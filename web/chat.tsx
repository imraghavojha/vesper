import { useCallback, useEffect, useRef, useState } from "react";
import type { Connection } from "../shared/connection.js";
import type {
  Appearance,
  Conversation,
  Draft,
  Message,
} from "../shared/sync.js";
import { useSync, syncError } from "./use-sync.js";
import { messageRequestHash } from "../shared/sync.js";
import { loadDraft, saveDraft } from "./draft-storage.js";
import "./chat.css";

type Saved = Connection & { workspaceId: string; mode?: "local" | "remote" };
export function ConversationScreen({
  connection,
  onWorkspace,
  onRevoked,
  onDisconnect,
}: {
  connection: Saved;
  onWorkspace: () => void;
  onRevoked: () => Promise<void>;
  onDisconnect: () => void;
}) {
  const [selected, setSelected] = useState<string>();
  const sync = useSync(connection, selected, onRevoked);
  const [title, setTitle] = useState("");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<{
    id: string;
    revision: number;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const formRequest = useRef<{ id: string; fingerprint: string } | null>(null);
  function requestFor(operation: string, payload: unknown) {
    const fingerprint = JSON.stringify([operation, payload]);
    if (formRequest.current?.fingerprint !== fingerprint)
      formRequest.current = { id: crypto.randomUUID(), fingerprint };
    return formRequest.current.id;
  }
  const snapshot = sync.snapshot;
  const activeId = selected ?? snapshot?.conversationId;
  const conversation = snapshot?.conversations.find(
    (item) => item.id === activeId,
  );
  const appearance = snapshot?.settings.appearance;
  useEffect(() => {
    if (appearance) document.documentElement.dataset.appearance = appearance;
  }, [appearance]);
  async function mutate(operation: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await operation();
      await sync.refresh();
    } catch (cause) {
      setError(syncError(cause));
      await sync.refresh();
    } finally {
      setBusy(false);
    }
  }
  async function reconnect() {
    setError("");
    try {
      if (connection.mode === "local" && window.vesperDesktop && !sync.revoked)
        await window.vesperDesktop.restartLocalHost();
      sync.reconnect();
    } catch {
      setError(
        "The local host could not restart. Check its saved data in Workspace.",
      );
    }
  }
  return (
    <div className="chat-shell">
      <nav className="chat-rail" aria-label="Navigation">
        <span className="chat-brand" aria-label="Vesper">
          v
        </span>
        <button className="rail-selected" aria-label="Chat">
          ◫
        </button>
        <button
          className="rail-settings"
          aria-label="Workspace and devices"
          onClick={onWorkspace}
        >
          ⚙
        </button>
      </nav>
      <aside className="chat-sidebar">
        <div className="sidebar-heading">
          <strong>Conversations</strong>
          <button
            aria-label="New side chat"
            title="New side chat"
            disabled={!sync.online || busy}
            onClick={() => {
              formRequest.current = null;
              setCreating(true);
              setEditing(null);
              setTitle("");
            }}
          >
            ＋
          </button>
        </div>
        <div className="conversation-list">
          {snapshot?.conversations.map((item) => (
            <button
              key={item.id}
              className={
                item.id === activeId ? "conversation selected" : "conversation"
              }
              onClick={() => {
                setSelected(item.id);
                setCreating(false);
                setEditing(null);
              }}
            >
              <span>{item.kind === "main" ? "◫" : "○"}</span>
              <span>{item.title}</span>
            </button>
          ))}
        </div>
        {(creating || editing) && (
          <form
            className="conversation-form"
            onSubmit={(event) => {
              event.preventDefault();
              void mutate(async () => {
                if (editing)
                  await sync.api.renameConversation.mutate({
                    requestId: requestFor(
                      "renameConversation",
                      editing.id + ":" + editing.revision + ":" + title,
                    ),
                    id: editing.id,
                    title,
                    expectedRevision: editing.revision,
                  });
                else {
                  const result = await sync.api.createConversation.mutate({
                    requestId: requestFor("createConversation", title),
                    title,
                  });
                  setSelected(result.id);
                }
                formRequest.current = null;
                setCreating(false);
                setEditing(null);
              });
            }}
          >
            <label htmlFor="conversation-title">
              {editing ? "Rename chat" : "Name your side chat"}
            </label>
            <input
              id="conversation-title"
              value={title}
              maxLength={80}
              required
              autoFocus
              onChange={(event) => setTitle(event.target.value)}
            />
            <div className="chat-form-actions">
              <button disabled={busy || !sync.online}>Save</button>
              <button
                type="button"
                onClick={() => {
                  setCreating(false);
                  setEditing(null);
                }}
              >
                Cancel
              </button>
            </div>
          </form>
        )}
        <div className="compact-appearance">
          <label htmlFor="compact-appearance">Appearance</label>
          <select
            id="compact-appearance"
            value={appearance ?? "system"}
            disabled={!sync.online || busy || !snapshot}
            onChange={(event) =>
              void mutate(() =>
                sync.api.setAppearance.mutate({
                  requestId: crypto.randomUUID(),
                  appearance: event.target.value as Appearance,
                  expectedRevision: snapshot!.settings.revision,
                }),
              )
            }
          >
            <option value="system">System</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </div>
        <div className="sidebar-footer">
          <span
            className={sync.online ? "connection-dot online" : "connection-dot"}
          />
          {sync.online
            ? "Connected"
            : sync.revoked
              ? "Access revoked"
              : "Disconnected"}
          <small>
            {connection.mode === "local"
              ? "Workspace on this Mac"
              : "Shared host"}
          </small>
        </div>
      </aside>
      <main className="conversation-main">
        <div className="conversation-heading">
          <div>
            <h1>{conversation?.title ?? "Your conversations"}</h1>
            <span>No provider connected</span>
          </div>
          <button
            aria-label="Rename conversation"
            disabled={!conversation || !sync.online || busy}
            onClick={() => {
              if (conversation) {
                formRequest.current = null;
                setTitle(conversation.title);
                setEditing({
                  id: conversation.id,
                  revision: conversation.revision,
                });
                setCreating(false);
              }
            }}
          >
            Rename
          </button>
        </div>
        {(sync.error || error) && (
          <div className="chat-notice" role="alert">
            <p>{error || sync.error}</p>
            {sync.revoked ? (
              <button onClick={onDisconnect}>Disconnect this device</button>
            ) : (
              <button onClick={() => void reconnect()}>Reconnect</button>
            )}
          </div>
        )}
        {conversation && snapshot?.conversationId === activeId ? (
          <ConversationBody
            key={connection.workspaceId + ":" + conversation.id}
            connection={connection}
            conversation={conversation}
            sync={sync}
          />
        ) : (
          <div className="chat-empty" role="status">
            {snapshot ? "Loading conversation…" : "Opening your workspace…"}
          </div>
        )}
      </main>
      <aside className="chat-agent">
        <div className="agent-placeholder" aria-hidden="true">
          v
        </div>
        <h2>Vesper</h2>
        <p className="agent-state">No provider connected</p>
        <div className="agent-info">
          <h3>Your messages are saved</h3>
          <p>
            This workspace stores your messages and side chats. No agent is
            connected yet, so saving a message does not start an agent.
          </p>
        </div>
        <section className="appearance">
          <h3>Appearance</h3>
          <div role="group" aria-label="Shared appearance">
            {(["light", "dark", "system"] as Appearance[]).map((value) => (
              <button
                key={value}
                aria-pressed={appearance === value}
                disabled={!sync.online || busy || !snapshot}
                onClick={() =>
                  void mutate(() =>
                    sync.api.setAppearance.mutate({
                      requestId: crypto.randomUUID(),
                      appearance: value,
                      expectedRevision: snapshot!.settings.revision,
                    }),
                  )
                }
              >
                {value[0]!.toUpperCase() + value.slice(1)}
              </button>
            ))}
          </div>
          <p>Shared across connected clients. System follows each device.</p>
        </section>
        <div className="agent-info">
          <h3>Private drafts</h3>
          <p>
            Unsent text stays{" "}
            {window.vesperDesktop
              ? "encrypted on this Mac"
              : "in this browser tab"}
            . Reconnecting never sends it.
          </p>
        </div>
        <button onClick={onWorkspace}>Workspace and devices</button>
      </aside>
    </div>
  );
}

