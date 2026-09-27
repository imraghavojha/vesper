"use strict";

// A single main process serializes encrypted drafts across trusted windows.
function createDraftCoordinator(store) {
  const versions = new Map();
  function load(workspaceId, conversationId) {
    const draft = store.load(workspaceId, conversationId);
    const key = workspaceId + ":" + conversationId;
    const fingerprint = JSON.stringify(draft);
    const prior = versions.get(key);
    const revision = prior
      ? prior.revision + Number(prior.fingerprint !== fingerprint)
      : 0;
    versions.set(key, { fingerprint, revision });
    return { draft, revision };
  }
  return {
    load,
    save(workspaceId, conversationId, draft, expectedRevision) {
      const current = load(workspaceId, conversationId);
      if (
        !Number.isSafeInteger(expectedRevision) ||
        expectedRevision < 0 ||
        expectedRevision > current.revision
      )
        return { ok: false, revision: current.revision };
      // Both windows can acknowledge one receipt. An already-persisted exact
      // result needs no write and must not become a spurious edit conflict.
      if (JSON.stringify(draft) === JSON.stringify(current.draft))
        return { ok: true, revision: current.revision, changed: false };
      if (expectedRevision !== current.revision)
        return { ok: false, revision: current.revision };
      store.save(workspaceId, conversationId, draft);
      const revision = current.revision + 1;
      versions.set(workspaceId + ":" + conversationId, {
        fingerprint: JSON.stringify(draft),
        revision,
      });
      return { ok: true, revision, changed: true };
    },
  };
}
module.exports = { createDraftCoordinator };
