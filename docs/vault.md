# Shared encrypted vault

IMR-9 stores passwords, custom tokens and future connector OAuth data on the workspace's authoritative host. It is separate from the Mac's `safeStorage` files, which protect that device's connection and unsent drafts. A local Mac workspace keeps working while its app and host are running. Independent hosting uses the same vault and permits authorized clients to connect while the Mac is off.

This is a storage and secure-entry slice. Google Calendar (IMR-17) stores its refresh token here as an `oauth` entry; see [development](development.md#google-calendar). Browser filling, other connector dispatch, waiting-task resume, and Android entry are not implemented. The full [IMR-9 acceptance](https://linear.app/imraghavojha/issue/2175c734-16a1-493d-b0f6-e94b420d686d) remains open for those paths.

## Entry and use

Secure Store is a dedicated Settings section. The client submits newly entered values directly to the authenticated host. It receives only entry metadata and status. There is no saved-secret read/reveal API. Revealing text in the entry form concerns only the new value currently being typed.

Each entry has a kind, label, account identity and an explicit set of HTTPS origins. Labels, account identity, origins and dates are ordinary metadata, not encrypted secret fields. Never put a password or token in a label. URLs are reduced to their HTTPS origin; embedded credentials, query strings, fragments and non-HTTPS destinations are rejected. There is no hostname substring matching, implicit subdomain permission or automatic SSO-origin expansion.

The internal `withSecret` method checks the exact account and origin, active entry state, vault availability and, when supplied, the expected entry revision. Plaintext is handed only to a trusted host callback. Its result is discarded and callback errors are replaced with a safe error. Temporary plaintext/key buffers are cleared where possible; JavaScript strings and a compromised host cannot be made secret by buffer clearing.

Future broker dispatch **must supply the entry's `expectedRevision`**, along with its exact account/origin/operation approval. The global vault revision is not a substitute; it also changes when a credential is used. This callback is not an action-approval broker. A `USE_FAILED` error says the callback did not return a confirmed result. It does not prove a remote write failed or authorize retrying an uncertain external effect.

## Host key and lock state

The database stores independently nonced AES-256-GCM ciphertext and authentication tags. Authenticated data binds the workspace, entry identity, account, allowed origins, kind, label and content revision. Schema migration from version 3 preserves existing chats, device grants and provider runs.

The raw 256-bit key is stored outside the workspace database directory. By default a workspace at `.vesper` uses `.vesper-secrets/vault-keys.json`. A managed Mac workspace uses a sibling `local-host-secrets` directory beside `local-host`. `VESPER_VAULT_KEY_FILE` can select an absolute operator-controlled path outside the database directory. The immediate directory must be private to the host owner, mode `0700`; the key file is a private regular file, mode `0600`. A private read-only `0400` file can be read. Symlinks and unsafe ownership/modes are refused rather than silently repaired.

Unattended operation can load this restricted host file when the shared vault is unlocked. Explicit Lock is persisted in SQLite: it survives restart and is respected by every instance using that database. Set `VESPER_VAULT_START_LOCKED=1` to lock at every startup even if the previous session was unlocked. Unlock verifies the host key before clearing the shared lock. Lock blocks new vault writes and credential use. It does not sign out existing browser sessions or erase a value already granted to an in-progress trusted callback. Metadata and revocation remain available while locked.

Missing or invalid keys never cause automatic replacement of an initialized vault. A missing key has a distinct recovery state. Invalid/private-file-permission failures remain unavailable until the operator restores the correct file or fixes the configuration.

The host administrator is trusted and can access the raw key. This does not protect against a compromised administrator or host process. The existing chat adapter has tools/MCP disabled, but that is not proof of OS-level filesystem isolation from a compromised provider executable. Standard worker isolation and the action broker remain release gates before general external tool use.

Key publication requires successful file and directory synchronization. A filesystem that cannot provide the directory durability barrier cannot initialize, recover or rotate the vault; these operations fail closed before a database key switch. An existing key is still checked before reporting Locked, so damaged or inaccessible key material remains Unavailable rather than presenting an unusable Unlock action.

## Recovery and rotation

Initialization asks for a recovery passphrase. A fixed-parameter scrypt derivation wraps a recovery copy of the key with AES-256-GCM. Only that wrapped copy is stored in SQLite. The passphrase is neither saved nor returned. Keep it separately from database backups.

If the key file is lost, Recover validates the passphrase, workspace/key identity, verifier and every active encrypted entry before publishing a replacement private key file. It never overwrites an existing key file. To recover from a corrupt key file, the operator must first preserve/move the damaged file aside privately. Wrong passphrases and mismatched data do not create replacement keys.

Rotation requires the current vault revision and a recovery passphrase for the new key. Under a SQLite write transaction it first atomically publishes both old and new keys, then rewrites all active ciphertext and recovery metadata and commits. A separate write transaction rechecks the database's active key before trimming the old key. A crash can leave two keys, but startup selects only the database-referenced key after verifying it. No failure path restores a stale ring over a newer rotation. Existing entry content revisions do not change merely because their encryption key changes.

Initialize rejects a repeat once setup has completed. Entry writes use a client-generated UUID and expected revision; an identical retry after a lost response conflicts instead of creating another record or claiming the secret matches. Rotation also rejects stale/repeated revisions. Refresh metadata and review an uncertain operation before submitting another write. Secret payload hashes are not placed in the ordinary chat mutation-receipt table.

Revocation removes an entry's usable ciphertext and keeps its metadata marked revoked. Deletion removes the local record and permanently retires its ID in that workspace state. A stale credential reference or delayed create request cannot reuse the deleted ID for a different secret. Neither action logs out a website nor revokes a remote OAuth grant. Old backups may still contain the earlier encrypted credential state.

## Backup and restore

From source, with the pinned Node runtime:

```sh
VESPER_DATA_DIR=/private/path/to/workspace npm run backup -- /private/path/to/new-backup
```

For a built standalone host, use `node dist/server/backup.js /private/path/to/new-backup` with the same `VESPER_DATA_DIR`. The destination must not already exist and must be outside the workspace directory.

The command uses SQLite's backup API, checks the copied database, and writes an `initialized` marker and completion manifest. It copies only the database, including encrypted vault records and their wrapped recovery copy. It never reads or includes the raw host key. Other workspace data, including conversations, is ordinary SQLite data and is **not separately encrypted**. Keep the whole backup private. A failed command or directory without a valid `backup-manifest.json` is not a completed backup.

To restore, stop the host and retain its current data as a separate fallback. Copy the completed backup's `workspace.sqlite` and `initialized` into an otherwise empty workspace data directory. Use the restored workspace identity and a separate private key location. If the matching raw key is absent, start the host and use Recover with that backup's recovery passphrase. Existing paired-device tokens in the backup retain their identity and revocation state. Do not copy an unrelated key file or initialize a replacement vault over restored ciphertext.

Older backups require their own older recovery passphrase/key. Rotating the current vault does not rewrite old backups. Backup/restore is an operator operation, not an unauthenticated download or model tool.

## Validation boundary

Focused temporary verification exercises real Node crypto, private key files, SQLite/WAL, HTTP metadata/redaction, exact origin/account binding, revocation, lock/restart, missing-key recovery, stale revisions, interrupted rotation and backup restoration. Test material is generated in private temporary directories and never committed. No real account credential or OAuth grant is required for these checks. Static checks and those local results do not establish browser-fill, Android or independent-host deployment acceptance.

Cryptographic and storage APIs follow the pinned [Node crypto documentation](https://nodejs.org/docs/latest-v24.x/api/crypto.html) and [Node SQLite backup interface](https://raw.githubusercontent.com/nodejs/node/v24.21.0/doc/api/sqlite.md).
