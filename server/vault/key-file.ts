import { randomBytes } from 'node:crypto';
import {
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  renameSync,
  unlinkSync,
  writeSync,
  type Stats,
} from 'node:fs';
import { basename, dirname, isAbsolute, join, normalize } from 'node:path';
import type { VaultKey } from './crypto.js';

// Restricted host key file. The service decides where it lives (outside the DB directory) and
// serializes all mutations; this module only validates, reads and atomically publishes it.

type KeyFileErrorCode = 'missing' | 'exists' | 'invalid' | 'permissions' | 'io';

const MESSAGES: Record<KeyFileErrorCode, string> = {
  missing: 'Vault key file is missing',
  exists: 'Vault key file already exists',
  invalid: 'Vault key file is invalid',
  permissions: 'Vault key file location is not private',
  io: 'Vault key file could not be accessed',
};

/** Messages are fixed per code; they never echo paths, file contents or keys. */
export class VaultKeyFileError extends Error {
  readonly code: KeyFileErrorCode;

  constructor(code: KeyFileErrorCode) {
    super(MESSAGES[code]);
    this.name = 'VaultKeyFileError';
    this.code = code;
  }
}

const MAX_FILE_BYTES = 16 * 1024;
const MAX_PATH_LENGTH = 4096;
const MAX_WORKSPACE_ID_LENGTH = 256;
const KEY_BYTES = 32;
const MAX_KEYS = 2;
const DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o600;
const READ_ONLY_FILE_MODE = 0o400;

const KEY_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/;
const UNSUPPORTED_DIRECTORY_SYNC = new Set(['EINVAL', 'ENOTSUP', 'EISDIR', 'EBADF']);

/** Reads and validates an existing key ring. A missing file is an error, never an initialization. */
export function readKeyRing(filePath: string, workspaceId: string): VaultKey[] {
  const target = checkedPath(filePath);
  assertWorkspaceId(workspaceId);
  const directory = inspectDirectory(dirname(target));
  return readValidated(target, directory, workspaceId);
}

export function writeKeyRing(
  filePath: string,
  workspaceId: string,
  keys: readonly VaultKey[],
  mode: 'create' | 'replace',
): void {
  const target = checkedPath(filePath);
  assertWorkspaceId(workspaceId);
  if (mode !== 'create' && mode !== 'replace') throw new VaultKeyFileError('invalid');
  const content = serializeKeyRing(workspaceId, keys);
  try {
    const directoryPath = dirname(target);
    const directory = mode === 'create' ? prepareDirectory(directoryPath) : inspectDirectory(directoryPath);
    if (mode === 'create') {
      if (entryExists(target)) throw new VaultKeyFileError('exists');
    } else {
      // Only a safe, well-formed ring for this workspace may be replaced.
      for (const key of readValidated(target, directory, workspaceId)) key.bytes.fill(0);
    }
    publish(target, directoryPath, directory, content, mode);
  } finally {
    content.fill(0);
  }
}

function publish(target: string, directoryPath: string, directory: Stats, content: Buffer, mode: 'create' | 'replace'): void {
  const temp = join(directoryPath, `.${basename(target)}.${randomBytes(16).toString('hex')}.tmp`);
  let tempPresent = false;
  try {
    const fd = fsCall(() =>
      openSync(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, FILE_MODE),
    );
    tempPresent = true;
    try {
      fsCall(() => {
        fchmodSync(fd, FILE_MODE);
        writeAll(fd, content);
        fsyncSync(fd);
      });
    } finally {
      closeQuietly(fd);
    }
    assertSameEntry(fsCall(() => lstatSync(directoryPath)), directory);
    if (mode === 'create') {
      // link() fails with EEXIST instead of clobbering a target created by a racing writer.
      fsCall(() => linkSync(temp, target));
      removeQuietly(temp);
    } else {
      fsCall(() => renameSync(temp, target));
    }
    tempPresent = false;
    syncDirectory(directoryPath, directory);
  } finally {
    if (tempPresent) removeQuietly(temp);
  }
}

