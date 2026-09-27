"use strict";

const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  protocol,
  safeStorage,
  session,
  shell,
} = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { createLocalHost } = require("./local-host.cjs");
const { createDraftStore } = require("./drafts.cjs");
const { createDraftCoordinator } = require("./draft-coordinator.cjs");
const { createSpeechController } = require("./speech.cjs");
const { createQuickChat } = require("./quick-chat.cjs");

app.setName("Vesper");
const dataDirectory = path.resolve(
  process.env.VESPER_DESKTOP_DATA_DIR ||
    path.join(app.getPath("appData"), "Vesper"),
);
fs.mkdirSync(dataDirectory, { recursive: true, mode: 0o700 });
fs.chmodSync(dataDirectory, 0o700);
app.setPath("userData", dataDirectory);
app.setPath("sessionData", dataDirectory);
if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}
protocol.registerSchemesAsPrivileged([
  {
    scheme: "vesper",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
]);

const RENDERER_IDENTITY = "vesper://app";
const PARTITION = "persist:vesper";
const connectionPath = path.join(dataDirectory, "connection.encrypted");
const webRoot = path.resolve(__dirname, "../dist/web");
const windows = new Set();
const drafts = createDraftStore({
  directory: path.join(dataDirectory, "drafts"),
  safeStorage,
});
const draftCoordinator = createDraftCoordinator(drafts);
let mainWindow = null;
let quickChat = null;
let activeConversation = null;
const speech = createSpeechController({
  executablePath: app.isPackaged
    ? path.join(process.resourcesPath, "native", "speech-bridge")
    : path.resolve(__dirname, "../dist/native/speech-bridge"),
  onEvent(owner, value) {
    if (!owner.isDestroyed()) owner.send("vesper:speech:event", value);
  },
});
let storedConnection = null;
let quitting = false;
let localConnectionPending = null;

function trustedUrl(raw) {
  try {
    const url = new URL(raw);
    return (
      url.protocol === "vesper:" &&
      url.hostname === "app" &&
      !url.port &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}
function requireTrustedCaller(event) {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (
    !windows.has(win) ||
    !event.senderFrame ||
    event.senderFrame !== event.sender.mainFrame ||
    !trustedUrl(event.senderFrame.url)
  ) {
    throw new Error("This page cannot access the device connection.");
  }
}
function validateConnection(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    ![3, 4].includes(Object.keys(value).length) ||
    Object.keys(value).some(
      (key) => !["url", "token", "workspaceId", "mode"].includes(key),
    ) ||
    typeof value.url !== "string" ||
    value.url.length > 2048 ||
    typeof value.token !== "string" ||
    !/^[A-Za-z0-9_-]{43}$/.test(value.token) ||
    typeof value.workspaceId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value.workspaceId,
    ) ||
    (value.mode !== undefined &&
      value.mode !== "local" &&
      value.mode !== "remote")
  )
    throw new Error("Invalid connection.");
  const url = new URL(value.url);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/" ||
    (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) ||
    (value.mode === "local" &&
      (url.protocol !== "http:" || url.hostname !== "127.0.0.1"))
  )
    throw new Error("Invalid host address.");
  return {
    url: url.origin,
    token: value.token,
    workspaceId: value.workspaceId,
    mode: value.mode ?? "remote",
  };
}
function requireEncryption() {
  if (
    !safeStorage.isEncryptionAvailable() ||
    (process.platform === "linux" &&
      safeStorage.getSelectedStorageBackend() === "basic_text")
  )
    throw new Error("Device encryption is unavailable.");
}
function readConnection() {
  requireEncryption();
  let info;
  try {
    info = fs.lstatSync(connectionPath);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  if (!info.isFile() || info.size > 16384)
    throw new Error("Invalid saved connection.");
  const saved = JSON.parse(
    safeStorage.decryptString(fs.readFileSync(connectionPath)),
  );
  const connection = validateConnection(saved.connection);
  if (saved.rendererOrigin === RENDERER_IDENTITY) return connection;
  // PR #2 stored the configured HTTP(S) renderer origin. Accept only its
  // endpoint-bound production format or the exact built-in development origin.
  const legacy = new URL(saved.rendererOrigin);
  const isExactOrigin =
    legacy.origin === saved.rendererOrigin &&
    !legacy.username &&
    !legacy.password;
  const wasLegacyShape =
    Object.keys(saved.connection).length === 3 &&
    !Object.hasOwn(saved.connection, "mode");
  const knownLegacyOrigin =
    saved.rendererOrigin === connection.url ||
    saved.rendererOrigin === "http://127.0.0.1:5177";
  if (
    !wasLegacyShape ||
    !isExactOrigin ||
    !["http:", "https:"].includes(legacy.protocol) ||
    !knownLegacyOrigin
  ) {
    throw new Error("Saved connection belongs to an unrecognized renderer.");
  }
  const migrated = { ...connection, mode: "remote" };
  writeConnection(migrated);
  return migrated;
}
function writeConnection(value) {
  if (value === null) {
    try {
      fs.unlinkSync(connectionPath);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    storedConnection = null;
    return;
  }
  const connection = validateConnection(value);
  requireEncryption();
  const encrypted = safeStorage.encryptString(
    JSON.stringify({ rendererOrigin: RENDERER_IDENTITY, connection }),
  );
  const temporary = path.join(dataDirectory, `.connection-${randomUUID()}.tmp`);
  try {
    const descriptor = fs.openSync(temporary, "wx", 0o600);
    try {
      fs.writeFileSync(descriptor, encrypted);
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }
    fs.renameSync(temporary, connectionPath);
    storedConnection = connection;
  } finally {
    try {
      fs.unlinkSync(temporary);
    } catch {
      /* Renamed files no longer have a temporary path. */
    }
  }
}
function broadcast(channel, value) {
  for (const win of windows)
    if (!win.isDestroyed() && trustedUrl(win.webContents.getURL()))
      win.webContents.send(channel, value);
}
const localHost = createLocalHost({
  getExpectedWorkspaceId: () =>
    storedConnection?.mode === "local" ? storedConnection.workspaceId : null,
  modulePath: path.resolve(__dirname, "../dist/server/index.js"),
  dataDirectory,
  onStatus(status) {
    broadcast("vesper:local:status", status);
    if (
      status.state === "running" &&
      storedConnection?.mode === "local" &&
      status.url &&
      status.workspaceId
    ) {
      if (status.workspaceId !== storedConnection.workspaceId) {
        broadcast("vesper:local:status", {
          state: "failed",
          message:
            "The local workspace identity changed. Restore its data before reconnecting.",
        });
        void localHost.stop();
        return;
      }
      if (status.url !== storedConnection.url) {
        try {
          writeConnection({ ...storedConnection, url: status.url });
          broadcast("vesper:connection:changed", storedConnection);
        } catch {
          broadcast("vesper:local:status", {
            state: "failed",
            message:
              "The updated local connection could not be saved securely.",
          });
        }
      }
    }
  },
});
function installBridge() {
  function draftScope(event, workspaceId, conversationId) {
    requireTrustedCaller(event);
    if (
      !storedConnection ||
      storedConnection.workspaceId !== workspaceId ||
      typeof conversationId !== "string"
    )
      throw new Error("Draft is outside the active workspace.");
  }
  ipcMain.handle("vesper:drafts:load", (event, workspaceId, conversationId) => {
    draftScope(event, workspaceId, conversationId);
    return draftCoordinator.load(workspaceId, conversationId);
  });
  ipcMain.handle(
    "vesper:drafts:save",
    (event, workspaceId, conversationId, draft, expectedRevision) => {
      draftScope(event, workspaceId, conversationId);
      const result = draftCoordinator.save(
        workspaceId,
        conversationId,
        draft,
        expectedRevision,
      );
      if (result.ok)
        for (const win of windows)
          if (!win.isDestroyed() && win.webContents !== event.sender)
            win.webContents.send("vesper:drafts:changed", {
              workspaceId,
              conversationId,
              revision: result.revision,
            });
      return result;
    },
  );
  ipcMain.handle("vesper:quick:status", (event) => {
    requireTrustedCaller(event);
    return quickChat.status();
  });
  ipcMain.handle("vesper:quick:show", (event) => {
    requireTrustedCaller(event);
    return quickChat.show();
  });
  ipcMain.handle("vesper:quick:hide", (event) => {
    requireTrustedCaller(event);
    return quickChat.hide();
  });
  ipcMain.handle("vesper:quick:shortcut", (event, accelerator) => {
    requireTrustedCaller(event);
    return quickChat.setShortcut(accelerator);
  });
  ipcMain.handle("vesper:main:show", (event) => {
    requireTrustedCaller(event);
    showMain();
  });
  ipcMain.handle("vesper:conversation:get", (event) => {
    requireTrustedCaller(event);
    return activeConversation?.workspaceId === storedConnection?.workspaceId
      ? activeConversation
      : null;
  });
  ipcMain.handle(
    "vesper:conversation:set",
    (event, workspaceId, conversationId) => {
      draftScope(event, workspaceId, conversationId);
      if (
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          conversationId,
        )
      )
        throw new Error("Invalid conversation.");
      if (
        activeConversation?.workspaceId === workspaceId &&
        activeConversation?.conversationId === conversationId
      )
        return;
      activeConversation = { workspaceId, conversationId };
      for (const win of windows)
        if (!win.isDestroyed() && win.webContents !== event.sender)
          win.webContents.send(
            "vesper:conversation:changed",
            activeConversation,
          );
    },
  );
  ipcMain.handle("vesper:speech:command", (event, command) => {
    requireTrustedCaller(event);
    if (!storedConnection)
      throw new Error("Open a workspace before dictation.");
    const owner = BrowserWindow.fromWebContents(event.sender);
    if (
      command?.command === "start" &&
      (owner.isDestroyed() || !owner.isVisible() || owner.isMinimized())
    )
      throw new Error("Open this window before starting voice input.");
    speech.send(command, event.sender);
  });
  ipcMain.handle("vesper:speech:cancel", (event) => {
    requireTrustedCaller(event);
    return speech.cancelOwner(event.sender);
  });
  ipcMain.handle("vesper:connection:load", async (event) => {
    requireTrustedCaller(event);
    try {
      storedConnection = readConnection();
      if (storedConnection?.mode === "local") {
        const ready = await localHost.start();
        if (ready.workspaceId !== storedConnection.workspaceId)
          throw Object.assign(new Error("Local workspace identity changed."), {
            code: "LOCAL_WORKSPACE_IDENTITY",
          });
        writeConnection({ ...storedConnection, url: ready.url });
      }
      return storedConnection;
    } catch (error) {
      if (
        error?.code === "LOCAL_WORKSPACE_MISSING" ||
        error?.code === "LOCAL_WORKSPACE_IDENTITY"
      ) {
        return { error: "restore-local-workspace" };
      }
      throw new Error(
        "Saved connection could not be opened. Check device encryption or connection settings.",
      );
    }
  });
  ipcMain.handle("vesper:connection:save", async (event, value) => {
    requireTrustedCaller(event);
    await Promise.all(
      [...windows].map((win) => speech.cancelOwner(win.webContents)),
    );
    try {
      writeConnection(value);
    } catch {
      throw new Error("Cannot save this device's connection securely.");
    }
    if (value?.mode !== "local") await localHost.stop();
    activeConversation = null;
    broadcast("vesper:connection:changed", storedConnection);
  });
  ipcMain.handle("vesper:local:restart", async (event) => {
    requireTrustedCaller(event);
    if (storedConnection?.mode !== "local")
      throw new Error(
        "No saved local connection is available. Open the local workspace explicitly.",
      );
    const previous = storedConnection;
    const ready = await localHost.start();
    if (ready.workspaceId !== previous.workspaceId)
      throw new Error(
        "Local workspace identity changed. Restore its data before reconnecting.",
      );
    // Retain the exact credential. A restart never restores revoked access.
    if (
      storedConnection?.mode !== "local" ||
      storedConnection.token !== previous.token ||
      storedConnection.workspaceId !== previous.workspaceId
    )
      throw new Error("The connection changed while restarting.");
    const connection = { ...previous, url: ready.url };
    writeConnection(connection);
    broadcast("vesper:connection:changed", connection);
    return connection;
  });
  ipcMain.handle("vesper:local:create", async (event) => {
    requireTrustedCaller(event);
    requireEncryption();
    if (!localConnectionPending) {
      localConnectionPending = (async () => {
        const reopeningLocalData = fs.existsSync(
          path.join(dataDirectory, "local-host", "workspace.sqlite"),
        );
        const ready = await localHost.start();
        if (storedConnection?.mode === "local") {
          if (ready.workspaceId !== storedConnection.workspaceId)
            throw new Error(
              "Local workspace identity changed. Restore the existing data first.",
            );
          const response = await fetch(ready.url + "/trpc/workspace", {
            headers: { Authorization: `Bearer ${storedConnection.token}` },
            signal: AbortSignal.timeout(5000),
          });
          if (response.ok) {
            writeConnection({ ...storedConnection, url: ready.url });
            return storedConnection;
          }
          if (response.status !== 401)
            throw new Error("Local workspace is unavailable.");
        }
        if (reopeningLocalData) {
          const confirmation = await dialog.showMessageBox(
            BrowserWindow.fromWebContents(event.sender),
            {
              type: "question",
              buttons: ["Cancel", "Restore access"],
              defaultId: 0,
              cancelId: 0,
              title: "Restore local owner access",
              message: "Restore access to this Mac's local workspace?",
              detail:
                "This is an owner recovery action using your Mac account's local data access. It creates a new device connection. Previously revoked tokens stay revoked; other devices and remote hosts gain no access.",
            },
          );
          if (confirmation.response !== 1) {
            await localHost.stop();
            return null;
          }
        }
        const connection = await localHost.bootstrap();
        writeConnection(connection);
        return storedConnection;
      })().finally(() => {
        localConnectionPending = null;
      });
    }
    return localConnectionPending;
  });
  ipcMain.handle("vesper:local:status", (event) => {
    requireTrustedCaller(event);
    return localHost.status();
  });
}
function openExternal(raw) {
  try {
    const url = new URL(raw);
    if (url.protocol === "https:" && !url.username && !url.password)
      void shell.openExternal(url.href).catch(() => {});
  } catch {
    /* Reject invalid links. */
  }
}
app.on("web-contents-created", (_event, contents) => {
  contents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: "deny" };
  });
  contents.on("will-attach-webview", (event) => event.preventDefault());
  contents.on("will-frame-navigate", (event) => {
    if (!trustedUrl(event.url)) {
      event.preventDefault();
      if (event.isMainFrame) openExternal(event.url);
    }
  });
  contents.on("will-redirect", (event) => {
    if (!trustedUrl(event.url)) event.preventDefault();
  });
});
function createWindow(quick = false) {
  const win = new BrowserWindow({
    width: quick ? 600 : 1130,
    height: quick ? 600 : 780,
    minWidth: quick ? 380 : 900,
    minHeight: quick ? 360 : 650,
    show: !quick,
    alwaysOnTop: quick,
    title: quick ? "Vesper Quick Chat" : "Vesper",
    backgroundColor: "#191919",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      partition: PARTITION,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webviewTag: false,
    },
  });
  windows.add(win);
  const contents = win.webContents;
  win.on("closed", () => {
    windows.delete(win);
    if (mainWindow === win) mainWindow = null;
    void speech.cancelOwner(contents);
  });
  win.on("hide", () => {
    void speech.cancelOwner(win.webContents);
  });
  win.on("minimize", () => {
    void speech.cancelOwner(contents);
  });
  win.webContents.on("render-process-gone", () => {
    void speech.cancelOwner(win.webContents);
  });
  win.loadURL(RENDERER_IDENTITY + (quick ? "/?quick=1" : "/")).catch(() => {
    dialog.showErrorBox(
      "Vesper",
      "The bundled workspace could not load. Reinstall the app or rebuild it from source.",
    );
  });
  return win;
}
function showMain() {
  if (!mainWindow || mainWindow.isDestroyed()) mainWindow = createWindow();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}
