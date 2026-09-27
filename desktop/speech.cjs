"use strict";
const { spawn } = require("node:child_process");
const { randomUUID } = require("node:crypto");
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function createSpeechController({ executablePath, onEvent }) {
  let child = null;
  let buffer = "";
  let active = null;
  const requests = new Map();
  const stoppedWaiters = new Set();
  const emit = (owner, event) => {
    if (owner && !owner.isDestroyed()) onEvent(owner, event);
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
    for (const [id, owner] of requests)
      emit(owner, {
        id,
        type: "error",
        code: "helper-exited",
        message: "Voice input stopped. Try again after checking availability.",
      });
    active = null;
    requests.clear();
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
      requests.get(value.id) ??
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
      if (value.revision <= active.revision) return;
      active.revision = value.revision;
    }
    emit(owner, value);
    if (["status", "error", "stopped"].includes(value.type))
      requests.delete(value.id);
    if (value.type === "stopped" && active?.sessionId === value.sessionId) {
      requests.delete(active.id);
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
    child.stdin.on("error", () => {});
    child.once("error", () => {
      if (child === launched) ended();
    });
    child.once("close", () => {
      if (child === launched) ended();
    });
    return child;
  }
  function send(command, owner) {
    if (
      !command ||
      !uuid.test(command.id) ||
      !["status", "prepare", "start", "stop", "cancel"].includes(
        command.command,
      ) ||
      requests.has(command.id) ||
      requests.size >= 16
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
    if (command.command === "start") {
      if (active)
        throw new Error("Voice input is already active in another window.");
      active = {
        id: command.id,
        sessionId: command.sessionId,
        owner,
        revision: -1,
      };
    } else if (
      ["stop", "cancel"].includes(command.command) &&
      (active?.owner !== owner || active.sessionId !== command.sessionId)
    )
      throw new Error("Voice session is not owned by this window.");
    const process = ensure();
    requests.set(command.id, owner);
    process.stdin.write(
      JSON.stringify({
        id: command.id,
        command: command.command,
        ...(command.sessionId ? { sessionId: command.sessionId } : {}),
        locale: command.locale ?? "en-US",
      }) + "\n",
    );
  }
  async function cancelOwner(owner) {
    if (!active || active.owner !== owner) return;
    const sessionId = active.sessionId;
    const waiting = new Promise((resolve) => {
      let timer;
      const done = () => {
        clearTimeout(timer);
        stoppedWaiters.delete(done);
        resolve();
      };
      stoppedWaiters.add(done);
      timer = setTimeout(() => {
        if (child) child.kill("SIGKILL");
        else done();
      }, 3000);
    });
    try {
      send({ id: randomUUID(), command: "cancel", sessionId }, owner);
    } catch {
      child?.kill("SIGKILL");
    }
    await waiting;
  }
  return {
    send,
    cancelOwner,
    async close() {
      if (active) await cancelOwner(active.owner);
      if (child) {
        const current = child;
        await new Promise((resolve) => {
          current.once("close", resolve);
          current.stdin.end();
          setTimeout(() => current.kill("SIGKILL"), 1000).unref();
        });
      }
    },
  };
}
module.exports = { createSpeechController };