function ConversationBody({
  connection,
  conversation,
  sync,
}: {
  connection: Saved;
  conversation: Conversation;
  sync: ReturnType<typeof useSync>;
}) {
  const [draft, setDraft] = useState<Draft>({ text: "", pending: null });
  const draftRef = useRef(draft);
  const [ready, setReady] = useState(false);
  const [savedState, setSavedState] = useState("Opening local draft…");
  const [draftError, setDraftError] = useState("");
  const [sendError, setSendError] = useState("");
  const [sending, setSending] = useState(false);
  const [olderBusy, setOlderBusy] = useState(false);
  const [hasMore, setHasMore] = useState(sync.snapshot?.hasMore ?? false);
  const [messages, setMessages] = useState<Message[]>(
    sync.snapshot?.messages ?? [],
  );
  const messageCache = useRef(messages);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const saveRevision = useRef(0);
  const mounted = useRef(true);
  const list = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const messageEpoch = useRef(sync.resetEpoch);
  const workspaceId = connection.workspaceId,
    conversationId = conversation.id;
  useEffect(() => {
    mounted.current = true;
    let current = true;
    void loadDraft(workspaceId, conversationId)
      .then((value) => {
        if (!current) return;
        draftRef.current = value;
        setDraft(value);
        setReady(true);
        setSavedState(
          value.text || value.pending
            ? "Draft saved on this device"
            : "No unsent draft",
        );
      })
      .catch(() => {
        if (current) {
          setDraftError(
            "The saved draft could not be opened. Restore its local data before editing.",
          );
          setSavedState("Draft unavailable");
        }
      });
    return () => {
      current = false;
      mounted.current = false;
    };
  }, [workspaceId, conversationId]);
  useEffect(() => {
    if (sync.snapshot?.conversationId !== conversationId) return;
    const incoming = sync.snapshot.messages;
    const previous = messageCache.current;
    const ids = new Set(previous.map((message) => message.id));
    const noOverlap =
      previous.length > 0 &&
      incoming.length > 0 &&
      !incoming.some((message) => ids.has(message.id));
    if (
      messageEpoch.current !== sync.resetEpoch ||
      noOverlap ||
      previous.length === 0
    ) {
      messageEpoch.current = sync.resetEpoch;
      messageCache.current = incoming;
      setMessages(incoming);
      setHasMore(sync.snapshot.hasMore);
      return;
    }
    const merged = new Map(previous.map((message) => [message.id, message]));
    for (const message of incoming) merged.set(message.id, message);
    const next = [...merged.values()].sort((a, b) => a.sequence - b.sequence);
    messageCache.current = next;
    setMessages(next);
  }, [sync.snapshot, conversationId, sync.resetEpoch]);
  useEffect(() => {
    if (nearBottom.current && list.current)
      list.current.scrollTop = list.current.scrollHeight;
  }, [messages]);
  const persist = useCallback(
    (next: Draft) => {
      const revision = ++saveRevision.current;
      draftRef.current = next;
      setDraft(next);
      setSavedState("Saving draft…");
      const operation = queue.current
        .catch(() => {})
        .then(() => saveDraft(workspaceId, conversationId, next));
      queue.current = operation;
      void operation.then(
        () => {
          if (mounted.current && revision === saveRevision.current) {
            setDraftError("");
            setSavedState(
              next.text || next.pending
                ? window.vesperDesktop
                  ? "Draft saved on this Mac"
                  : "Draft saved in this tab"
                : "No unsent draft",
            );
          }
        },
        () => {
          if (mounted.current && revision === saveRevision.current) {
            setDraftError(
              "This draft could not be saved on your device. Messages will not send until local storage works.",
            );
            setSavedState("Draft not saved");
          }
        },
      );
      return operation;
    },
    [workspaceId, conversationId],
  );
  const acknowledge = useCallback(
    async (requestId: string) => {
      const current = draftRef.current;
      if (current.pending?.requestId !== requestId) return;
      await persist({
        text: current.text === current.pending.text ? "" : current.text,
        pending: null,
      });
      if (mounted.current) setSendError("");
    },
    [persist],
  );
  const checkReceipt = useCallback(async () => {
    const pending = draftRef.current.pending;
    if (!pending || !sync.online) return;
    try {
      const receipt = await sync.api.mutationReceipt.query({
        requestId: pending.requestId,
      });
      if (!mounted.current) return;
      if (
        receipt?.operation === "sendMessage" &&
        receipt.payloadHash ===
          (await messageRequestHash(conversationId, pending.text))
      ) {
        await acknowledge(pending.requestId);
        await sync.refresh();
      } else if (receipt) {
        setSendError(
          "This draft does not match the saved action. It has been kept on this device.",
        );
      }
    } catch {
      /* A failed read never sends the pending draft. */
    }
  }, [sync.api, sync.online, sync.refresh, acknowledge, conversationId]);
  useEffect(() => {
    if (ready && draft.pending && sync.online) void checkReceipt();
  }, [
    ready,
    draft.pending?.requestId,
    sync.online,
    sync.snapshot?.cursor,
    checkReceipt,
  ]);
  async function send(retry = false) {
    if (!ready || !sync.online || sending || draftError) return;
    const current = draftRef.current;
    const pending = retry
      ? current.pending
      : { requestId: crypto.randomUUID(), text: current.text };
    if (!pending || !pending.text.trim() || (!retry && current.pending)) return;
    setSending(true);
    setSendError("");
    try {
      await queue.current;
      await persist({ ...draftRef.current, pending });
      await sync.api.sendMessage.mutate({
        requestId: pending.requestId,
        conversationId,
        text: pending.text,
      });
      if (mounted.current) {
        await acknowledge(pending.requestId);
        await sync.refresh();
      }
    } catch (cause) {
      if (
        mounted.current &&
        draftRef.current.pending?.requestId === pending.requestId
      )
        setSendError(syncError(cause));
    } finally {
      if (mounted.current) setSending(false);
    }
  }
  async function earlier() {
    const first = messageCache.current[0];
    if (!first) return;
    setOlderBusy(true);
    try {
      const page = await sync.api.messages.query({
        conversationId,
        before: first.sequence,
      });
      if (!mounted.current || messageCache.current[0]?.id !== first.id) return;
      const merged = new Map(
        [...page.messages, ...messageCache.current].map((message) => [
          message.id,
          message,
        ]),
      );
      const next = [...merged.values()].sort((a, b) => a.sequence - b.sequence);
      messageCache.current = next;
      setMessages(next);
      setHasMore(page.hasMore);
    } catch (cause) {
      if (mounted.current) setSendError(syncError(cause));
    } finally {
      if (mounted.current) setOlderBusy(false);
    }
  }
  const pending = draft.pending;
  return (
    <>
      <div
        className="message-list"
        ref={list}
        onScroll={() => {
          if (list.current)
            nearBottom.current =
              list.current.scrollHeight -
                list.current.scrollTop -
                list.current.clientHeight <
              80;
        }}
      >
        {hasMore && (
          <button
            className="load-earlier"
            disabled={olderBusy || !sync.online}
            onClick={() => void earlier()}
          >
            {olderBusy ? "Loading…" : "Load earlier messages"}
          </button>
        )}
        {messages.length === 0 && (
          <div className="chat-empty">
            <h2>Your conversation starts here</h2>
            <p>
              Write a message to save it in this workspace.
              <br />
              No agent is connected, so no reply or action will run.
            </p>
          </div>
        )}
        {messages.map((message) => (
          <article className={"message " + message.role} key={message.id}>
            <div className="message-text">{message.text}</div>
            <small>
              {message.role === "user" ? "You" : "Assistant"} ·{" "}
              {new Date(message.createdAt).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}{" "}
              · Saved
            </small>
          </article>
        ))}
      </div>
      <div className="composer-area">
        {(draftError || sendError) && (
          <p className="chat-notice" role="alert">
            {draftError || sendError}
          </p>
        )}
        {pending && (
          <div className="pending-message" role="status">
            <span>
              {sending
                ? "Saving message…"
                : "Delivery unconfirmed. Reconnecting only checks its saved status."}
            </span>
            <button
              disabled={!sync.online || sending}
              onClick={() => void checkReceipt()}
            >
              Check status
            </button>
            <button
              disabled={!sync.online || sending || !!draftError}
              onClick={() => void send(true)}
            >
              Retry same message
            </button>
          </div>
        )}
        <form
          className="message-composer"
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          <textarea
            aria-label="Message"
            placeholder={
              sync.online ? "Message" : "Write a private offline draft"
            }
            value={draft.text}
            maxLength={10000}
            disabled={!ready || sync.revoked}
            rows={2}
            onChange={(event) => {
              void persist({
                ...draftRef.current,
                text: event.target.value,
              }).catch(() => {});
            }}
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
                void send();
              }
            }}
          />
          <button
            aria-label="Save message to workspace"
            disabled={
              !ready ||
              !sync.online ||
              sending ||
              !!pending ||
              !draft.text.trim() ||
              !!draftError
            }
            type="submit"
          >
            ↑
          </button>
        </form>
        <div className="composer-status">
          <span role="status">{savedState}</span>
          <span>Messages are saved. No provider is connected.</span>
        </div>
      </div>
    </>
  );
}
