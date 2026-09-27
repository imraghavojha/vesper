import type { Draft } from "../shared/sync.js";
import type { AskIntent } from "../shared/providers.js";
const prefix = "vesper.draft.v1:";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Cell = {
  latest?: Draft;
  revision: number;
  acknowledged: number;
  tail: Promise<void>;
  remoteRevision?: number;
  notifiedRevision?: number;
  conflicted?: boolean;
};
const cells = new Map<string, Cell>();
const listeners = new Map<string, Set<() => void>>();
let subscribed = false;
function subscribeDesktop() {
  if (subscribed || !window.vesperDesktop) return;
  subscribed = true;
  window.vesperDesktop.onDraftChanged((scope) => {
    const name = prefix + scope.workspaceId + ":" + scope.conversationId;
    const current = cells.get(name);
    if (current) current.notifiedRevision = scope.revision;
    for (const callback of listeners.get(name) ?? []) callback();
  });
}
function key(workspaceId: string, conversationId: string) {
  subscribeDesktop();
  if (!uuid.test(workspaceId) || !uuid.test(conversationId))
    throw new Error("Invalid draft scope.");
  return prefix + workspaceId + ":" + conversationId;
}
function exactObject(
  value: unknown,
  keys: string[],
): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return false;
  const prototype = Object.getPrototypeOf(value);
  return (
    (prototype === Object.prototype || prototype === null) &&
    Object.keys(value).length === keys.length &&
    keys.every((name) => Object.hasOwn(value, name))
  );
}
function providerId(value: unknown): value is string {
  return (
    typeof value === "string" && value.trim().length > 0 && value.length <= 128
  );
}
function validateProvider(value: unknown): AskIntent {
  if (
    !exactObject(value, ["selection", "bindingRevision"]) ||
    typeof value.bindingRevision !== "number" ||
    !Number.isSafeInteger(value.bindingRevision) ||
    value.bindingRevision <= 0 ||
    !exactObject(value.selection, ["provider", "accountId", "modelId"]) ||
    value.selection.provider !== "claude" ||
    !providerId(value.selection.accountId) ||
    !providerId(value.selection.modelId)
  )
    throw new Error("Saved pending provider is invalid.");
  return {
    selection: {
      provider: "claude",
      accountId: value.selection.accountId,
      modelId: value.selection.modelId,
    },
    bindingRevision: value.bindingRevision,
  };
}
function sameProvider(
  left: AskIntent | undefined,
  right: AskIntent | undefined,
) {
  if (left === undefined || right === undefined) return left === right;
  return (
    left.bindingRevision === right.bindingRevision &&
    left.selection.provider === right.selection.provider &&
    left.selection.accountId === right.selection.accountId &&
    left.selection.modelId === right.selection.modelId
  );
}
function validate(value: unknown): Draft {
  if (
    !value ||
    typeof value !== "object" ||
    !("text" in value) ||
    typeof value.text !== "string" ||
    value.text.length > 10000 ||
    !("pending" in value)
  )
    throw new Error("Saved draft is invalid.");
  let pending: Draft["pending"] = null;
  if (value.pending !== null) {
    const candidate = value.pending;
    if (
      !candidate ||
      typeof candidate !== "object" ||
      !("requestId" in candidate) ||
      typeof candidate.requestId !== "string" ||
      !uuid.test(candidate.requestId) ||
      !("text" in candidate) ||
      typeof candidate.text !== "string" ||
      candidate.text.length > 10000
    )
      throw new Error("Saved pending message is invalid.");
    pending = {
      requestId: candidate.requestId,
      text: candidate.text,
      ...("provider" in candidate
        ? { provider: validateProvider(candidate.provider) }
        : {}),
    };
  }
  return { text: value.text, pending };
}
function cell(name: string): Cell {
  let value = cells.get(name);
  if (!value) {
    value = { revision: 0, acknowledged: 0, tail: Promise.resolve() };
    cells.set(name, value);
  }
  return value;
}
export async function loadDraft(
  workspaceId: string,
  conversationId: string,
): Promise<{ draft: Draft; saved: boolean }> {
  const name = key(workspaceId, conversationId);
  const state = cell(name);
  // Fence older views' writes, then verify persistence even for cached drafts.
  for (;;) {
    const tail = state.tail;
    const revision = state.revision;
    await tail.catch(() => {});
    if (tail !== state.tail || revision !== state.revision) continue;
    let stored: Draft;
    let remoteRevision: number | undefined;
    try {
      let value;
      if (window.vesperDesktop) {
        const result = await window.vesperDesktop.loadDraft(
          workspaceId,
          conversationId,
        );
        value = result.draft;
        remoteRevision = result.revision;
      } else value = JSON.parse(sessionStorage.getItem(name) ?? "null");
      stored = value === null ? { text: "", pending: null } : validate(value);
    } catch (error) {
      if (tail !== state.tail || revision !== state.revision) continue;
      if (state.latest) return { draft: validate(state.latest), saved: false };
      throw error;
    }
    if (tail !== state.tail || revision !== state.revision) continue;
    if (remoteRevision !== undefined) {
      if (
        state.remoteRevision !== undefined &&
        state.remoteRevision !== remoteRevision &&
        state.notifiedRevision === remoteRevision
      ) {
        if (state.acknowledged === revision && !state.conflicted)
          state.latest = stored;
        else state.conflicted = true;
      }
      state.remoteRevision = remoteRevision;
    }
    if (!state.latest) state.latest = stored;
    const latest = state.latest;
    const matches =
      latest.text === stored.text &&
      (latest.pending === null
        ? stored.pending === null
        : stored.pending !== null &&
          latest.pending.requestId === stored.pending.requestId &&
          latest.pending.text === stored.pending.text &&
          sameProvider(latest.pending.provider, stored.pending.provider));
    if (matches) state.acknowledged = revision;
    else if (remoteRevision !== undefined) state.conflicted = true;
    return { draft: validate(latest), saved: matches && !state.conflicted };
  }
}
async function writeDraft(
  workspaceId: string,
  conversationId: string,
  name: string,
  draft: Draft,
  operationRevision: number,
) {
  const empty = !draft.text && !draft.pending;
  if (window.vesperDesktop) {
    const state = cell(name);
    if (state.conflicted || state.remoteRevision === undefined)
      throw new Error(
        "Draft changed in another window. Review it before retrying.",
      );
    const result = await window.vesperDesktop.saveDraft(
      workspaceId,
      conversationId,
      empty ? null : draft,
      state.remoteRevision,
    );
    state.remoteRevision = result.revision;
    // A no-op can acknowledge this exact value without authorizing later
    // edits that were already queued against the stale base.
    if (result.staleEqual && state.revision > operationRevision)
      state.conflicted = true;
    if (!result.ok) {
      state.conflicted = true;
      throw new Error(
        "Draft changed in another window. Review it before retrying.",
      );
    }
    return;
  }
  if (empty) {
    sessionStorage.removeItem(name);
    return;
  }
  if (
    sessionStorage.getItem(name) === null &&
    Object.keys(sessionStorage).filter((k) => k.startsWith(prefix)).length >= 50
  )
    throw new Error("Too many saved drafts.");
  sessionStorage.setItem(name, JSON.stringify(draft));
}
export function saveDraft(
  workspaceId: string,
  conversationId: string,
  draft: Draft,
  resolveConflict = false,
): Promise<void> {
  const name = key(workspaceId, conversationId);
  const value = validate(draft);
  const state = cell(name);
  const revision = ++state.revision;
  state.latest = value;
  const operation = state.tail
    .catch(() => {})
    .then(() => {
      if (resolveConflict) state.conflicted = false;
    })
    .then(() => writeDraft(workspaceId, conversationId, name, value, revision))
    .then(() => {
      state.acknowledged = revision;
    });
  state.tail = operation;
  // Keep failure observable to callers without an unhandled detached rejection.
  void operation.catch(() => {});
  return operation;
}
export function onDraftChanged(
  workspaceId: string,
  conversationId: string,
  callback: () => void,
) {
  const name = key(workspaceId, conversationId);
  let group = listeners.get(name);
  if (!group) {
    group = new Set();
    listeners.set(name, group);
  }
  group.add(callback);
  return () => {
    group.delete(callback);
    if (!group.size) listeners.delete(name);
  };
}
