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

const STORAGE_KEY = "vesper.connection.v1";
type SavedConnection = Connection & { workspaceId: string };
declare global {
  interface Window {
    vesperDesktop?: {
      loadConnection(): Promise<SavedConnection | null>;
      saveConnection(value: SavedConnection | null): Promise<void>;
    };
  }
}
async function loadConnection(): Promise<SavedConnection | null> {
  const saved: unknown = window.vesperDesktop
    ? await window.vesperDesktop.loadConnection()
    : JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? "null");
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
      <span className="mark" aria-hidden="true">
        v
      </span>
      <span>vesper</span>
    </div>
  );
}
function App() {
  const [connection, setConnection] = useState<SavedConnection | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [storageError, setStorageError] = useState("");
  useEffect(() => {
    let active = true;
    void loadConnection()
      .then((saved) => {
        if (active) setConnection(saved);
      })
      .catch(() => {
        if (active)
          setStorageError(
            "Saved connection could not be opened. Pair this device again.",
          );
      })
      .finally(() => {
        if (active) setLoaded(true);
      });
    return () => {
      active = false;
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
      <header>
        <Brand />
        <span className="header-note">Your personal workspace</span>
      </header>
      {storageError && (
        <p role="alert" className="banner">
          {storageError}
        </p>
      )}
      {!loaded ? (
        <main className="workspace">
          <p role="status">Opening your saved connection…</p>
        </main>
      ) : connection ? (
        <Workspace
          connection={connection}
          disconnect={() => save(null)}
          onRevoked={forgetRevoked}
        />
      ) : (
        <Pair onConnect={save} />
      )}
      <footer>
        Vesper · Workspace preview <span>One shared host. Your devices.</span>
      </footer>
    </>
  );
}
function Pair({
  onConnect,
}: {
  onConnect: (value: SavedConnection) => Promise<void>;
}) {
  const [host, setHost] = useState(
    location.port === "5177" ? "http://127.0.0.1:4317" : location.origin,
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
        This first release connects devices and preserves workspace identity.
        Chats, agents, connectors, and scheduled work are not available yet.
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
          <button onClick={() => void status.refetch()}>Try again</button>
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
              <dd>{data?.host.availability ?? "Waiting for host"}</dd>
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
              <span className="check">✓</span> Shared workspace identity
            </li>
            <li>
              <span className="check">✓</span> Persistent device connections
            </li>
            <li>
              <span className="check">✓</span> Reconnect and revoke access
            </li>
          </ul>
          <p className="muted">
            Chat, agents, account connections and schedules are being built. No
            background model work runs in this preview.
          </p>
          <div className="small-note">
            A host on this Mac goes offline when the Mac shuts down. Use an
            independent host for availability across devices.
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
          {revokeCandidate?.name} will need a new pairing code to reconnect.
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
