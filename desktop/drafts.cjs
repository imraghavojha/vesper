"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const STORE_FILE = "drafts.encrypted";
const MARKER_FILE = "drafts.initialized";
const MARKER_CONTENT = '{"vesperDrafts":1}\n';
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_RECORDS = 50;
const MAX_TEXT = 10000;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const GENERIC_ERROR = "Draft storage operation failed";

function fail() {
  throw new Error(GENERIC_ERROR);
}

function check(condition) {
  if (!condition) fail();
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function hasExactKeys(value, keys) {
  if (!isPlainObject(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, i) => key === expected[i])
  );
}

const isUuid = (value) => typeof value === "string" && UUID_RE.test(value);
const isText = (value) => typeof value === "string" && value.length <= MAX_TEXT;
const isProviderId = (value) =>
  typeof value === "string" && value.trim().length > 0 && value.length <= 128;

function isProviderIntent(value) {
  return (
    hasExactKeys(value, ["selection", "bindingRevision"]) &&
    Number.isSafeInteger(value.bindingRevision) &&
    value.bindingRevision > 0 &&
    hasExactKeys(value.selection, ["provider", "accountId", "modelId"]) &&
    value.selection.provider === "claude" &&
    isProviderId(value.selection.accountId) &&
    isProviderId(value.selection.modelId)
  );
}

function isDraft(draft) {
  if (!hasExactKeys(draft, ["text", "pending"]) || !isText(draft.text))
    return false;
  if (draft.pending === null) return true;
  return (
    (hasExactKeys(draft.pending, ["requestId", "text"]) ||
      (hasExactKeys(draft.pending, ["requestId", "text", "provider"]) &&
        isProviderIntent(draft.pending.provider))) &&
    isUuid(draft.pending.requestId) &&
    isText(draft.pending.text)
  );
}

function copyDraft(draft) {
  const pending = draft.pending && {
    requestId: draft.pending.requestId,
    text: draft.pending.text,
    ...(draft.pending.provider
      ? {
          provider: {
            selection: { ...draft.pending.provider.selection },
            bindingRevision: draft.pending.provider.bindingRevision,
          },
        }
      : {}),
  };
  return { text: draft.text, pending };
}

function validateRecords(records) {
  check(Array.isArray(records) && records.length <= MAX_RECORDS);
  const seen = new Set();
  for (const record of records) {
    check(hasExactKeys(record, ["workspaceId", "conversationId", "draft"]));
    check(
      isUuid(record.workspaceId) &&
        isUuid(record.conversationId) &&
        isDraft(record.draft),
    );
    const scope = `${record.workspaceId.toLowerCase()}:${record.conversationId.toLowerCase()}`;
    check(!seen.has(scope));
    seen.add(scope);
  }
  return records;
}

