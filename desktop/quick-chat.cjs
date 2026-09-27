"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const {
  app,
  globalShortcut,
  Menu,
  Tray,
  nativeImage,
  screen,
} = require("electron");

const DEFAULT_SHORTCUT = "Alt+Space";
const PREFS_NAME = "quick-chat-shortcut.json";
const READY_TIMEOUT_MS = 10000;
const SIZE = 600;

function validAccelerator(value) {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= 80 &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}

function trayImage() {
  const buf = Buffer.alloc(20 * 20 * 4); // BGRA, transparent
  const plot = (x, y) => {
    if (x < 0 || x > 19 || y < 0 || y > 19) return;
    buf[(y * 20 + x) * 4 + 3] = 255; // black, opaque
  };
  for (let y = 4; y <= 16; y++) {
    const t = (y - 4) / 12;
    const left = Math.round(4 + 6 * t);
    const right = Math.round(16 - 6 * t);
    plot(left, y);
    plot(left - 1, y);
    plot(right, y);
    plot(right - 1, y);
  }
  const image = nativeImage.createFromBitmap(buf, { width: 20, height: 20 });
  image.setTemplateImage(true);
  return image;
}

function createQuickChat({
  createWindow,
  showMain,
  onDismiss,
  onStatus,
  dataDirectory,
}) {
  const prefsPath = path.join(dataDirectory, PREFS_NAME);
  let win = null;
  let ready = null;
  let cancelReady = null;
  let desired = null;
  let running = null;
  let revision = 0;
  let applied = 0;
  let disposed = false;
  let disposing = false;
  let disposePromise = null;
  let requested = DEFAULT_SHORTCUT;
  let active = null;
  let shortcutError = null;
  let uiError = null;
  let tray = null;

  const isVisible = () => {
    try {
      return Boolean(win && !win.isDestroyed() && win.isVisible());
    } catch {
      return false;
    }
  };
  const status = () => ({
    requested,
    active,
    error: [shortcutError, uiError].filter(Boolean).join(" ") || null,
    visible: isVisible(),
  });
  const notify = () => {
    try {
      if (typeof onStatus === "function") onStatus(status());
    } catch {
      /* ignored */
    }
  };

  function ensureWindow() {
    if (win && !win.isDestroyed()) return;
    const created = createWindow();
    if (
      !created ||
      typeof created.isDestroyed !== "function" ||
      created.isDestroyed()
    ) {
      throw new Error("Quick Chat window could not be created.");
    }
    win = created;
    const current = created;
    ready = new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        cancelReady = null;
        if (error) reject(new Error(error));
        else resolve();
      };
      const timer = setTimeout(
        () => finish("Quick Chat window timed out."),
        READY_TIMEOUT_MS,
      );
      cancelReady = () => finish("Quick Chat was closed.");
      current.once("ready-to-show", () => finish(null));
      current.once("closed", () => finish("Quick Chat window closed."));
      current.webContents.on(
        "did-fail-load",
        (_e, code, _desc, _url, isMainFrame) => {
          if (isMainFrame && code !== -3)
            finish("Quick Chat window failed to load.");
        },
      );
    });
    ready.catch(() => {});
    current.webContents.on("before-input-event", (event, input) => {
      if (input.type === "keyDown" && input.key === "Escape") {
        event.preventDefault();
        request(false).catch(() => {});
      }
    });
    current.on("close", (event) => {
      if (disposing) return;
      event.preventDefault();
      request(false).catch(() => {});
    });
    current.on("closed", () => {
      if (win === current) {
        win = null;
        ready = null;
      }
      notify();
    });
    current.on("show", notify);
    current.on("hide", notify);
  }

  function position() {
    const point = screen.getCursorScreenPoint();
    const { workArea: wa } = screen.getDisplayNearestPoint(point);
    const width = Math.max(1, Math.min(SIZE, wa.width));
    const height = Math.max(1, Math.min(SIZE, wa.height));
    const x = Math.min(
      Math.max(wa.x + Math.round((wa.width - width) / 2), wa.x),
      wa.x + wa.width - width,
    );
    const y = wa.y;
    win.setBounds({ x, y, width, height }, false);
  }

  async function doShow() {
    ensureWindow();
    const current = win;
    try {
      await ready;
    } catch (error) {
      if (!disposed) {
        if (win === current) {
          win = null;
          ready = null;
        }
        if (!current.isDestroyed()) current.destroy();
      }
      throw error;
    }
    if (
      disposed ||
      desired !== true ||
      win !== current ||
      current.isDestroyed()
    )
      return;
    position();
    current.show();
    current.focus();
    current.webContents.send("vesper:quick:focus");
    uiError = null;
  }

  async function doHide() {
    try {
      if (typeof onDismiss === "function") await onDismiss();
    } catch {
      uiError = "Quick Chat could not stop speech; it stayed open.";
      throw new Error("Quick Chat dismissal failed.");
    }
    if (disposed || desired !== false) return;
    if (win && !win.isDestroyed()) win.hide();
    uiError = null;
  }

  const needsWork = () => !disposed && desired !== null && applied !== revision;

  async function loop() {
    while (needsWork()) {
      const processing = revision;
      uiError = null;
      try {
        if (desired) await doShow();
        else await doHide();
      } catch (error) {
        if (!disposed && !uiError)
          uiError = "Quick Chat could not open or close safely.";
        desired = null;
        notify();
        throw new Error(uiError || "Quick Chat was closed.");
      }
      applied = processing;
      notify();
    }
  }

  async function request(visible) {
    if (disposed) return;
    desired = visible;
    revision++;
    while (running) await running.catch(() => {});
    if (running || !needsWork()) return;
    running = loop().finally(() => {
      running = null;
    });
    await running;
  }

  function onShortcut() {
    const target = running && desired !== null ? !desired : !isVisible();
    request(target).catch(() => {});
  }

  function register(accelerator) {
    try {
      return globalShortcut.register(accelerator, onShortcut) === true;
    } catch {
      return false;
    }
  }

  function unregister(accelerator) {
    try {
      globalShortcut.unregister(accelerator);
    } catch {
      /* ignored */
    }
  }

  function ensureDirectory() {
    fs.mkdirSync(dataDirectory, { recursive: true, mode: 0o700 });
    const info = fs.lstatSync(dataDirectory);
    if (!info.isDirectory() || info.isSymbolicLink())
      throw new Error("Invalid shortcut storage.");
    fs.chmodSync(dataDirectory, 0o700);
  }

  function readPreferences() {
    ensureDirectory();
    let info;
    try {
      info = fs.lstatSync(prefsPath);
    } catch (error) {
      if (error.code === "ENOENT") return DEFAULT_SHORTCUT;
      throw error;
    }
    if (!info.isFile() || info.isSymbolicLink() || info.size > 4096)
      throw new Error("Invalid shortcut settings.");
    const value = JSON.parse(fs.readFileSync(prefsPath, "utf8"));
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      Object.keys(value).length !== 2 ||
      value.version !== 1 ||
      !validAccelerator(value.requested)
    ) {
      throw new Error("Invalid shortcut settings.");
    }
    return value.requested.trim();
  }

  function persist(accelerator) {
    ensureDirectory();
    try {
      const info = fs.lstatSync(prefsPath);
      if (!info.isFile() || info.isSymbolicLink() || info.size > 4096)
        throw new Error("Invalid shortcut settings.");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const temporary = path.join(
      dataDirectory,
      `.quick-chat-${crypto.randomUUID()}.tmp`,
    );
    try {
      const descriptor = fs.openSync(temporary, "wx", 0o600);
      try {
        fs.writeFileSync(
          descriptor,
          JSON.stringify({ version: 1, requested: accelerator }) + "\n",
        );
        fs.fsyncSync(descriptor);
      } finally {
        fs.closeSync(descriptor);
      }
      fs.renameSync(temporary, prefsPath);
    } finally {
      try {
        fs.unlinkSync(temporary);
      } catch {
        /* A successful rename removed it. */
      }
    }
  }

  function setShortcut(accelerator) {
    if (disposed) return status();
    if (!validAccelerator(accelerator)) {
      shortcutError =
        "Enter a shortcut between 1 and 80 characters without control characters.";
      notify();
      return status();
    }
    requested = accelerator.trim();
    const previous = active;
    const newlyRegistered = requested !== previous;
    if (newlyRegistered && !register(requested)) {
      shortcutError =
        "This shortcut is unavailable. Another app or the system may already use it.";
      notify();
      return status();
    }
    try {
      persist(requested);
    } catch {
      if (newlyRegistered) unregister(requested);
      shortcutError =
        "The shortcut could not be saved. The previous active shortcut is unchanged.";
      notify();
      return status();
    }
    active = requested;
    if (previous && previous !== active) unregister(previous);
    shortcutError = null;
    notify();
    return status();
  }

  try {
    tray = new Tray(trayImage());
    tray.setToolTip("Vesper");
    tray.setContextMenu(
      Menu.buildFromTemplate([
        {
          label: "Open Quick Chat",
          click: () => {
            void request(true).catch(() => {});
          },
        },
        {
          label: "Open Vesper",
          click: () => {
            try {
              Promise.resolve(showMain()).catch(() => {
                uiError = "Vesper could not open.";
                notify();
              });
            } catch {
              uiError = "Vesper could not open.";
              notify();
            }
          },
        },
        { type: "separator" },
        { label: "Quit Vesper", click: () => app.quit() },
      ]),
    );
  } catch {
    try {
      tray?.destroy();
    } catch {
      /* No tray ownership remains. */
    }
    tray = null;
    uiError = "The Vesper menu bar control is unavailable.";
  }
  try {
    setShortcut(readPreferences());
  } catch {
    shortcutError =
      "Saved shortcut settings could not be read. Choose a shortcut in Vesper.";
    notify();
  }

  function dispose() {
    if (disposePromise) return disposePromise;
    disposed = true;
    disposing = true;
    desired = null;
    if (active) {
      unregister(active);
      active = null;
    }
    cancelReady?.();
    disposePromise = (async () => {
      try {
        await running;
      } catch {
        /* Any pending show was cancelled. */
      }
      try {
        await onDismiss?.();
      } catch {
        /* Destroying the owned renderer still releases its capture. */
      }
      try {
        if (win && !win.isDestroyed()) win.destroy();
      } catch {
        /* Application shutdown owns final process teardown. */
      }
      win = null;
      ready = null;
      try {
        tray?.destroy();
      } catch {
        /* The tray may already be gone. */
      }
      tray = null;
      notify();
    })();
    return disposePromise;
  }

  return {
    show: () => request(true),
    hide: () => request(false),
    setShortcut,
    status,
    dispose,
  };
}

module.exports = { createQuickChat };
