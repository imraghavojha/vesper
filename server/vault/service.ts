import type { DatabaseSync } from "node:sqlite";
import { lstatSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import {
  MAX_VAULT_ENTRIES,
  MAX_VAULT_SECRET_BYTES,
  type VaultEntryMetadata,
  type VaultEntryVersion,
  type VaultPutInput,
  type VaultSnapshot,
  type VaultStatus,
} from "../../shared/vault.js";
import { transaction } from "../transaction.js";
import {
  newVaultKey,
  openValue,
  sealValue,
  unwrapRecoveryKey,
  validateRecoveryPassphrase,
  wrapRecoveryKey,
  type VaultKey,
} from "./crypto.js";
import { readKeyRing, VaultKeyFileError, writeKeyRing } from "./key-file.js";

type ErrorCode =
  | "INVALID_INPUT"
  | "NOT_INITIALIZED"
  | "LOCKED"
  | "MISSING_KEY"
  | "UNAVAILABLE"
  | "CONFLICT"
  | "NOT_FOUND"
  | "REVOKED"
  | "SCOPE_MISMATCH"
  | "USE_FAILED";

export class VaultError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "VaultError";
  }
}

type StateRow = {
  workspaceId: string;
  keyId: string;
  verifierJson: string;
  recoveryJson: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  locked: number;
};
type EntryRow = Omit<VaultEntryMetadata, "origins"> & {
  originsJson: string;
  sealedJson: string | null;
};
export type VaultOptions = {
  database: DatabaseSync;
  workspaceId: string;
  dataDirectory: string;
  keyFilePath?: string;
  startLocked?: boolean;
  appendChange(id: string, revision: number): unknown;
  notify(): void;
};

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const verifier = Buffer.from("Vesper shared vault key verification, version 1");
const invalid = () => new VaultError("INVALID_INPUT", "Invalid secure entry.");
const unavailable = () =>
  new VaultError(
    "UNAVAILABLE",
    "The vault cannot be opened. Restore its matching host key or database backup.",
  );

function origins(values: string[]): string[] {
  if (!Array.isArray(values) || values.length < 1 || values.length > 8)
    throw invalid();
  const normalized = values.map((value) => {
    if (typeof value !== "string" || value.length > 2048) throw invalid();
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw invalid();
    }
    if (
      url.protocol !== "https:" ||
      !url.hostname ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw invalid();
    return url.origin;
  });
  return [...new Set(normalized)].sort();
}

function metadata(row: EntryRow): VaultEntryMetadata {
  return {
    id: row.id,
    kind: row.kind,
    label: row.label,
    accountId: row.accountId,
    origins: origins(JSON.parse(row.originsJson) as string[]),
    revision: row.revision,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastUsedAt: row.lastUsedAt,
    revokedAt: row.revokedAt,
  };
}

function entryAad(workspaceId: string, row: VaultEntryMetadata): string {
  return JSON.stringify([
    "vesper-vault-entry",
    1,
    workspaceId,
    row.id,
    row.kind,
    row.label,
    row.accountId,
    row.origins,
    row.revision,
    row.createdAt,
    row.updatedAt,
  ]);
}

function stateAad(workspaceId: string, keyId: string): string {
  return JSON.stringify(["vesper-vault-state", 1, workspaceId, keyId]);
}

