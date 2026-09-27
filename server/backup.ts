import { backup, DatabaseSync } from "node:sqlite";
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  writeFileSync,
} from "node:fs";
import { relative, resolve, sep } from "node:path";

// Operator command, not an RPC or provider tool. The raw vault key is never read.
async function main() {
  if (process.argv.length !== 3)
    throw new Error("Provide one new backup directory.");
  const directory = resolve(process.env.VESPER_DATA_DIR ?? ".vesper");
  const destination = resolve(process.argv[2]!);
  const relation = relative(directory, destination);
  if (!relation || (!relation.startsWith(".." + sep) && relation !== ".."))
    throw new Error("Choose a backup directory outside the workspace.");
  const sourcePath = resolve(directory, "workspace.sqlite");
  const sourceInfo = lstatSync(sourcePath);
  if (
    !sourceInfo.isFile() ||
    sourceInfo.isSymbolicLink() ||
    !existsSync(resolve(directory, "initialized"))
  )
    throw new Error("The existing workspace could not be identified.");
  // Refuse any existing destination. A manifest appears only after a verified copy.
  mkdirSync(destination, { mode: 0o700 });
  const targetPath = resolve(destination, "workspace.sqlite");
  closeSync(openSync(targetPath, "wx", 0o600));
  const source = new DatabaseSync(sourcePath, { readOnly: true });
  try {
    await backup(source, targetPath);
  } finally {
    source.close();
  }
  chmodSync(targetPath, 0o600);
  const copied = openSync(targetPath, "r");
  try {
    fsyncSync(copied);
  } finally {
    closeSync(copied);
  }
  const target = new DatabaseSync(targetPath, { readOnly: true });
  try {
    const check = target.prepare("PRAGMA quick_check").get() as Record<
      string,
      unknown
    >;
    if (Object.values(check)[0] !== "ok")
      throw new Error("Backup integrity check failed.");
    const workspace = target.prepare("SELECT id FROM workspace").get() as
      { id: string } | undefined;
    if (!workspace) throw new Error("Backup workspace is missing.");
    const hasVault = target
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='vault_state'",
      )
      .get();
    const vault = hasVault
      ? (target
          .prepare(
            "SELECT keyId,recoveryJson FROM vault_state WHERE singleton=1",
          )
          .get() as { keyId: string; recoveryJson: string } | undefined)
      : undefined;
    const recovery = vault
      ? (JSON.parse(vault.recoveryJson) as {
          keyId?: string;
          workspaceId?: string;
        })
      : undefined;
    if (
      vault &&
      (recovery?.keyId !== vault.keyId ||
        recovery?.workspaceId !== workspace.id)
    )
      throw new Error("Backup recovery information is inconsistent.");
    writeFileSync(
      resolve(destination, "initialized"),
      "Vesper workspace initialized. Keep this file with the database.\n",
      { mode: 0o600, flag: "wx", flush: true },
    );
    writeFileSync(
      resolve(destination, "backup-manifest.json"),
      JSON.stringify(
        {
          version: 1,
          createdAt: new Date().toISOString(),
          workspaceId: workspace.id,
          vaultRecoveryIncluded: !!vault,
          rawVaultKeyIncluded: false,
          note: "Credential values are encrypted. Conversation and other workspace data in SQLite are not separately encrypted. Keep this backup private and its recovery passphrase separate.",
        },
        null,
        2,
      ) + "\n",
      { mode: 0o600, flag: "wx", flush: true },
    );
  } finally {
    target.close();
  }
  const directoryHandle = openSync(destination, "r");
  try {
    fsyncSync(directoryHandle);
  } catch (error) {
    if (
      !["EINVAL", "ENOTSUP", "EISDIR"].includes(
        (error as NodeJS.ErrnoException).code ?? "",
      )
    )
      throw error;
  } finally {
    closeSync(directoryHandle);
  }
  console.info(
    "Workspace backup completed. The raw vault key was excluded. Keep the recovery passphrase separately.",
  );
}

void main().catch(() => {
  console.error(
    "Workspace backup did not complete. Check the source and choose a new private destination. Do not treat a directory without backup-manifest.json as a completed backup.",
  );
  process.exitCode = 1;
});
