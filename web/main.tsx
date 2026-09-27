import React, {
  useMemo,
  useState,
  useEffect,
  useCallback,
  useRef,
} from "react";
import { createRoot } from "react-dom/client";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import { createTRPCClient, httpLink, TRPCClientError } from "@trpc/client";
import type { AppRouter } from "../server/router.js";
import { normalizeHost, type Connection } from "../shared/connection.js";
import "./style.css";
import type { Draft } from "../shared/sync.js";
import type {
  QuickChatStatus,
  SpeechCommand,
  SpeechEvent,
} from "../shared/desktop.js";
import { ConversationScreen } from "./chat.js";
import { VesperAvatar } from "./presentation/icons.js";

const STORAGE_KEY = "vesper.connection.v1";
type SavedConnection = Connection & {
  workspaceId: string;
  mode?: "local" | "remote";
};
/** Sections the native settings window may be opened at. */
export type SettingsEntrySection =
  "general" | "providers" | "devices" | "dictation" | "secure";
const settingsWindow =
  !!window.vesperDesktop &&
  new URLSearchParams(location.search).get("settings") === "1";
class LocalWorkspaceRestoreError extends Error {}
type LocalHostStatus = {
  state: "stopped" | "starting" | "running" | "failed";
  message?: string;
};
declare global {
  interface Window {
    vesperDesktop?: {
      loadDraft(
        workspaceId: string,
        conversationId: string,
      ): Promise<{ draft: Draft | null; revision: number }>;
      saveDraft(
        workspaceId: string,
        conversationId: string,
        draft: Draft | null,
        revision: number,
      ): Promise<{ ok: boolean; revision: number; staleEqual?: boolean }>;
      onDraftChanged(
        callback: (scope: {
          workspaceId: string;
          conversationId: string;
          revision: number;
        }) => void,
      ): () => void;
      quickChatStatus(): Promise<QuickChatStatus>;
      showQuickChat(): Promise<void>;
      hideQuickChat(): Promise<void>;
      showMainWindow(): Promise<void>;
      setQuickShortcut(accelerator: string): Promise<QuickChatStatus>;
      onQuickStatus(callback: (status: QuickChatStatus) => void): () => void;
      onQuickFocus(callback: () => void): () => void;
      activeConversation(): Promise<{
        workspaceId: string;
        conversationId: string;
      } | null>;
      setActiveConversation(
        workspaceId: string,
        conversationId: string,
      ): Promise<void>;
      onActiveConversation(
        callback: (scope: {
          workspaceId: string;
          conversationId: string;
        }) => void,
      ): () => void;
      showSettings(section?: SettingsEntrySection): Promise<void>;
      closeSettings(): Promise<void>;
      settingsSection(): Promise<SettingsEntrySection>;
      onSettingsSection(
        callback: (section: SettingsEntrySection) => void,
      ): () => void;
      speechCommand(command: SpeechCommand): Promise<void>;
      cancelSpeech(): Promise<void>;
      onSpeechEvent(callback: (event: SpeechEvent) => void): () => void;
      loadConnection(): Promise<
        SavedConnection | null | { error: "restore-local-workspace" }
      >;
      saveConnection(value: SavedConnection | null): Promise<void>;
      createLocalWorkspace(): Promise<SavedConnection | null>;
      restartLocalHost(): Promise<SavedConnection>;
      localHostStatus(): Promise<LocalHostStatus>;
      onLocalHostStatus(
        callback: (status: LocalHostStatus) => void,
      ): () => void;
      onConnectionChanged(
        callback: (connection: SavedConnection | null) => void,
      ): () => void;
    };
  }
}
async function loadConnection(): Promise<SavedConnection | null> {
  const saved: unknown = window.vesperDesktop
    ? await window.vesperDesktop.loadConnection()
    : JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? "null");
  if (
    saved &&
    typeof saved === "object" &&
    "error" in saved &&
    saved.error === "restore-local-workspace"
  ) {
    throw new LocalWorkspaceRestoreError(
      "The saved local workspace is missing or has changed. Restore its data from backup before opening Vesper.",
    );
  }
  if (saved === null) return null;
  if (
    !saved ||
    typeof saved !== "object" ||
    !("url" in saved) ||
    !("token" in saved) ||
    !("workspaceId" in saved) ||
    typeof saved.url !== "string" ||
    typeof saved.token !== "string" ||
    typeof saved.workspaceId !== "string"
  ) {
    throw new Error("Saved connection is invalid. Pair this device again.");
  }
  return {
    url: normalizeHost(saved.url),
    token: saved.token,
    workspaceId: saved.workspaceId,
    mode: "mode" in saved && saved.mode === "local" ? "local" : "remote",
  };
}
async function persistConnection(next: SavedConnection | null) {
  if (window.vesperDesktop) await window.vesperDesktop.saveConnection(next);
  else if (next) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  else sessionStorage.removeItem(STORAGE_KEY);
}
function isUnauthorized(error: unknown) {
  return (
    error instanceof TRPCClientError && error.data?.code === "UNAUTHORIZED"
  );
}
function client(connection: Connection) {
  return createTRPCClient<AppRouter>({
    links: [
      httpLink({
        url: connection.url + "/trpc",
        headers: () => ({ Authorization: `Bearer ${connection.token}` }),
        fetch: (url, options) =>
          fetch(url, { ...options, signal: AbortSignal.timeout(8000) }),
      }),
    ],
  });
}
function errorMessage(error: unknown) {
  if (error instanceof TRPCClientError && error.data?.code === "CONFLICT")
    return "The workspace name changed on another device. Cancel this edit to see the current name, then rename it again.";
  if (error instanceof TRPCClientError && error.data?.code)
    return error.message;
  return "Cannot reach this host. Check its address and connection, then try again.";
}
const queries = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: true } },
});
function Brand() {
  return (
    <div className="brand">
      <VesperAvatar size={30} />
      <span>vesper</span>
    </div>
  );
}
function App() {
  const [connection, setConnection] = useState<SavedConnection | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [remoteSetup, setRemoteSetup] = useState(false);
  const [view, setView] = useState<"chat" | "workspace">("chat");
  const [localStatus, setLocalStatus] = useState<LocalHostStatus>({
    state: "stopped",
  });
  const [storageError, setStorageError] = useState("");
  useEffect(() => {
    let active = true;
    void loadConnection()
      .then((saved) => {
        if (active) setConnection(saved);
      })
      .catch((error: unknown) => {
        if (active)
          setStorageError(
            error instanceof LocalWorkspaceRestoreError
              ? error.message
              : "Saved connection could not be opened. Check device encryption or connection settings.",
          );
      })
      .finally(() => {
        if (active) setLoaded(true);
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    const bridge = window.vesperDesktop;
    if (!bridge) return;
    void bridge
      .localHostStatus()
      .then(setLocalStatus)
      .catch(() => {});
    const unsubscribeStatus = bridge.onLocalHostStatus(setLocalStatus);
    const unsubscribeConnection = bridge.onConnectionChanged((next) => {
      queries.clear();
      setConnection(next);
    });
    return () => {
      unsubscribeStatus();
      unsubscribeConnection();
    };
  }, []);
  async function save(next: SavedConnection | null) {
    try {
      await persistConnection(next);
      setStorageError("");
    } catch {
      setStorageError(
        "This device cannot save its connection. You will need to pair again after closing the app.",
      );
    }
    queries.clear();
    setConnection(next);
    if (!next) setRemoteSetup(false);
  }
  const forgetRevoked = useCallback(async () => {
    try {
      await persistConnection(null);
    } catch {
      setStorageError(
        "Access was revoked, but the saved connection could not be removed from this device.",
      );
    }
  }, []);
  return (
    <>
      {(!connection || view === "workspace") && (
        <header>
          <Brand />
          {connection ? (
            <button onClick={() => setView("chat")}>
              {settingsWindow ? "Back to Settings" : "Back to chat"}
            </button>
          ) : (
            <span className="header-note">Your personal workspace</span>
          )}
        </header>
      )}
      {storageError && (
        <p role="alert" className="banner">
          {storageError}
        </p>
      )}
      {localStatus.state === "failed" &&
        (!connection || view === "workspace") &&
        (connection?.mode === "local" || !connection) && (
          <p className="banner" role="alert">
            {localStatus.message ?? "The local workspace could not start."}
          </p>
        )}
      {!loaded ? (
        <main className="workspace">
          <p role="status">Opening your saved connection…</p>
        </main>
      ) : settingsWindow && !connection ? (
        // The settings window never pairs or creates workspaces itself.
        <main className="workspace">
          <p role="status">
            Connect a workspace in the main Vesper window, then reopen Settings.
          </p>
        </main>
      ) : connection && view === "chat" ? (
        <ConversationScreen
          key={connection.workspaceId}
          settingsWindow={settingsWindow}
          connection={connection}
          onWorkspace={() => setView("workspace")}
          onRevoked={forgetRevoked}
          onDisconnect={() => save(null)}
        />
      ) : connection ? (
        <Workspace
          connection={connection}
          disconnect={() => save(null)}
          onRevoked={forgetRevoked}
        />
      ) : window.vesperDesktop && !remoteSetup ? (
        <Welcome onConnect={save} onRemote={() => setRemoteSetup(true)} />
      ) : (
        <Pair
          onConnect={save}
          onBack={
            window.vesperDesktop ? () => setRemoteSetup(false) : undefined
          }
        />
      )}
      {(!connection || view === "workspace") && (
        <footer>
          Vesper <span>One shared host. Your devices.</span>
        </footer>
      )}
    </>
  );
}
function Welcome({
  onConnect,
  onRemote,
}: {
  onConnect: (value: SavedConnection) => Promise<void>;
  onRemote: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function openLocal() {
    setBusy(true);
    setError("");
    try {
      const connection = await window.vesperDesktop!.createLocalWorkspace();
      if (connection) await onConnect(connection);
    } catch {
      setError(
        "The local workspace could not open. Check that storage and device encryption are available, then try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="workspace welcome">
      <p className="eyebrow">Welcome to Vesper</p>
      <h1>Your workspace, your way.</h1>
      <p className="lead">
        Start on this Mac. You do not need a phone, a separate server, or a
        terminal.
      </p>
      <div className="workspace-grid">
        <section className="card">
          <h2>On this Mac</h2>
          <p className="muted">
            Create a private workspace here, or reopen the one already saved on
            this Mac.
          </p>
          <button
            className="primary"
            disabled={busy}
            onClick={() => void openLocal()}
          >
            {busy ? "Opening workspace…" : "Start on this Mac"}
          </button>
          <p className="field-help">
            Your data stays on this Mac. Local work pauses when you quit Vesper
            or the Mac is off.
          </p>
        </section>
        <section className="card">
          <h2>Connect to a workspace</h2>
          <p className="muted">
            Pair this Mac with an existing Vesper host using its address and a
            one-time code.
          </p>
          <button disabled={busy} onClick={onRemote}>
            Connect to existing host
          </button>
          <p className="field-help">
            An independent host can remain available while this Mac is off.
          </p>
        </section>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <p className="scope-note">
        Chat with Claude using your own account. Dictation uses on-device speech
        where this Mac supports it. Connectors and scheduled work aren’t
        available yet.
      </p>
    </main>
  );
}
function Pair({
  onConnect,
  onBack,
}: {
  onConnect: (value: SavedConnection) => Promise<void>;
  onBack?: () => void;
}) {
  const [host, setHost] = useState(
    window.vesperDesktop
      ? ""
      : location.port === "5177"
        ? "http://127.0.0.1:4317"
        : location.origin,
  );
  const [name, setName] = useState(
    window.vesperDesktop ? "My Mac" : "My browser",
  );
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function pair(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const url = normalizeHost(host);
      const result = await client({ url, token: "" }).pair.mutate({
        code,
        name,
        platform: window.vesperDesktop ? "mac" : "web",
      });
      const connection = { url, token: result.token };
      if (result.protocolVersion !== 1)
        throw new Error("This host needs a compatible Vesper client.");
      setCode("");
      await onConnect({ ...connection, workspaceId: result.workspaceId });
    } catch (err) {
      setError(
        err instanceof TRPCClientError
          ? errorMessage(err)
          : err instanceof Error
            ? err.message
            : "Pairing failed.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="setup">
      <section className="intro">
        {onBack && (
          <button className="text-button" onClick={onBack}>
            ← Back
          </button>
        )}
        <p className="eyebrow">A place for everything</p>
        <h1>
          Make yourself
          <br />
          at home.
        </h1>
        <p className="lead">
          Connect to your Vesper host. Your workspace stays in one place, ready
          for each device you pair.
        </p>
        <div className="host-note">
          <span className="note-icon" aria-hidden="true">
            ⌘
          </span>
          <div>
            <strong>Your host keeps the workspace</strong>
            <p>
              To stay available with your Mac off, run the host on a separate,
              always-on computer.
            </p>
          </div>
        </div>
      </section>
      <section className="card pairing">
        <p className="eyebrow">First connection</p>
        <h2>Connect your device</h2>
        <p className="muted">
          Use a pairing code from your host or a connected device.
        </p>
        <form onSubmit={pair}>
          <label htmlFor="host">Host address</label>
          <input
            id="host"
            type="url"
            autoComplete="url"
            value={host}
            onChange={(e) => setHost(e.target.value)}
            required
            placeholder="https://vesper.example.com"
          />
          <label htmlFor="name">Device name</label>
          <input
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={80}
            autoComplete="off"
          />
          <label htmlFor="code">Pairing code</label>
          <input
            id="code"
            type="password"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            required
            minLength={16}
            maxLength={128}
            autoComplete="off"
            spellCheck={false}
          />
          <p className="field-help">
            Codes expire after 10 minutes and work once.{" "}
            {!window.vesperDesktop &&
              "Browser connections last for this tab session."}
          </p>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button className="primary" disabled={busy}>
            {busy ? "Connecting…" : "Connect to workspace"}
            <span aria-hidden="true">↗</span>
          </button>
        </form>
        <details>
          <summary>Where do I find my first code?</summary>
          <p>
            On the computer running the host, open its private{" "}
            <code>pairing-code</code> file. After connecting, use “Pair another
            device” here. A code grants full access to your personal workspace.
          </p>
        </details>
      </section>
      <p className="scope-note">
        Conversations and Claude chat are available once connected. Connectors
        and scheduled work aren’t available yet.
      </p>
    </main>
  );
}
function Workspace({
  connection,
  disconnect,
  onRevoked,
}: {
  connection: SavedConnection;
  disconnect: () => void;
  onRevoked: () => Promise<void>;
}) {
  const api = useMemo(() => client(connection), [connection]);
  const status = useQuery({
    queryKey: ["workspace", connection.url, connection.workspaceId],
    queryFn: () => api.workspace.query(),
    refetchInterval: (query) =>
      isUnauthorized(query.state.error) ? false : 3000,
    refetchOnWindowFocus: (query) => !isUnauthorized(query.state.error),
    refetchOnReconnect: (query) => !isUnauthorized(query.state.error),
    refetchIntervalInBackground: false,
  });
  const [name, setName] = useState("");
  const [editing, setEditing] = useState(false);
  const [editVersion, setEditVersion] = useState<number | null>(null);
  const [revokeCandidate, setRevokeCandidate] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const revokeDialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (revokeCandidate) revokeDialog.current?.showModal();
    else revokeDialog.current?.close();
  }, [revokeCandidate]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [pairCode, setPairCode] = useState<{
    code: string;
    expiresAt: string;
  } | null>(null);
  const [clock, setClock] = useState(Date.now());
  const data = status.data;
  useEffect(() => {
    if (data?.settings?.appearance)
      document.documentElement.dataset.appearance = data.settings.appearance;
  }, [data?.settings?.appearance]);
  const mismatch =
    !!data &&
    !!connection.workspaceId &&
    data.workspace.id !== connection.workspaceId;
  const incompatible = !!data && data.host.protocolVersion !== 1;
  const unauthorized = isUnauthorized(status.error);
  useEffect(() => {
    if (unauthorized) void onRevoked();
  }, [unauthorized, onRevoked]);
  const connected = !!data && !status.isError && !mismatch && !incompatible;
  useEffect(() => {
    if (!pairCode) return;
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [pairCode]);
  useEffect(() => {
    if (!connected) setPairCode(null);
  }, [connected]);
  async function act(operation: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await operation();
      await status.refetch();
    } catch (err) {
      setError(errorMessage(err));
      await status.refetch();
    } finally {
      setBusy(false);
    }
  }
  async function retryConnection() {
    if (connection.mode !== "local" || !window.vesperDesktop || unauthorized) {
      await status.refetch();
      return;
    }
    setBusy(true);
    setError("");
    try {
      const next = await window.vesperDesktop.restartLocalHost();
      // A changed port arrives through the connection event and starts a new query.
      if (next.url === connection.url) await status.refetch();
    } catch {
      setError(
        "The local workspace could not restart. Check its status and saved data, then try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="workspace">
      <div className="workspace-top">
        <div>
          <p className="eyebrow">Your workspace</p>
          <h1>
            {mismatch
              ? "Workspace changed"
              : (data?.workspace.name ?? "Connecting…")}
          </h1>
          <p className="muted">{connection.url}</p>
        </div>
        <span
          role="status"
          className={`status ${connected ? "online" : "offline"}`}
        >
          <i />
          {connected
            ? "Connected"
            : status.isPending
              ? "Connecting"
              : unauthorized
                ? "Access revoked"
                : mismatch
                  ? "Identity mismatch"
                  : "Disconnected"}
        </span>
      </div>
      {!connected && !status.isPending && (
        <div className="notice" role="alert">
          <strong>
            {unauthorized
              ? "This device no longer has access."
              : mismatch
                ? "This address now serves a different workspace."
                : incompatible
                  ? "This host needs a compatible client."
                  : "Your host is unavailable."}
          </strong>
          <p>
            {mismatch
              ? "For your security, pair again before using the replacement workspace."
              : unauthorized
                ? "Pair again with a new code from a connected device."
                : "Changes are disabled. Vesper will reconnect when the host is available. Last received information may be out of date."}
          </p>
          <button disabled={busy} onClick={() => void retryConnection()}>
            {busy ? "Trying again…" : "Try again"}
          </button>
          <button className="text-button" onClick={disconnect}>
            Forget this connection
          </button>
        </div>
      )}
      <div className="workspace-grid">
        <section className="card">
          <div className="section-title">
            <h2>Workspace</h2>
            <span className="pill">Personal</span>
          </div>
          <dl>
            <div>
              <dt>Host</dt>
              <dd>
                {connection.mode === "local"
                  ? "This Mac · Local workspace"
                  : (data?.host.availability ?? "Waiting for host")}
              </dd>
            </div>
            <div>
              <dt>This device</dt>
              <dd>{data?.device.name ?? "Not yet confirmed"}</dd>
            </div>
            <div>
              <dt>Last received</dt>
              <dd>
                {status.dataUpdatedAt
                  ? new Date(status.dataUpdatedAt).toLocaleTimeString()
                  : "Waiting"}
              </dd>
            </div>
          </dl>
          {editing ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (data && editVersion !== null)
                  void act(async () => {
                    await api.renameWorkspace.mutate({
                      name,
                      expectedVersion: editVersion,
                    });
                    setEditing(false);
                  });
              }}
            >
              <label htmlFor="workspace-name">Workspace name</label>
              <input
                id="workspace-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={80}
                required
                autoFocus
              />
              <div className="actions">
                <button disabled={busy || !connected}>Save name</button>
                <button
                  type="button"
                  className="text-button"
                  onClick={() => setEditing(false)}
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <button
              disabled={!connected || busy}
              onClick={() => {
                setName(data?.workspace.name ?? "");
                setEditVersion(data?.workspace.version ?? null);
                setEditing(true);
              }}
            >
              Rename workspace
            </button>
          )}
          <p className="field-help">
            Names and paired devices are shared by your connected clients.
          </p>
        </section>
        <section className="card">
          <h2>Available here</h2>
          <ul className="capabilities">
            <li>
              <span className="check">✓</span> Chat with Claude using your
              selected account
            </li>
            <li>
              <span className="check">✓</span> Saved conversations and private
              drafts
            </li>
            <li>
              <span className="check">✓</span> Shared appearance and workspace
              identity
            </li>
            <li>
              <span className="check">✓</span> Persistent device connections
            </li>
            <li>
              <span className="check">✓</span> Reconnect and revoke access
            </li>
          </ul>
          <p className="muted">
            Replies run only when you send a message. Connectors and scheduled
            work aren’t available yet, and nothing runs in the background.
          </p>
          <div className="small-note">
            {connection.mode === "local"
              ? "This workspace runs on your Mac and is accessible only from this Mac. Quitting Vesper or turning off the Mac stops local work. No phone is required."
              : "This device connects to a separate host. Its availability depends on that host staying online."}
          </div>
        </section>
        <section className="card devices">
          <div className="section-title">
            <div>
              <p className="eyebrow">One place, every device</p>
              <h2>Connected devices</h2>
            </div>
            <button
              disabled={!connected || busy}
              onClick={() =>
                void act(async () => {
                  setPairCode(await api.createPairingCode.mutate());
                  setClock(Date.now());
                })
              }
            >
              Pair another device
            </button>
          </div>
          {pairCode && (
            <div className="pair-code">
              <strong>
                {clock >= Date.parse(pairCode.expiresAt)
                  ? "This code has expired"
                  : "Your one-time pairing code"}
              </strong>
              {clock < Date.parse(pairCode.expiresAt) && (
                <>
                  <code>{pairCode.code}</code>
                  <p>
                    Grants full workspace access. Expires at{" "}
                    {new Date(pairCode.expiresAt).toLocaleTimeString()}.
                  </p>
                </>
              )}
              <button className="text-button" onClick={() => setPairCode(null)}>
                Hide code
              </button>
            </div>
          )}
          <ul className="device-list">
            {!mismatch &&
              data?.devices.map((device) => (
                <li key={device.id}>
                  <span className="device-icon" aria-hidden="true">
                    ▱
                  </span>
                  <div>
                    <strong>{device.name}</strong>
                    <p>
                      {device.platform === "mac"
                        ? "Mac"
                        : device.platform === "android"
                          ? "Android"
                          : "Browser"}
                      {device.id === data.device.id ? " · This device" : ""} ·
                      Paired {new Date(device.pairedAt).toLocaleDateString()}
                    </p>
                  </div>
                  <button
                    className="text-button"
                    disabled={!connected || busy}
                    onClick={() =>
                      setRevokeCandidate({ id: device.id, name: device.name })
                    }
                  >
                    Revoke access
                  </button>
                </li>
              ))}
          </ul>
        </section>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <dialog
        ref={revokeDialog}
        onCancel={() => setRevokeCandidate(null)}
        aria-labelledby="revoke-title"
        className="revoke-dialog"
      >
        <h2 id="revoke-title">Revoke device access?</h2>
        <p>
          {revokeCandidate?.name} will need a new pairing code to reconnect. All
          unused workspace pairing codes will also be canceled.
        </p>
        <div className="actions">
          <button autoFocus onClick={() => setRevokeCandidate(null)}>
            Cancel
          </button>
          <button
            disabled={!connected || busy}
            onClick={() => {
              const device = revokeCandidate;
              setRevokeCandidate(null);
              if (device)
                void act(async () => {
                  await api.revokeDevice.mutate({ id: device.id });
                  setPairCode(null);
                  if (device.id === data?.device.id) disconnect();
                });
            }}
          >
            Revoke device
          </button>
        </div>
      </dialog>
      <button className="text-button forget" onClick={disconnect}>
        Forget connection on this device
      </button>
      <p className="field-help">
        Forgetting removes this device's saved connection. Revoke access to
        invalidate its token on the host.
      </p>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queries}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>,
);
