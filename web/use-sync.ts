import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { createTRPCClient, httpLink, TRPCClientError } from "@trpc/client";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../server/router.js";
import type { Connection } from "../shared/connection.js";
export type Snapshot = inferRouterOutputs<AppRouter>["syncSnapshot"];
export function syncError(error: unknown) {
  if (error instanceof TRPCClientError) {
    if (error.data?.code === "UNAUTHORIZED")
      return "Access revoked. Reconnect this device with a new authorized connection.";
    if (error.data?.code === "NOT_FOUND")
      return "This host needs the conversation update, or the conversation no longer exists.";
    if (error.data?.code) return error.message;
  }
  return "The host could not be reached. Your draft stays on this device.";
}
export function useSync(
  connection: Connection & { workspaceId: string },
  conversationId: string | undefined,
  onRevoked: () => Promise<void>,
) {
  const api = useMemo(
    () =>
      createTRPCClient<AppRouter>({
        links: [
          httpLink({
            url: connection.url + "/trpc",
            headers: () => ({ Authorization: `Bearer ${connection.token}` }),
            fetch: (url, options) =>
              fetch(url, { ...options, signal: AbortSignal.timeout(8000) }),
          }),
        ],
      }),
    [connection.url, connection.token],
  );
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [online, setOnline] = useState(false);
  const [error, setError] = useState("");
  const [revoked, setRevoked] = useState(false);
  const [generation, setGeneration] = useState(0);
  const [resetEpoch, setResetEpoch] = useState(0);
  const refreshRef = useRef<() => Promise<void>>(async () => {});
  const refresh = useCallback(() => refreshRef.current(), []);
  const reconnect = useCallback(() => setGeneration((value) => value + 1), []);
  useEffect(() => {
    let active = true,
      cursor = 0,
      hasSnapshot = false,
      running = false,
      dirty = false,
      authenticated = false,
      denied = false;
    let attempts = 0;
    let socket: WebSocket | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let work: Promise<void> = Promise.resolve();
    setOnline(false);
    setError("");
    setRevoked(false);
    async function refreshState() {
      dirty = true;
      if (running) return work;
      running = true;
      work = (async () => {
        while (dirty && active && !denied) {
          dirty = false;
          try {
            let needsSnapshot = !hasSnapshot;
            let replaceHistory = !hasSnapshot;
            let replayCursor = cursor;
            if (hasSnapshot) {
              for (let page = 0; page < 10; page++) {
                const changes = await api.changes.query({
                  after: replayCursor,
                  limit: 200,
                });
                if (!active) return;
                if (changes.resetRequired) {
                  replaceHistory = true;
                  needsSnapshot = true;
                  break;
                }
                if (changes.events.length) needsSnapshot = true;
                replayCursor = changes.nextCursor;
                if (!changes.hasMore) break;
                if (page === 9) needsSnapshot = true;
              }
            }
            if (needsSnapshot) {
              const next = await api.syncSnapshot.query({ conversationId });
              if (!active) return;
              if (next.workspaceId !== connection.workspaceId) {
                denied = true;
                socket?.close();
                setError(
                  "Workspace identity changed. Restore the expected host or pair again.",
                );
                setOnline(false);
                return;
              }
              cursor = next.cursor;
              hasSnapshot = true;
              setSnapshot(next);
              if (replaceHistory) setResetEpoch((value) => value + 1);
            } else {
              cursor = replayCursor;
            }
            if (active) {
              setError("");
              setOnline(authenticated);
              if (authenticated) attempts = 0;
            }
          } catch (cause) {
            if (!active) return;
            setOnline(false);
            setError(syncError(cause));
            if (
              cause instanceof TRPCClientError &&
              cause.data?.code === "UNAUTHORIZED"
            ) {
              denied = true;
              setRevoked(true);
              socket?.close();
              void onRevoked();
            } else if (
              cause instanceof TRPCClientError &&
              cause.data?.code === "NOT_FOUND"
            ) {
              denied = true;
              socket?.close();
            } else {
              // Retry only reads after transient snapshot failure. The applied
              // cursor stays unchanged until a full snapshot succeeds.
              socket?.close(4002, "Snapshot unavailable");
            }
          }
        }
      })().finally(() => {
        running = false;
      });
      return work;
    }
    refreshRef.current = refreshState;
    function connect() {
      if (!active || denied) return;
      authenticated = false;
      setOnline(false);
      const endpoint = new URL("/sync", connection.url);
      endpoint.protocol = endpoint.protocol === "https:" ? "wss:" : "ws:";
      const current = new WebSocket(endpoint);
      socket = current;
      current.onopen = () => {
        if (active && socket === current && !denied)
          current.send(
            JSON.stringify({ type: "authenticate", token: connection.token }),
          );
      };
      current.onmessage = (event) => {
        if (!active || socket !== current || denied) return;
        try {
          const message = JSON.parse(String(event.data)) as {
            type?: string;
            cursor?: number;
          };
          if (
            message.type !== "changed" ||
            !Number.isSafeInteger(message.cursor) ||
            message.cursor! < 0
          )
            throw new Error();
          authenticated = true;
          void refreshState();
        } catch {
          current.close(4003, "Invalid sync message");
        }
      };
      current.onclose = (event) => {
        if (!active || socket !== current || denied) return;
        authenticated = false;
        setOnline(false);
        if (event.code === 4001) {
          denied = true;
          setRevoked(true);
          setError("Access revoked. Reconnect this device.");
          void onRevoked();
          return;
        }
        setError(
          "Live connection unavailable. Your unsent draft stays on this device.",
        );
        if (attempts < 8)
          timer = setTimeout(connect, Math.min(250 * 2 ** attempts++, 8000));
      };
      current.onerror = () => {
        /* onclose owns reconnect and visible connection state. */
      };
    }
    connect();
    void refreshState();
    const focus = () => {
      if (active && !denied) void refreshState();
    };
    window.addEventListener("focus", focus);
    return () => {
      active = false;
      clearTimeout(timer);
      window.removeEventListener("focus", focus);
      socket?.close();
    };
  }, [
    api,
    connection.url,
    connection.token,
    connection.workspaceId,
    conversationId,
    generation,
    onRevoked,
  ]);
  return {
    api,
    snapshot,
    online,
    error,
    revoked,
    refresh,
    reconnect,
    resetEpoch,
  };
}
