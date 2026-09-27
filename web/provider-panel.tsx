import { useId, useState } from "react";
import type { ProviderAvailability } from "../server/providers/contract.js";
import type { ProviderBinding, ProviderRun } from "../shared/providers.js";
import "./provider-panel.css";

type ProviderPanelProps = {
  availability: ProviderAvailability | null;
  selection: ProviderBinding | null;
  run: ProviderRun | null;
  busy: boolean;
  loading: boolean;
  error: string;
  onRefresh: () => void;
  onSelect: (modelId: string | null) => void;
  onCancel: () => void;
};

type RunStatus = ProviderRun["status"];
type Usage = NonNullable<ProviderRun["usage"]>;
type LimitStatus = NonNullable<Usage["limit"]>["status"];

type DraftState = {
  key: string;
  account: string | null;
  draft: string;
};

const ACTIVE_STATUSES: ReadonlySet<RunStatus> = new Set<RunStatus>([
  "queued",
  "initializing",
  "running",
  "cancelling",
]);

const RUN_STATUS_LABELS: Record<RunStatus, string> = {
  queued: "Queued",
  initializing: "Initializing",
  running: "Running",
  cancelling: "Cancelling",
  completed: "Completed",
  cancelled: "Cancelled",
  failed: "Failed",
  interrupted: "Interrupted",
};

const AVAILABILITY_LABELS: Record<ProviderAvailability["status"], string> = {
  available: "Connected",
  unavailable: "Unavailable",
  "auth-required": "Sign-in required",
  blocked: "Blocked",
};

const LIMIT_LABELS: Record<LimitStatus, string> = {
  allowed: "Within limit",
  allowed_warning: "Approaching limit",
  rejected: "Limit reached",
};

const UNAVAILABLE_PROVIDERS = [
  "Codex",
  "OpenCode",
  "Antigravity",
  "Custom endpoint",
] as const;

