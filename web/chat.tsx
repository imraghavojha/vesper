import { useCallback, useEffect, useRef, useState } from "react";
import type { Connection } from "../shared/connection.js";
import type {
  Appearance,
  Conversation,
  Draft,
  Message,
} from "../shared/sync.js";
import { useSync, syncError } from "./use-sync.js";
import { TRPCClientError } from "@trpc/client";
import {
  messageRequestHash,
  createConversationRequestHash,
} from "../shared/sync.js";
import { loadDraft, saveDraft, onDraftChanged } from "./draft-storage.js";
import { Dictation } from "./dictation.js";
import { QuickControls } from "./quick-controls.js";
import { ProviderPanel } from "./provider-panel.js";
import type { ProviderAvailability } from "../server/providers/contract.js";
import { askRequestHash } from "../shared/sync.js";
import "./chat.css";

type Saved = Connection & { workspaceId: string; mode?: "local" | "remote" };
type CreationIntent = { requestId: string; title: string };
const pendingCreations = new Map<string, CreationIntent>();
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
  const selectionGeneration = useRef(0);
  const quick =
    !!window.vesperDesktop &&
    new URLSearchParams(location.search).get("quick") === "1";
  const selectConversation = useCallback(
    (id: string) => {
      selectionGeneration.current++;
      setSelected(id);
      void window.vesperDesktop
        ?.setActiveConversation(connection.workspaceId, id)
        .catch(() => {});
    },
    [connection.workspaceId],
  );
  useEffect(() => {
    const bridge = window.vesperDesktop;
    if (!bridge) return;
    let current = true;
    const generation = selectionGeneration.current;
    const remove = bridge.onActiveConversation((scope) => {
      if (scope.workspaceId === connection.workspaceId) {
        selectionGeneration.current++;
        setSelected(scope.conversationId);
      }
    });
    void bridge
      .activeConversation()
      .then((scope) => {
        if (
          current &&
          selectionGeneration.current === generation &&
          scope?.workspaceId === connection.workspaceId
        )
          setSelected(scope.conversationId);
      })
      .catch(() => {});
    return () => {
      current = false;
      remove();
    };
  }, [connection.workspaceId]);
  const sync = useSync(connection, selected, onRevoked);
  const [creationIntent, setCreationIntent] = useState<CreationIntent | null>(
    () => pendingCreations.get(connection.workspaceId) ?? null,
  );
  const creationRef = useRef(creationIntent);
  const creationPosting = useRef(false);
  const [title, setTitle] = useState(creationIntent?.title ?? "");
  const [creating, setCreating] = useState(creationIntent !== null);
  const [editing, setEditing] = useState<{
    id: string;
    revision: number;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [availability, setAvailability] = useState<ProviderAvailability | null>(
    null,
  );
  const [providerLoading, setProviderLoading] = useState(false);
  const [providerError, setProviderError] = useState("");
  const [providerOpen, setProviderOpen] = useState(false);
  const formRequest = useRef<{ id: string; fingerprint: string } | null>(null);
  function requestFor(operation: string, payload: unknown) {
    const fingerprint = JSON.stringify([operation, payload]);
    if (formRequest.current?.fingerprint !== fingerprint)
      formRequest.current = { id: crypto.randomUUID(), fingerprint };
    return formRequest.current.id;
  }
  const snapshot = sync.snapshot;
  const activeId = selected ?? snapshot?.conversationId;
  const activeSnapshot =
    snapshot?.conversationId === activeId ? snapshot : null;
  const conversation = snapshot?.conversations.find(
    (item) => item.id === activeId,
  );
  const appearance = snapshot?.settings.appearance;
  async function refreshProvider() {
    setProviderLoading(true);
    setProviderError("");
    try {
      setAvailability(await sync.api.providerAvailability.query());
    } catch (cause) {
      setProviderError(syncError(cause));
    } finally {
      setProviderLoading(false);
    }
  }
  async function selectProvider(modelId: string | null) {
    if (!activeSnapshot || !activeId || (modelId && !availability?.account))
      return;
    await mutate(() =>
      sync.api.bindProvider.mutate({
        requestId: crypto.randomUUID(),
        conversationId: activeId,
        selection: modelId
          ? {
              provider: "claude",
              accountId: availability!.account!.id,
              modelId,
            }
          : null,
        expectedRevision: activeSnapshot.providerBindingRevision,
      }),
    );
  }
  useEffect(() => {
    if (appearance) document.documentElement.dataset.appearance = appearance;
  }, [appearance]);
  const clearCreation = useCallback(
    (intent: CreationIntent) => {
      if (creationRef.current?.requestId !== intent.requestId) return false;
      if (
        pendingCreations.get(connection.workspaceId)?.requestId ===
        intent.requestId
      )
        pendingCreations.delete(connection.workspaceId);
      creationRef.current = null;
      setCreationIntent(null);
      return true;
    },
    [connection.workspaceId],
  );
  const finishCreation = useCallback(
    (intent: CreationIntent, id: string) => {
      if (!clearCreation(intent)) return;
      setCreating(false);
      setEditing(null);
      setTitle("");
      selectConversation(id);
      setError("");
      void sync.refresh();
    },
    [clearCreation, sync.refresh, selectConversation],
  );
  const checkCreation = useCallback(async () => {
    const intent = creationRef.current;
    if (!intent) return false;
    try {
      const receipt = await sync.api.mutationReceipt.query({
        requestId: intent.requestId,
      });
      if (
        receipt?.operation === "createConversation" &&
        receipt.payloadHash ===
          (await createConversationRequestHash(intent.title))
      ) {
        finishCreation(intent, receipt.result.id);
        return true;
      }
      if (receipt && clearCreation(intent)) {
        setTitle(intent.title);
        setCreating(true);
        setError(
          "This creation conflicted with another saved action. Your title is kept; submit it again.",
        );
      }
    } catch {
      /* Read-only recovery never repeats the creation. */
    }
    return false;
  }, [sync.api, finishCreation, clearCreation]);
  useEffect(() => {
    if (creationIntent && sync.online) void checkCreation();
  }, [
    creationIntent?.requestId,
    sync.online,
    sync.snapshot?.cursor,
    checkCreation,
  ]);
  async function createChat() {
    if (!sync.online || busy || creationPosting.current) return;
    const firstAttempt = creationRef.current === null;
    let intent = creationRef.current;
    if (!intent) {
      const normalized = title.trim();
      if (!normalized) {
        setError("Enter a chat name.");
        return;
      }
      intent = { requestId: crypto.randomUUID(), title: normalized };
      pendingCreations.set(connection.workspaceId, intent);
      creationRef.current = intent;
      setCreationIntent(intent);
      setTitle(intent.title);
    }
    creationPosting.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await sync.api.createConversation.mutate(intent);
      finishCreation(intent, result.id);
    } catch (cause) {
      if (creationRef.current?.requestId === intent.requestId) {
        setError(syncError(cause));
        if (
          firstAttempt &&
          cause instanceof TRPCClientError &&
          ["BAD_REQUEST", "NOT_FOUND"].includes(cause.data?.code)
        ) {
          if (clearCreation(intent)) {
            setTitle(intent.title);
            setCreating(true);
          }
        } else await checkCreation();
      }
    } finally {
      creationPosting.current = false;
      setBusy(false);
    }
  }
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
    <div className={"chat-shell" + (quick ? " quick-chat-shell" : "")}>
      {quick && (
        <header className="quick-header">
          <strong>Vesper quick chat</strong>
          <select
            aria-label="Quick chat conversation"
            value={activeId ?? ""}
            onChange={(event) => selectConversation(event.target.value)}
          >
            {snapshot?.conversations.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title}
              </option>
            ))}
          </select>
          <button onClick={() => void window.vesperDesktop?.showMainWindow()}>
            Open full window
          </button>
          <button onClick={() => void window.vesperDesktop?.hideQuickChat()}>
            Dismiss
          </button>
        </header>
      )}
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
            disabled={!sync.online || busy || !!creationIntent}
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
                selectConversation(item.id);
                if (!creationRef.current) {
                  setCreating(false);
                  setEditing(null);
                }
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
              if (!editing) {
                void createChat();
                return;
              }
              void mutate(async () => {
                await sync.api.renameConversation.mutate({
                  requestId: requestFor(
                    "renameConversation",
                    editing.id + ":" + editing.revision + ":" + title,
                  ),
                  id: editing.id,
                  title,
                  expectedRevision: editing.revision,
                });
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
              disabled={busy || !!creationIntent}
              maxLength={80}
              required
              autoFocus
              onChange={(event) => setTitle(event.target.value)}
            />
            <div className="chat-form-actions">
              <button disabled={busy || !sync.online}>
                {creationIntent ? "Retry original creation" : "Save"}
              </button>
              {creationIntent && (
                <button
                  type="button"
                  disabled={!sync.online || busy}
                  onClick={() => void checkCreation()}
                >
                  Check status
                </button>
              )}
              <button
                type="button"
                disabled={busy || !!creationIntent}
                onClick={() => {
                  setCreating(false);
                  setEditing(null);
                }}
              >
                Cancel
              </button>
            </div>
            {creationIntent && (
              <p className="field-help" role="status">
                Creation is awaiting confirmation. Its original name is kept
                until the saved result is known.
              </p>
            )}
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
            <span>
              {snapshot?.providerBinding?.modelId ?? "No provider connected"}
            </span>
          </div>
          <button
            aria-label="Rename conversation"
            disabled={!conversation || !sync.online || busy || !!creationIntent}
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
          <button
            className="provider-toggle"
            onClick={() => setProviderOpen(!providerOpen)}
          >
            Provider
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
      <aside className={"chat-agent" + (providerOpen ? " provider-open" : "")}>
        <button
          className="provider-toggle"
          onClick={() => setProviderOpen(false)}
        >
          Close provider panel
        </button>
        <div className="agent-placeholder" aria-hidden="true">
          v
        </div>
        <h2>Vesper</h2>
        <ProviderPanel
          key={connection.workspaceId + ":" + activeId}
          availability={availability}
          selection={activeSnapshot?.providerBinding ?? null}
          run={activeSnapshot?.providerRun ?? null}
          busy={busy || !sync.online || !activeSnapshot}
          loading={providerLoading}
          error={providerError}
          onRefresh={() => void refreshProvider()}
          onSelect={(modelId) => void selectProvider(modelId)}
          onCancel={() => {
            if (activeSnapshot?.providerRun)
              void mutate(() =>
                sync.api.cancelProviderRun.mutate({
                  id: activeSnapshot.providerRun!.id,
                }),
              );
          }}
        />
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
        <QuickControls />
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
      .then(({ draft: value, saved }) => {
        if (!current) return;
        draftRef.current = value;
        setDraft(value);
        setReady(true);
        setSavedState(
          saved
            ? value.text || value.pending
              ? "Draft saved on this device"
              : "No unsent draft"
            : "Draft not saved",
        );
        if (!saved)
          setDraftError(
            "The latest draft is kept in memory but was not saved. Retry saving before closing the app.",
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
    (next: Draft, resolveConflict = false) => {
      const revision = ++saveRevision.current;
      draftRef.current = next;
      setDraft(next);
      setSavedState("Saving draft…");
      const operation = saveDraft(
        workspaceId,
        conversationId,
        next,
        resolveConflict,
      );
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
  useEffect(
    () =>
      onDraftChanged(workspaceId, conversationId, () => {
        void loadDraft(workspaceId, conversationId)
          .then(({ draft: next, saved }) => {
            if (!mounted.current) return;
            draftRef.current = next;
            setDraft(next);
            setSavedState(
              saved
                ? next.text || next.pending
                  ? "Draft saved on this Mac"
                  : "No unsent draft"
                : "Draft not saved",
            );
            setDraftError(
              saved
                ? ""
                : "Another window changed this draft. Your text is kept here. Retry saving to replace the shared draft with this text.",
            );
          })
          .catch(() => {
            if (mounted.current) {
              setDraftError(
                "The shared draft could not be opened. Your text stays in this window.",
              );
              setSavedState("Draft not saved");
            }
          });
      }),
    [workspaceId, conversationId],
  );
  useEffect(() => {
    const bridge = window.vesperDesktop;
    if (
      !bridge ||
      !ready ||
      new URLSearchParams(location.search).get("quick") !== "1"
    )
      return;
    let current = true;
    const focus = () => {
      void bridge
        .quickChatStatus()
        .then((status) => {
          if (current && status.visible)
            document
              .querySelector<HTMLTextAreaElement>(
                'textarea[aria-label="Message"]',
              )
              ?.focus();
        })
        .catch(() => {});
    };
    const remove = bridge.onQuickFocus(focus);
    focus();
    return () => {
      current = false;
      remove();
    };
  }, [ready]);
  const checkReceipt = useCallback(async () => {
    const pending = draftRef.current.pending;
    if (!pending || !sync.online) return;
    try {
      const receipt = await sync.api.mutationReceipt.query({
        requestId: pending.requestId,
      });
      if (!mounted.current) return;
      const matches =
        receipt?.operation ===
          (pending.provider ? "askProvider" : "sendMessage") &&
        receipt.payloadHash ===
          (pending.provider
            ? await askRequestHash(
                conversationId,
                pending.text,
                pending.provider,
              )
            : await messageRequestHash(conversationId, pending.text));
      if (!mounted.current) return;
      if (matches) {
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
    if (
      !ready ||
      !sync.online ||
      sending ||
      draftError ||
      (!retry && replyActive)
    )
      return;
    const current = draftRef.current;
    const binding = sync.snapshot?.providerBinding;
    const pending: Draft["pending"] = retry
      ? current.pending
      : {
          requestId: crypto.randomUUID(),
          text: current.text,
          ...(binding
            ? {
                provider: {
                  selection: {
                    provider: binding.provider,
                    accountId: binding.accountId,
                    modelId: binding.modelId,
                  },
                  bindingRevision: binding.revision,
                },
              }
            : {}),
        };
    if (!pending || !pending.text.trim() || (!retry && current.pending)) return;
    setSending(true);
    setSendError("");
    try {
      await queue.current;
      await persist({ ...draftRef.current, pending });
      const input = {
        requestId: pending.requestId,
        conversationId,
        text: pending.text,
      };
      if (pending.provider)
        await sync.api.askProvider.mutate({ ...input, ...pending.provider });
      else await sync.api.sendMessage.mutate(input);
      if (mounted.current) {
        await acknowledge(pending.requestId);
        await sync.refresh();
      }
    } catch (cause) {
      if (
        mounted.current &&
        draftRef.current.pending?.requestId === pending.requestId
      ) {
        setSendError(syncError(cause));
        if (
          !retry &&
          cause instanceof TRPCClientError &&
          [
            "BAD_REQUEST",
            "NOT_FOUND",
            "CONFLICT",
            "TOO_MANY_REQUESTS",
            "UNAUTHORIZED",
          ].includes(cause.data?.code)
        )
          await persist({ ...draftRef.current, pending: null }).catch(() => {});
      }
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
  const binding = sync.snapshot?.providerBinding;
  const replyActive = [
    "queued",
    "initializing",
    "running",
    "cancelling",
  ].includes(sync.snapshot?.providerRun?.status ?? "");
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
              {binding
                ? "Send a message to the selected Claude account. This connection supports chat only."
                : "Write a message to save it in this workspace, or select a provider for replies."}
            </p>
          </div>
        )}
        {messages.map((message) => (
          <article className={"message " + message.role} key={message.id}>
            <div className="message-text">
              {message.text ||
                (message.role === "assistant"
                  ? [
                      "completed",
                      "cancelled",
                      "failed",
                      "interrupted",
                    ].includes(message.status ?? "")
                    ? "No reply text was received."
                    : "Waiting for provider…"
                  : "")}
            </div>
            <small>
              {message.role === "user" ? "You" : "Assistant"} ·{" "}
              {new Date(message.createdAt).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}{" "}
              ·{" "}
              {message.role === "assistant"
                ? (message.status ?? "completed")
                : "Saved"}
            </small>
          </article>
        ))}
      </div>
      <div className="composer-area">
        {(draftError || sendError) && (
          <div className="chat-notice" role="alert">
            <p>{draftError || sendError}</p>
            {draftError && ready && (
              <button
                onClick={() =>
                  void persist(draftRef.current, true).catch(() => {})
                }
              >
                Retry saving draft
              </button>
            )}
          </div>
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
            aria-label={
              binding
                ? "Send message to selected provider"
                : "Save message to workspace"
            }
            disabled={
              !ready ||
              !sync.online ||
              sending ||
              replyActive ||
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
          <span>
            {binding
              ? "Chat only · no tools or external actions"
              : "Messages are saved. No provider is connected."}
          </span>
        </div>
        <Dictation
          disabled={!ready || !!draftError || sync.revoked}
          onInsert={async (text) => {
            const current = draftRef.current;
            const next = current.text ? current.text + "\n" + text : text;
            if (next.length > 10000)
              throw new Error("Transcript exceeds draft limit.");
            await persist({ ...current, text: next }).catch(() => {});
          }}
        />
      </div>
    </>
  );
}
