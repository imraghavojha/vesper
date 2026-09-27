export const MAX_VAULT_SECRET_BYTES = 16 * 1024;
export const MAX_VAULT_ENTRIES = 256;

export type VaultEntryKind = "password" | "token" | "oauth";
export type VaultState =
  | "uninitialized"
  | "ready"
  | "locked"
  | "missing-key"
  | "unavailable";

export type VaultStatus = {
  state: VaultState;
  revision: number;
  recoveryAvailable: boolean;
  message: string;
};

// Secret values and encrypted payloads are deliberately absent from this type.
export type VaultEntryMetadata = {
  id: string;
  kind: VaultEntryKind;
  label: string;
  accountId: string;
  origins: string[];
  revision: number;
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
};

export type VaultSnapshot = {
  status: VaultStatus;
  entries: VaultEntryMetadata[];
};

// A dedicated secure form supplies this input directly to the trusted host.
// Never put it in chat, mutation_receipts, activity payloads or client caches.
export type VaultPutInput = {
  id: string;
  expectedRevision: number;
  kind: VaultEntryKind;
  label: string;
  accountId: string;
  origins: string[];
  secret?: string;
};

export type VaultEntryVersion = { id: string; expectedRevision: number };
