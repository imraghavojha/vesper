import { useCallback, useEffect, useId, useRef, useState } from "react";
import { TRPCClientError } from "@trpc/client";
import type {
  VaultEntryMetadata,
  VaultSnapshot,
} from "../shared/vault.js";
import type { useSync } from "./use-sync.js";
import "./vault-panel.css";

type Api = ReturnType<typeof useSync>["api"];
type ManualKind = "password" | "token";

// Everything typed here lives only in this component's state. It is never
// written to storage, drafts, logs, URLs or query caches, and it disappears
// when the panel unmounts (section change, dialog close, window close).
type EntryForm = {
  key: number;
  id: string;
  expectedRevision: number;
  isNew: boolean;
  kind: ManualKind;
  label: string;
  url: string;
  account: string;
  secret: string;
  reveal: boolean;
  // "editing" accepts input; "saving" is in flight; "rejected" was refused by
  // the host before any write; "uncertain" may or may not have been saved.
  phase: "editing" | "saving" | "rejected" | "uncertain";
  message: string;
};
type PassForm = {
  key: number;
  action: "initialize" | "recover" | "rotate";
  expectedRevision: number;
  phrase: string;
  confirm: string;
  phase: "editing" | "saving" | "rejected" | "uncertain";
  message: string;
};
type Confirm = {
  key: number;
  action: "revoke" | "remove";
  id: string;
  revision: number;
  label: string;
  phase: "editing" | "saving" | "rejected" | "uncertain";
  message: string;
};

const MIN_PHRASE = 12;

// Host messages that are fixed, safe copy (server/vault/service.ts, router.ts).
const SAFE_HOST_MESSAGES = new Set([
  "Invalid secure-store input.",
  "Invalid secure entry.",
  "Check the recovery passphrase and try again.",
  "Set up the shared vault first.",
  "Unlock the shared vault first.",
  "The host key is missing. Recover it with the recovery passphrase; do not create a new vault.",
  "The vault cannot be opened. Restore its matching host key or database backup.",
  "The host key file must be outside the workspace data directory.",
  "The recovery passphrase or recovery data could not unlock this vault.",
  "Key rotation could not be confirmed. Refresh vault status before retrying; no key was silently replaced.",
  "A host key file already exists. Recovery does not replace it; restore the matching key or move a damaged file aside privately first.",
  "Remove an unused secure entry before adding another.",
  "The shared vault is already initialized. Refresh its status.",
  "This secure entry was revoked.",
  "Secure entry not found.",
]);
// CONFLICT responses that are definite refusals rather than possible earlier success.
const DEFINITE_CONFLICTS = new Set([
  "Remove an unused secure entry before adding another.",
  "A host key file already exists. Recovery does not replace it; restore the matching key or move a damaged file aside privately first.",
]);
const UNCERTAIN =
  "The host didn’t confirm this change. It may or may not have been saved. Review the current details below before doing anything else.";

type Outcome = { definite: boolean; message: string; revoked: boolean };
/** Classifies an RPC failure into fixed, safe copy. Never serializes the error. */
function outcome(cause: unknown): Outcome {
  if (!(cause instanceof TRPCClientError))
    return { definite: false, message: UNCERTAIN, revoked: false };
  const code: unknown = cause.data?.code;
  const hostMessage = SAFE_HOST_MESSAGES.has(cause.message)
    ? cause.message
    : "";
  switch (code) {
    case "UNAUTHORIZED":
      return {
        definite: true,
        revoked: true,
        message: "This device’s access was revoked. Pair it again.",
      };
    case "BAD_REQUEST":
      return {
        definite: true,
        revoked: false,
        message: hostMessage || "Check the entered details and try again.",
      };
    case "PRECONDITION_FAILED":
      return {
        definite: true,
        revoked: false,
        message:
          hostMessage ||
          "Secure Store isn’t ready for this action. Check its status.",
      };
    case "FORBIDDEN":
      return {
        definite: true,
        revoked: false,
        message: "This entry was revoked. It can’t be changed.",
      };
    case "NOT_FOUND":
      return {
        definite: true,
        revoked: false,
        message: "This entry no longer exists.",
      };
    case "CONFLICT":
      if (DEFINITE_CONFLICTS.has(cause.message))
        return { definite: true, revoked: false, message: cause.message };
      return {
        definite: false,
        revoked: false,
        message:
          "Secure Store changed, or an earlier request already completed. Review the current details before trying again.",
      };
    default:
      return { definite: false, message: UNCERTAIN, revoked: false };
  }
}

