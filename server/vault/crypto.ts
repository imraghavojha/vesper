import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  randomUUID,
  scryptSync,
} from "node:crypto";

// Standard AES-256-GCM sealing with a single random vault key. The host is trusted: it holds the
// key and decrypts values, so this protects stored data at rest, not against a compromised host.

export type VaultKey = { id: string; bytes: Buffer };

export type SealedValue = {
  version: 1;
  keyId: string;
  nonce: string;
  ciphertext: string;
  tag: string;
};

export type RecoveryEnvelope = {
  version: 1;
  workspaceId: string;
  keyId: string;
  kdf: "scrypt";
  N: 32768;
  r: 8;
  p: 1;
  salt: string;
  nonce: string;
  ciphertext: string;
  tag: string;
};

/** Messages are fixed strings; they never contain keys, passphrases, ciphertext or OpenSSL output. */
export class VaultCryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VaultCryptoError";
  }
}

const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const MAX_VALUE_BYTES = 1024 * 1024;
const MAX_AAD_BYTES = 64 * 1024;
const MAX_WORKSPACE_ID_LENGTH = 256;

const SCRYPT_N = 32768;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_MAXMEM = 128 * 1024 * 1024;
const SALT_BYTES = 16;
const MAX_SALT_BYTES = 64;

const PASSPHRASE_MIN_CHARS = 12;
const PASSPHRASE_MAX_CHARS = 1024;
const PASSPHRASE_MAX_BYTES = 4096;

const KEY_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/;
const LONE_SURROGATE_PATTERN = /\p{Cs}/u;

const SEALED_FIELDS = ["ciphertext", "keyId", "nonce", "tag", "version"];
const RECOVERY_FIELDS = [
  "N",
  "ciphertext",
  "kdf",
  "keyId",
  "nonce",
  "p",
  "r",
  "salt",
  "tag",
  "version",
  "workspaceId",
];

export function newVaultKey(): VaultKey {
  return { id: randomUUID(), bytes: randomBytes(KEY_BYTES) };
}

export function sealValue(
  key: VaultKey,
  plaintext: Buffer,
  aad: string,
): SealedValue {
  assertVaultKey(key);
  if (!Buffer.isBuffer(plaintext) || plaintext.length > MAX_VALUE_BYTES) {
    throw new VaultCryptoError("Vault value is too large or invalid");
  }
  const encrypted = encrypt(key.bytes, plaintext, aadBytes(aad));
  return { version: 1, keyId: key.id, ...encrypted };
}

export function openValue(
  key: VaultKey,
  envelope: unknown,
  aad: string,
): Buffer {
  assertVaultKey(key);
  const additionalData = aadBytes(aad);
  const fields = strictObject(envelope, SEALED_FIELDS);
  if (!fields || fields.version !== 1 || fields.keyId !== key.id) {
    throw new VaultCryptoError("Vault value envelope is invalid");
  }
  const nonce = decodeBase64(fields.nonce, NONCE_BYTES, NONCE_BYTES);
  const tag = decodeBase64(fields.tag, TAG_BYTES, TAG_BYTES);
  const ciphertext = decodeBase64(fields.ciphertext, 0, MAX_VALUE_BYTES);
  if (!nonce || !tag || !ciphertext) {
    throw new VaultCryptoError("Vault value envelope is invalid");
  }
  const plaintext = decrypt(key.bytes, nonce, ciphertext, tag, additionalData);
  if (!plaintext) {
    throw new VaultCryptoError("Vault value could not be opened");
  }
  return plaintext;
}

export function validateRecoveryPassphrase(passphrase: string): void {
  // Bound raw UTF-16 length first so oversized input is rejected before scanning or copying it.
  if (
    typeof passphrase !== "string" ||
    passphrase.length > PASSPHRASE_MAX_CHARS * 2 ||
    LONE_SURROGATE_PATTERN.test(passphrase)
  ) {
    throw new VaultCryptoError("Recovery passphrase is invalid");
  }
  const chars = Array.from(passphrase).length;
  if (
    chars < PASSPHRASE_MIN_CHARS ||
    chars > PASSPHRASE_MAX_CHARS ||
    Buffer.byteLength(passphrase, "utf8") > PASSPHRASE_MAX_BYTES
  ) {
    throw new VaultCryptoError(
      "Recovery passphrase must be 12 to 1024 characters",
    );
  }
}

export function wrapRecoveryKey(
  key: VaultKey,
  workspaceId: string,
  passphrase: string,
): RecoveryEnvelope {
  assertVaultKey(key);
  assertWorkspaceId(workspaceId);
  validateRecoveryPassphrase(passphrase);
  const salt = randomBytes(SALT_BYTES);
  const aad = Buffer.from(recoveryAad(workspaceId, key.id), "utf8");
  const encrypted = withDerivedKey(passphrase, salt, (wrappingKey) =>
    encrypt(wrappingKey, key.bytes, aad),
  );
  return {
    version: 1,
    workspaceId,
    keyId: key.id,
    kdf: "scrypt",
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    salt: salt.toString("base64"),
    ...encrypted,
  };
}

