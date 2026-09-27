import Database from "better-sqlite3";
import { randomBytes, createHash, randomUUID } from "node:crypto";
import {
  mkdirSync,
  chmodSync,
  writeFileSync,
  unlinkSync,
  existsSync,
} from "node:fs";
import { resolve } from "node:path";
import { TRPCError } from "@trpc/server";

export type Device = {
  id: string;
  name: string;
  platform: string;
  pairedAt: string;
  revokedAt: string | null;
};
type Workspace = {
  id: string;
  name: string;
  version: number;
  createdAt: string;
};
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export function openStore(directory: string) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
  const databasePath = resolve(directory, "workspace.sqlite");
  const initializedPath = resolve(directory, "initialized");
  if (existsSync(initializedPath) && !existsSync(databasePath)) {
    throw new Error(
      "Workspace database is missing. Restore your backup; refusing to replace an initialized workspace.",
    );
  }
  const db = new Database(databasePath);
  chmodSync(resolve(directory, "workspace.sqlite"), 0o600);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  db.exec(`CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS workspace (id TEXT PRIMARY KEY, name TEXT NOT NULL, version INTEGER NOT NULL, createdAt TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS devices (id TEXT PRIMARY KEY, name TEXT NOT NULL, platform TEXT NOT NULL, tokenHash TEXT NOT NULL UNIQUE, pairedAt TEXT NOT NULL, revokedAt TEXT);
    CREATE TABLE IF NOT EXISTS pairing_codes (hash TEXT PRIMARY KEY, expiresAt INTEGER NOT NULL);
    INSERT INTO schema_version SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM schema_version);`);
  const schema = db.prepare("SELECT version FROM schema_version").get() as {
    version: number;
  };
  if (schema.version !== 1)
    throw new Error(
      "Unsupported database version. Use a compatible Vesper host.",
    );
  if (!db.prepare("SELECT id FROM workspace").get()) {
    if (existsSync(initializedPath))
      throw new Error("Workspace record is missing. Restore your backup.");
    db.prepare("INSERT INTO workspace VALUES (?, ?, 1, ?)").run(
      randomUUID(),
      "My workspace",
      new Date().toISOString(),
    );
  }
  writeFileSync(
    initializedPath,
    "Vesper workspace initialized. Keep this file with the database.\n",
    { mode: 0o600 },
  );
  const codePath = resolve(directory, "pairing-code");
  function createPairingCode() {
    const code = randomBytes(18).toString("base64url");
    const expiresAt = Date.now() + 10 * 60_000;
    db.prepare("DELETE FROM pairing_codes WHERE expiresAt < ?").run(Date.now());
    db.prepare("INSERT INTO pairing_codes VALUES (?, ?)").run(
      hash(code),
      expiresAt,
    );
    return { code, expiresAt: new Date(expiresAt).toISOString() };
  }
  if (!db.prepare("SELECT id FROM devices WHERE revokedAt IS NULL").get()) {
    db.prepare("DELETE FROM pairing_codes").run();
    const { code } = createPairingCode();
    writeFileSync(codePath, code + "\n", { mode: 0o600 });
    chmodSync(codePath, 0o600);
    console.info(
      `First device pairing code is in ${codePath}. It expires in 10 minutes. Restart this host to renew before pairing.`,
    );
  } else if (existsSync(codePath)) unlinkSync(codePath);
  const deviceColumns = "id, name, platform, pairedAt, revokedAt";
  function authenticate(token: string | undefined) {
    if (!token) return null;
    return (
      (db
        .prepare(
          `SELECT ${deviceColumns} FROM devices WHERE tokenHash = ? AND revokedAt IS NULL`,
        )
        .get(hash(token)) as Device | undefined) ?? null
    );
  }
  const pair = db.transaction(
    (input: { code: string; name: string; platform: string }) => {
      const row = db
        .prepare(
          "DELETE FROM pairing_codes WHERE hash = ? AND expiresAt > ? RETURNING hash",
        )
        .get(hash(input.code), Date.now());
      if (!row)
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Pairing code is invalid, expired, or already used.",
        });
      const token = randomBytes(32).toString("base64url");
      const id = randomUUID();
      db.prepare("INSERT INTO devices VALUES (?, ?, ?, ?, ?, NULL)").run(
        id,
        input.name,
        input.platform,
        hash(token),
        new Date().toISOString(),
      );
      const workspace = db.prepare("SELECT id FROM workspace").get() as {
        id: string;
      };
      return {
        token,
        deviceId: id,
        workspaceId: workspace.id,
        protocolVersion: 1,
      };
    },
  );
  return {
    authenticate,
    createPairingCode,
    pair(input: { code: string; name: string; platform: string }) {
      const result = pair(input);
      if (existsSync(codePath)) unlinkSync(codePath);
      return result;
    },
    snapshot(device: Device) {
      return {
        workspace: db.prepare("SELECT * FROM workspace").get() as Workspace,
        device,
        devices: db
          .prepare(
            `SELECT ${deviceColumns} FROM devices WHERE revokedAt IS NULL ORDER BY pairedAt`,
          )
          .all() as Device[],
        host: {
          time: new Date().toISOString(),
          protocolVersion: 1,
          availability: process.env.VESPER_HOST_LABEL ?? "This host",
          scheduledWork: "not-implemented" as const,
        },
      };
    },
    rename(name: string, expectedVersion: number) {
      const result = db
        .prepare(
          "UPDATE workspace SET name = ?, version = version + 1 WHERE version = ?",
        )
        .run(name, expectedVersion);
      if (result.changes !== 1)
        throw new TRPCError({
          code: "CONFLICT",
          message:
            "The workspace changed on another device. Refresh and try again.",
        });
    },
    revoke(id: string) {
      db.prepare(
        "UPDATE devices SET revokedAt = ? WHERE id = ? AND revokedAt IS NULL",
      ).run(new Date().toISOString(), id);
    },
    close() {
      db.close();
    },
  };
}
export type Store = ReturnType<typeof openStore>;
