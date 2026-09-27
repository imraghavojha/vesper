import type { Draft } from "../shared/sync.js";
const prefix = "vesper.draft.v1:";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Cell = {
  latest?: Draft;
  revision: number;
  acknowledged: number;
  tail: Promise<void>;
};
const cells = new Map<string, Cell>();
function key(workspaceId: string, conversationId: string) {
  if (!uuid.test(workspaceId) || !uuid.test(conversationId))
    throw new Error("Invalid draft scope.");
  return prefix + workspaceId + ":" + conversationId;
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
    pending = { requestId: candidate.requestId, text: candidate.text };
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
    try {
      const value = window.vesperDesktop
        ? await window.vesperDesktop.loadDraft(workspaceId, conversationId)
        : JSON.parse(sessionStorage.getItem(name) ?? "null");
      stored = value === null ? { text: "", pending: null } : validate(value);
    } catch (error) {
      if (tail !== state.tail || revision !== state.revision) continue;
      if (state.latest) return { draft: validate(state.latest), saved: false };
      throw error;
    }
    if (tail !== state.tail || revision !== state.revision) continue;
    if (!state.latest) state.latest = stored;
    const latest = state.latest;
    const matches =
      latest.text === stored.text &&
      (latest.pending === null
        ? stored.pending === null
        : stored.pending !== null &&
          latest.pending.requestId === stored.pending.requestId &&
          latest.pending.text === stored.pending.text);
    if (matches) state.acknowledged = revision;
    return { draft: validate(latest), saved: matches };
  }
}
async function writeDraft(
  workspaceId: string,
  conversationId: string,
  name: string,
  draft: Draft,
) {
  const empty = !draft.text && !draft.pending;
  if (window.vesperDesktop) {
    await window.vesperDesktop.saveDraft(
      workspaceId,
      conversationId,
      empty ? null : draft,
    );
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
): Promise<void> {
  const name = key(workspaceId, conversationId);
  const value = validate(draft);
  const state = cell(name);
  const revision = ++state.revision;
  state.latest = value;
  const operation = state.tail
    .catch(() => {})
    .then(() => writeDraft(workspaceId, conversationId, name, value))
    .then(() => {
      state.acknowledged = revision;
    });
  state.tail = operation;
  // Keep failure observable to callers without an unhandled detached rejection.
  void operation.catch(() => {});
  return operation;
}