export function createVault(options: VaultOptions) {
  const db = options.database;
  const workspaceId = options.workspaceId;
  const dataDirectory = resolve(options.dataDirectory);
  const keyFilePath =
    options.keyFilePath ??
    resolve(dataDirectory + "-secrets", "vault-keys.json");
  const keyRelative = relative(dataDirectory, resolve(keyFilePath));
  const unsafeKeyPath =
    !isAbsolute(keyFilePath) ||
    (keyRelative !== ".." &&
      !keyRelative.startsWith(".." + sep) &&
      !isAbsolute(keyRelative));
  const schema = db.prepare("SELECT version FROM schema_version").get() as {
    version: number;
  };
  if (schema.version === 3)
    transaction(db, () => {
      db.exec(`
        CREATE TABLE vault_state (
          singleton INTEGER PRIMARY KEY CHECK(singleton=1),
          workspaceId TEXT NOT NULL, keyId TEXT NOT NULL,
          verifierJson TEXT NOT NULL, recoveryJson TEXT NOT NULL,
          revision INTEGER NOT NULL, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL,
          locked INTEGER NOT NULL DEFAULT 0 CHECK(locked IN (0,1))
        );
        CREATE TABLE vault_entries (
          id TEXT PRIMARY KEY,
          kind TEXT NOT NULL CHECK(kind IN ('password','token','oauth')),
          label TEXT NOT NULL, accountId TEXT NOT NULL, originsJson TEXT NOT NULL,
          revision INTEGER NOT NULL, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL,
          lastUsedAt TEXT, revokedAt TEXT, sealedJson TEXT,
          CHECK((revokedAt IS NULL AND sealedJson IS NOT NULL) OR
                (revokedAt IS NOT NULL AND sealedJson IS NULL))
        );
        UPDATE schema_version SET version=4;
      `);
    });
  else if (schema.version !== 4) throw unavailable();
  // IDs are never recycled: an old approved reference must not name a new secret.
  db.exec(`CREATE TABLE IF NOT EXISTS vault_retired_ids (
    id TEXT PRIMARY KEY, retiredAt TEXT NOT NULL
  )`);
  // Also upgrade private preview databases created earlier in this unreleased slice.
  transaction(db, () => {
    if (
      !db
        .prepare("PRAGMA table_info(vault_state)")
        .all()
        .some((column) => column.name === "locked")
    )
      db.exec(
        "ALTER TABLE vault_state ADD COLUMN locked INTEGER NOT NULL DEFAULT 0 CHECK(locked IN (0,1))",
      );
  });
  if (options.startLocked)
    transaction(db, () => {
      if (state()?.locked === 0) {
        db.prepare("UPDATE vault_state SET locked=1 WHERE singleton=1").run();
        changed("vault");
      }
    });

  function state(): StateRow | undefined {
    const row = db
      .prepare("SELECT * FROM vault_state WHERE singleton=1")
      .get() as StateRow | undefined;
    if (row && row.workspaceId !== workspaceId) throw unavailable();
    return row;
  }
  function initialized(): StateRow {
    const row = state();
    if (!row)
      throw new VaultError("NOT_INITIALIZED", "Set up the shared vault first.");
    return row;
  }
  function configured() {
    if (unsafeKeyPath)
      throw new VaultError(
        "UNAVAILABLE",
        "The host key file must be outside the workspace data directory.",
      );
  }
  function keyPathEntry() {
    try {
      return lstatSync(keyFilePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw unavailable();
    }
  }
  function keys(): VaultKey[] {
    configured();
    try {
      return readKeyRing(keyFilePath, workspaceId);
    } catch (error) {
      if (error instanceof VaultKeyFileError && error.code === "missing")
        throw new VaultError(
          "MISSING_KEY",
          "The host key is missing. Recover it with the recovery passphrase; do not create a new vault.",
        );
      throw unavailable();
    }
  }
  function keyFor(row: StateRow): VaultKey {
    const ring = keys();
    try {
      const found = ring.find((key) => key.id === row.keyId);
      if (!found) throw unavailable();
      const proof = openValue(
        found,
        JSON.parse(row.verifierJson),
        stateAad(workspaceId, row.keyId),
      );
      try {
        if (!proof.equals(verifier)) throw unavailable();
      } finally {
        proof.fill(0);
      }
      return { id: found.id, bytes: Buffer.from(found.bytes) };
    } catch {
      throw unavailable();
    } finally {
      for (const key of ring) key.bytes.fill(0);
    }
  }
  function unlockedKey(row = initialized()): VaultKey {
    if (row.locked !== 0)
      throw new VaultError("LOCKED", "Unlock the shared vault first.");
    return keyFor(row);
  }
  function record(id: string): EntryRow {
    if (!uuid.test(id)) throw invalid();
    const row = db.prepare("SELECT * FROM vault_entries WHERE id=?").get(id) as
      EntryRow | undefined;
    if (!row) throw new VaultError("NOT_FOUND", "Secure entry not found.");
    return row;
  }
  function active(row: EntryRow) {
    if (row.revokedAt !== null || row.sealedJson === null)
      throw new VaultError("REVOKED", "This secure entry was revoked.");
  }
  function checkRevision(actual: number, expected: number) {
    if (!Number.isSafeInteger(expected) || expected < 0) throw invalid();
    if (actual !== expected)
      throw new VaultError(
        "CONFLICT",
        "The vault changed. Refresh its metadata before trying again; the previous request may already have completed.",
      );
  }
  function changed(id: string) {
    const now = new Date().toISOString();
    const row = db
      .prepare(
        "UPDATE vault_state SET revision=revision+1,updatedAt=? WHERE singleton=1 RETURNING revision",
      )
      .get(now) as { revision: number };
    options.appendChange(id, row.revision);
  }
  function decrypt(key: VaultKey, row: EntryRow): Buffer {
    active(row);
    try {
      return openValue(
        key,
        JSON.parse(row.sealedJson!),
        entryAad(workspaceId, metadata(row)),
      );
    } catch {
      throw unavailable();
    }
  }
  function status(): VaultStatus {
    let row: StateRow | undefined;
    try {
      row = state();
      configured();
      if (!row) {
        const count = db
          .prepare("SELECT COUNT(*) AS count FROM vault_entries")
          .get() as { count: number };
        if (count.count) throw unavailable();
        return {
          state: "uninitialized",
          revision: 0,
          recoveryAvailable: false,
          message: "Set up encrypted storage on this workspace's host.",
        };
      }
      const keyFile = keyPathEntry();
      if (!keyFile)
        return {
          state: "missing-key",
          revision: row.revision,
          recoveryAvailable: true,
          message:
            "The host key is missing. Use the recovery passphrase to restore it.",
        };
      if (!keyFile.isFile() || keyFile.isSymbolicLink()) throw unavailable();
      const key = keyFor(row);
      key.bytes.fill(0);
      if (row.locked !== 0)
        return {
          state: "locked",
          revision: row.revision,
          recoveryAvailable: true,
          message: "The shared vault is locked. Credential use is paused.",
        };
      return {
        state: "ready",
        revision: row.revision,
        recoveryAvailable: true,
        message: "The shared vault is unlocked.",
      };
    } catch {
      return {
        state: "unavailable",
        revision: row?.revision ?? 0,
        recoveryAvailable: !!row,
        message:
          "The vault cannot be opened. Check its private host key or restore a matching backup.",
      };
    }
  }
  function snapshot(): VaultSnapshot {
    const current = status();
    return {
      status: current,
      entries: (
        db
          .prepare("SELECT * FROM vault_entries ORDER BY createdAt,id")
          .all() as EntryRow[]
      ).map(metadata),
    };
  }

  return {
    snapshot,
    initialize(recoveryPassphrase: string) {
      configured();
      validateRecoveryPassphrase(recoveryPassphrase);
      transaction(db, () => {
        if (state())
          throw new VaultError(
            "CONFLICT",
            "The shared vault is already initialized. Refresh its status.",
          );
        const count = db
          .prepare("SELECT COUNT(*) AS count FROM vault_entries")
          .get() as { count: number };
        if (count.count) throw unavailable();
        let ring: VaultKey[];
        let reused = true;
        try {
          ring = readKeyRing(keyFilePath, workspaceId);
        } catch (error) {
          if (!(error instanceof VaultKeyFileError) || error.code !== "missing")
            throw unavailable();
          ring = [newVaultKey()];
          reused = false;
          try {
            writeKeyRing(keyFilePath, workspaceId, ring, "create");
          } catch {
            for (const key of ring) key.bytes.fill(0);
            throw unavailable();
          }
        }
        try {
          // Reuse an exclusively published key after interrupted initialization.
          if (ring.length !== 1) throw unavailable();
          // An earlier publication may have failed its durability barrier.
          // Re-establish it before committing any ciphertext/recovery metadata.
          if (reused)
            try {
              writeKeyRing(keyFilePath, workspaceId, ring, "replace");
            } catch {
              throw unavailable();
            }
          const key = ring[0]!;
          const now = new Date().toISOString();
          const sealed = sealValue(
            key,
            verifier,
            stateAad(workspaceId, key.id),
          );
          const recovery = wrapRecoveryKey(
            key,
            workspaceId,
            recoveryPassphrase,
          );
          db.prepare(
            "INSERT INTO vault_state (singleton,workspaceId,keyId,verifierJson,recoveryJson,revision,createdAt,updatedAt,locked) VALUES (1,?,?,?,?,1,?,?,0)",
          ).run(
            workspaceId,
            key.id,
            JSON.stringify(sealed),
            JSON.stringify(recovery),
            now,
            now,
          );
          options.appendChange("vault", 1);
        } finally {
          for (const key of ring) key.bytes.fill(0);
        }
      });
      options.notify();
      return snapshot();
    },
    put(input: VaultPutInput): VaultEntryMetadata {
      if (
        !uuid.test(input.id) ||
        !["password", "token", "oauth"].includes(input.kind) ||
        typeof input.label !== "string" ||
        !input.label.trim() ||
        input.label.length > 80 ||
        typeof input.accountId !== "string" ||
        !input.accountId.trim() ||
        input.accountId.length > 256 ||
        (input.secret !== undefined &&
          (typeof input.secret !== "string" ||
            !input.secret.length ||
            /\p{Cs}/u.test(input.secret) ||
            Buffer.byteLength(input.secret, "utf8") > MAX_VAULT_SECRET_BYTES))
      )
        throw invalid();
      const allowedOrigins = origins(input.origins);
      const result = transaction(db, () => {
        const key = unlockedKey();
        let plaintext: Buffer | undefined;
        try {
          if (
            db
              .prepare("SELECT id FROM vault_retired_ids WHERE id=?")
              .get(input.id)
          )
            throw new VaultError(
              "CONFLICT",
              "This secure entry was deleted. Add a new entry instead of reusing its identity.",
            );
          const prior = db
            .prepare("SELECT * FROM vault_entries WHERE id=?")
            .get(input.id) as EntryRow | undefined;
          checkRevision(prior?.revision ?? 0, input.expectedRevision);
          if (prior) active(prior);
          if (!prior) {
            const count = db
              .prepare("SELECT COUNT(*) AS count FROM vault_entries")
              .get() as { count: number };
            if (count.count >= MAX_VAULT_ENTRIES)
              throw new VaultError(
                "CONFLICT",
                "Remove an unused secure entry before adding another.",
              );
            if (input.secret === undefined) throw invalid();
          }
          plaintext =
            input.secret !== undefined
              ? Buffer.from(input.secret, "utf8")
              : decrypt(key, prior!);
          const now = new Date().toISOString();
          const entry: VaultEntryMetadata = {
            id: input.id,
            kind: input.kind,
            label: input.label.trim(),
            accountId: input.accountId,
            origins: allowedOrigins,
            revision: (prior?.revision ?? 0) + 1,
            createdAt: prior?.createdAt ?? now,
            updatedAt: now,
            lastUsedAt: prior?.lastUsedAt ?? null,
            revokedAt: null,
          };
          const sealed = sealValue(
            key,
            plaintext,
            entryAad(workspaceId, entry),
          );
          db.prepare(
            `INSERT INTO vault_entries VALUES (?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(id) DO UPDATE SET kind=excluded.kind,label=excluded.label,accountId=excluded.accountId,
            originsJson=excluded.originsJson,revision=excluded.revision,updatedAt=excluded.updatedAt,sealedJson=excluded.sealedJson`,
          ).run(
            entry.id,
            entry.kind,
            entry.label,
            entry.accountId,
            JSON.stringify(entry.origins),
            entry.revision,
            entry.createdAt,
            entry.updatedAt,
            entry.lastUsedAt,
            entry.revokedAt,
            JSON.stringify(sealed),
          );
          changed(entry.id);
          return entry;
        } finally {
          plaintext?.fill(0);
          key.bytes.fill(0);
        }
      });
      options.notify();
      return result;
    },
    revoke(input: VaultEntryVersion): VaultEntryMetadata {
      const result = transaction(db, () => {
        initialized();
        const row = record(input.id);
        checkRevision(row.revision, input.expectedRevision);
        active(row);
        const now = new Date().toISOString();
        db.prepare(
          "UPDATE vault_entries SET sealedJson=NULL,revokedAt=?,updatedAt=?,revision=revision+1 WHERE id=?",
        ).run(now, now, row.id);
        changed(row.id);
        return metadata(record(row.id));
      });
      options.notify();
      return result;
    },
    remove(input: VaultEntryVersion) {
      transaction(db, () => {
        initialized();
        const row = record(input.id);
        checkRevision(row.revision, input.expectedRevision);
        db.prepare("INSERT INTO vault_retired_ids VALUES (?,?)").run(
          row.id,
          new Date().toISOString(),
        );
        db.prepare("DELETE FROM vault_entries WHERE id=?").run(row.id);
        changed(row.id);
      });
      options.notify();
      return { removed: true as const };
    },
    lock() {
      transaction(db, () => {
        if (initialized().locked === 0) {
          db.prepare("UPDATE vault_state SET locked=1 WHERE singleton=1").run();
          changed("vault");
        }
      });
      options.notify();
      return snapshot();
    },
    unlock() {
      transaction(db, () => {
        const row = initialized();
        const key = keyFor(row);
        key.bytes.fill(0);
        if (row.locked !== 0) {
          db.prepare("UPDATE vault_state SET locked=0 WHERE singleton=1").run();
          changed("vault");
        }
      });
      options.notify();
      return snapshot();
    },
    recover(recoveryPassphrase: string) {
      configured();
      validateRecoveryPassphrase(recoveryPassphrase);
      transaction(db, () => {
        const row = initialized();
        if (keyPathEntry())
          throw new VaultError(
            "CONFLICT",
            "A host key file already exists. Recovery does not replace it; restore the matching key or move a damaged file aside privately first.",
          );
        let key: VaultKey;
        try {
          key = unwrapRecoveryKey(
            JSON.parse(row.recoveryJson),
            workspaceId,
            recoveryPassphrase,
          );
        } catch {
          throw new VaultError(
            "UNAVAILABLE",
            "The recovery passphrase or recovery data could not unlock this vault.",
          );
        }
        try {
          if (key.id !== row.keyId) throw unavailable();
          const proof = openValue(
            key,
            JSON.parse(row.verifierJson),
            stateAad(workspaceId, row.keyId),
          );
          try {
            if (!proof.equals(verifier)) throw unavailable();
          } finally {
            proof.fill(0);
          }
          for (const entry of db
            .prepare("SELECT * FROM vault_entries WHERE revokedAt IS NULL")
            .all() as EntryRow[]) {
            const plaintext = decrypt(key, entry);
            plaintext.fill(0);
          }
          try {
            writeKeyRing(keyFilePath, workspaceId, [key], "create");
          } catch (error) {
            if (error instanceof VaultKeyFileError && error.code === "exists")
              throw new VaultError(
                "CONFLICT",
                "A host key file already exists. Recovery does not replace it; restore the matching key or move a damaged file aside privately first.",
              );
            throw unavailable();
          }
          db.prepare("UPDATE vault_state SET locked=0 WHERE singleton=1").run();
          changed("vault");
        } finally {
          key.bytes.fill(0);
        }
      });
      options.notify();
      return snapshot();
    },
    rotate(input: { expectedRevision: number; recoveryPassphrase: string }) {
      configured();
      validateRecoveryPassphrase(input.recoveryPassphrase);
      const next = newVaultKey();
      try {
        const recovery = wrapRecoveryKey(
          next,
          workspaceId,
          input.recoveryPassphrase,
        );
        transaction(db, () => {
          const row = initialized();
          checkRevision(row.revision, input.expectedRevision);
          const previous = unlockedKey(row);
          try {
            // The DB write lock serializes keyring changes with other hosts/admin commands.
            writeKeyRing(keyFilePath, workspaceId, [previous, next], "replace");
            for (const entry of db
              .prepare("SELECT * FROM vault_entries WHERE revokedAt IS NULL")
              .all() as EntryRow[]) {
              const plaintext = decrypt(previous, entry);
              try {
                const sealed = sealValue(
                  next,
                  plaintext,
                  entryAad(workspaceId, metadata(entry)),
                );
                db.prepare(
                  "UPDATE vault_entries SET sealedJson=? WHERE id=?",
                ).run(JSON.stringify(sealed), entry.id);
              } finally {
                plaintext.fill(0);
              }
            }
            const sealedVerifier = sealValue(
              next,
              verifier,
              stateAad(workspaceId, next.id),
            );
            db.prepare(
              "UPDATE vault_state SET keyId=?,verifierJson=?,recoveryJson=? WHERE singleton=1",
            ).run(
              next.id,
              JSON.stringify(sealedVerifier),
              JSON.stringify(recovery),
            );
            changed("vault");
          } finally {
            previous.bytes.fill(0);
          }
        });
        // Recheck under a fresh lock. Never overwrite another process's newer staged ring.
        transaction(db, () => {
          const current = initialized();
          if (current.keyId !== next.id) return;
          const checked = keyFor(current);
          try {
            writeKeyRing(keyFilePath, workspaceId, [checked], "replace");
          } finally {
            checked.bytes.fill(0);
          }
        });
      } catch (error) {
        // Both keys remain available after an interrupted transaction. Never restore a stale ring.
        if (error instanceof VaultError) throw error;
        throw new VaultError(
          "UNAVAILABLE",
          "Key rotation could not be confirmed. Refresh vault status before retrying; no key was silently replaced.",
        );
      } finally {
        next.bytes.fill(0);
      }
      options.notify();
      return snapshot();
    },
    // Trusted host code only. Not a route, provider tool, or substitute for action approval.
    // The callback's result is discarded and its errors are redacted.
    async withSecret(
      scope: {
        id: string;
        accountId: string;
        origin: string;
        expectedRevision?: number;
      },
      consume: (secret: Buffer) => void | Promise<void>,
    ): Promise<void> {
      const plaintext = transaction(db, () => {
        const entry = record(scope.id);
        active(entry);
        if (scope.expectedRevision !== undefined)
          checkRevision(entry.revision, scope.expectedRevision);
        const allowed = metadata(entry).origins;
        let requested: string;
        try {
          requested = origins([scope.origin])[0]!;
          if (scope.origin !== requested) throw invalid();
        } catch {
          throw new VaultError(
            "SCOPE_MISMATCH",
            "Credential origin or account does not match this operation.",
          );
        }
        if (entry.accountId !== scope.accountId || !allowed.includes(requested))
          throw new VaultError(
            "SCOPE_MISMATCH",
            "Credential origin or account does not match this operation.",
          );
        const key = unlockedKey();
        try {
          const value = decrypt(key, entry);
          db.prepare("UPDATE vault_entries SET lastUsedAt=? WHERE id=?").run(
            new Date().toISOString(),
            entry.id,
          );
          changed(entry.id);
          return value;
        } finally {
          key.bytes.fill(0);
        }
      });
      options.notify();
      try {
        await consume(plaintext);
      } catch {
        throw new VaultError(
          "USE_FAILED",
          "Credential use did not return a confirmed result.",
        );
      } finally {
        plaintext.fill(0);
      }
    },
  };
}

export type Vault = ReturnType<typeof createVault>;
