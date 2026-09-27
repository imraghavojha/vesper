"use strict";
const { spawn } = require("node:child_process");
const { randomUUID } = require("node:crypto");
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function createSpeechController({ executablePath, onEvent }) {
  let child = null;
  let buffer = "";
  let active = null;
  const requests = new Map();
  const pendingWriteFailures = new Set();
  const stoppedWaiters = new Set();
  const emit = (owner, event) => {
    try {
      if (owner && !owner.isDestroyed()) onEvent(owner, event);
    } catch {
      /* A renderer failure must not interrupt capture cleanup. */
    }
  };
  function ended() {
    child = null;
    buffer = "";
    if (active)
      emit(active.owner, {
        id: active.id,
        sessionId: active.sessionId,
        type: "stopped",
        reason: "helper-exited",
      });
    for (const [id, request] of requests)
      emit(request.owner, {
        id,
        type: "error",
        code: "helper-exited",
        message: "Voice input stopped. Try again after checking availability.",
      });
    active = null;
    requests.clear();
    pendingWriteFailures.clear();
    for (const done of stoppedWaiters) done();
    stoppedWaiters.clear();
  }
  function receive(value) {
    if (
      !value ||
      typeof value !== "object" ||
      !uuid.test(value.id) ||
      !["status", "started", "transcript", "stopped", "error"].includes(
        value.type,
      )
    )
      throw new Error("Invalid voice response.");
    const owner =
      requests.get(value.id)?.owner ??
      (active &&
      (active.id === value.id || active.sessionId === value.sessionId)
        ? active.owner
        : null);
    if (!owner) return;
    if (
      value.sessionId !== undefined &&
      (!uuid.test(value.sessionId) || value.sessionId !== active?.sessionId)
    )
      return;
    if (
      value.type === "transcript" &&
      (typeof value.text !== "string" ||
        value.text.length > 10000 ||
        !Number.isSafeInteger(value.revision) ||
        value.revision < 0 ||
        typeof value.final !== "boolean")
    )
      throw new Error("Invalid transcript.");
    if (
      ["started", "transcript"].includes(value.type) &&
      (!active ||
        active.owner !== owner ||
        value.sessionId !== active.sessionId)
    )
      return;
    if (value.type === "transcript") {
      if (active.cancelRequested) return;
      if (value.revision <= active.revision) return;
      active.revision = value.revision;
    }
    emit(
      owner,
      value.type === "stopped" && active?.cancelRequested
        ? { ...value, final: false, reason: "cancelled" }
        : value,
    );
    if (["status", "error", "stopped"].includes(value.type))
      requests.delete(value.id);
    if (value.type === "error" && active) {
      for (const operation of ["stop", "cancel"])
        if (active.controls[operation] === value.id)
          delete active.controls[operation];
    }
    if (value.type === "stopped" && active?.sessionId === value.sessionId) {
      requests.delete(active.id);
      for (const id of Object.values(active.controls)) requests.delete(id);
      active = null;
      for (const done of stoppedWaiters) done();
      stoppedWaiters.clear();
    }
  }
  function ensure() {
    if (child) return child;
    buffer = "";
    child = spawn(executablePath, [], {
      stdio: ["pipe", "pipe", "ignore"],
      env: { PATH: "/usr/bin:/bin:/usr/sbin:/sbin", LANG: "en_US.UTF-8" },
    });
    const launched = child;
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      if (child !== launched) return;
      buffer += chunk;
      try {
        if (Buffer.byteLength(buffer) > 131072)
          throw new Error("Oversized voice response.");
        let newline;
        while ((newline = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          if (line) receive(JSON.parse(line));
        }
      } catch {
        launched.kill("SIGKILL");
      }
    });
    child.stdin.on("error", () => {
      if (child !== launched) return;
      for (const fail of [...pendingWriteFailures]) fail();
      try {
        launched.kill("SIGKILL");
      } catch {
        /* Exit remains unconfirmed until close. */
      }
    });
    child.once("error", () => {
      if (child !== launched) return;
      if (!launched.pid) ended();
      else {
        if (active)
          emit(active.owner, {
            id: active.id,
            sessionId: active.sessionId,
            type: "error",
            code: "helper-error",
            message: "Voice input status is unconfirmed. Retry Cancel.",
          });
        try {
          launched.kill("SIGKILL");
        } catch {
          /* A process error is not an exit receipt. */
        }
      }
    });
    child.once("close", () => {
      if (child === launched) ended();
    });
    return child;
  }
  function send(command, owner) {
    const control =
      command?.command === "stop" || command?.command === "cancel";
    if (
      !command ||
      !uuid.test(command.id) ||
      !["status", "prepare", "start", "stop", "cancel"].includes(
        command.command,
      ) ||
      requests.has(command.id) ||
      (!control && requests.size >= 16)
    )
      throw new Error("Invalid voice command.");
    if (
      command.locale !== undefined &&
      (typeof command.locale !== "string" ||
        !/^[A-Za-z]{2,3}[-_][A-Za-z]{2,4}$/.test(command.locale))
    )
      throw new Error("Unsupported voice locale.");
    if (
      ["start", "stop", "cancel"].includes(command.command) &&
      !uuid.test(command.sessionId)
    )
      throw new Error("Invalid capture session.");
    if (
      control &&
      (active?.owner !== owner || active.sessionId !== command.sessionId)
    )
      throw new Error("Voice session is not owned by this window.");
    if (control && active.controls[command.command]) return;
    if (command.command === "start" && active)
      throw new Error("Voice input is already active in another window.");
    const process = control ? child : ensure();
    if (!process)
      throw new Error("Voice process is unavailable; stop is not confirmed.");
    if (command.command === "start") {
      active = {
        id: command.id,
        sessionId: command.sessionId,
        owner,
        revision: -1,
        controls: {},
        cancelRequested: false,
        cancellation: null,
      };
    }
    if (control) active.controls[command.command] = command.id;
    if (command.command === "cancel") active.cancelRequested = true;
    const request = { owner };
    requests.set(command.id, request);
    const capture = active;
    let writeSettled = false;
    const failWrite = () => {
      if (writeSettled) return;
      writeSettled = true;
      pendingWriteFailures.delete(failWrite);
      if (child !== process || requests.get(command.id) !== request) return;
      requests.delete(command.id);
      if (active !== capture) return;
      if (control && active?.controls[command.command] === command.id)
        delete active.controls[command.command];
      if (!process.pid) {
        ended();
        return;
      }
      if (active)
        emit(active.owner, {
          id: active.id,
          sessionId: active.sessionId,
          type: "error",
          code: "write-failed",
          message: "Voice input status is unconfirmed. Retry Cancel.",
        });
      else
        emit(owner, {
          id: command.id,
          type: "error",
          code: "write-failed",
          message: "Voice command could not be delivered. Try again.",
        });
      try {
        process.kill("SIGKILL");
      } catch {
        /* Keep the session until a real stop/exit receipt. */
      }
    };
    pendingWriteFailures.add(failWrite);
    try {
      process.stdin.write(
        JSON.stringify({
          id: command.id,
          command: command.command,
          ...(command.sessionId ? { sessionId: command.sessionId } : {}),
          locale: command.locale ?? "en-US",
        }) + "\n",
        (error) => {
          if (error) failWrite();
          else {
            writeSettled = true;
            pendingWriteFailures.delete(failWrite);
          }
        },
      );
    } catch {
      failWrite();
      if (!process.pid) throw new Error("Voice process did not start.");
    }
  }
  function cancelOwner(owner) {
    if (!active || active.owner !== owner) return Promise.resolve();
    const capture = active;
    if (capture.cancellation) return capture.cancellation;
    const sessionId = capture.sessionId;
    capture.cancelRequested = true;
    const waiting = new Promise((resolve, reject) => {
      let timer, exitTimer;
      const done = () => {
        clearTimeout(timer);
        clearTimeout(exitTimer);
        stoppedWaiters.delete(done);
        resolve();
      };
      stoppedWaiters.add(done);
      timer = setTimeout(() => {
        try {
          child?.kill("SIGKILL");
        } catch {
          /* Wait for proof rather than assuming kill succeeded. */
        }
        exitTimer = setTimeout(() => {
          stoppedWaiters.delete(done);
          emit(capture.owner, {
            id: capture.id,
            sessionId,
            type: "error",
            code: "stop-unconfirmed",
            message:
              "Voice input could not be confirmed stopped. Retry Cancel.",
          });
          reject(
            new Error(
              "Voice input could not be confirmed stopped. Retry Cancel.",
            ),
          );
        }, 2000);
      }, 3000);
    });
    capture.cancellation = waiting.finally(() => {
      if (active === capture) capture.cancellation = null;
    });
    try {
      send({ id: randomUUID(), command: "cancel", sessionId }, owner);
    } catch {
      try {
        child?.kill("SIGKILL");
      } catch {
        /* The bounded waiter rejects if no receipt arrives. */
      }
    }
    return capture.cancellation;
  }
  return {
    send,
    cancelOwner,
    async close() {
      if (active) await cancelOwner(active.owner);
      if (child) {
        const current = child;
        await new Promise((resolve, reject) => {
          const done = () => {
            clearTimeout(killTimer);
            clearTimeout(exitTimer);
            resolve();
          };
          const killTimer = setTimeout(() => {
            try {
              current.kill("SIGKILL");
            } catch {
              /* Wait for actual close. */
            }
          }, 1000);
          const exitTimer = setTimeout(() => {
            current.removeListener("close", done);
            reject(new Error("Voice process exit could not be confirmed."));
          }, 3000);
          current.once("close", done);
          try {
            current.stdin.end();
          } catch {
            try {
              current.kill("SIGKILL");
            } catch {
              /* The exit deadline remains authoritative. */
            }
          }
        });
      }
    },
  };
}
module.exports = { createSpeechController };
