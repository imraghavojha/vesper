import type { DatabaseSync } from "node:sqlite";
import { createHash, randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { transaction } from "./transaction.js";
import { createProviderState } from "./provider-state.js";
import type {
  Appearance,
  Conversation,
  Message,
  Settings,
  Change,
  MutationResult,
} from "../shared/sync.js";

export function createConversations(
  database: DatabaseSync,
  notify: () => void,
) {
  const schema = database
    .prepare("SELECT version FROM schema_version")
    .get() as { version: number };
  if (schema.version === 1)
    transaction(database, () => {
      database.exec(`
      CREATE TABLE conversations (id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('main','side')), title TEXT NOT NULL, revision INTEGER NOT NULL, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL);
      CREATE UNIQUE INDEX one_main_conversation ON conversations(kind) WHERE kind='main';
      CREATE TABLE messages (sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, conversationId TEXT NOT NULL REFERENCES conversations(id), role TEXT NOT NULL CHECK(role IN ('user','assistant')), text TEXT NOT NULL, createdAt TEXT NOT NULL);
      CREATE INDEX conversation_messages ON messages(conversationId, sequence);
      CREATE TABLE settings (singleton INTEGER PRIMARY KEY CHECK(singleton=1), appearance TEXT NOT NULL CHECK(appearance IN ('system','light','dark')), revision INTEGER NOT NULL);
      CREATE TABLE mutation_receipts (requestId TEXT PRIMARY KEY, deviceId TEXT NOT NULL REFERENCES devices(id), operation TEXT NOT NULL, payloadHash TEXT NOT NULL, resultJson TEXT NOT NULL);
      CREATE TABLE changes (cursor INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, entityId TEXT NOT NULL, revision INTEGER NOT NULL);
      INSERT INTO settings VALUES (1, 'system', 1);
      UPDATE schema_version SET version=2;
    `);
      const now = new Date().toISOString();
      database
        .prepare("INSERT INTO conversations VALUES (?, ?, ?, 1, ?, ?)")
        .run(randomUUID(), "main", "Main chat", now, now);
    });
  const retention = Number(process.env.VESPER_CHANGE_RETENTION ?? 1000);
  if (!Number.isInteger(retention) || retention < 10 || retention > 100000)
    throw new Error("Change retention must be between 10 and 100000.");
  const cursor = () =>
    Number(
      (
        database
          .prepare("SELECT COALESCE(MAX(cursor),0) AS cursor FROM changes")
          .get() as { cursor: number }
      ).cursor,
    );
  const settings = () =>
    database
      .prepare("SELECT appearance,revision FROM settings WHERE singleton=1")
      .get() as Settings;
  function getConversation(id: string) {
    const result = database
      .prepare("SELECT * FROM conversations WHERE id=?")
      .get(id) as Conversation | undefined;
    if (!result)
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Conversation not found.",
      });
    return result;
  }
  function messagePage(conversationId: string, before?: number) {
    getConversation(conversationId);
    const rows = database
      .prepare(
        "SELECT * FROM messages WHERE conversationId=? AND sequence < ? ORDER BY sequence DESC LIMIT 101",
      )
      .all(conversationId, before ?? Number.MAX_SAFE_INTEGER) as Message[];
    return {
      messages: rows.slice(0, 100).reverse(),
      hasMore: rows.length > 100,
    };
  }
  function appendChange(kind: Change["kind"], id: string, revision: number) {
    const entry = database
      .prepare(
        "INSERT INTO changes(kind,entityId,revision) VALUES (?,?,?) RETURNING cursor",
      )
      .get(kind, id, revision) as { cursor: number };
    database
      .prepare("DELETE FROM changes WHERE cursor <= ?")
      .run(entry.cursor - retention);
    return entry.cursor;
  }
  function mutate(
    deviceId: string,
    requestId: string,
    operation: string,
    payload: unknown,
    write: () => { id: string; kind: Change["kind"]; revision: number },
  ): MutationResult {
    const payloadHash = createHash("sha256")
      .update(JSON.stringify([operation, payload]))
      .digest("hex");
    let changed = false;
    const result = transaction(database, () => {
      if (
        !database
          .prepare("SELECT id FROM devices WHERE id=? AND revokedAt IS NULL")
          .get(deviceId)
      ) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "This device no longer has access.",
        });
      }
      const prior = database
        .prepare("SELECT * FROM mutation_receipts WHERE requestId=?")
        .get(requestId) as
        | {
            deviceId: string;
            operation: string;
            payloadHash: string;
            resultJson: string;
          }
        | undefined;
      if (prior) {
        if (
          prior.deviceId !== deviceId ||
          prior.operation !== operation ||
          prior.payloadHash !== payloadHash
        )
          throw new TRPCError({
            code: "CONFLICT",
            message:
              "This request ID was already used for a different operation. Start a new action.",
          });
        return JSON.parse(prior.resultJson) as MutationResult;
      }
      const change = write();
      const receipt = {
        id: change.id,
        cursor: appendChange(change.kind, change.id, change.revision),
        revision: change.revision,
      };
      database
        .prepare("INSERT INTO mutation_receipts VALUES (?,?,?,?,?)")
        .run(
          requestId,
          deviceId,
          operation,
          payloadHash,
          JSON.stringify(receipt),
        );
      changed = true;
      return receipt;
    });
    if (changed) notify();
    return result;
  }
  const providerState = createProviderState(
    database,
    mutate,
    appendChange,
    notify,
  );
  return {
    ...providerState,
    // The vault publishes only metadata invalidation, never a secret payload or hash.
    appendVaultChange(id: string, revision: number) {
      return appendChange("vault", id, revision);
    },
    appendConnectorChange(id: string, revision: number) {
      return appendChange("connector", id, revision);
    },
    changeCursor: cursor,
    sharedSettings: settings,
    syncSnapshot(conversationId?: string) {
      return transaction(database, () => {
        const conversations = database
          .prepare(
            "SELECT * FROM conversations ORDER BY CASE kind WHEN 'main' THEN 0 ELSE 1 END, createdAt,id",
          )
          .all() as Conversation[];
        const selected = conversationId ?? conversations[0]!.id;
        return {
          cursor: cursor(),
          conversations,
          settings: settings(),
          conversationId: selected,
          providerBinding: providerState.providerBinding(selected),
          providerBindingRevision:
            providerState.providerBindingRevision(selected),
          providerRun: providerState.latestProviderRun(selected),
          ...messagePage(selected),
        };
      });
    },
    changes(after: number, limit: number) {
      return transaction(database, () => {
        const newest = cursor();
        const first = database
          .prepare("SELECT MIN(cursor) AS cursor FROM changes")
          .get() as { cursor: number | null };
        const gap =
          after > newest || (first.cursor !== null && after < first.cursor - 1);
        if (gap)
          return {
            resetRequired: true,
            events: [] as Change[],
            nextCursor: newest,
            hasMore: false,
          };
        const events = database
          .prepare(
            "SELECT * FROM changes WHERE cursor>? ORDER BY cursor LIMIT ?",
          )
          .all(after, limit + 1) as Change[];
        const page = events.slice(0, limit);
        return {
          resetRequired: false,
          events: page,
          nextCursor: page.at(-1)?.cursor ?? after,
          hasMore: events.length > limit,
        };
      });
    },
    messagePage,
    mutationReceipt(requestId: string) {
      const receipt = database
        .prepare(
          "SELECT operation,payloadHash,resultJson FROM mutation_receipts WHERE requestId=?",
        )
        .get(requestId) as
        | { operation: string; payloadHash: string; resultJson: string }
        | undefined;
      return receipt
        ? {
            operation: receipt.operation,
            payloadHash: receipt.payloadHash,
            result: JSON.parse(receipt.resultJson) as MutationResult,
          }
        : null;
    },
    createConversation(
      deviceId: string,
      input: { requestId: string; title: string },
    ) {
      return mutate(
        deviceId,
        input.requestId,
        "createConversation",
        { title: input.title },
        () => {
          const id = randomUUID();
          const now = new Date().toISOString();
          database
            .prepare("INSERT INTO conversations VALUES (?, ?, ?, 1, ?, ?)")
            .run(id, "side", input.title, now, now);
          return { id, kind: "conversation", revision: 1 };
        },
      );
    },
    renameConversation(
      deviceId: string,
      input: {
        requestId: string;
        id: string;
        title: string;
        expectedRevision: number;
      },
    ) {
      return mutate(
        deviceId,
        input.requestId,
        "renameConversation",
        {
          id: input.id,
          title: input.title,
          expectedRevision: input.expectedRevision,
        },
        () => {
          getConversation(input.id);
          const result = database
            .prepare(
              "UPDATE conversations SET title=?,revision=revision+1,updatedAt=? WHERE id=? AND revision=?",
            )
            .run(
              input.title,
              new Date().toISOString(),
              input.id,
              input.expectedRevision,
            );
          if (result.changes !== 1)
            throw new TRPCError({
              code: "CONFLICT",
              message:
                "This conversation changed on another device. Refresh its name before editing again.",
            });
          return {
            id: input.id,
            kind: "conversation",
            revision: input.expectedRevision + 1,
          };
        },
      );
    },
    sendMessage(
      deviceId: string,
      input: { requestId: string; conversationId: string; text: string },
    ) {
      return mutate(
        deviceId,
        input.requestId,
        "sendMessage",
        { conversationId: input.conversationId, text: input.text },
        () => {
          getConversation(input.conversationId);
          const id = randomUUID();
          const now = new Date().toISOString();
          const row = database
            .prepare(
              "INSERT INTO messages(id,conversationId,role,text,createdAt) VALUES (?,?,'user',?,?) RETURNING sequence",
            )
            .get(id, input.conversationId, input.text, now) as {
            sequence: number;
          };
          database
            .prepare("UPDATE conversations SET updatedAt=? WHERE id=?")
            .run(now, input.conversationId);
          return { id, kind: "message", revision: row.sequence };
        },
      );
    },
    setAppearance(
      deviceId: string,
      input: {
        requestId: string;
        appearance: Appearance;
        expectedRevision: number;
      },
    ) {
      return mutate(
        deviceId,
        input.requestId,
        "setAppearance",
        {
          appearance: input.appearance,
          expectedRevision: input.expectedRevision,
        },
        () => {
          const result = database
            .prepare(
              "UPDATE settings SET appearance=?,revision=revision+1 WHERE singleton=1 AND revision=?",
            )
            .run(input.appearance, input.expectedRevision);
          if (result.changes !== 1)
            throw new TRPCError({
              code: "CONFLICT",
              message:
                "Appearance changed on another device. Refresh and choose again.",
            });
          return {
            id: "appearance",
            kind: "settings",
            revision: input.expectedRevision + 1,
          };
        },
      );
    },
  };
}