/** HTTPS origin only: no credentials, query or fragment. Paths are dropped. */
function originOf(value: string): string | null {
  const text = value.trim();
  if (!text) return null;
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(text) ? text : "https://" + text);
  } catch {
    return null;
  }
  if (
    url.protocol !== "https:" ||
    !url.hostname ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    text.includes("?") ||
    text.includes("#")
  )
    return null;
  return url.origin;
}

function when(value: string | null) {
  if (!value) return "Never";
  return new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

const STATE_LABEL: Record<VaultSnapshot["status"]["state"], string> = {
  uninitialized: "Not set up",
  ready: "Unlocked",
  locked: "Locked",
  "missing-key": "Host key missing",
  unavailable: "Unavailable",
};

export function VaultPanel({
  api,
  workspaceId,
  online,
  refreshHint,
}: {
  api: Api;
  workspaceId: string;
  online: boolean;
  refreshHint: number | undefined;
}) {
  const baseId = useId();
  const [snapshot, setSnapshot] = useState<VaultSnapshot | null>(null);
  const [loadError, setLoadError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [entryForm, setEntryForm] = useState<EntryForm | null>(null);
  const [passForm, setPassForm] = useState<PassForm | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  // Fences: `epoch` changes on unmount or connection change; `formKey`
  // identifies the one live form attempt. Late completions for anything
  // older are dropped so they can't clear or overwrite a newer form.
  const epoch = useRef(0);
  const formKey = useRef(0);
  const loadSeq = useRef(0);
  // Highest vault revision applied on this connection. Status revisions are
  // monotonic, so an older read or lifecycle response never replaces it.
  const appliedRevision = useRef(-1);
  const applied = useRef<VaultSnapshot | null>(null);
  const accept = useCallback((next: VaultSnapshot) => {
    if (next.status.revision < appliedRevision.current) return false;
    appliedRevision.current = next.status.revision;
    applied.current = next;
    setSnapshot(next);
    return true;
  }, []);
  /** Applies a lifecycle mutation's snapshot and invalidates reads sent before it. */
  function acceptMutation(next: VaultSnapshot) {
    loadSeq.current++;
    accept(next);
  }

  function clearAll() {
    formKey.current++;
    setEntryForm(null);
    setPassForm(null);
    setConfirm(null);
    setNotice("");
  }

  const load = useCallback(async () => {
    const at = epoch.current;
    const seq = ++loadSeq.current;
    try {
      const next = await api.vaultSnapshot.query();
      if (epoch.current !== at || seq !== loadSeq.current) return null;
      setLoadError("");
      // An older response yields the newer snapshot already applied.
      return accept(next) ? next : applied.current;
    } catch (cause) {
      if (epoch.current !== at || seq !== loadSeq.current) return null;
      const result = outcome(cause);
      setLoadError(
        result.revoked
          ? result.message
          : "Secure Store status couldn’t be loaded. Check the connection and try again.",
      );
      return null;
    }
  }, [api, accept]);

  // New connection (or unmount): drop everything typed and fence old work.
  // Old requests can't clear `busy` in the new epoch, so reset it here.
  useEffect(() => {
    epoch.current++;
    loadSeq.current++;
    appliedRevision.current = -1;
    applied.current = null;
    setBusy(false);
    setSnapshot(null);
    setLoadError("");
    clearAll();
    return () => {
      epoch.current++;
      formKey.current++;
    };
  }, [api, workspaceId]);

  // Metadata refresh on open, reconnect and each sync cursor change.
  // Forms keep their own base revision; this never rebases them.
  useEffect(() => {
    if (online) void load();
  }, [online, refreshHint, load]);

  const status = snapshot?.status;
  const state = status?.state;
  const entries = snapshot?.entries ?? [];
  const writable = online && !busy;

  // ---------- Simple lifecycle actions ----------
  async function lockOrUnlock(lock: boolean) {
    const at = epoch.current;
    setBusy(true);
    setNotice("");
    try {
      const next = lock
        ? await api.vaultLock.mutate()
        : await api.vaultUnlock.mutate();
      if (epoch.current === at) acceptMutation(next);
    } catch (cause) {
      if (epoch.current !== at) return;
      const result = outcome(cause);
      if (result.revoked) clearAll();
      setNotice(result.message);
      await load();
    } finally {
      if (epoch.current === at) setBusy(false);
    }
  }

  // ---------- Entry form ----------
  function openNew() {
    setConfirm(null);
    setPassForm(null);
    setEntryForm({
      key: ++formKey.current,
      id: crypto.randomUUID(),
      expectedRevision: 0,
      isNew: true,
      kind: "password",
      label: "",
      url: "",
      account: "",
      secret: "",
      reveal: false,
      phase: "editing",
      message: "",
    });
  }
  function openEdit(entry: VaultEntryMetadata, keep?: EntryForm) {
    setConfirm(null);
    setPassForm(null);
    setEntryForm({
      key: ++formKey.current,
      id: entry.id,
      expectedRevision: entry.revision,
      isNew: false,
      kind: entry.kind === "token" ? "token" : "password",
      label: keep?.label ?? entry.label,
      url: keep?.url ?? entry.origins[0] ?? "",
      account: keep?.account ?? entry.accountId,
      secret: keep?.secret ?? "",
      reveal: false,
      phase: "editing",
      message: "",
    });
  }
  function updateEntry(patch: Partial<EntryForm>) {
    setEntryForm((form) =>
      form && form.phase !== "saving" && form.phase !== "uncertain"
        ? { ...form, ...patch, phase: "editing", message: "" }
        : form,
    );
  }
  async function saveEntry(form: EntryForm) {
    const origin = originOf(form.url);
    const account = form.account.trim();
    if (!origin) {
      setEntryForm({
        ...form,
        phase: "rejected",
        message:
          "Enter an HTTPS website address without a username, query or fragment.",
      });
      return;
    }
    if (!account) {
      setEntryForm({ ...form, phase: "rejected", message: "Enter the account." });
      return;
    }
    if (form.isNew && !form.secret) {
      setEntryForm({
        ...form,
        phase: "rejected",
        message: `Enter the ${form.kind === "token" ? "token" : "password"}.`,
      });
      return;
    }
    const label = form.label.trim() || new URL(origin).hostname;
    const at = epoch.current;
    const saving: EntryForm = {
      ...form,
      url: origin,
      label,
      phase: "saving",
      message: "",
    };
    setEntryForm(saving);
    setBusy(true);
    const live = () => epoch.current === at && formKey.current === form.key;
    try {
      await api.vaultPut.mutate({
        id: form.id,
        expectedRevision: form.expectedRevision,
        kind: form.kind,
        label,
        accountId: account,
        origins: [origin],
        ...(form.secret ? { secret: form.secret } : {}),
      });
      if (!live()) return;
      formKey.current++;
      setEntryForm(null);
      setNotice(form.isNew ? "Credential added." : "Credential updated.");
      await load();
    } catch (cause) {
      if (!live()) return;
      const result = outcome(cause);
      if (result.revoked) {
        clearAll();
        setNotice(result.message);
        return;
      }
      // Never treat an error as proof nothing was saved: check metadata.
      const next = await load();
      if (!live()) return;
      const found = next?.entries.find((entry) => entry.id === form.id);
      const moved = (found?.revision ?? 0) !== form.expectedRevision;
      setEntryForm({
        ...saving,
        phase: result.definite && !moved ? "rejected" : "uncertain",
        message: result.definite && !moved ? result.message : result.message,
      });
    } finally {
      if (epoch.current === at) setBusy(false);
    }
  }

  // ---------- Revoke / delete ----------
  function openConfirm(action: Confirm["action"], entry: VaultEntryMetadata) {
    setEntryForm(null);
    setPassForm(null);
    setConfirm({
      key: ++formKey.current,
      action,
      id: entry.id,
      revision: entry.revision,
      label: entry.label,
      phase: "editing",
      message: "",
    });
  }
  async function runConfirm(item: Confirm) {
    const at = epoch.current;
    const live = () => epoch.current === at && formKey.current === item.key;
    setConfirm({ ...item, phase: "saving", message: "" });
    setBusy(true);
    try {
      const input = { id: item.id, expectedRevision: item.revision };
      if (item.action === "revoke") await api.vaultRevoke.mutate(input);
      else await api.vaultRemove.mutate(input);
      if (!live()) return;
      formKey.current++;
      setConfirm(null);
      setNotice(
        item.action === "revoke" ? "Credential revoked." : "Credential deleted.",
      );
      await load();
    } catch (cause) {
      if (!live()) return;
      const result = outcome(cause);
      if (result.revoked) {
        clearAll();
        setNotice(result.message);
        return;
      }
      await load();
      if (!live()) return;
      // No retry from here: the user closes and starts again from the list.
      setConfirm({
        ...item,
        phase: result.definite ? "rejected" : "uncertain",
        message: result.message,
      });
    } finally {
      if (epoch.current === at) setBusy(false);
    }
  }

  // ---------- Passphrase forms ----------
  function openPass(action: PassForm["action"]) {
    setEntryForm(null);
    setConfirm(null);
    setPassForm({
      key: ++formKey.current,
      action,
      expectedRevision: status?.revision ?? 0,
      phrase: "",
      confirm: "",
      phase: "editing",
      message: "",
    });
  }
  function updatePass(patch: Partial<PassForm>) {
    setPassForm((form) =>
      form && (form.phase === "editing" || form.phase === "rejected")
        ? { ...form, ...patch, phase: "editing", message: "" }
        : form,
    );
  }
  async function submitPass(form: PassForm) {
    if (form.phrase.length < MIN_PHRASE) {
      setPassForm({
        ...form,
        phase: "rejected",
        message: `Use at least ${MIN_PHRASE} characters.`,
      });
      return;
    }
    if (form.action !== "recover" && form.phrase !== form.confirm) {
      setPassForm({
        ...form,
        phase: "rejected",
        message: "The two passphrases don’t match.",
      });
      return;
    }
    const at = epoch.current;
    const live = () => epoch.current === at && formKey.current === form.key;
    setPassForm({ ...form, phase: "saving", message: "" });
    setBusy(true);
    try {
      const recoveryPassphrase = form.phrase;
      const next =
        form.action === "initialize"
          ? await api.vaultInitialize.mutate({ recoveryPassphrase })
          : form.action === "recover"
            ? await api.vaultRecover.mutate({ recoveryPassphrase })
            : await api.vaultRotate.mutate({
                expectedRevision: form.expectedRevision,
                recoveryPassphrase,
              });
      if (!live()) return;
      formKey.current++;
      setPassForm(null);
      acceptMutation(next);
      setNotice(
        form.action === "initialize"
          ? "Secure Store is set up. Keep your recovery passphrase somewhere safe, separate from backups."
          : form.action === "recover"
            ? "The host key was recovered."
            : "The key was rotated. Use the new recovery passphrase for backups made from now on.",
      );
    } catch (cause) {
      if (!live()) return;
      const result = outcome(cause);
      if (result.revoked) {
        clearAll();
        setNotice(result.message);
        return;
      }
      const next = await load();
      if (!live()) return;
      // Did the state move as this request would have moved it?
      const moved = next
        ? form.action === "initialize"
          ? next.status.state !== "uninitialized"
          : form.action === "recover"
            ? next.status.state !== "missing-key"
            : next.status.revision !== form.expectedRevision
        : true;
      setPassForm({
        ...form,
        phase: result.definite && !moved ? "rejected" : "uncertain",
        message:
          result.definite && !moved
            ? result.message
            : moved && form.action !== "recover"
              ? "This may have completed. If it did, the passphrase you entered is now the recovery passphrase — keep it. Don’t repeat the request."
              : result.message,
      });
    } finally {
      if (epoch.current === at) setBusy(false);
    }
  }

  // ---------- Render ----------
  const stateLabel = state ? STATE_LABEL[state] : online ? "Checking…" : "Offline";
  const canEdit = state === "ready";

  return (
    <div className="vault-panel">
      <div className="settings-card">
        <div className="settings-row">
          <span className="vault-status">
            <span>Status</span>
            <small>
              {status?.message ??
                (online
                  ? "Checking Secure Store…"
                  : "Connect to the workspace to manage Secure Store.")}
            </small>
          </span>
          <span className="vault-status__actions">
            <span className={"vault-badge vault-badge--" + (state ?? "none")}>
              {stateLabel}
            </span>
            {state === "ready" && (
              <button
                type="button"
                className="pill-button"
                disabled={!writable}
                onClick={() => void lockOrUnlock(true)}
              >
                Lock
              </button>
            )}
            {state === "locked" && (
              <button
                type="button"
                className="pill-button"
                disabled={!writable}
                onClick={() => void lockOrUnlock(false)}
              >
                Unlock
              </button>
            )}
          </span>
        </div>
      </div>
      <p className="settings-footnote">
        Credentials are encrypted on this workspace’s host and shared with your
        paired devices. Saved values can’t be viewed again. Browser filling,
        connectors and Android aren’t connected yet.
      </p>
      {loadError && (
        <p className="panel-error" role="alert">
          {loadError}
          {online && (
            <button
              type="button"
              className="vault-link"
              onClick={() => void load()}
            >
              Try again
            </button>
          )}
        </p>
      )}
      {notice && (
        <p className="vault-notice" role="status">
          {notice}
        </p>
      )}

      {state === "uninitialized" && !passForm && (
        <div className="settings-card settings-card--padded vault-block">
          <p className="settings-muted">
            Set up encrypted storage on this workspace’s host. You’ll choose a
            recovery passphrase that can restore the host key if it’s lost.
          </p>
          <button
            type="button"
            className="pill-button vault-primary"
            disabled={!writable}
            onClick={() => openPass("initialize")}
          >
            Set up Secure Store
          </button>
        </div>
      )}
      {state === "missing-key" && !passForm && (
        <div className="settings-card settings-card--padded vault-block">
          <p className="settings-muted">
            The host key file is missing. Enter the recovery passphrase to
            restore it from the encrypted recovery copy. Revoking and deleting
            entries still works.
          </p>
          <button
            type="button"
            className="pill-button vault-primary"
            disabled={!writable}
            onClick={() => openPass("recover")}
          >
            Recover host key
          </button>
        </div>
      )}
      {state === "unavailable" && (
        <div className="settings-card settings-card--note vault-block">
          Secure Store can’t be opened. The host operator should check that
          the private host key file is present and matches this workspace, or
          restore a matching backup of the key and database. Vesper won’t
          create a new vault over existing data.
        </div>
      )}

      {passForm && (
        <PassphraseForm
          baseId={baseId}
          form={passForm}
          online={online}
          onChange={updatePass}
          onSubmit={() => void submitPass(passForm)}
          onClose={() => {
            formKey.current++;
            setPassForm(null);
          }}
        />
      )}

      {state && state !== "uninitialized" && (
        <>
          <div className="vault-heading">
            <h4 className="settings-group-label">Saved credentials</h4>
            {!entryForm && (
              <button
                type="button"
                className="pill-button"
                disabled={!writable || !canEdit}
                title={canEdit ? undefined : "Unlock Secure Store to add"}
                onClick={openNew}
              >
                Add
              </button>
            )}
          </div>
          {entryForm && (
            <EntryEditor
              baseId={baseId}
              form={entryForm}
              current={entries.find((entry) => entry.id === entryForm.id)}
              online={online}
              canEdit={canEdit}
              onChange={updateEntry}
              onSubmit={() => void saveEntry(entryForm)}
              onReopen={(entry) => openEdit(entry, entryForm)}
              onReopenNew={() =>
                setEntryForm({
                  ...entryForm,
                  key: ++formKey.current,
                  phase: "editing",
                  message: "",
                })
              }
              onClose={() => {
                formKey.current++;
                setEntryForm(null);
              }}
            />
          )}
          <div className="settings-card">
            {entries.length === 0 ? (
              <p className="vault-empty">No saved credentials.</p>
            ) : (
              <ul className="vault-list">
                {entries.map((entry) => (
                  <EntryRow
                    key={entry.id}
                    entry={entry}
                    disabled={!writable || !!entryForm || !!confirm}
                    canEdit={canEdit}
                    onEdit={() => openEdit(entry)}
                    onRevoke={() => openConfirm("revoke", entry)}
                    onRemove={() => openConfirm("remove", entry)}
                  />
                ))}
              </ul>
            )}
          </div>
          {confirm && (
            <div
              className="settings-card settings-card--padded vault-block vault-confirm"
              role="group"
              aria-label={
                confirm.action === "revoke"
                  ? "Revoke credential"
                  : "Delete credential"
              }
            >
              <p>
                <strong>
                  {confirm.action === "revoke" ? "Revoke" : "Delete"} “
                  {confirm.label}”?
                </strong>
              </p>
              <p className="settings-muted">
                {confirm.action === "revoke"
                  ? "Vesper removes the saved value from this workspace and keeps a revoked record. This doesn’t sign you out of the website or revoke access with the provider."
                  : "Vesper deletes this record from this workspace. This doesn’t sign you out of the website or revoke access with the provider."}
              </p>
              {confirm.message && (
                <p
                  className={
                    confirm.phase === "uncertain"
                      ? "vault-warning"
                      : "panel-error"
                  }
                  role="alert"
                >
                  {confirm.message}
                </p>
              )}
              <div className="vault-actions">
                <button
                  type="button"
                  className="pill-button"
                  disabled={confirm.phase === "saving"}
                  onClick={() => {
                    formKey.current++;
                    setConfirm(null);
                  }}
                >
                  {confirm.phase === "editing" || confirm.phase === "saving"
                    ? "Cancel"
                    : "Close"}
                </button>
                {confirm.phase !== "uncertain" &&
                  confirm.phase !== "rejected" && (
                    <button
                      type="button"
                      className="pill-button vault-danger"
                      disabled={!online || confirm.phase === "saving"}
                      onClick={() => void runConfirm(confirm)}
                    >
                      {confirm.phase === "saving"
                        ? "Working…"
                        : confirm.action === "revoke"
                          ? "Revoke"
                          : "Delete"}
                    </button>
                  )}
              </div>
            </div>
          )}
        </>
      )}

      {state === "ready" && !passForm && (
        <details className="vault-details">
          <summary>Advanced: rotate encryption key</summary>
          <p>
            Rotation re-encrypts saved credentials with a new host key and
            protects its recovery copy with a new passphrase. Backups made
            before rotation still need their older passphrase.
          </p>
          <button
            type="button"
            className="pill-button"
            disabled={!writable}
            onClick={() => openPass("rotate")}
          >
            Rotate key…
          </button>
        </details>
      )}

      <details className="vault-details">
        <summary>Backups and recovery</summary>
        <p>
          The host operator can run{" "}
          <code>npm run backup -- &lt;new-private-directory&gt;</code> to make a
          consistent copy of the workspace database. In that copy, credential
          records and the recovery copy of the key are encrypted, and the raw
          host key isn’t included. Ordinary conversation data in the same
          backup is not separately encrypted, so keep the whole backup
          private.
        </p>
        <p>
          Keep the recovery passphrase separate from backups. Vesper can’t show
          or reset it.
        </p>
      </details>
    </div>
  );
}

function EntryRow({
  entry,
  disabled,
  canEdit,
  onEdit,
  onRevoke,
  onRemove,
}: {
  entry: VaultEntryMetadata;
  disabled: boolean;
  canEdit: boolean;
  onEdit: () => void;
  onRevoke: () => void;
  onRemove: () => void;
}) {
  const revoked = entry.revokedAt !== null;
  // OAuth is connector-managed and multi-origin entries can't be shown in
  // one field without dropping origins, so both stay read-only here.
  const editable =
    !revoked && entry.kind !== "oauth" && entry.origins.length === 1;
  return (
    <li className="vault-row">
      <div className="vault-row__main">
        <span className="vault-row__title">
          {entry.label}
          {revoked && <span className="vault-tag">Revoked</span>}
          {entry.kind === "oauth" && (
            <span className="vault-tag">Connector-managed</span>
          )}
        </span>
        <span className="vault-row__meta">
          {entry.accountId} ·{" "}
          {entry.kind === "token"
            ? "Token"
            : entry.kind === "oauth"
              ? "OAuth"
              : "Password"}
        </span>
        {entry.origins.map((origin) => (
          <span key={origin} className="vault-row__meta vault-row__origin">
            {origin}
          </span>
        ))}
        <span className="vault-row__meta">
          {revoked
            ? `Revoked ${when(entry.revokedAt)}`
            : `Last used: ${when(entry.lastUsedAt)}`}
        </span>
      </div>
      <div className="vault-row__actions">
        {editable && (
          <button
            type="button"
            className="vault-link"
            disabled={disabled || !canEdit}
            title={canEdit ? undefined : "Unlock Secure Store to edit"}
            onClick={onEdit}
          >
            Edit
          </button>
        )}
        {!revoked && (
          <button
            type="button"
            className="vault-link"
            disabled={disabled}
            onClick={onRevoke}
          >
            Revoke
          </button>
        )}
        <button
          type="button"
          className="vault-link vault-link--danger"
          disabled={disabled}
          onClick={onRemove}
        >
          Delete
        </button>
      </div>
    </li>
  );
}

function EntryEditor({
  baseId,
  form,
  current,
  online,
  canEdit,
  onChange,
  onSubmit,
  onReopen,
  onReopenNew,
  onClose,
}: {
  baseId: string;
  form: EntryForm;
  current: VaultEntryMetadata | undefined;
  online: boolean;
  canEdit: boolean;
  onChange: (patch: Partial<EntryForm>) => void;
  onSubmit: () => void;
  onReopen: (entry: VaultEntryMetadata) => void;
  onReopenNew: () => void;
  onClose: () => void;
}) {
  const id = (name: string) => `${baseId}-${name}`;
  const locked = form.phase === "saving" || form.phase === "uncertain";
  const secretName = form.kind === "token" ? "Token" : "Password";
  // The record moved away from the revision this form started from
  // (another device, or possibly this form's own unconfirmed save).
  const stale = (current?.revision ?? 0) !== form.expectedRevision;
  const reopenable = !current
    ? form.isNew
    : current.revokedAt === null && current.kind !== "oauth" &&
      current.origins.length === 1;
  return (
    <form
      className="settings-card settings-card--padded vault-form"
      autoComplete="off"
      aria-label={form.isNew ? "Add credential" : "Edit credential"}
      onSubmit={(event) => {
        event.preventDefault();
        if (!locked && !stale && online && canEdit) onSubmit();
      }}
    >
      {form.isNew && (
        <div className="vault-kind" role="group" aria-label="Type">
          {(["password", "token"] as const).map((kind) => (
            <button
              key={kind}
              type="button"
              aria-pressed={form.kind === kind}
              disabled={locked}
              onClick={() => onChange({ kind })}
            >
              {kind === "password" ? "Password" : "Token"}
            </button>
          ))}
        </div>
      )}
      <label htmlFor={id("url")}>URL</label>
      <input
        id={id("url")}
        type="url"
        inputMode="url"
        placeholder="https://example.com"
        value={form.url}
        readOnly={locked}
        maxLength={2048}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        autoComplete="off"
        onChange={(event) => onChange({ url: event.target.value })}
        onBlur={() => {
          const origin = originOf(form.url);
          if (origin && origin !== form.url && !locked) onChange({ url: origin });
        }}
      />
      <p className="vault-help">
        Only this exact HTTPS origin may use the credential.
      </p>
      <label htmlFor={id("account")}>
        {form.kind === "token" ? "Account" : "Username"}
      </label>
      <input
        id={id("account")}
        value={form.account}
        readOnly={locked}
        maxLength={256}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        autoComplete="off"
        onChange={(event) => onChange({ account: event.target.value })}
      />
      <label htmlFor={id("secret")}>
        {form.isNew ? secretName : `New ${secretName.toLowerCase()}`}
      </label>
      <div className="vault-secret">
        <input
          id={id("secret")}
          type={form.reveal ? "text" : "password"}
          value={form.secret}
          readOnly={locked}
          placeholder={form.isNew ? "" : "Leave empty to keep the saved value"}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          autoComplete="new-password"
          onChange={(event) => onChange({ secret: event.target.value })}
        />
        <button
          type="button"
          className="vault-link"
          aria-pressed={form.reveal}
          disabled={!form.secret}
          onClick={() =>
            // Reveal applies only to what was typed here, never a saved value.
            onChange({ reveal: !form.reveal })
          }
        >
          {form.reveal ? "Hide" : "Show"}
        </button>
      </div>
      <label htmlFor={id("label")}>Label</label>
      <input
        id={id("label")}
        value={form.label}
        readOnly={locked}
        maxLength={80}
        placeholder="Defaults to the website name"
        autoComplete="off"
        onChange={(event) => onChange({ label: event.target.value })}
      />
      {stale && form.phase !== "uncertain" && (
        <p className="vault-warning" role="alert">
          {current
            ? "This entry changed since you opened it. Review the current details, then reopen to edit that version."
            : "This entry no longer exists."}
        </p>
      )}
      {form.message && (
        <p
          className={form.phase === "uncertain" ? "vault-warning" : "panel-error"}
          role="alert"
        >
          {form.message}
        </p>
      )}
      {form.phase === "uncertain" && (
        <p className="vault-help">
          {current
            ? `Now saved: “${current.label}”, ${current.accountId}, ${current.origins.join(", ")}${current.revokedAt ? " (revoked)" : ""}.`
            : "No saved record with this entry was found."}{" "}
          Your typed details are kept until you discard them.
        </p>
      )}
      <div className="vault-actions">
        <button
          type="button"
          className="pill-button"
          disabled={form.phase === "saving"}
          onClick={onClose}
        >
          {form.phase === "uncertain" ? "Discard" : "Cancel"}
        </button>
        {form.phase === "uncertain" || stale ? (
          reopenable && (
            <button
              type="button"
              className="pill-button vault-primary"
              disabled={!online || form.phase === "saving"}
              onClick={() => (current ? onReopen(current) : onReopenNew())}
            >
              {current ? "Reopen current version" : "Review and edit again"}
            </button>
          )
        ) : (
          <button
            type="submit"
            className="pill-button vault-primary"
            disabled={!online || !canEdit || form.phase === "saving"}
          >
            {form.phase === "saving"
              ? "Saving…"
              : form.isNew
                ? "Add"
                : "Save"}
          </button>
        )}
      </div>
    </form>
  );
}

function PassphraseForm({
  baseId,
  form,
  online,
  onChange,
  onSubmit,
  onClose,
}: {
  baseId: string;
  form: PassForm;
  online: boolean;
  onChange: (patch: Partial<PassForm>) => void;
  onSubmit: () => void;
  onClose: () => void;
}) {
  const id = (name: string) => `${baseId}-pass-${name}`;
  const locked = form.phase === "saving" || form.phase === "uncertain";
  const needsConfirm = form.action !== "recover";
  const title =
    form.action === "initialize"
      ? "Choose a recovery passphrase"
      : form.action === "recover"
        ? "Recover the host key"
        : "Rotate the encryption key";
  return (
    <form
      className="settings-card settings-card--padded vault-form"
      autoComplete="off"
      aria-label={title}
      onSubmit={(event) => {
        event.preventDefault();
        if (!locked && online) onSubmit();
      }}
    >
      <p>
        <strong>{title}</strong>
      </p>
      <p className="settings-muted">
        {form.action === "initialize"
          ? "It restores the host key if the key file is lost. Vesper can’t show or reset it, so keep it somewhere safe and separate from backups."
          : form.action === "recover"
            ? "Enter the recovery passphrase that protects this workspace’s key. Recovery never replaces an existing key file."
            : "Choose a new recovery passphrase for the new key. Backups made before rotation still need their older passphrase."}
      </p>
      <label htmlFor={id("phrase")}>
        {form.action === "rotate" ? "New recovery passphrase" : "Recovery passphrase"}
      </label>
      <input
        id={id("phrase")}
        type="password"
        value={form.phrase}
        readOnly={locked}
        maxLength={1024}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        autoComplete={form.action === "recover" ? "off" : "new-password"}
        onChange={(event) => onChange({ phrase: event.target.value })}
      />
      {needsConfirm && (
        <>
          <label htmlFor={id("confirm")}>Confirm passphrase</label>
          <input
            id={id("confirm")}
            type="password"
            value={form.confirm}
            readOnly={locked}
            maxLength={1024}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            autoComplete="new-password"
            onChange={(event) => onChange({ confirm: event.target.value })}
          />
        </>
      )}
      <p className="vault-help">At least {MIN_PHRASE} characters.</p>
      {form.message && (
        <p
          className={form.phase === "uncertain" ? "vault-warning" : "panel-error"}
          role="alert"
        >
          {form.message}
        </p>
      )}
      <div className="vault-actions">
        <button
          type="button"
          className="pill-button"
          disabled={form.phase === "saving"}
          onClick={onClose}
        >
          {form.phase === "uncertain" ? "Close" : "Cancel"}
        </button>
        {form.phase !== "uncertain" && (
          <button
            type="submit"
            className="pill-button vault-primary"
            disabled={!online || form.phase === "saving"}
          >
            {form.phase === "saving"
              ? "Working…"
              : form.action === "initialize"
                ? "Set up"
                : form.action === "recover"
                  ? "Recover"
                  : "Rotate key"}
          </button>
        )}
      </div>
    </form>
  );
}