function createDraftStore({ directory, safeStorage } = {}) {
  check(typeof directory === "string" && path.isAbsolute(directory));
  check(
    safeStorage &&
      typeof safeStorage.encryptString === "function" &&
      typeof safeStorage.decryptString === "function",
  );
  const storePath = path.join(directory, STORE_FILE);
  const markerPath = path.join(directory, MARKER_FILE);

  function assertEncryption() {
    check(
      typeof safeStorage.isEncryptionAvailable === "function" &&
        safeStorage.isEncryptionAvailable() === true,
    );
    if (process.platform === "linux") {
      check(typeof safeStorage.getSelectedStorageBackend === "function");
      check(safeStorage.getSelectedStorageBackend() !== "basic_text");
    }
  }

  function ensureDirectory() {
    try {
      fs.lstatSync(directory);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    }
    const stat = fs.lstatSync(directory);
    check(stat.isDirectory() && !stat.isSymbolicLink());
    if ((stat.mode & 0o777) !== 0o700) fs.chmodSync(directory, 0o700);
  }

  function readRegularFile(filePath, maxBytes) {
    let stat;
    try {
      stat = fs.lstatSync(filePath);
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
    check(stat.isFile() && !stat.isSymbolicLink() && stat.size <= maxBytes);
    const fd = fs.openSync(
      filePath,
      fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW,
    );
    try {
      const fdStat = fs.fstatSync(fd);
      check(fdStat.isFile() && fdStat.size <= maxBytes);
      check(fdStat.ino === stat.ino && fdStat.dev === stat.dev);
      const content = Buffer.alloc(fdStat.size);
      let offset = 0;
      while (offset < content.length) {
        const count = fs.readSync(
          fd,
          content,
          offset,
          content.length - offset,
          offset,
        );
        check(count > 0);
        offset += count;
      }
      check(fs.fstatSync(fd).size === fdStat.size);
      return content;
    } finally {
      fs.closeSync(fd);
    }
  }

  function writeAtomic(fileName, data) {
    const target = path.join(directory, fileName);
    const temp = path.join(
      directory,
      `.${fileName}.${crypto.randomUUID()}.tmp`,
    );
    let fd = fs.openSync(temp, "wx", 0o600);
    try {
      fs.writeFileSync(fd, data);
      fs.fsyncSync(fd);
      fs.closeSync(fd);
      fd = null;
      fs.renameSync(temp, target);
    } catch (error) {
      if (fd !== null) {
        try {
          fs.closeSync(fd);
        } catch {
          /* ignore */
        }
      }
      try {
        fs.unlinkSync(temp);
      } catch {
        /* ignore */
      }
      throw error;
    }
    try {
      const dirFd = fs.openSync(directory, "r");
      try {
        fs.fsyncSync(dirFd);
      } finally {
        fs.closeSync(dirFd);
      }
    } catch {
      /* directory fsync is best effort */
    }
  }

  function hasMarker() {
    const content = readRegularFile(markerPath, MARKER_CONTENT.length);
    if (content === null) return false;
    check(content.toString("utf8") === MARKER_CONTENT);
    return true;
  }

  function readStore() {
    assertEncryption();
    ensureDirectory();
    const marker = hasMarker();
    const ciphertext = readRegularFile(storePath, MAX_BYTES);
    if (ciphertext === null) {
      check(!marker);
      return [];
    }
    const plaintext = safeStorage.decryptString(ciphertext);
    check(
      typeof plaintext === "string" &&
        Buffer.byteLength(plaintext, "utf8") <= MAX_BYTES,
    );
    const envelope = JSON.parse(plaintext);
    check(
      hasExactKeys(envelope, ["version", "records"]) && envelope.version === 1,
    );
    const records = validateRecords(envelope.records);
    if (!marker) writeAtomic(MARKER_FILE, MARKER_CONTENT);
    return records;
  }

  function checkScope(workspaceId, conversationId) {
    check(isUuid(workspaceId) && isUuid(conversationId));
  }

  const matches = (record, workspaceId, conversationId) =>
    record.workspaceId.toLowerCase() === workspaceId.toLowerCase() &&
    record.conversationId.toLowerCase() === conversationId.toLowerCase();

  function load(workspaceId, conversationId) {
    try {
      checkScope(workspaceId, conversationId);
      const record = readStore().find((r) =>
        matches(r, workspaceId, conversationId),
      );
      return record ? copyDraft(record.draft) : null;
    } catch {
      return fail();
    }
  }

  function save(workspaceId, conversationId, draft) {
    try {
      checkScope(workspaceId, conversationId);
      check(draft === null || isDraft(draft));
      const records = readStore().filter(
        (r) => !matches(r, workspaceId, conversationId),
      );
      if (draft !== null)
        records.push({ workspaceId, conversationId, draft: copyDraft(draft) });
      validateRecords(records);
      const plaintext = JSON.stringify({ version: 1, records });
      check(Buffer.byteLength(plaintext, "utf8") <= MAX_BYTES);
      const ciphertext = safeStorage.encryptString(plaintext);
      check(
        Buffer.isBuffer(ciphertext) &&
          ciphertext.length > 0 &&
          ciphertext.length <= MAX_BYTES,
      );
      writeAtomic(STORE_FILE, ciphertext);
      if (!hasMarker()) writeAtomic(MARKER_FILE, MARKER_CONTENT);
    } catch {
      fail();
    }
  }

  return { load, save };
}

module.exports = { createDraftStore };
