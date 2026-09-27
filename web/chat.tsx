import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
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
import { VaultPanel } from "./vault-panel.js";
import { CalendarPanel } from "./calendar-panel.js";
import type { ProviderAvailability } from "../server/providers/contract.js";
import { askRequestHash } from "../shared/sync.js";
import {
  ActivityIcon,
  ApprovalIcon,
  IdentityIcon,
  SettingsIcon,
  UpcomingIcon,
  ChevronRightIcon,
  FileIcon,
  GridIcon,
  HandIcon,
  HelpIcon,
  LockIcon,
  MicIcon,
  MoonIcon,
  SunIcon,
  WalletIcon,
  ArrowUpIcon,
  BoltIcon,
  ChatIcon,
  ChevronDownIcon,
  CloseIcon,
  DeviceIcon,
  ExpandIcon,
  FeedIcon,
  GoalIcon,
  IdeaIcon,
  LibraryIcon,
  MenuIcon,
  ModelIcon,
  MoreIcon,
  PanelIcon,
  PencilIcon,
  PlusIcon,
  SearchIcon,
  StopIcon,
  VesperAvatar,
} from "./presentation/icons.js";
import { Popover } from "./presentation/popover.js";
import { useMediaQuery } from "./presentation/use-media.js";
import type { SettingsEntrySection } from "./main.js";
import "./chat.css";
import "./presentation/panel.css";

type PanelTab = "activity" | "approvals" | "upcoming" | "identity";
const PANEL_TABS: Array<{
  id: PanelTab;
  label: string;
  Icon: typeof ModelIcon;
}> = [
  { id: "activity", label: "Activity", Icon: ActivityIcon },
  { id: "approvals", label: "Approvals", Icon: ApprovalIcon },
  { id: "upcoming", label: "Upcoming", Icon: UpcomingIcon },
  { id: "identity", label: "Identity", Icon: IdentityIcon },
];
// Native Mac settings groups, in reference order. Providers is Vesper's
// documented addition. `note` marks sections with no Vesper capability yet.
type SettingsSection =
  | "general"
  | "providers"
  | "connectors"
  | "computer"
  | "files"
  | "dictation"
  | "wallet"
  | "secure"
  | "permissions"
  | "channels"
  | "devices"
  | "data"
  | "help"
  | "legal";
const SETTINGS_SECTIONS: Array<{
  id: SettingsSection;
  label: string;
  Icon: typeof ModelIcon;
  note?: string;
}> = [
  { id: "general", label: "General", Icon: SettingsIcon },
  { id: "providers", label: "Providers", Icon: ModelIcon },
  { id: "connectors", label: "Connectors", Icon: GridIcon },
  {
    id: "computer",
    label: "Computer use",
    Icon: DeviceIcon,
    note: "Computer use isn’t available in Vesper yet. Vesper can’t control this Mac.",
  },
  {
    id: "files",
    label: "File system access",
    Icon: FileIcon,
    note: "File system access isn’t available in Vesper yet. Vesper can’t read or change your files.",
  },
  { id: "dictation", label: "Dictation", Icon: MicIcon },
  {
    id: "wallet",
    label: "Wallet",
    Icon: WalletIcon,
    note: "Wallet isn’t available in Vesper.",
  },
  { id: "secure", label: "Secure Store", Icon: ApprovalIcon },
  {
    id: "permissions",
    label: "Permissions",
    Icon: HandIcon,
    note: "Vesper doesn’t take actions yet, so there are no permissions to manage.",
  },
  {
    id: "channels",
    label: "Messaging channels",
    Icon: ChatIcon,
    note: "Messaging channels aren’t available in Vesper yet. Chat happens only in this app.",
  },
  { id: "devices", label: "Devices", Icon: DeviceIcon },
  {
    id: "data",
    label: "Data controls",
    Icon: LockIcon,
    note: "Data controls aren’t available here yet. Manage paired devices under Devices.",
  },
  {
    id: "help",
    label: "Help and support",
    Icon: HelpIcon,
    note: "Help and support isn’t available in this build.",
  },
  {
    id: "legal",
    label: "Legal info",
    Icon: ApprovalIcon,
    note: "Legal information isn’t available in this build.",
  },
];
const ENTRY_SECTIONS: ReadonlySet<string> = new Set<SettingsEntrySection>([
  "general",
  "providers",
  "devices",
  "dictation",
  "secure",
]);
/** Validates an untrusted section name against the native entry sections. */
function entrySection(value: unknown): SettingsEntrySection | null {
  return typeof value === "string" && ENTRY_SECTIONS.has(value)
    ? (value as SettingsEntrySection)
    : null;
}
const RUN_LABELS: Record<string, string> = {
  queued: "Queued",
  initializing: "Starting",
  running: "Replying",
  cancelling: "Stopping",
  completed: "Completed",
  cancelled: "Stopped",
  failed: "Failed",
  interrupted: "Interrupted",
};
// Rail glyphs: the shared icons draw ~16 of 24 units, so the rail renders
// them at 32px with a 1.5 stroke (~21px visible shape, 2px line) to match
// the reference's occupied glyph size inside the 44px circle.
const RAIL_GLYPH = { size: 32, strokeWidth: 1.5 } as const;
// Destinations shown for orientation only; none are implemented yet.
const UNAVAILABLE_DESTINATIONS = [
  { label: "Feed", Icon: FeedIcon },
  { label: "Ideas", Icon: IdeaIcon },
  { label: "Goals", Icon: GoalIcon },
  { label: "Library", Icon: LibraryIcon },
];