function isCount(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function syncKey(
  selection: ProviderBinding | null,
  account: string | null,
): string {
  return JSON.stringify([
    selection?.revision ?? null,
    selection?.accountId ?? null,
    selection?.modelId ?? null,
    account,
  ]);
}

// Only carry a saved model into the draft when it belongs to the discovered account.
function initialDraft(
  selection: ProviderBinding | null,
  account: string | null,
): string {
  if (!selection || account === null || selection.accountId !== account)
    return "";
  return selection.modelId;
}

function UsageList({ usage }: { usage: Usage }) {
  const rows: Array<[string, string]> = [];
  if (isCount(usage.inputTokens))
    rows.push(["Input tokens", usage.inputTokens.toLocaleString()]);
  if (isCount(usage.outputTokens))
    rows.push(["Output tokens", usage.outputTokens.toLocaleString()]);
  if (isCount(usage.cacheReadTokens))
    rows.push(["Cache read", usage.cacheReadTokens.toLocaleString()]);
  if (isCount(usage.cacheWriteTokens))
    rows.push(["Cache write", usage.cacheWriteTokens.toLocaleString()]);
  if (usage.limit) rows.push(["Rate limit", LIMIT_LABELS[usage.limit.status]]);
  if (rows.length === 0) return null;
  return (
    <dl className="provider-panel__usage">
      {rows.map(([label, value]) => (
        <div className="provider-panel__usage-row" key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function ProviderPanel({
  availability,
  selection,
  run,
  busy,
  loading,
  error,
  onRefresh,
  onSelect,
  onCancel,
}: ProviderPanelProps) {
  const baseId = useId();
  const modelSelectId = `${baseId}-model`;
  const statusId = `${baseId}-status`;

  const discoveredAccount = availability?.account;
  const models =
    availability &&
    availability.status === "available" &&
    availability.capabilities.chat &&
    discoveredAccount
      ? availability.models
      : [];

  // While discovery is absent (e.g. mid-refresh), keep the last known account so the draft survives.
  const [draftState, setDraftState] = useState<DraftState>(() => {
    const account = discoveredAccount?.id ?? null;
    return {
      key: syncKey(selection, account),
      account,
      draft: initialDraft(selection, account),
    };
  });
  const trackedAccount =
    availability === null
      ? draftState.account
      : (discoveredAccount?.id ?? null);
  const key = syncKey(selection, trackedAccount);
  let current = draftState;
  if (key !== draftState.key) {
    current = {
      key,
      account: trackedAccount,
      draft: initialDraft(selection, trackedAccount),
    };
    setDraftState(current);
  }

  const draft = models.some((model) => model.id === current.draft)
    ? current.draft
    : "";
  const active = run !== null && ACTIVE_STATUSES.has(run.status);
  const accountChanged =
    selection !== null &&
    discoveredAccount !== undefined &&
    selection.accountId !== discoveredAccount.id;
  const unchanged =
    selection === null
      ? draft === ""
      : !accountChanged &&
        discoveredAccount !== undefined &&
        draft === selection.modelId;
  const applyDisabled = busy || loading || active || unchanged;
  const savedModelLabel = selection
    ? (models.find((model) => model.id === selection.modelId)?.label ??
      selection.modelId)
    : null;

  function handleApply() {
    if (applyDisabled) return;
    onSelect(draft === "" ? null : draft);
  }

  return (
    <section className="provider-panel" aria-labelledby={`${baseId}-title`}>
      <header className="provider-panel__header">
        <h3 className="provider-panel__title" id={`${baseId}-title`}>
          Provider
        </h3>
        <button
          type="button"
          className="provider-panel__button"
          onClick={onRefresh}
          disabled={busy || loading}
          aria-busy={loading}
        >
          {loading ? "Checking…" : "Refresh connection"}
        </button>
      </header>

      <div
        className="provider-panel__status"
        id={statusId}
        role="status"
        aria-live="polite"
      >
        <p className="provider-panel__line">
          <span className="provider-panel__name">Claude</span>{" "}
          <span className="provider-panel__muted">
            {availability
              ? AVAILABILITY_LABELS[availability.status]
              : loading
                ? "Checking"
                : "Not checked"}
          </span>
        </p>
        {discoveredAccount ? (
          <p className="provider-panel__line">
            Account: {discoveredAccount.label}
            {discoveredAccount.plan ? (
              <span className="provider-panel__muted">
                {" "}
                · {discoveredAccount.plan}
              </span>
            ) : null}
          </p>
        ) : null}
        {availability?.reason ? (
          <p className="provider-panel__line provider-panel__muted">
            {availability.reason}
          </p>
        ) : null}
      </div>

      <ul
        className="provider-panel__capabilities"
        aria-label="Claude capabilities"
      >
        <li>
          Chat:{" "}
          {availability
            ? availability.capabilities.chat
              ? "supported"
              : "not supported"
            : "not checked"}
        </li>
        <li>Tools, browser, and actions: not available</li>
        <li>Native session resume: not available</li>
        <li>
          Replies continue from up to 20 recent visible messages, within a
          60,000-character history limit.
        </li>
      </ul>

      <div className="provider-panel__group">
        <label className="provider-panel__label" htmlFor={modelSelectId}>
          Model
        </label>
        <select
          id={modelSelectId}
          className="provider-panel__select"
          value={draft}
          onChange={(event) =>
            setDraftState((state) => ({ ...state, draft: event.target.value }))
          }
          disabled={busy || loading || active}
        >
          <option value="">Save only (no provider)</option>
          {models.map((model) => (
            <option key={model.id} value={model.id}>
              {model.label}
            </option>
          ))}
        </select>
        {selection ? (
          <p className="provider-panel__line provider-panel__muted">
            Saved: {savedModelLabel}
          </p>
        ) : (
          <p className="provider-panel__line provider-panel__muted">
            Saved: save only
          </p>
        )}
        {accountChanged ? (
          <p className="provider-panel__notice" role="alert">
            Account changed. The saved model belongs to a different account;
            apply a selection for the current account.
          </p>
        ) : null}
        <button
          type="button"
          className="provider-panel__button provider-panel__button--primary"
          onClick={handleApply}
          disabled={applyDisabled}
        >
          Apply selection
        </button>
      </div>

      {run ? (
        <div className="provider-panel__group" aria-live="polite">
          <p className="provider-panel__line">
            Run: {RUN_STATUS_LABELS[run.status]}
            <span className="provider-panel__muted">
              {" "}
              · {run.selection.modelId}
            </span>
          </p>
          {run.usage ? <UsageList usage={run.usage} /> : null}
          {active ? (
            <button
              type="button"
              className="provider-panel__button"
              onClick={onCancel}
              disabled={run.status === "cancelling" || busy}
            >
              {run.status === "cancelling" ? "Stopping…" : "Stop"}
            </button>
          ) : null}
        </div>
      ) : null}

      {run?.error ? (
        <p className="provider-panel__error" role="alert">
          {run.error}
        </p>
      ) : null}
      {error ? (
        <p className="provider-panel__error" role="alert">
          {error}
        </p>
      ) : null}

      <ul className="provider-panel__others" aria-label="Other providers">
        {UNAVAILABLE_PROVIDERS.map((name) => (
          <li key={name}>
            {name}{" "}
            <span className="provider-panel__muted">
              not available in this build
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