export function unwrapRecoveryKey(
  envelope: unknown,
  workspaceId: string,
  passphrase: string,
): VaultKey {
  assertWorkspaceId(workspaceId);
  const fields = strictObject(envelope, RECOVERY_FIELDS);
  // Reject foreign workspaces and any KDF parameters other than the fixed ones before deriving.
  if (
    !fields ||
    fields.version !== 1 ||
    fields.workspaceId !== workspaceId ||
    fields.kdf !== "scrypt" ||
    fields.N !== SCRYPT_N ||
    fields.r !== SCRYPT_R ||
    fields.p !== SCRYPT_P ||
    typeof fields.keyId !== "string" ||
    !KEY_ID_PATTERN.test(fields.keyId)
  ) {
    throw new VaultCryptoError("Recovery envelope is invalid");
  }
  const keyId = fields.keyId;
  const salt = decodeBase64(fields.salt, SALT_BYTES, MAX_SALT_BYTES);
  const nonce = decodeBase64(fields.nonce, NONCE_BYTES, NONCE_BYTES);
  const tag = decodeBase64(fields.tag, TAG_BYTES, TAG_BYTES);
  const ciphertext = decodeBase64(fields.ciphertext, KEY_BYTES, KEY_BYTES);
  if (!salt || !nonce || !tag || !ciphertext) {
    throw new VaultCryptoError("Recovery envelope is invalid");
  }
  validateRecoveryPassphrase(passphrase);
  const aad = Buffer.from(recoveryAad(workspaceId, keyId), "utf8");
  const bytes = withDerivedKey(passphrase, salt, (wrappingKey) =>
    decrypt(wrappingKey, nonce, ciphertext, tag, aad),
  );
  if (!bytes || bytes.length !== KEY_BYTES) {
    bytes?.fill(0);
    throw new VaultCryptoError("Recovery key could not be unwrapped");
  }
  return { id: keyId, bytes };
}

// Stable, unambiguous binding of every recovery parameter that is not itself a KDF input.
function recoveryAad(workspaceId: string, keyId: string): string {
  return JSON.stringify([
    "vesper-vault-recovery",
    1,
    workspaceId,
    keyId,
    "scrypt",
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
  ]);
}

function withDerivedKey<T>(
  passphrase: string,
  salt: Buffer,
  use: (key: Buffer) => T,
): T {
  const secret = Buffer.from(passphrase, "utf8");
  let derived: Buffer | undefined;
  try {
    derived = scryptSync(secret, salt, KEY_BYTES, {
      N: SCRYPT_N,
      r: SCRYPT_R,
      p: SCRYPT_P,
      maxmem: SCRYPT_MAXMEM,
    });
    return use(derived);
  } catch (error) {
    if (error instanceof VaultCryptoError) throw error;
    throw new VaultCryptoError("Recovery key derivation failed");
  } finally {
    // Only these temporary buffers can be cleared; the passphrase string itself cannot be erased.
    derived?.fill(0);
    secret.fill(0);
  }
}

function encrypt(
  key: Buffer,
  plaintext: Buffer,
  aad: Buffer,
): { nonce: string; ciphertext: string; tag: string } {
  const nonce = randomBytes(NONCE_BYTES);
  try {
    const cipher = createCipheriv(ALGORITHM, key, nonce, {
      authTagLength: TAG_BYTES,
    });
    cipher.setAAD(aad);
    const ciphertext = Buffer.concat([
      cipher.update(plaintext),
      cipher.final(),
    ]);
    return {
      nonce: nonce.toString("base64"),
      ciphertext: ciphertext.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
    };
  } catch {
    throw new VaultCryptoError("Vault encryption failed");
  }
}

/** Returns undefined on any authentication or decryption failure so callers choose a generic message. */
function decrypt(
  key: Buffer,
  nonce: Buffer,
  ciphertext: Buffer,
  tag: Buffer,
  aad: Buffer,
): Buffer | undefined {
  const parts: Buffer[] = [];
  try {
    const decipher = createDecipheriv(ALGORITHM, key, nonce, {
      authTagLength: TAG_BYTES,
    });
    decipher.setAuthTag(tag);
    decipher.setAAD(aad);
    parts.push(decipher.update(ciphertext));
    parts.push(decipher.final());
    return Buffer.concat(parts);
  } catch {
    return undefined;
  } finally {
    for (const part of parts) part.fill(0);
  }
}

function assertVaultKey(key: VaultKey): void {
  if (
    typeof key !== "object" ||
    key === null ||
    typeof key.id !== "string" ||
    !KEY_ID_PATTERN.test(key.id) ||
    !Buffer.isBuffer(key.bytes) ||
    key.bytes.length !== KEY_BYTES
  ) {
    throw new VaultCryptoError("Vault key is invalid");
  }
}

function assertWorkspaceId(workspaceId: string): void {
  if (
    typeof workspaceId !== "string" ||
    workspaceId.length === 0 ||
    workspaceId.length > MAX_WORKSPACE_ID_LENGTH
  ) {
    throw new VaultCryptoError("Workspace identifier is invalid");
  }
}

function aadBytes(aad: string): Buffer {
  if (
    typeof aad !== "string" ||
    aad.length === 0 ||
    Buffer.byteLength(aad, "utf8") > MAX_AAD_BYTES
  ) {
    throw new VaultCryptoError("Vault metadata is invalid");
  }
  return Buffer.from(aad, "utf8");
}

/** Returns the own fields of a plain object with exactly the expected keys, otherwise undefined. */
function strictObject(
  value: unknown,
  fields: readonly string[],
): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return undefined;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return undefined;
  const keys = Object.keys(value).sort();
  if (
    keys.length !== fields.length ||
    keys.some((key, index) => key !== fields[index])
  )
    return undefined;
  return value as Record<string, unknown>;
}

/** Decodes canonical padded base64 within byte bounds, checking encoded length before decoding. */
function decodeBase64(
  value: unknown,
  minBytes: number,
  maxBytes: number,
): Buffer | undefined {
  if (typeof value !== "string" || value.length % 4 !== 0) return undefined;
  if (value.length > Math.ceil(maxBytes / 3) * 4 || !BASE64_PATTERN.test(value))
    return undefined;
  const bytes = Buffer.from(value, "base64");
  if (
    bytes.length < minBytes ||
    bytes.length > maxBytes ||
    bytes.toString("base64") !== value
  )
    return undefined;
  return bytes;
}