type Saved = Connection & { workspaceId: string; mode?: "local" | "remote" };
type CreationIntent = { requestId: string; title: string };
const pendingCreations = new Map<string, CreationIntent>();
export function ConversationScreen({
  settingsWindow = false,
  connection,
  onWorkspace,
  onRevoked,
  onDisconnect,
}: {
  /** Native settings window: render only the settings interior. */
  settingsWindow?: boolean;
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
  // Presentation only: docked panel visibility, active tab and title filter.
  // All four panes are measured at 1130px; below that the panel overlays.
  const wide = useMediaQuery("(min-width: 1130px)");
  const docked = wide && !quick;
  const [panelHidden, setPanelHidden] = useState(false);
  const [panelTab, setPanelTab] = useState<PanelTab>("activity");
  const [filter, setFilter] = useState("");
  const filterInput = useRef<HTMLInputElement>(null);
  const panelClose = useRef<HTMLButtonElement>(null);
  const panelVisible = docked ? !panelHidden : providerOpen;
  const settingsDialog = useRef<HTMLDialogElement>(null);
  // Browser dialog visibility. Every close path (button, Escape, backdrop)
  // fires `close`, which unmounts the Secure Store panel and its inputs.
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>(
    () =>
      (settingsWindow &&
        entrySection(new URLSearchParams(location.search).get("section"))) ||
      "general",
  );
  // Any newer section choice (native event or sidebar click) outranks a late
  // response to the initial settingsSection() read.
  const sectionGeneration = useRef(0);
  function chooseSection(section: SettingsSection) {
    sectionGeneration.current++;
    setSettingsSection(section);
  }
  useEffect(() => {
    const bridge = window.vesperDesktop;
    if (!settingsWindow || !bridge) return;
    let current = true;
    const remove = bridge.onSettingsSection((section) => {
      const next = entrySection(section);
      if (!current || !next) return;
      sectionGeneration.current++;
      setSettingsSection(next);
    });
    const generation = sectionGeneration.current;
    void bridge
      .settingsSection()
      .then((section) => {
        const next = entrySection(section);
        if (current && next && sectionGeneration.current === generation)
          setSettingsSection(next);
      })
      .catch(() => {});
    return () => {
      current = false;
      remove();
    };
  }, [settingsWindow]);
  // Overlay panel focus return: remember the launcher, and after any close
  // path commits, move focus back to it (or a visible fallback launcher).
  const panelOpener = useRef<HTMLElement | null>(null);
  const restorePanelFocus = useRef(false);
  // An explicit open/close applies to both layouts, so resizing across the
  // docked/overlay boundary never reverses the user's last choice. Until the
  // user chooses, the defaults stand: docked shown, overlay hidden.
  const focusPanelOnOpen = useRef(false);
  function openPanel(tab: PanelTab) {
    setPanelTab(tab);
    const active = document.activeElement;
    panelOpener.current = active instanceof HTMLElement ? active : null;
    restorePanelFocus.current = false;
    focusPanelOnOpen.current = !docked;
    setPanelHidden(false);
    setProviderOpen(true);
  }
  function closeOverlayPanel() {
    restorePanelFocus.current = true;
    setPanelHidden(true);
    setProviderOpen(false);
  }
  function closePanel() {
    closeOverlayPanel();
  }
  useEffect(() => {
    if (panelVisible || !restorePanelFocus.current) return;
    restorePanelFocus.current = false;
    const opener = panelOpener.current;
    panelOpener.current = null;
    const usable = (element: HTMLElement | null): element is HTMLElement =>
      !!element &&
      element.isConnected &&
      !element.closest("[hidden], dialog:not([open]), .agent-panel") &&
      element.getClientRects().length > 0;
    const target = [
      opener,
      document.querySelector<HTMLElement>(".chat-shell .panel-reveal"),
      document.querySelector<HTMLElement>(
        '.chat-shell .chat-rail [aria-label="App menu"]',
      ),
    ].find(usable);
    target?.focus();
  }, [panelVisible]);
  function openSettings(section: SettingsSection) {
    if (settingsWindow) {
      chooseSection(section);
      return;
    }
    const openDialog = () => {
      chooseSection(section);
      const dialog = settingsDialog.current;
      if (dialog && !dialog.open) dialog.showModal();
      setSettingsOpen(true);
    };
    const bridge = window.vesperDesktop;
    if (bridge?.showSettings)
      // Only the four validated entry sections cross the bridge. A native
      // rejection may mean quick chat or voice capture did not confirm it
      // stopped, so never cover it with the DOM dialog; report it instead.
      void bridge
        .showSettings(entrySection(section) ?? "general")
        .catch(() =>
          setError(
            "Settings couldn’t open. Check the voice controls in case a recording is still active, then try again.",
          ),
        );
    else openDialog();
  }
  useEffect(() => {
    if (docked || !providerOpen) return;
    // Only an explicit open moves focus; a resize that turns an already open
    // docked panel into an overlay leaves focus where it is.
    if (focusPanelOnOpen.current) {
      focusPanelOnOpen.current = false;
      panelClose.current?.focus();
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !settingsDialog.current?.open) {
        restorePanelFocus.current = true;
        setPanelHidden(true);
        setProviderOpen(false);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [docked, providerOpen]);
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
  const connectionState = sync.online
    ? "online"
    : sync.revoked
      ? "revoked"
      : !snapshot && !sync.error
        ? "connecting"
        : "offline";
  const connectionLabel = {
    online: "Connected",
    revoked: "Access revoked",
    connecting: "Connecting…",
    offline: "Disconnected",
  }[connectionState];
  const binding = activeSnapshot?.providerBinding ?? null;
  const run = activeSnapshot?.providerRun ?? null;
  const runActive = ["queued", "initializing", "running", "cancelling"].includes(
    run?.status ?? "",
  );
  const modelLabel = binding?.modelId ?? "Save only";
  function cancelRun() {
    if (activeSnapshot?.providerRun)
      void mutate(() =>
        sync.api.cancelProviderRun.mutate({
          id: activeSnapshot.providerRun!.id,
        }),
      );
  }
  const query = filter.trim().toLowerCase();
  const visibleConversations = (snapshot?.conversations ?? []).filter(
    (item) => !query || item.title.toLowerCase().includes(query),
  );
  const mainChats = visibleConversations.filter((item) => item.kind === "main");
  const sideChats = visibleConversations.filter((item) => item.kind !== "main");
  function conversationRow(item: Conversation) {
    return (
      <button
        key={item.id}
        className={
          item.id === activeId ? "conversation selected" : "conversation"
        }
        aria-current={item.id === activeId ? "page" : undefined}
        onClick={() => {
          selectConversation(item.id);
          if (!creationRef.current) {
            setCreating(false);
            setEditing(null);
          }
        }}
      >
        <span>{item.title}</span>
      </button>
    );
  }
  const modelChip = (
    <button
      type="button"
      className={"model-chip" + (binding ? "" : " model-chip--none")}
      aria-label={`Model: ${modelLabel}. Open model settings`}
      title="Model and provider"
      onClick={() => openSettings("providers")}
    >
      <ModelIcon size={15} />
      <span>{modelLabel}</span>
      {runActive && (
        <span className="model-chip__run">
          {run?.status === "cancelling" ? "Stopping…" : "Replying…"}
        </span>
      )}
      <ChevronDownIcon size={14} />
    </button>
  );
  return (
    <div
      className={
        "chat-shell" +
        (quick ? " quick-chat-shell" : "") +
        (settingsWindow ? " settings-window-shell" : "") +
        (docked && panelVisible ? " with-panel" : "")
      }
    >
      {quick && (
        <header className="quick-bar">
          <VesperAvatar size={22} />
          <select
            className="quick-bar__select"
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
          {connectionState !== "online" && (
            <span className={"status-pill " + connectionState} role="status">
              {connectionLabel}
            </span>
          )}
          <span className="quick-bar__spacer" />
          {modelChip}
          <button
            type="button"
            className="icon-button"
            aria-label="Open full window"
            title="Open full window"
            onClick={() => void window.vesperDesktop?.showMainWindow()}
          >
            <ExpandIcon size={18} />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="Dismiss"
            title="Dismiss quick chat"
            onClick={() => void window.vesperDesktop?.hideQuickChat()}
          >
            <CloseIcon size={18} />
          </button>
        </header>
      )}
      {!settingsWindow && (
      <>
      <nav className="chat-rail" aria-label="Navigation">
        <div className="rail-group">
          <button
            className="rail-button selected"
            aria-label="Chat"
            aria-current="page"
            title="Chat"
          >
            <span className="rail-icon">
              <ChatIcon {...RAIL_GLYPH} />
            </span>
          </button>
          <button
            className="rail-button"
            aria-label="Search chat titles"
            title="Search chat titles"
            onClick={() => filterInput.current?.focus()}
          >
            <span className="rail-icon">
              <SearchIcon {...RAIL_GLYPH} />
            </span>
          </button>
          {UNAVAILABLE_DESTINATIONS.map(({ label, Icon }) => (
            <button
              key={label}
              className="rail-button unavailable"
              aria-disabled="true"
              aria-label={`${label}, not available yet`}
              title={`${label} isn’t available in Vesper yet`}
              onClick={(event) => event.preventDefault()}
            >
              <span className="rail-icon">
                <Icon {...RAIL_GLYPH} />
              </span>
            </button>
          ))}
        </div>
        <Popover
          label="App menu"
          placement="right-end"
          triggerClassName="rail-button"
          trigger={
            <span className="rail-icon">
              <MenuIcon {...RAIL_GLYPH} />
            </span>
          }
        >
          {(close) => (
            <div className="menu">
              <button
                className="menu-item"
                onClick={() => {
                  close();
                  openSettings("general");
                }}
              >
                <SettingsIcon size={18} /> Settings
              </button>
              <button
                className="menu-item"
                onClick={() => {
                  close();
                  openSettings("providers");
                }}
              >
                <ModelIcon size={18} /> Providers
              </button>
              <button
                className="menu-item"
                onClick={() => {
                  close();
                  onWorkspace();
                }}
              >
                <DeviceIcon size={18} /> Workspace and devices
              </button>
              {!panelVisible && (
                <button
                  className="menu-item"
                  onClick={() => {
                    close();
                    openPanel(panelTab);
                  }}
                >
                  <PanelIcon size={18} /> Show Vesper panel
                </button>
              )}
            </div>
          )}
        </Popover>
      </nav>
      <aside className="chat-sidebar" aria-label="Chats">
        <div className="sidebar-top">
          <label className="sidebar-search">
            <SearchIcon size={20} />
            <input
              ref={filterInput}
              type="search"
              aria-label="Search chat titles"
              placeholder="Search chat titles"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") setFilter("");
              }}
            />
          </label>
          <Popover
            label="Chat options"
            triggerClassName="icon-button"
            trigger={<MoreIcon size={20} />}
          >
            {(close) => (
              <div className="menu">
                <button
                  className="menu-item"
                  disabled={!sync.online || busy || !!creationIntent}
                  onClick={() => {
                    close();
                    formRequest.current = null;
                    setCreating(true);
                    setEditing(null);
                    setTitle("");
                  }}
                >
                  <PlusIcon size={18} /> New side chat
                </button>
                <button
                  className="menu-item"
                  disabled={
                    !conversation || !sync.online || busy || !!creationIntent
                  }
                  onClick={() => {
                    close();
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
                  <PencilIcon size={18} /> Rename conversation
                </button>
              </div>
            )}
          </Popover>
        </div>
        <div className="conversation-list">
          {mainChats.map(conversationRow)}
          <div className="sidebar-section">
            <span>Side chats</span>
            <button
              className="icon-button icon-button--small"
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
              <PlusIcon size={18} />
            </button>
          </div>
          {sideChats.map(conversationRow)}
          {query && visibleConversations.length === 0 && (
            <p className="sidebar-empty" role="status">
              No chat titles match “{filter.trim()}”.
            </p>
          )}
          {!snapshot && (
            <p className="sidebar-empty" role="status">
              {connectionState === "connecting"
                ? "Loading chats…"
                : "Chats appear once connected."}
            </p>
          )}
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
        </div>
        {connectionState !== "online" && (
          <button
            className={"sidebar-status " + connectionState}
            onClick={() => openSettings("devices")}
          >
            <span className="connection-dot" aria-hidden="true" />
            {connectionLabel}
          </button>
        )}
      </aside>
      <main
        className="conversation-main"
        aria-label={conversation?.title ?? "Conversation"}
      >
        {window.vesperDesktop && !quick && (
          // Native Mac content toolbar: window drag space only. The
          // reference's Invite control is omitted because sharing is
          // unsupported; no title or model is shown here.
          <div className="main-toolbar" />
        )}
        {!quick && !panelVisible && (
          <button
            type="button"
            className="icon-button panel-reveal"
            aria-label="Show Vesper panel"
            title="Show Vesper panel"
            onClick={() => openPanel(panelTab)}
          >
            <PanelIcon size={20} />
          </button>
        )}
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
            onChooseModel={() => openSettings("providers")}
            onStop={cancelRun}
            stopDisabled={busy || run?.status === "cancelling"}
          />
        ) : (
          <div className="chat-empty" role="status">
            {snapshot ? "Loading conversation…" : "Opening your workspace…"}
          </div>
        )}
      </main>
      {!docked && providerOpen && (
        <div
          className="agent-scrim"
          aria-hidden="true"
          onClick={closeOverlayPanel}
        />
      )}
      <aside
        className={"agent-panel" + (docked ? " docked" : " overlay")}
        aria-label="Vesper panel"
        hidden={!panelVisible}
      >
        <button
          ref={panelClose}
          type="button"
          className="icon-button agent-close"
          aria-label="Close Vesper panel"
          title="Close"
          onClick={closePanel}
        >
          <CloseIcon size={20} />
        </button>
        <div className="agent-identity">
          <span className="agent-avatar-wrap">
            <span className="agent-avatar">
              <VesperAvatar size={100} />
            </span>
            <button
              type="button"
              className="agent-avatar-edit"
              aria-disabled="true"
              aria-label="Edit avatar, not available yet"
              title="Avatar editing isn’t available yet"
              onClick={(event) => event.preventDefault()}
            >
              <PencilIcon size={16} />
            </button>
          </span>
          <h2>Vesper</h2>
          <p className={"agent-status " + connectionState} role="status">
            {connectionState === "online" && <BoltIcon size={16} />}
            {connectionState !== "online" && (
              <span className="connection-dot" aria-hidden="true" />
            )}
            {connectionLabel}
          </p>
        </div>
        <div className="agent-tabs-wrap">
          <div
            className="agent-tabs"
            role="tablist"
            aria-label="Vesper panel sections"
            onKeyDown={(event) => {
              if (event.key !== "ArrowRight" && event.key !== "ArrowLeft")
                return;
              const index = PANEL_TABS.findIndex((tab) => tab.id === panelTab);
              const step = event.key === "ArrowRight" ? 1 : -1;
              const next =
                PANEL_TABS[(index + step + PANEL_TABS.length) % PANEL_TABS.length]!;
              setPanelTab(next.id);
              event.currentTarget
                .querySelector<HTMLElement>(`#agent-tab-${next.id}`)
                ?.focus();
            }}
          >
            {PANEL_TABS.map(({ id, label, Icon }) => (
              <button
                key={id}
                id={`agent-tab-${id}`}
                type="button"
                role="tab"
                className="agent-tab"
                aria-selected={panelTab === id}
                aria-controls="agent-tabpanel"
                aria-label={label}
                title={label}
                tabIndex={panelTab === id ? 0 : -1}
                onClick={() => setPanelTab(id)}
              >
                <Icon size={18} />
              </button>
            ))}
          </div>
        </div>
        <div
          id="agent-tabpanel"
          className="agent-tabpanel"
          role="tabpanel"
          aria-labelledby={`agent-tab-${panelTab}`}
        >
          <div hidden={panelTab !== "activity"}>
            {run ? (
              <>
                <ul className="activity-list" aria-label="Latest reply in this chat">
                  <li className={"activity-row status-" + run.status}>
                    <div className="activity-row__main">
                      <span className="activity-row__title">
                        Reply · {run.selection.modelId}
                      </span>
                      <span className="activity-row__outcome">
                        {RUN_LABELS[run.status] ?? run.status}
                      </span>
                    </div>
                    <time dateTime={run.completedAt ?? run.createdAt}>
                      {new Date(run.completedAt ?? run.createdAt).toLocaleString(
                        [],
                        {
                          month: "short",
                          day: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                        },
                      )}
                    </time>
                  </li>
                </ul>
                {runActive && (
                  <button
                    type="button"
                    className="pill-button activity-stop"
                    disabled={
                      busy || !sync.online || run.status === "cancelling"
                    }
                    onClick={cancelRun}
                  >
                    {run.status === "cancelling" ? "Stopping…" : "Stop reply"}
                  </button>
                )}
                {run.error && (
                  <p className="panel-error" role="alert">
                    {run.error}
                  </p>
                )}
              </>
            ) : (
              <p className="panel-empty">
                {activeSnapshot
                  ? "No replies have run in this chat."
                  : "Open a chat to see its latest reply."}
              </p>
            )}
          </div>
          <p className="panel-empty" hidden={panelTab !== "approvals"}>
            Vesper doesn’t take actions yet, so there is nothing to approve.
          </p>
          <p className="panel-empty" hidden={panelTab !== "upcoming"}>
            Scheduled work isn’t available yet. Nothing runs on a schedule.
          </p>
          <p className="panel-empty" hidden={panelTab !== "identity"}>
            Identity settings aren’t available yet.
          </p>
        </div>
      </aside>
      </>
      )}
      <SettingsFrame
        windowMode={settingsWindow}
        dialogRef={settingsDialog}
        labelledBy="settings-title"
        onClose={() => setSettingsOpen(false)}
      >
        <div className="settings-surface">
          <nav className="settings-nav" aria-label="Settings sections">
            <h2 id="settings-title" className="sr-only">
              Settings
            </h2>
            {SETTINGS_SECTIONS.map(({ id, label, Icon }) => (
              <button
                key={id}
                type="button"
                className="settings-nav__item"
                aria-current={settingsSection === id ? "page" : undefined}
                onClick={() => chooseSection(id)}
              >
                <Icon size={16} />
                {label}
              </button>
            ))}
          </nav>
          <div className="settings-main">
            <header className="settings-header">
              <h3>
                {
                  SETTINGS_SECTIONS.find((item) => item.id === settingsSection)
                    ?.label
                }
              </h3>
              {!settingsWindow && (
                <form method="dialog">
                  <button
                    className="settings-close"
                    aria-label="Close settings"
                    title="Close"
                  >
                    <CloseIcon size={16} />
                  </button>
                </form>
              )}
            </header>
            <div className="settings-body">
              {(error || sync.error) && (
                <p className="panel-error settings-error">
                  {error || sync.error}
                </p>
              )}
          {SETTINGS_SECTIONS.map(({ id, note }) =>
            note ? (
              <div
                key={id}
                className="settings-card settings-card--note"
                hidden={settingsSection !== id}
              >
                {note}
              </div>
            ) : null,
          )}
          <section
            className="settings-card settings-card--padded"
            hidden={settingsSection !== "providers"}
          >
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
          onCancel={cancelRun}
            />
          </section>
          <div hidden={settingsSection !== "general"}>
            <h4 className="settings-group-label">Appearance</h4>
            <div className="settings-card">
              <div className="settings-row">
                <span id="settings-mode-label">Mode</span>
            <div
              className="mode-switch"
              role="group"
              aria-label="Shared appearance"
            >
              {(["light", "dark", "system"] as Appearance[]).map((value) => (
                <button
                  key={value}
                  aria-label={value[0]!.toUpperCase() + value.slice(1)}
                  title={value[0]!.toUpperCase() + value.slice(1)}
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
                  {value === "light" ? (
                    <SunIcon size={16} />
                  ) : value === "dark" ? (
                    <MoonIcon size={16} />
                  ) : (
                    <DeviceIcon size={16} />
                  )}
                </button>
              ))}
            </div>
              </div>
            </div>
            <p className="settings-footnote">
              Shared across your devices. System follows each device.
            </p>
            <h4 className="settings-group-label">Quick Chat</h4>
            <div className="settings-card settings-card--padded">
              {window.vesperDesktop ? (
                <QuickControls />
              ) : (
                <p className="settings-muted">
                  Quick Chat is available in the Mac app.
                </p>
              )}
            </div>
          </div>
          {settingsSection === "connectors" && (
            <CalendarPanel
              key={connection.workspaceId + ":" + connection.url}
              api={sync.api}
              online={sync.online}
              hostUrl={connection.url}
              refreshHint={sync.snapshot?.cursor}
            />
          )}
          {settingsSection === "secure" && (settingsWindow || settingsOpen) && (
            // Mounted only while visible, so typed secrets, passphrases and
            // refreshes never persist behind a hidden section or closed dialog.
            <VaultPanel
              key={connection.workspaceId + ":" + connection.url}
              api={sync.api}
              workspaceId={connection.workspaceId}
              online={sync.online}
              refreshHint={sync.snapshot?.cursor}
            />
          )}
          <div hidden={settingsSection !== "dictation"}>
            <div className="settings-card settings-card--note">
              {window.vesperDesktop
                ? "Dictation turns speech into a private draft using on-device recognition. Use the microphone button in the message box to check availability, prepare voice and record. It never sends automatically."
                : "Dictation is available in the Mac app."}
            </div>
          </div>
          <div hidden={settingsSection !== "devices"}>
            <h4 className="settings-group-label">This device</h4>
            <div className="settings-card settings-card--padded">
            <dl className="panel-facts">
              <div>
                <dt>Status</dt>
                <dd>{connectionLabel}</dd>
              </div>
              <div>
                <dt>Workspace</dt>
                <dd>
                  {connection.mode === "local" ? "On this Mac" : "Shared host"}
                </dd>
              </div>
              <div>
                <dt>Drafts</dt>
                <dd>
                  {window.vesperDesktop
                    ? "Encrypted on this Mac"
                    : "In this browser tab"}
                </dd>
              </div>
            </dl>
            </div>
            <p className="settings-footnote">
              Unsent text never sends on reconnect.
            </p>
            <div className="panel-actions">
              {sync.revoked ? (
                <button className="pill-button" onClick={onDisconnect}>
                  Disconnect this device
                </button>
              ) : (
                !sync.online && (
                  <button className="pill-button" onClick={() => void reconnect()}>
                    Reconnect
                  </button>
                )
              )}
            </div>
            <h4 className="settings-group-label">Paired devices</h4>
            <button
              type="button"
              className="settings-card settings-row settings-row--link"
              onClick={onWorkspace}
            >
              <span>Workspace and devices</span>
              <ChevronRightIcon size={18} />
            </button>
          </div>
            </div>
          </div>
        </div>
      </SettingsFrame>
    </div>
  );
}

/**
 * Browser fallback shows settings as a modal dialog; the native settings
 * window renders the same interior as its whole content.
 */
function SettingsFrame({
  windowMode,
  dialogRef,
  labelledBy,
  onClose,
  children,
}: {
  windowMode: boolean;
  dialogRef: RefObject<HTMLDialogElement | null>;
  labelledBy: string;
  onClose: () => void;
  children: ReactNode;
}) {
  if (windowMode)
    return (
      <main className="settings-window" aria-labelledby={labelledBy}>
        {children}
      </main>
    );
  return (
    <dialog
      ref={dialogRef}
      className="settings-dialog"
      aria-labelledby={labelledBy}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) event.currentTarget.close();
      }}
    >
      {children}
    </dialog>
  );
}

