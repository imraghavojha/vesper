"use strict";

// Vesper desktop shell. The backend/shared host runs independently; this process
// never spawns it. It only opens one hardened window onto the configured renderer.

const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  safeStorage,
  session,
  shell,
} = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

app.setName("Vesper");
const dataDirectory = path.resolve(
  process.env.VESPER_DESKTOP_DATA_DIR ||
    path.join(app.getPath("appData"), "Vesper"),
);
fs.mkdirSync(dataDirectory, { recursive: true, mode: 0o700 });
fs.chmodSync(dataDirectory, 0o700);
app.setPath("userData", dataDirectory);
app.setPath("sessionData", dataDirectory);
const connectionPath = path.join(dataDirectory, "connection.encrypted");
const windows = new Set();

const DEV_RENDERER_URL = "http://127.0.0.1:5177";
const DEFAULT_HOST_URL = "http://127.0.0.1:4317";
const PARTITION = "persist:vesper";
// WHATWG URL normalizes hostnames: lowercases names and brackets IPv6 literals.
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

// Packaged builds are never dev. Unpackaged builds use the dev renderer unless
// NODE_ENV=production is set, which allows testing the shared host from source.
const isDev = !app.isPackaged && process.env.NODE_ENV !== "production";

let rendererUrl = null;

function parseRendererUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("renderer URL is not a valid absolute URL");
  }
  if (url.username || url.password) {
    throw new Error("renderer URL must not contain credentials");
  }
  if (url.protocol === "https:") return url;
  if (url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname)) return url;
  throw new Error(
    "renderer URL must use HTTPS, or HTTP on localhost, 127.0.0.1 or [::1]",
  );
}

function resolveRendererUrl() {
  if (isDev) return parseRendererUrl(DEV_RENDERER_URL);
  const configured = (process.env.VESPER_DESKTOP_URL || "").trim();
  return parseRendererUrl(configured || DEFAULT_HOST_URL);
}

// Logs must never contain paths, queries, fragments or credentials.
function safeOrigin(raw) {
  try {
    return new URL(raw).origin;
  } catch {
    return "<invalid-url>";
  }
}

function isTrustedUrl(raw) {
  if (!rendererUrl) return false;
  try {
    const url = new URL(raw);
    return (
      !url.username &&
      !url.password &&
      url.protocol === rendererUrl.protocol &&
      url.origin === rendererUrl.origin
    );
  } catch {
    return false;
  }
}

function validateConnection(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Object.keys(value).length !== 3 ||
    typeof value.url !== "string" ||
    value.url.length > 2048 ||
    typeof value.token !== "string" ||
    !/^[A-Za-z0-9_-]{43}$/.test(value.token) ||
    typeof value.workspaceId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value.workspaceId,
    )
  ) {
    throw new Error("Invalid connection.");
  }
  const url = parseRendererUrl(value.url);
  if (url.search || url.hash || url.pathname !== "/")
    throw new Error("Invalid host address.");
  return {
    url: url.origin,
    token: value.token,
    workspaceId: value.workspaceId,
  };
}

function requireEncryption() {
  if (
    !safeStorage.isEncryptionAvailable() ||
    (process.platform === "linux" &&
      safeStorage.getSelectedStorageBackend() === "basic_text")
  ) {
    throw new Error("Device encryption is unavailable.");
  }
}

function requireTrustedCaller(event) {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (
    !windows.has(window) ||
    !event.senderFrame ||
    event.senderFrame !== event.sender.mainFrame ||
    !isTrustedUrl(event.senderFrame.url)
  ) {
    throw new Error("Connection storage is unavailable to this page.");
  }
}

