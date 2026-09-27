"use strict";

const { utilityProcess } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const validPort = (port) => Number.isInteger(port) && port > 0 && port <= 65535;
const RECOVERY_MESSAGES = {
  LOCAL_WORKSPACE_MISSING:
    "The saved local workspace is missing or unavailable. Restore its data before starting Vesper.",
  LOCAL_WORKSPACE_IDENTITY:
    "The saved local workspace identity is invalid. Restore its saved connection.",
};

// The worker owns the backend. This module only supervises its private IPC lifecycle.
function createLocalHost({
  modulePath,
  dataDirectory,
  onStatus,
  getExpectedWorkspaceId = () => null,
}) {
  const hostDirectory = path.join(dataDirectory, "local-host");
  const portFile = path.join(hostDirectory, "port");
  let current = { state: "stopped" };
  let worker = null;
  let starting = null;
  let stopping = null;
  let bootstrapping = null;
  let recovering = null;
  let stopRequested = false;
  let restartCount = 0;
  let pending = null;

  function report(state, details = {}) {
    current = { state, ...details };
    try {
      onStatus?.({ ...current });
    } catch {
      /* UI observers do not own lifecycle. */
    }
  }
  function readPort() {
    try {
      const info = fs.lstatSync(portFile);
      if (!info.isFile() || info.size > 6) throw new Error();
      const value = fs.readFileSync(portFile, "utf8");
      if (!/^\d{1,5}\n?$/.test(value) || !validPort(Number(value)))
        throw new Error();
      return Number(value);
    } catch (error) {
      if (error.code === "ENOENT") return 0;
      throw new Error("The saved local host port is invalid or unavailable.");
    }
  }
  function writePort(port) {
    const temporary = `${portFile}.${randomUUID()}.tmp`;
    try {
      const descriptor = fs.openSync(temporary, "wx", 0o600);
      try {
        fs.writeFileSync(descriptor, `${port}\n`);
        fs.fsyncSync(descriptor);
      } finally {
        fs.closeSync(descriptor);
      }
      fs.renameSync(temporary, portFile);
    } finally {
      try {
        fs.unlinkSync(temporary);
      } catch {
        /* A successful rename removes it. */
      }
    }
  }
  function rejectBootstrap() {
    if (!pending) return;
    clearTimeout(pending.timer);
    pending.reject(new Error("The local host is unavailable."));
    pending = null;
  }
  function connectionInfo(w) {
    return {
      url: `http://127.0.0.1:${w.port}`,
      pid: w.child.pid,
      workspaceId: w.workspaceId,
    };
  }
  function restartAfterCrash() {
    if (recovering || stopRequested) return;
    recovering = Promise.resolve()
      .then(async () => {
        if (starting) await starting.catch(() => {});
        while (!stopRequested && !worker && restartCount < 2) {
          restartCount++;
          try {
            await start();
            return;
          } catch {
            /* Each failed launch consumes one retry. */
          }
        }
      })
      .catch(() => {})
      .finally(() => {
        recovering = null;
      });
  }

  function launch(port) {
    const expectedWorkspaceId = getExpectedWorkspaceId();
    let recoveryCode;
    if (
      expectedWorkspaceId !== null &&
      (typeof expectedWorkspaceId !== "string" ||
        !UUID.test(expectedWorkspaceId))
    ) {
      recoveryCode = "LOCAL_WORKSPACE_IDENTITY";
    } else if (
      expectedWorkspaceId !== null &&
      !fs.existsSync(path.join(hostDirectory, "workspace.sqlite"))
    ) {
      recoveryCode = "LOCAL_WORKSPACE_MISSING";
    }
    if (recoveryCode) {
      const error = new Error(RECOVERY_MESSAGES[recoveryCode]);
      error.code = recoveryCode;
      throw error;
    }
    fs.mkdirSync(hostDirectory, { recursive: true, mode: 0o700 });
    fs.chmodSync(hostDirectory, 0o700);
    const env = { ...process.env };
    for (const key of ["ELECTRON_RUN_AS_NODE", "NODE_OPTIONS", "NODE_PATH"])
      delete env[key];
    delete env.VESPER_EXPECTED_WORKSPACE_ID;
    if (expectedWorkspaceId !== null)
      env.VESPER_EXPECTED_WORKSPACE_ID = expectedWorkspaceId;
    Object.assign(env, {
      VESPER_BIND: "127.0.0.1",
      VESPER_PORT: String(port),
      VESPER_DATA_DIR: hostDirectory,
      VESPER_ALLOWED_ORIGINS: "vesper://app",
      VESPER_HOST_LABEL: "This Mac",
      VESPER_MANAGED_LOCAL: "1",
    });
    let child;
    try {
      child = utilityProcess.fork(modulePath, [], {
        env,
        stdio: "ignore",
        serviceName: "Vesper local host",
      });
    } catch {
      throw new Error("The local host could not be launched.");
    }
    let markExited;
    const w = {
      child,
      ready: false,
      port: 0,
      workspaceId: null,
      cancelStart: null,
      exited: new Promise((resolve) => {
        markExited = resolve;
      }),
    };
    worker = w;
    return new Promise((resolve, reject) => {
      let settled = false;
      let portBusy = false;
      const settle = (error, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(deadline);
        if (error) reject(error);
        else resolve(value);
      };
      const kill = () => {
        try {
          child.kill();
        } catch {
          /* Exit/timeout handles failure. */
        }
      };
      const deadline = setTimeout(() => {
        settle(new Error("The local host did not start within 10 seconds."));
        kill();
      }, 10000);
      w.cancelStart = () =>
        settle(new Error("Local host startup was stopped."));
      child.on("error", () => {
        settle(new Error("The local host process failed."));
        kill();
      });
      child.on("message", (message) => {
        if (
          worker !== w ||
          !message ||
          typeof message !== "object" ||
          stopRequested
        )
          return;
        if (message.type === "host-error" && !w.ready && !settled) {
          portBusy = message.code === "EADDRINUSE";
          kill(); // Wait for exit before the caller can try another port.
        } else if (message.type === "host-ready" && !settled) {
          if (
            portBusy ||
            !validPort(message.port) ||
            (port && message.port !== port) ||
            typeof message.workspaceId !== "string" ||
            !UUID.test(message.workspaceId) ||
            (expectedWorkspaceId !== null &&
              message.workspaceId !== expectedWorkspaceId) ||
            !child.pid
          ) {
            settle(new Error("The local host reported invalid readiness."));
            kill();
            return;
          }
          try {
            writePort(message.port);
          } catch {
            settle(new Error("The local host port could not be saved."));
            kill();
            return;
          }
          w.ready = true;
          w.port = message.port;
          w.workspaceId = message.workspaceId;
          settle(null, connectionInfo(w));
        } else if (
          w.ready &&
          pending?.worker === w &&
          message.requestId === pending.requestId &&
          (message.type === "bootstrap-result" ||
            message.type === "bootstrap-error")
        ) {
          const request = pending;
          pending = null;
          clearTimeout(request.timer);
          const value = message.connection;
          if (
            message.type === "bootstrap-error" ||
            !value ||
            value.url !== connectionInfo(w).url ||
            value.workspaceId !== w.workspaceId ||
            typeof value.token !== "string" ||
            !TOKEN.test(value.token)
          ) {
            request.reject(
              new Error("The local workspace connection could not be created."),
            );
          } else
            request.resolve({
              url: value.url,
              token: value.token,
              workspaceId: value.workspaceId,
              mode: "local",
            });
        }
      });
      child.once("exit", () => {
        if (worker === w) {
          worker = null;
          rejectBootstrap();
        }
        markExited();
        const error = new Error(
          portBusy
            ? "The saved local port is occupied."
            : "The local host stopped during startup.",
        );
        if (portBusy) error.code = "EADDRINUSE";
        settle(error);
        if (w.ready && !stopRequested) {
          report("failed", { message: "The local host stopped unexpectedly." });
          restartAfterCrash();
        }
      });
    });
  }

  function start() {
    if (stopping)
      return stopping.then(async () => {
        if (starting) await starting.catch(() => {});
        return start();
      });
    if (starting) return starting;
    if (worker?.ready) return Promise.resolve(connectionInfo(worker));
    if (worker)
      return Promise.reject(
        new Error("The previous local host is still stopping."),
      );
    stopRequested = false;
    starting = Promise.resolve()
      .then(async () => {
        if (stopRequested) throw new Error("Local host startup was stopped.");
        report("starting");
        if (stopRequested) throw new Error("Local host startup was stopped.");
        try {
          const port = readPort();
          let info;
          try {
            info = await launch(port);
          } catch (error) {
            if (
              error.code !== "EADDRINUSE" ||
              port === 0 ||
              stopRequested ||
              worker
            )
              throw error;
            info = await launch(0); // Never probe or attach to a listener occupying the saved port.
          }
          if (
            stopRequested ||
            !worker?.ready ||
            worker.child.pid !== info.pid
          ) {
            throw new Error("Local host startup was stopped.");
          }
          report("running", { url: info.url, workspaceId: info.workspaceId });
          return info;
        } catch (error) {
          const recoveryMessage = Object.hasOwn(RECOVERY_MESSAGES, error?.code)
            ? RECOVERY_MESSAGES[error.code]
            : undefined;
          if (!stopRequested)
            report("failed", {
              message:
                recoveryMessage ??
                "The local host could not start. Try again or check local storage.",
            });
          const failure = new Error(
            recoveryMessage ?? "The local host could not start.",
          );
          if (recoveryMessage) failure.code = error.code;
          throw failure;
        }
      })
      .finally(() => {
        starting = null;
      });
    return starting;
  }

  function bootstrap() {
    if (bootstrapping) return bootstrapping;
    bootstrapping = (async () => {
      await start();
      const w = worker;
      if (!w?.ready || stopRequested)
        throw new Error("The local host is unavailable.");
      return new Promise((resolve, reject) => {
        const requestId = randomUUID();
        const timer = setTimeout(() => {
          if (pending?.requestId === requestId) {
            pending = null;
            reject(new Error("Local workspace connection timed out."));
          }
        }, 10000);
        pending = { worker: w, requestId, timer, resolve, reject };
        try {
          w.child.postMessage({
            type: "bootstrap",
            requestId,
            deviceName: "This Mac",
          });
        } catch {
          rejectBootstrap();
        }
      });
    })().finally(() => {
      bootstrapping = null;
    });
    return bootstrapping;
  }

  function stop() {
    if (stopping) return stopping;
    stopRequested = true;
    rejectBootstrap();
    worker?.cancelStart();
    stopping = Promise.resolve()
      .then(async () => {
        const w = worker;
        if (!w) {
          report("stopped");
          return;
        }
        let killTimer;
        let failTimer;
        try {
          try {
            w.child.postMessage({ type: "shutdown" });
          } catch {
            /* Escalate below. */
          }
          await Promise.race([
            w.exited,
            new Promise((_, reject) => {
              killTimer = setTimeout(() => {
                try {
                  w.child.kill();
                } catch {
                  /* Final deadline applies. */
                }
              }, 2000);
              failTimer = setTimeout(
                () => reject(new Error("The local host did not stop.")),
                4000,
              );
            }),
          ]);
          report("stopped");
        } catch {
          report("failed", {
            message:
              "The local host did not stop. Quit Vesper before retrying.",
          });
          throw new Error("The local host did not stop.");
        } finally {
          clearTimeout(killTimer);
          clearTimeout(failTimer);
        }
      })
      .finally(() => {
        stopping = null;
      });
    return stopping;
  }
  return { start, bootstrap, stop, status: () => ({ ...current }) };
}

module.exports = { createLocalHost };