function readValidated(target: string, directory: Stats, workspaceId: string): VaultKey[] {
  const buffer = Buffer.alloc(MAX_FILE_BYTES + 1);
  const fd = fsCall(() => openSync(target, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK));
  try {
    const stats = fsCall(() => fstatSync(fd));
    assertPrivateFile(stats);
    // The opened descriptor must still be the entry at this path inside the checked directory.
    assertSameEntry(fsCall(() => lstatSync(target)), stats);
    assertSameEntry(fsCall(() => lstatSync(dirname(target))), directory);
    if (stats.size > MAX_FILE_BYTES) throw new VaultKeyFileError('invalid');
    const length = readBounded(fd, buffer);
    if (length > MAX_FILE_BYTES) throw new VaultKeyFileError('invalid');
    return parseKeyRing(buffer.toString('utf8', 0, length), workspaceId);
  } finally {
    buffer.fill(0);
    closeQuietly(fd);
  }
}

function parseKeyRing(text: string, workspaceId: string): VaultKey[] {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new VaultKeyFileError('invalid');
  }
  const ring = strictObject(value, ['keys', 'version', 'workspaceId']);
  if (!ring || ring.version !== 1 || ring.workspaceId !== workspaceId) throw new VaultKeyFileError('invalid');
  const entries = ring.keys;
  if (!Array.isArray(entries) || entries.length < 1 || entries.length > MAX_KEYS) {
    throw new VaultKeyFileError('invalid');
  }
  const keys: VaultKey[] = [];
  try {
    for (const entry of entries) {
      const fields = strictObject(entry, ['id', 'key']);
      const bytes = fields ? decodeKey(fields.key) : undefined;
      if (!fields || typeof fields.id !== 'string' || !KEY_ID_PATTERN.test(fields.id) || !bytes) {
        throw new VaultKeyFileError('invalid');
      }
      keys.push({ id: fields.id, bytes });
    }
    assertUniqueIds(keys);
    return keys;
  } catch (error) {
    for (const key of keys) key.bytes.fill(0);
    throw error;
  }
}

function serializeKeyRing(workspaceId: string, keys: readonly VaultKey[]): Buffer {
  if (!Array.isArray(keys) || keys.length < 1 || keys.length > MAX_KEYS) throw new VaultKeyFileError('invalid');
  for (const key of keys) {
    if (
      typeof key !== 'object' ||
      key === null ||
      typeof key.id !== 'string' ||
      !KEY_ID_PATTERN.test(key.id) ||
      !Buffer.isBuffer(key.bytes) ||
      key.bytes.length !== KEY_BYTES
    ) {
      throw new VaultKeyFileError('invalid');
    }
  }
  assertUniqueIds(keys);
  const ring = { version: 1, workspaceId, keys: keys.map((key) => ({ id: key.id, key: key.bytes.toString('base64') })) };
  const content = Buffer.from(`${JSON.stringify(ring)}\n`, 'utf8');
  if (content.length > MAX_FILE_BYTES) {
    content.fill(0);
    throw new VaultKeyFileError('invalid');
  }
  return content;
}

/** Validates an existing private directory without following a symlink or changing it. */
function inspectDirectory(directoryPath: string): Stats {
  const stats = fsCall(() => lstatSync(directoryPath));
  if (!stats.isDirectory() || (stats.mode & 0o7777) !== DIRECTORY_MODE) throw new VaultKeyFileError('permissions');
  assertOwner(stats);
  return stats;
}

/** Creates only the immediate directory (never parents) for a first key file, then validates it. */
function prepareDirectory(directoryPath: string): Stats {
  if (!entryExists(directoryPath)) {
    try {
      mkdirSync(directoryPath, { mode: DIRECTORY_MODE });
    } catch (error) {
      if (errnoCode(error) !== 'EEXIST') throw fileError(error);
    }
  }
  return inspectDirectory(directoryPath);
}

function assertPrivateFile(stats: Stats): void {
  const permissions = stats.mode & 0o7777;
  if (!stats.isFile() || (permissions !== FILE_MODE && permissions !== READ_ONLY_FILE_MODE)) {
    throw new VaultKeyFileError('permissions');
  }
  assertOwner(stats);
}

function assertOwner(stats: Stats): void {
  const uid = process.getuid?.();
  if (uid !== undefined && stats.uid !== uid) throw new VaultKeyFileError('permissions');
}

function assertSameEntry(current: Stats, expected: Stats): void {
  if (current.dev !== expected.dev || current.ino !== expected.ino) throw new VaultKeyFileError('permissions');
}