function installConnectionStorage() {
  ipcMain.handle("vesper:connection:load", (event) => {
    requireTrustedCaller(event);
    try {
      requireEncryption();
      let info;
      try {
        info = fs.lstatSync(connectionPath);
      } catch (error) {
        if (error.code === "ENOENT") return null;
        throw error;
      }
      if (!info.isFile() || info.size > 16 * 1024)
        throw new Error("Invalid record.");
      const saved = JSON.parse(
        safeStorage.decryptString(fs.readFileSync(connectionPath)),
      );
      if (saved.rendererOrigin !== rendererUrl.origin)
        throw new Error("Different renderer.");
      return validateConnection(saved.connection);
    } catch {
      throw new Error(
        "Cannot unlock this device's saved connection. Check device encryption or forget the connection.",
      );
    }
  });
  ipcMain.handle("vesper:connection:save", (event, value) => {
    requireTrustedCaller(event);
    let temporary;
    try {
      if (value === null) {
        try {
          fs.unlinkSync(connectionPath);
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
        }
        return;
      }
      const connection = validateConnection(value);
      requireEncryption();
      const encrypted = safeStorage.encryptString(
        JSON.stringify({ rendererOrigin: rendererUrl.origin, connection }),
      );
      temporary = path.join(dataDirectory, `.connection-${randomUUID()}.tmp`);
      const descriptor = fs.openSync(temporary, "wx", 0o600);
      try {
        fs.writeFileSync(descriptor, encrypted);
        fs.fsyncSync(descriptor);
      } finally {
        fs.closeSync(descriptor);
      }
      fs.renameSync(temporary, connectionPath);
    } catch {
      throw new Error(
        "Cannot save this device's connection securely. Check device encryption and storage.",
      );
    } finally {
      if (temporary) {
        try {
          fs.unlinkSync(temporary);
        } catch {
          /* A successful rename already removed the temporary file. */
        }
      }
    }
  });
}

function openExternalSafely(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return;
  }
  if (url.protocol !== "https:" || url.username || url.password) return;
  shell.openExternal(url.href).catch(() => {
    console.error(`[vesper] failed to open external link origin=${url.origin}`);
  });
}

function hardenSession(ses) {
  ses.setPermissionRequestHandler((_webContents, _permission, callback) =>
    callback(false),
  );
  ses.setPermissionCheckHandler(() => false);
  ses.setDevicePermissionHandler(() => false);
}

// Applies to every webContents, so nothing created later escapes the policy.
app.on("web-contents-created", (_event, contents) => {
  contents.setWindowOpenHandler(({ url }) => {
    openExternalSafely(url);
    return { action: "deny" };
  });

  contents.on("will-attach-webview", (event) => {
    event.preventDefault();
  });

  contents.on("will-frame-navigate", (event) => {
    if (isTrustedUrl(event.url)) return;
    event.preventDefault();
    if (event.isMainFrame) openExternalSafely(event.url);
  });

  contents.on("will-redirect", (event) => {
    if (isTrustedUrl(event.url)) return;
    event.preventDefault();
    console.warn(`[vesper] blocked redirect origin=${safeOrigin(event.url)}`);
  });
});

function createWindow() {
  const win = new BrowserWindow({
    width: 1130,
    height: 780,
    minWidth: 900,
    minHeight: 650,
    title: "Vesper",
    webPreferences: {
      // Device tokens persist through the narrow encrypted-storage bridge.
      // Trusted renderer code still receives the token for authenticated requests.
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

  win.webContents.on(
    "did-fail-load",
    (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      // ERR_ABORTED (-3) is expected when a navigation is cancelled by our own policy.
      if (errorCode === -3) return;
      console.error(
        `[vesper] load failed code=${errorCode} (${errorDescription}) ` +
          `origin=${safeOrigin(validatedURL)} mainFrame=${isMainFrame}`,
      );
    },
  );

  win.webContents.on("render-process-gone", (_event, details) => {
    console.error(
      `[vesper] renderer process gone reason=${details.reason} exitCode=${details.exitCode}`,
    );
  });

  // did-fail-load reports the details; the rejection message may include the full URL.
  win.loadURL(rendererUrl.href).catch(() => {});

  return win;
}

app.whenReady().then(() => {
  try {
    rendererUrl = resolveRendererUrl();
  } catch (err) {
    console.error(`[vesper] invalid renderer configuration: ${err.message}`);
    dialog.showErrorBox(
      "Vesper",
      `Invalid desktop URL configuration: ${err.message}`,
    );
    app.quit();
    return;
  }

  hardenSession(session.fromPartition(PARTITION));
  installConnectionStorage();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