function ConversationBody({
  connection,
  conversation,
  sync,
  onChooseModel,
  onStop,
  stopDisabled,
}: {
  connection: Saved;
  conversation: Conversation;
  sync: ReturnType<typeof useSync>;
  onChooseModel: () => void;
  onStop: () => void;
  stopDisabled: boolean;
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
        <div className="message-column">
          {hasMore && (
            <button
              className="load-earlier"
              disabled={olderBusy || !sync.online}
              onClick={() => void earlier()}
            >
              {olderBusy ? "Loading…" : "Load earlier messages"}
            </button>
          )}
          {messages.map((message, index) => {
            const previous = messages[index - 1];
            const next = messages[index + 1];
            const day = new Date(message.createdAt).toDateString();
            const newDay =
              !previous || new Date(previous.createdAt).toDateString() !== day;
            const joinsPrevious =
              !newDay && previous?.role === message.role;
            const joinsNext =
              next?.role === message.role &&
              new Date(next.createdAt).toDateString() === day;
            const status = message.status ?? "completed";
            const settled = [
              "completed",
              "cancelled",
              "failed",
              "interrupted",
            ].includes(status);
            const time = new Date(message.createdAt).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            });
            return (
              <div className="message-group" key={message.id}>
                {newDay && (
                  <div className="day-divider">
                    {new Date(message.createdAt).toLocaleDateString([], {
                      weekday: "long",
                      month: "long",
                      day: "numeric",
                    })}
                  </div>
                )}
                <article
                  className={
                    "message " +
                    message.role +
                    (joinsPrevious ? " joins-previous" : "") +
                    (joinsNext ? " joins-next" : "") +
                    (message.role === "assistant" && status !== "completed"
                      ? " status-" + status
                      : "")
                  }
                >
                  <span className="sr-only">
                    {message.role === "user" ? "You" : "Vesper"}, {time}
                    {message.role === "assistant" ? `, ${status}` : ""}:
                  </span>
                  <div className="message-text" title={time}>
                    {message.text ||
                      (message.role === "assistant" ? (
                        settled ? (
                          <span className="message-muted">
                            No reply text was received.
                          </span>
                        ) : (
                          <span className="message-waiting">
                            <span className="typing" aria-hidden="true">
                              <i />
                              <i />
                              <i />
                            </span>
                            Waiting for provider…
                          </span>
                        )
                      ) : (
                        ""
                      ))}
                  </div>
                  {message.role === "assistant" &&
                    (status === "failed" ||
                      status === "interrupted" ||
                      status === "cancelled") && (
                      <small className="message-status" aria-hidden="true">
                        {status === "failed"
                          ? "Reply failed"
                          : status === "interrupted"
                            ? "Reply interrupted"
                            : "Reply stopped"}
                      </small>
                    )}
                </article>
              </div>
            );
          })}
        </div>
      </div>
      <div className="composer-area">
        <div className="composer-column">
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
          <Popover
            label="Add to message"
            placement="above-start"
            triggerClassName="composer-icon"
            trigger={<PlusIcon size={20} />}
          >
            {(close) => (
              <div className="menu">
                <button
                  type="button"
                  className="menu-item"
                  onClick={() => {
                    close();
                    onChooseModel();
                  }}
                >
                  <ModelIcon size={18} />
                  <span>
                    Model
                    <small>{binding?.modelId ?? "Save only"}</small>
                  </span>
                </button>
                <button
                  type="button"
                  className="menu-item"
                  disabled
                  title="Attachments aren’t available in Vesper yet"
                >
                  <PlusIcon size={18} />
                  <span>
                    Attach files
                    <small>Not available yet</small>
                  </span>
                </button>
              </div>
            )}
          </Popover>
          <textarea
            aria-label="Message"
            placeholder={
              sync.online ? "Message" : "Write a private offline draft"
            }
            value={draft.text}
            maxLength={10000}
            disabled={!ready || sync.revoked}
            rows={1}
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
          <div className="composer-actions">
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
            {replyActive ? (
              <button
                type="button"
                className="composer-send composer-send--stop"
                aria-label={
                  sync.snapshot?.providerRun?.status === "cancelling"
                    ? "Stopping reply"
                    : "Stop reply"
                }
                title="Stop reply"
                disabled={stopDisabled || !sync.online}
                onClick={onStop}
              >
                <StopIcon size={18} />
              </button>
            ) : (
              <button
                className="composer-send"
                aria-label={
                  binding
                    ? "Send message to selected provider"
                    : "Save message to workspace"
                }
                title={binding ? "Send" : "Save without a reply"}
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
                <ArrowUpIcon size={18} />
              </button>
            )}
          </div>
        </form>
        <div className="composer-status">
          <span role="status" className={draftError ? "" : "sr-only"}>
            {savedState}
          </span>
          {!binding && (
            <button
              type="button"
              className="composer-hint"
              onClick={onChooseModel}
            >
              No model selected — messages are saved without a reply.{" "}
              <span>Choose a model</span>
            </button>
          )}
        </div>
        </div>
      </div>
    </>
  );
}