app.whenReady().then(() => {
  const ses = session.fromPartition(PARTITION);
  ses.setPermissionRequestHandler((_contents, _permission, callback) =>
    callback(false),
  );
  ses.setPermissionCheckHandler(() => false);
  ses.setDevicePermissionHandler(() => false);
  ses.protocol.handle("vesper", async (request) => {
    if (!trustedUrl(request.url))
      return new Response("Not found", { status: 404 });
    if (!["GET", "HEAD"].includes(request.method))
      return new Response("Method not allowed", { status: 405 });
    try {
      const url = new URL(request.url);
      const target = path.resolve(
        webRoot,
        "." +
          decodeURIComponent(
            url.pathname === "/" ? "/index.html" : url.pathname,
          ),
      );
      if (!target.startsWith(webRoot + path.sep))
        return new Response("Not found", { status: 404 });
      const bytes = await fs.promises.readFile(target);
      const type =
        {
          ".html": "text/html; charset=utf-8",
          ".js": "text/javascript",
          ".css": "text/css",
          ".svg": "image/svg+xml",
          ".png": "image/png",
        }[path.extname(target)] || "application/octet-stream";
      return new Response(request.method === "HEAD" ? null : bytes, {
        headers: {
          "Content-Type": type,
          "X-Content-Type-Options": "nosniff",
          "Content-Security-Policy":
            "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' https: wss: ws://127.0.0.1:* ws://localhost:* http://127.0.0.1:* http://localhost:*; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
        },
      });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  });
  installBridge();
  quickChat = createQuickChat({
    createWindow: () => createWindow(true),
    showMain,
    dataDirectory,
    onDismiss: () =>
      Promise.all(
        [...windows]
          .filter((win) => win !== mainWindow)
          .map((win) => speech.cancelOwner(win.webContents)),
      ),
    onStatus: (status) => broadcast("vesper:quick:status", status),
  });
  showMain();
  app.on("activate", () => {
    showMain();
  });
});
app.on("second-instance", () => {
  if (app.isReady()) showMain();
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("before-quit", (event) => {
  if (quitting) return;
  event.preventDefault();
  quitting = true;
  void Promise.allSettled([
    speech.close(),
    quickChat?.dispose(),
    localHost.stop(),
  ]).finally(() => app.quit());
});
