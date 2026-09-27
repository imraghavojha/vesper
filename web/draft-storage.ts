import type { Draft } from "../shared/sync.js";
const prefix = "vesper.draft.v1:";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
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
  const pending = value.pending;
  if (
    pending !== null &&
    (!pending ||
      typeof pending !== "object" ||
      !("requestId" in pending) ||
      typeof pending.requestId !== "string" ||
      !uuid.test(pending.requestId) ||
      !("text" in pending) ||
      typeof pending.text !== "string" ||
      pending.text.length > 10000)
  )
    throw new Error("Saved pending message is invalid.");
  return { text: value.text, pending: pending as Draft["pending"] };
}
export async function loadDraft(
  workspaceId: string,
  conversationId: string,
): Promise<Draft> {
  const name = key(workspaceId, conversationId);
  const value = window.vesperDesktop
    ? await window.vesperDesktop.loadDraft(workspaceId, conversationId)
    : JSON.parse(sessionStorage.getItem(name) ?? "null");
  return value === null ? { text: "", pending: null } : validate(value);
}
export async function saveDraft(
  workspaceId: string,
  conversationId: string,
  draft: Draft,
) {
  const name = key(workspaceId, conversationId);
  validate(draft);
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
