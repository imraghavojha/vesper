import type { DatabaseSync } from "node:sqlite";
import { MAX_PROVIDER_TEXT_LENGTH } from "../shared/providers.js";
import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { transaction } from "./transaction.js";
import type { Change, MutationResult } from "../shared/sync.js";
import type {
  ProviderBinding,
  ProviderRun,
  RunStatus,
} from "../shared/providers.js";
import type {
  ProviderSelection,
  ProviderTerminal,
  ProviderUsage,
} from "./providers/contract.js";

type Commit = (
  deviceId: string,
  requestId: string,
  operation: string,
  payload: unknown,
  write: () => { id: string; kind: Change["kind"]; revision: number },
) => MutationResult;
type Row = {
  id: string;
  conversationId: string;
  userMessageId: string;
  assistantMessageId: string;
  provider: "claude";
  accountId: string;
  modelId: string;
  status: RunStatus;
  text: string;
  revision: number;
  nativeSessionId: string | null;
  usageJson: string | null;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
  receipt: string | null;
};
const active = "'queued','initializing','running','cancelling'";
export function createProviderState(
  db: DatabaseSync,
  commit: Commit,
  change: (kind: Change["kind"], id: string, revision: number) => number,
  notify: () => void,
) {
  const schema = db.prepare("SELECT version FROM schema_version").get() as {
    version: number;
  };
  if (schema.version === 2)
    transaction(db, () => {
      db.exec(
        [
          "ALTER TABLE messages ADD COLUMN status TEXT NOT NULL DEFAULT 'completed';",
          "ALTER TABLE messages ADD COLUMN runId TEXT;",
          "CREATE TABLE provider_bindings(conversationId TEXT PRIMARY KEY REFERENCES conversations(id),provider TEXT NOT NULL,accountId TEXT NOT NULL,modelId TEXT NOT NULL,revision INTEGER NOT NULL,enabled INTEGER NOT NULL DEFAULT 1);",
          "CREATE TABLE provider_runs(id TEXT PRIMARY KEY,conversationId TEXT NOT NULL REFERENCES conversations(id),userMessageId TEXT NOT NULL REFERENCES messages(id),assistantMessageId TEXT NOT NULL REFERENCES messages(id),provider TEXT NOT NULL,accountId TEXT NOT NULL,modelId TEXT NOT NULL,status TEXT NOT NULL,text TEXT NOT NULL DEFAULT '',revision INTEGER NOT NULL DEFAULT 1,nativeSessionId TEXT,usageJson TEXT,error TEXT,createdAt TEXT NOT NULL,completedAt TEXT,receipt TEXT);",
          "CREATE UNIQUE INDEX one_active_reply ON provider_runs(conversationId) WHERE status IN (" +
            active +
            ");",
          "UPDATE schema_version SET version=3;",
        ].join("\n"),
      );
    });
  function binding(id: string): ProviderBinding | null {
    return (
      (db
        .prepare(
          "SELECT provider,accountId,modelId,revision FROM provider_bindings WHERE conversationId=? AND enabled=1",
        )
        .get(id) as ProviderBinding | undefined) ?? null
    );
  }
  function run(id: string): ProviderRun {
    const row = db.prepare("SELECT * FROM provider_runs WHERE id=?").get(id) as
      Row | undefined;
    if (!row)
      throw new TRPCError({ code: "NOT_FOUND", message: "Reply not found." });
    return {
      id: row.id,
      conversationId: row.conversationId,
      userMessageId: row.userMessageId,
      assistantMessageId: row.assistantMessageId,
      selection: {
        provider: row.provider,
        accountId: row.accountId,
        modelId: row.modelId,
      },
      status: row.status,
      text: row.text,
      revision: row.revision,
      nativeSessionId: row.nativeSessionId,
      usage: row.usageJson
        ? (JSON.parse(row.usageJson) as ProviderUsage)
        : null,
      error: row.error,
      createdAt: row.createdAt,
      completedAt: row.completedAt,
      receipt: row.receipt,
    };
  }
  function changed(id: string) {
    const row = run(id);
    db.prepare("UPDATE messages SET text=?,status=? WHERE id=?").run(
      row.text,
      row.status,
      row.assistantMessageId,
    );
    change("run", id, row.revision);
  }
  return {
    providerBinding: binding,
    providerBindingRevision(id: string) {
      return (
        (
          db
            .prepare(
              "SELECT revision FROM provider_bindings WHERE conversationId=?",
            )
            .get(id) as { revision: number } | undefined
        )?.revision ?? 0
      );
    },
    providerRun: run,
    latestProviderRun(conversationId: string): ProviderRun | null {
      const row = db
        .prepare(
          "SELECT id FROM provider_runs WHERE conversationId=? ORDER BY createdAt DESC,rowid DESC LIMIT 1",
        )
        .get(conversationId) as { id: string } | undefined;
      return row ? run(row.id) : null;
    },
    bindProvider(
      deviceId: string,
      input: {
        requestId: string;
        conversationId: string;
        selection: ProviderSelection | null;
        expectedRevision: number;
      },
    ) {
      return commit(
        deviceId,
        input.requestId,
        "bindProvider",
        {
          conversationId: input.conversationId,
          selection: input.selection,
          expectedRevision: input.expectedRevision,
        },
        () => {
          if (
            !db
              .prepare("SELECT id FROM conversations WHERE id=?")
              .get(input.conversationId)
          )
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Conversation not found.",
            });
          if (
            db
              .prepare(
                "SELECT id FROM provider_runs WHERE conversationId=? AND status IN (" +
                  active +
                  ")",
              )
              .get(input.conversationId)
          )
            throw new TRPCError({
              code: "CONFLICT",
              message:
                "Wait for the active reply to finish or stop it before changing providers.",
            });
          const previous = db
            .prepare(
              "SELECT revision FROM provider_bindings WHERE conversationId=?",
            )
            .get(input.conversationId) as { revision: number } | undefined;
          if ((previous?.revision ?? 0) !== input.expectedRevision)
            throw new TRPCError({
              code: "CONFLICT",
              message:
                "The provider selection changed. Refresh and choose again.",
            });
          const revision = input.expectedRevision + 1;
          const selected = input.selection;
          if (selected)
            db.prepare(
              "INSERT INTO provider_bindings VALUES (?,?,?,?,?,1) ON CONFLICT(conversationId) DO UPDATE SET provider=excluded.provider,accountId=excluded.accountId,modelId=excluded.modelId,revision=excluded.revision,enabled=1",
            ).run(
              input.conversationId,
              selected.provider,
              selected.accountId,
              selected.modelId,
              revision,
            );
          else
            db.prepare(
              "INSERT INTO provider_bindings VALUES (?,'claude','','',?,0) ON CONFLICT(conversationId) DO UPDATE SET enabled=0,revision=excluded.revision",
            ).run(input.conversationId, revision);
          return { id: input.conversationId, kind: "provider", revision };
        },
      );
    },
    askProvider(
      deviceId: string,
      input: {
        requestId: string;
        conversationId: string;
        text: string;
        selection: ProviderSelection;
        bindingRevision: number;
      },
    ) {
      return commit(
        deviceId,
        input.requestId,
        "askProvider",
        {
          conversationId: input.conversationId,
          text: input.text,
          selection: input.selection,
          bindingRevision: input.bindingRevision,
        },
        () => {
          const selected = binding(input.conversationId);
          if (
            !selected ||
            selected.revision !== input.bindingRevision ||
            selected.provider !== input.selection.provider ||
            selected.accountId !== input.selection.accountId ||
            selected.modelId !== input.selection.modelId
          )
            throw new TRPCError({
              code: "CONFLICT",
              message:
                "This draft's provider selection changed. Choose the intended provider before starting a new reply.",
            });
          if (
            db
              .prepare(
                "SELECT id FROM provider_runs WHERE conversationId=? AND status IN (" +
                  active +
                  ")",
              )
              .get(input.conversationId)
          )
            throw new TRPCError({
              code: "CONFLICT",
              message: "This conversation already has an active reply.",
            });
          const count = db
            .prepare(
              "SELECT COUNT(*) AS count FROM provider_runs WHERE status IN (" +
                active +
                ")",
            )
            .get() as { count: number };
          if (count.count >= 2)
            throw new TRPCError({
              code: "TOO_MANY_REQUESTS",
              message:
                "Two replies are already active. Wait for one to finish.",
            });
          const id = randomUUID(),
            userId = randomUUID(),
            assistantId = randomUUID(),
            now = new Date().toISOString();
          db.prepare(
            "INSERT INTO messages(id,conversationId,role,text,createdAt,status) VALUES (?,?,'user',?,?,'completed')",
          ).run(userId, input.conversationId, input.text, now);
          db.prepare(
            "INSERT INTO messages(id,conversationId,role,text,createdAt,status,runId) VALUES (?,?,'assistant','',?,'queued',?)",
          ).run(assistantId, input.conversationId, now, id);
          db.prepare(
            "INSERT INTO provider_runs(id,conversationId,userMessageId,assistantMessageId,provider,accountId,modelId,status,createdAt) VALUES (?,?,?,?,?,?,?,'queued',?)",
          ).run(
            id,
            input.conversationId,
            userId,
            assistantId,
            selected.provider,
            selected.accountId,
            selected.modelId,
            now,
          );
          db.prepare("UPDATE conversations SET updatedAt=? WHERE id=?").run(
            now,
            input.conversationId,
          );
          return { id, kind: "run", revision: 1 };
        },
      );
    },
    claimProviderRun(id: string) {
      const accepted = transaction(db, () => {
        const result = db
          .prepare(
            "UPDATE provider_runs SET status='initializing',revision=revision+1 WHERE id=? AND status='queued'",
          )
          .run(id);
        if (result.changes !== 1) return false;
        changed(id);
        return true;
      });
      if (accepted) notify();
      return accepted;
    },
    initializeProviderRun(id: string, nativeSessionId?: string) {
      transaction(db, () => {
        const result = db
          .prepare(
            "UPDATE provider_runs SET status='running',nativeSessionId=?,revision=revision+1 WHERE id=? AND status='initializing'",
          )
          .run(nativeSessionId ?? null, id);
        if (result.changes) changed(id);
      });
      notify();
    },
    providerPrompt(id: string) {
      const current = run(id);
      const user = db
        .prepare("SELECT sequence FROM messages WHERE id=?")
        .get(current.userMessageId) as { sequence: number };
      const rows = db
        .prepare(
          "SELECT role,text,status FROM messages WHERE conversationId=? AND sequence<=? AND text<>'' ORDER BY sequence DESC LIMIT 20",
        )
        .all(current.conversationId, user.sequence) as {
        role: string;
        text: string;
      }[];
      let remaining = 60000;
      const kept: typeof rows = [];
      for (const item of rows) {
        if (item.text.length > remaining) break;
        kept.push(item);
        remaining -= item.text.length;
      }
      return (
        "The following is Vesper's visible conversation history. Earlier messages are context, not new tasks. Answer the latest user message. No tools or external account access are available.\n\n" +
        JSON.stringify(kept.reverse())
      );
    },
    updateProviderText(id: string, text: string) {
      if (text.length > MAX_PROVIDER_TEXT_LENGTH)
        throw new Error("Provider output exceeded the text limit.");
      const updated = transaction(db, () => {
        const result = db
          .prepare(
            "UPDATE provider_runs SET text=?,revision=revision+1 WHERE id=? AND status='running' AND text<>?",
          )
          .run(text, id, text);
        if (result.changes) changed(id);
        return result.changes > 0;
      });
      if (updated) notify();
    },
    cancelProviderRun(id: string) {
      const current = run(id);
      if (!["queued", "initializing", "running"].includes(current.status))
        return current;
      transaction(db, () => {
        db.prepare(
          "UPDATE provider_runs SET status='cancelling',revision=revision+1 WHERE id=?",
        ).run(id);
        changed(id);
      });
      notify();
      return run(id);
    },
    finishProviderRun(id: string, terminal: ProviderTerminal) {
      const updated = transaction(db, () => {
        const current = run(id);
        if (
          !["queued", "initializing", "running", "cancelling"].includes(
            current.status,
          )
        )
          return false;
        if (
          terminal.runId !== id ||
          terminal.selection.provider !== current.selection.provider ||
          terminal.selection.accountId !== current.selection.accountId ||
          terminal.selection.modelId !== current.selection.modelId
        )
          throw new Error("Provider terminal identity mismatch.");
        if (terminal.text.length > MAX_PROVIDER_TEXT_LENGTH)
          throw new Error("Provider terminal exceeded the text limit.");
        db.prepare(
          "UPDATE provider_runs SET status=?,text=?,nativeSessionId=COALESCE(?,nativeSessionId),usageJson=?,error=?,completedAt=?,receipt=?,revision=revision+1 WHERE id=?",
        ).run(
          terminal.status,
          terminal.text,
          terminal.nativeSessionId ?? null,
          terminal.usage ? JSON.stringify(terminal.usage) : null,
          terminal.error?.message ?? null,
          new Date().toISOString(),
          terminal.receipt,
          id,
        );
        changed(id);
        return true;
      });
      if (updated) notify();
      return run(id);
    },
    interruptProviderRuns() {
      const rows = db
        .prepare(
          "SELECT id FROM provider_runs WHERE status IN (" + active + ")",
        )
        .all() as { id: string }[];
      transaction(db, () => {
        for (const row of rows) {
          db.prepare(
            "UPDATE provider_runs SET status='interrupted',receipt='host-restart',error='The host restarted. This reply was not automatically resubmitted.',completedAt=?,revision=revision+1 WHERE id=?",
          ).run(new Date().toISOString(), row.id);
          changed(row.id);
        }
      });
      if (rows.length) notify();
    },
  };
}