function assertUniqueIds(keys: readonly VaultKey[]): void {
  if (new Set(keys.map((key) => key.id)).size !== keys.length) throw new VaultKeyFileError('invalid');
}

function assertWorkspaceId(workspaceId: string): void {
  if (typeof workspaceId !== 'string' || workspaceId.length === 0 || workspaceId.length > MAX_WORKSPACE_ID_LENGTH) {
    throw new VaultKeyFileError('invalid');
  }
}

function checkedPath(filePath: string): string {
  if (
    typeof filePath !== 'string' ||
    filePath.length === 0 ||
    filePath.length > MAX_PATH_LENGTH ||
    filePath.includes('\0') ||
    !isAbsolute(filePath) ||
    normalize(filePath) !== filePath ||
    basename(filePath) === '' ||
    dirname(filePath) === filePath
  ) {
    throw new VaultKeyFileError('invalid');
  }
  return filePath;
}

function entryExists(entryPath: string): boolean {
  try {
    lstatSync(entryPath);
    return true;
  } catch (error) {
    if (errnoCode(error) === 'ENOENT') return false;
    throw fileError(error);
  }
}

function readBounded(fd: number, buffer: Buffer): number {
  let length = 0;
  while (length < buffer.length) {
    const read = fsCall(() => readSync(fd, buffer, length, buffer.length - length, null));
    if (read === 0) break;
    length += read;
  }
  return length;
}

function writeAll(fd: number, content: Buffer): void {
  let offset = 0;
  while (offset < content.length) {
    const written = writeSync(fd, content, offset, content.length - offset);
    if (written <= 0) throw new VaultKeyFileError('io');
    offset += written;
  }
}

function syncDirectory(directoryPath: string, directory: Stats): void {
  const fd = fsCall(() =>
    openSync(directoryPath, constants.O_RDONLY | constants.O_NOFOLLOW | (constants.O_DIRECTORY ?? 0)),
  );
  try {
    // The opened descriptor must be the same private directory checked before publication.
    const stats = fsCall(() => fstatSync(fd));
    if (!stats.isDirectory() || (stats.mode & 0o7777) !== DIRECTORY_MODE) throw new VaultKeyFileError('permissions');
    assertOwner(stats);
    assertSameEntry(stats, directory);
    try {
      fsyncSync(fd);
    } catch (error) {
      if (!UNSUPPORTED_DIRECTORY_SYNC.has(errnoCode(error) ?? '')) throw fileError(error);
    }
  } finally {
    closeQuietly(fd);
  }
}

function decodeKey(value: unknown): Buffer | undefined {
  if (typeof value !== 'string' || value.length !== 44 || !BASE64_PATTERN.test(value)) return undefined;
  const bytes = Buffer.from(value, 'base64');
  if (bytes.length !== KEY_BYTES || bytes.toString('base64') !== value) {
    bytes.fill(0);
    return undefined;
  }
  return bytes;
}

function strictObject(value: unknown, fields: readonly string[]): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const keys = Object.keys(value).sort();
  if (keys.length !== fields.length || keys.some((key, index) => key !== fields[index])) return undefined;
  return value as Record<string, unknown>;
}

function fsCall<T>(operation: () => T): T {
  try {
    return operation();
  } catch (error) {
    throw fileError(error);
  }
}

function fileError(error: unknown): VaultKeyFileError {
  if (error instanceof VaultKeyFileError) return error;
  switch (errnoCode(error)) {
    case 'ENOENT':
      return new VaultKeyFileError('missing');
    case 'EEXIST':
      return new VaultKeyFileError('exists');
    case 'ELOOP':
    case 'EMLINK':
    case 'EACCES':
    case 'EPERM':
      return new VaultKeyFileError('permissions');
    case 'ENOTDIR':
    case 'ENAMETOOLONG':
      return new VaultKeyFileError('invalid');
    default:
      return new VaultKeyFileError('io');
  }
}

function errnoCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined;
  return typeof error.code === 'string' ? error.code : undefined;
}

function closeQuietly(fd: number): void {
  try {
    closeSync(fd);
  } catch {
    // The descriptor is unusable either way; the caller's result is already determined.
  }
}

function removeQuietly(entryPath: string): void {
  try {
    unlinkSync(entryPath);
  } catch {
    // A leftover temp holds only the ring this operation wrote, inside the private directory.
  }
}
