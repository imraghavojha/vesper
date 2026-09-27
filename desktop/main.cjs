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
  if (saved.rendererOrigin !== RENDERER_IDENTITY)
    throw new Error(
      "Saved connection belongs to a different renderer. Pair again.",
    );
  return validateConnection(saved.connection);
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
  ipcMain.handle("vesper:connection:load", async (event) => {
    requireTrustedCaller(event);
    try {
      storedConnection = readConnection();
      if (storedConnection?.mode === "local") {
        const ready = await localHost.start();
        if (ready.workspaceId !== storedConnection.workspaceId)
          throw new Error("Local workspace identity changed.");
        writeConnection({ ...storedConnection, url: ready.url });
      }
      return storedConnection;
    } catch {
      throw new Error(
        "Saved connection could not be opened. Check local host status or pair again.",
      );
    }
  });
  ipcMain.handle("vesper:connection:save", async (event, value) => {
    requireTrustedCaller(event);
    try {
      writeConnection(value);
    } catch {
      throw new Error("Cannot save this device's connection securely.");
    }
    if (value?.mode !== "local") await localHost.stop();
  });
  ipcMain.handle("vesper:local:create", async (event) => {
    requireTrustedCaller(event);
    requireEncryption();
    if (!localConnectionPending) {
      localConnectionPending = (async () => {
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
function createWindow() {
  const win = new BrowserWindow({
    width: 1130,
    height: 780,
    minWidth: 900,
    minHeight: 650,
    title: "Vesper",
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
  win.on("closed", () => windows.delete(win));
  win.loadURL(RENDERER_IDENTITY + "/").catch(() => {
    dialog.showErrorBox(
      "Vesper",
      "The bundled workspace could not load. Reinstall the app or rebuild it from source.",
    );
  });
  return win;
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
            "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' https: http://127.0.0.1:* http://localhost:*; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
        },
      });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  });
  installBridge();
  createWindow();
  app.on("activate", () => {
    if (!windows.size) createWindow();
  });
});
app.on("second-instance", () => {
  const win = [...windows][0];
  if (win) {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  }
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("before-quit", (event) => {
  if (quitting) return;
  event.preventDefault();
  quitting = true;
  void localHost.stop().finally(() => app.quit());
});
