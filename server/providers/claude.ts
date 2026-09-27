import {
  query,
  type Query,
  type SDKMessage,
  type SDKUserMessage,
  type Options,
} from "@anthropic-ai/claude-agent-sdk";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { join, resolve } from "node:path";
import { MAX_PROVIDER_TEXT_LENGTH } from "../../shared/providers.js";
import type {
  ChatProvider,
  ClaudeAdapterOptions,
  ProviderAccount,
  ProviderAttestation,
  ProviderAvailability,
  ProviderErrorCode,
  ProviderEvent,
  ProviderModel,
  ProviderRunHandle,
  ProviderRunInput,
  ProviderSelection,
  ProviderTerminal,
  ProviderUsage,
} from "./contract.js";

type ProviderFailureCode = ProviderErrorCode;
class ProviderFailure extends Error {
  constructor(
    readonly code: ProviderErrorCode,
    message: string,
  ) {
    super(message);
  }
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
async function deadline<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new ProviderFailure(
                "timeout",
                "Claude did not respond within the time limit.",
              ),
            ),
          ms,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
function safeFailure(error: unknown): ProviderFailure {
  return error instanceof ProviderFailure
    ? error
    : new ProviderFailure(
        "unavailable",
        "Claude could not complete this request. Check the installed CLI, connection and sign-in.",
      );
}
function eventBuffer(onReturn: () => void) {
  const queue: ProviderEvent[] = [];
  let waiter: ((value: IteratorResult<ProviderEvent>) => void) | undefined;
  let ended = false;
  let taken = false;
  return {
    push(event: ProviderEvent) {
      if (ended) return;
      if (waiter) {
        const send = waiter;
        waiter = undefined;
        send({ value: event, done: false });
        return;
      }
      const replace =
        event.kind === "text" || event.kind === "usage"
          ? queue.findIndex((item) => item.kind === event.kind)
          : -1;
      if (replace >= 0) queue[replace] = event;
      else queue.push(event);
    },
    end() {
      ended = true;
      if (waiter && !queue.length) {
        waiter({ value: undefined, done: true });
        waiter = undefined;
      }
    },
    events: {
      [Symbol.asyncIterator](): AsyncIterator<ProviderEvent> {
        if (taken) throw new Error("Provider events already have a consumer.");
        taken = true;
        return {
          next: () =>
            queue.length
              ? Promise.resolve({ value: queue.shift()!, done: false })
              : ended
                ? Promise.resolve({ value: undefined, done: true })
                : new Promise((resolve) => {
                    waiter = resolve;
                  }),
          return: async () => {
            onReturn();
            return { value: undefined, done: true };
          },
        };
      },
    } satisfies AsyncIterable<ProviderEvent>,
  };
}

type Session = {
  query: Query;
  spawnVerified: boolean;
  started: boolean;
  exited: boolean;
  stop(): Promise<boolean>;
};

export function createClaudeAdapter(
  options: ClaudeAdapterOptions,
): ChatProvider {
  const executablePath = resolve(options.executablePath);
  const runtimeDirectory = resolve(options.runtimeDirectory);
  const outputLimit = Math.max(
    256,
    Math.min(8192, options.maxOutputTokens ?? 2048),
  );
  const timeoutMs = Math.max(
    5000,
    Math.min(180000, options.timeoutMs ?? 90000),
  );
  let quarantined = false;
  let discovery: Promise<ProviderAvailability> | undefined;

  function openSession(
    model: string,
    input: AsyncIterable<SDKUserMessage>,
  ): Session {
    if (quarantined)
      throw new ProviderFailure(
        "unavailable",
        "Restart the Vesper host before starting another Claude run.",
      );
    mkdirSync(runtimeDirectory, { recursive: true, mode: 0o700 });
    if (lstatSync(runtimeDirectory).isSymbolicLink())
      throw new ProviderFailure(
        "unsafe-configuration",
        "Claude runtime storage must be a private directory.",
      );
    chmodSync(runtimeDirectory, 0o700);
    const cwd = mkdtempSync(join(runtimeDirectory, "run-"));
    chmodSync(cwd, 0o700);
    const abortController = new AbortController();
    const exit = deferred<void>();
    let child: ChildProcessWithoutNullStreams | undefined;
    let stopping: Promise<boolean> | undefined;
    let stopRequested = false;
    const state: Session = {
      query: undefined as unknown as Query,
      spawnVerified: false,
      started: false,
      exited: false,
      stop() {
        if (stopping) return stopping;
        stopRequested = true;
        stopping = (async () => {
          try {
            state.query?.close();
          } catch {
            /* The tracked process still owns the exit receipt. */
          }
          abortController.abort();
          if (child && !state.exited) {
            try {
              await deadline(exit.promise, 4000);
            } catch {
              try {
                child.kill("SIGKILL");
              } catch {
                /* The next exit check determines the outcome. */
              }
              try {
                await deadline(exit.promise, 2000);
              } catch {
                quarantined = true;
                return false;
              }
            }
          }
          try {
            rmSync(cwd, { recursive: true, force: true });
          } catch {
            /* Never log private runtime paths. */
          }
          return true;
        })();
        return stopping;
      },
    };
    const env: Record<string, string> = {
      HOME: homedir(),
      USER: userInfo().username,
      LOGNAME: userInfo().username,
      PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
      TMPDIR: cwd,
      LANG: "en_US.UTF-8",
      CLAUDE_CODE_SAFE_MODE: "1",
      ENABLE_CLAUDEAI_MCP_SERVERS: "false",
      CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: "1",
      DISABLE_TELEMETRY: "1",
      DISABLE_ERROR_REPORTING: "1",
      CLAUDE_CODE_MAX_OUTPUT_TOKENS: String(outputLimit),
      CLAUDE_AGENT_SDK_CLIENT_APP: "vesper/0.1.0",
    };
    const settings = {
      disableAllHooks: true,
      disableClaudeAiConnectors: true,
      alwaysThinkingEnabled: false,
      syncClaudeAiPlugins: false,
      syncClaudeAiSkills: false,
      disableBundledSkills: true,
      workflowKeywordTriggerEnabled: false,
      enabledPlugins: {
        "agents-md@builtin": false,
        "telemetry@builtin": false,
      },
    };
    const sdkOptions: Options = {
      cwd,
      env,
      abortController,
      pathToClaudeCodeExecutable: executablePath,
      model,
      tools: [],
      allowedTools: [],
      disallowedTools: ["*"],
      mcpServers: {},
      strictMcpConfig: true,
      settingSources: [],
      settings,
      managedSettings: {
        disableAllHooks: true,
        disableClaudeAiConnectors: true,
        allowedMcpServers: [],
      },
      plugins: [],
      agents: {},
      skills: [],
      permissionMode: "dontAsk",
      permissionPrompts: "none",
      canUseTool: async () => ({
        behavior: "deny",
        message: "Tools are unavailable in this Vesper chat.",
      }),
      persistSession: false,
      includePartialMessages: true,
      promptSuggestions: false,
      agentProgressSummaries: false,
      title: "Vesper",
      thinking: { type: "disabled" },
      effort: "low",
      maxTurns: 1,
      systemPrompt:
        "You are Vesper, a helpful personal assistant. Answer the user's current message using the supplied visible conversation. This session has no tools, browsing, files, integrations or device access. Never claim to have performed actions or checked live information. Be concise unless the user asks for detail.",
      extraArgs: {
        "safe-mode": null,
        "no-chrome": null,
        "disable-slash-commands": null,
      },
      stderr: () => {},
      spawnClaudeCodeProcess(parameters) {
        if (
          stopRequested ||
          abortController.signal.aborted ||
          parameters.signal.aborted
        ) {
          throw new ProviderFailure(
            "unavailable",
            "Claude launch was cancelled before starting.",
          );
        }
        const value = (flag: string) => {
          const inline = parameters.args.find((argument) =>
            argument.startsWith(flag + "="),
          );
          if (inline !== undefined) return inline.slice(flag.length + 1);
          const index = parameters.args.indexOf(flag);
          return index < 0 ? undefined : parameters.args[index + 1];
        };
        if (
          parameters.command !== executablePath ||
          value("--tools") !== "" ||
          !parameters.args.includes("--strict-mcp-config") ||
          value("--setting-sources") !== "" ||
          value("--permission-mode") !== "dontAsk"
        ) {
          throw new ProviderFailure(
            "unsafe-configuration",
            "Claude did not apply the restricted launch configuration.",
          );
        }
        for (const key of Object.keys(parameters.env)) {
          if (
            parameters.env[key] &&
            /^(ANTHROPIC_(API_KEY|AUTH_TOKEN|BASE_URL)|CLAUDE_CODE_(USE_|OAUTH_TOKEN)|AWS_|GOOGLE_APPLICATION_CREDENTIALS|AZURE_)/.test(
              key,
            )
          ) {
            throw new ProviderFailure(
              "unsafe-configuration",
              "Claude received an unexpected authentication or billing override.",
            );
          }
        }
        state.spawnVerified = true;
        child = spawn(parameters.command, parameters.args, {
          cwd: parameters.cwd,
          env: parameters.env,
          signal: parameters.signal,
          stdio: ["pipe", "pipe", "pipe"],
        });
        state.started = child.pid !== undefined;
        child.stderr.resume();
        child.once("exit", () => {
          state.exited = true;
          exit.resolve();
        });
        child.once("close", () => {
          state.exited = true;
          exit.resolve();
        });
        child.once("error", () => {
          if (!child?.pid) {
            state.exited = true;
            exit.resolve();
          }
        });
        return child;
      },
    };
    try {
      state.query = query({ prompt: input, options: sdkOptions });
    } catch (error) {
      void state.stop();
      throw safeFailure(error);
    }
    return state;
  }

  async function discoverNow(): Promise<ProviderAvailability> {
    const gate = deferred<void>();
    let session: Session | undefined;
    async function* noPrompt(): AsyncGenerator<SDKUserMessage> {
      await gate.promise;
    }
    try {
      session = openSession("claude-opus-5-5", noPrompt());
      const inspected = await deadline(inspectSession(session.query), 20000);
      if (!session.spawnVerified)
        throw new ProviderFailure(
          "unsafe-configuration",
          "Claude launch restrictions were not verified.",
        );
      return {
        provider: "claude",
        status: "available",
        account: inspected.account,
        models: inspected.models,
        capabilities: { chat: true, tools: false, nativeResume: false },
      };
    } catch (error) {
      const failure = safeFailure(error);
      return {
        provider: "claude",
        status:
          failure.code === "auth-required"
            ? "auth-required"
            : failure.code === "unavailable"
              ? "unavailable"
              : "blocked",
        models: [],
        reason: failure.message,
        capabilities: { chat: false, tools: false, nativeResume: false },
      };
    } finally {
      gate.resolve();
      if (session) await session.stop();
    }
  }

  function start(input: ProviderRunInput): ProviderRunHandle {
    const selection = { ...input.selection };
    const prompt = input.prompt;
    const runId = input.runId;
    const ready = deferred<ProviderAttestation>();
    void ready.promise.catch(() => {});
    const completion = deferred<ProviderTerminal>();
    const permit = deferred<boolean>();
    const finishInput = deferred<void>();
    const stoppedSignal = deferred<void>();
    let session: Session | undefined;
    let terminal: ProviderTerminal | undefined;
    let reason: "cancel" | ProviderFailure | undefined;
    let released = false;
    let initialized = false;
    let text = "";
    let nativeSessionId: string | undefined;
    let usage: ProviderUsage | undefined;
    let attestation: ProviderAttestation | undefined;
    let result: Extract<SDKMessage, { type: "result" }> | undefined;
    const parts = new Map<string, string>();
    let currentMessage = "";
    let stopping: Promise<void> | undefined;
    const events = eventBuffer(() => {
      if (!terminal) void cancel();
    });
    const requestStop = () => {
      if (stopping) return stopping;
      permit.resolve(false);
      stopping = (async () => {
        if (session && released) {
          try {
            await deadline(session.query.interrupt(), 1200);
          } catch {
            /* Confirm exit even if interrupt was unavailable. */
          }
        }
        finishInput.resolve();
        if (session) await session.stop();
      })().finally(() => stoppedSignal.resolve());
      return stopping;
    };
    function cancel(): Promise<ProviderTerminal> {
      if (terminal) return completion.promise;
      reason ??= "cancel";
      void requestStop();
      return completion.promise;
    }
    const timer = setTimeout(() => {
      if (!terminal) {
        reason ??= new ProviderFailure(
          "timeout",
          "Claude exceeded this run's time limit.",
        );
        void requestStop();
      }
    }, timeoutMs);
    async function* messages(): AsyncGenerator<SDKUserMessage> {
      if (await permit.promise) {
        yield {
          type: "user",
          message: { role: "user", content: prompt },
          parent_tool_use_id: null,
          session_id: "",
          uuid: runId as `${string}-${string}-${string}-${string}-${string}`,
        };
        await finishInput.promise;
      }
    }
    function publishText() {
      const nextText = [...parts.values()].join("\n\n");
      if (nextText.length > MAX_PROVIDER_TEXT_LENGTH)
        throw new ProviderFailure(
          "quota-exceeded",
          "Claude exceeded this run's response-size limit.",
        );
      text = nextText;
      events.push({ kind: "text", runId, text });
    }
    function requireInit() {
      if (!initialized)
        throw new ProviderFailure(
          "unsafe-configuration",
          "Claude responded before its restricted turn was verified.",
        );
    }
    function verifyModel(model: string) {
      if (model !== selection.modelId)
        throw new ProviderFailure(
          "model-unavailable",
          "Claude changed the selected model.",
        );
    }
    function accept(message: SDKMessage): boolean {
      if (message.type === "system" && message.subtype === "init") {
        verifyModel(message.model);
        if (
          message.tools.length ||
          message.mcp_servers.length ||
          message.plugins.length ||
          message.skills.length ||
          message.permissionMode !== "dontAsk" ||
          message.apiKeySource !== "none"
        ) {
          throw new ProviderFailure(
            "unsafe-configuration",
            "Claude enabled an unexpected tool, connector or authentication source.",
          );
        }
        nativeSessionId = message.session_id;
        if (!initialized) {
          initialized = true;
          events.push({
            kind: "initialized",
            runId,
            nativeSessionId,
            attestation: { ...attestation!, toolsProof: "sdk-turn-init" },
          });
        }
      } else if (message.type === "rate_limit_event") {
        const info = message.rate_limit_info;
        if (
          info.status === "rejected" ||
          info.isUsingOverage ||
          info.overageInUse
        )
          throw new ProviderFailure(
            "quota-exceeded",
            "Claude subscription usage is unavailable; no paid fallback was used.",
          );
        usage = {
          ...usage,
          limit: {
            ...usage?.limit,
            status: info.status,
            ...(info.utilization !== undefined
              ? { utilization: info.utilization }
              : {}),
            ...(info.resetsAt !== undefined ? { resetsAt: info.resetsAt } : {}),
          },
        };
        events.push({ kind: "usage", runId, usage });
      } else if (message.type === "stream_event") {
        requireInit();
        if (message.parent_tool_use_id)
          throw new ProviderFailure(
            "unsafe-configuration",
            "Unexpected Claude subagent activity.",
          );
        const event = message.event;
        if (event.type === "message_start") {
          verifyModel(event.message.model);
          currentMessage = event.message.id;
          if (!parts.has(currentMessage)) parts.set(currentMessage, "");
          usage = { ...usage, ...normalUsage(event.message.usage) };
        } else if (event.type === "content_block_start") {
          if (
            event.content_block.type === "tool_use" ||
            event.content_block.type === "server_tool_use"
          )
            throw new ProviderFailure(
              "unsafe-configuration",
              "Claude attempted an unavailable tool.",
            );
          if (event.content_block.type === "text" && event.content_block.text) {
            parts.set(
              currentMessage,
              (parts.get(currentMessage) ?? "") + event.content_block.text,
            );
            publishText();
          }
        } else if (
          event.type === "content_block_delta" &&
          event.delta.type === "text_delta"
        ) {
          parts.set(
            currentMessage,
            (parts.get(currentMessage) ?? "") + event.delta.text,
          );
          publishText();
        } else if (event.type === "message_delta") {
          usage = { ...usage, ...normalUsage(event.usage) };
          events.push({ kind: "usage", runId, usage });
        }
      } else if (message.type === "assistant") {
        requireInit();
        if (message.error)
          throw new ProviderFailure(
            message.error === "authentication_failed"
              ? "auth-required"
              : message.error === "rate_limit" ||
                  message.error === "billing_error"
                ? "quota-exceeded"
                : "internal",
            "Claude could not complete its response.",
          );
        verifyModel(message.message.model);
        if (
          message.parent_tool_use_id ||
          message.message.content.some(
            (block) =>
              block.type === "tool_use" || block.type === "server_tool_use",
          )
        )
          throw new ProviderFailure(
            "unsafe-configuration",
            "Claude attempted an unavailable tool or subagent.",
          );
        parts.set(
          message.message.id,
          message.message.content
            .filter((block) => block.type === "text")
            .map((block) => block.text)
            .join(""),
        );
        publishText();
      } else if (message.type === "result") {
        requireInit();
        result = message;
        nativeSessionId = message.session_id;
        usage = { ...usage, ...normalUsage(message.usage) };
        if (
          message.subtype === "success" &&
          !message.is_error &&
          message.result.length > MAX_PROVIDER_TEXT_LENGTH
        )
          throw new ProviderFailure(
            "quota-exceeded",
            "Claude response exceeded the size limit.",
          );
        if (
          message.subtype === "success" &&
          !message.is_error &&
          !text &&
          message.result
        ) {
          text = message.result;
          events.push({ kind: "text", runId, text });
        }
        return true;
      }
      return false;
    }
    void (async () => {
      let failure: ProviderFailure | undefined;
      let stopped = true;
      try {
        if (reason)
          throw new ProviderFailure(
            "unavailable",
            "Claude run stopped before starting.",
          );
        if (
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
            runId,
          ) ||
          !prompt ||
          prompt.length > 131072 ||
          selection.provider !== "claude"
        )
          throw new ProviderFailure(
            "unsafe-configuration",
            "The Claude request is invalid or too large.",
          );
        session = openSession(selection.modelId, messages());
        const inspected = await deadline(
          Promise.race([
            inspectSession(session.query, selection),
            stoppedSignal.promise.then(() => {
              throw new ProviderFailure(
                "unavailable",
                "Claude run stopped before initialization.",
              );
            }),
          ]),
          20000,
        );
        if (!session.spawnVerified)
          throw new ProviderFailure(
            "unsafe-configuration",
            "Claude launch restrictions were not verified.",
          );
        if (reason)
          throw new ProviderFailure(
            "unavailable",
            "Claude run stopped before starting.",
          );
        attestation = {
          selection,
          account: inspected.account,
          tools: [],
          mcpServers: [],
          toolsProof: "sdk-option-and-spawn-flags",
        };
        usage = inspected.usage;
        ready.resolve(attestation);
        released = true;
        permit.resolve(true);
        for (;;) {
          const next = await Promise.race([
            session.query.next(),
            stoppedSignal.promise.then(() => ({
              done: true as const,
              value: undefined,
            })),
          ]);
          if (next.done || accept(next.value)) break;
        }
        if (!result && !reason)
          throw new ProviderFailure(
            "unavailable",
            "Claude stopped without a completion receipt.",
          );
      } catch (error) {
        failure = safeFailure(error);
      } finally {
        clearTimeout(timer);
        permit.resolve(false);
        finishInput.resolve();
        if (session) stopped = await session.stop();
        let status: ProviderTerminal["status"] = "failed";
        let receipt: ProviderTerminal["receipt"] = released
          ? "process-exit"
          : "not-started";
        const interrupted =
          result &&
          (result.terminal_reason === "aborted_streaming" ||
            result.terminal_reason === "aborted_tools" ||
            result.stop_reason === "interrupt");
        if (
          result &&
          result.subtype === "success" &&
          !result.is_error &&
          !interrupted &&
          !failure
        ) {
          status = "completed";
          receipt = "sdk-result";
        } else if (reason === "cancel" && stopped) {
          status = "cancelled";
          receipt = released ? "process-exit" : "not-started";
        } else if (result) {
          receipt = "sdk-result";
          failure ??= new ProviderFailure(
            "internal",
            "Claude did not complete this response.",
          );
        }
        if (reason instanceof ProviderFailure) failure = reason;
        if (!stopped) {
          status = "failed";
          receipt = "unknown";
          failure = new ProviderFailure(
            "internal",
            "Claude could not be confirmed stopped. Restart the Vesper host before another run.",
          );
        }
        if (!attestation)
          ready.reject(
            failure ??
              new ProviderFailure(
                "unavailable",
                "Claude run was cancelled before initialization.",
              ),
          );
        terminal = {
          kind: "terminal",
          runId,
          selection,
          status,
          text,
          receipt,
          ...(nativeSessionId ? { nativeSessionId } : {}),
          ...(usage ? { usage } : {}),
          ...(status === "failed"
            ? {
                error: {
                  code: failure?.code ?? "internal",
                  message:
                    failure?.message ??
                    "Claude did not complete this response.",
                },
              }
            : {}),
        };
        events.push(terminal);
        events.end();
        completion.resolve(terminal);
      }
    })();
    return {
      ready: ready.promise,
      events: events.events,
      completion: completion.promise,
      cancel,
      close: async () => {
        if (!terminal) await cancel();
        if (session) await session.stop();
      },
    };
  }
  return {
    discover() {
      if (!discovery)
        discovery = discoverNow().finally(() => {
          discovery = undefined;
        });
      return discovery;
    },
    start,
  };
}

function normalUsage(value: {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}): ProviderUsage {
  const result: ProviderUsage = {};
  for (const [source, destination] of [
    ["input_tokens", "inputTokens"],
    ["output_tokens", "outputTokens"],
    ["cache_read_input_tokens", "cacheReadTokens"],
    ["cache_creation_input_tokens", "cacheWriteTokens"],
  ] as const) {
    const count = value[source];
    if (typeof count === "number" && Number.isFinite(count) && count >= 0)
      result[destination] = count;
  }
  return result;
}

type QuotaWindow = { utilization: number | null; resets_at: string | null };

const fail = (code: ProviderFailureCode, message: string): never => {
  throw new ProviderFailure(code, message);
};

const isEmpty = (value: unknown, name: string, required = true): void => {
  if (value === undefined && !required) return;
  if (!Array.isArray(value) || value.length !== 0)
    fail("unsafe-configuration", `Claude session exposes ${name}`);
};

const boundLabel = (value: unknown, fallback: string): string => {
  const text =
    typeof value === "string"
      ? value.replace(/[\u0000-\u001f\u007f]/g, " ").trim()
      : "";
  return (text || fallback).slice(0, 80);
};

const checkWindow = (
  window: QuotaWindow | null | undefined,
  name: string,
  required: boolean,
): { util: number; resetsAt?: number } | undefined => {
  if (!window)
    return required
      ? fail("quota-exceeded", `Claude ${name} limit is unavailable`)
      : undefined;
  const util = window.utilization;
  if (
    typeof util !== "number" ||
    !Number.isFinite(util) ||
    util < 0 ||
    util > 100
  )
    fail("quota-exceeded", `Claude ${name} limit is unreadable`);
  if (util! >= 100) fail("quota-exceeded", `Claude ${name} limit is exhausted`);
  const ms = window.resets_at === null ? NaN : Date.parse(window.resets_at);
  return {
    util: util!,
    resetsAt: Number.isFinite(ms) ? Math.floor(ms / 1000) : undefined,
  };
};

async function inspectSession(
  session: Query,
  selected?: ProviderSelection,
): Promise<{
  account: ProviderAccount;
  models: ProviderModel[];
  modelId: string;
  usage: ProviderUsage;
}> {
  const [init, info, context, mcp, quota] = await Promise.all([
    session.initializationResult(),
    session.accountInfo(),
    session.getContextUsage({ detail: "summary" }),
    session.mcpServerStatus(),
    session.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({
      skipBehaviors: true,
    }),
  ]);

  const email =
    typeof info?.email === "string" ? info.email.trim().toLowerCase() : "";
  if (info?.apiProvider !== "firstParty" || !email || !info.subscriptionType) {
    fail("auth-required", "Claude subscription sign-in is required");
  }
  const digest = createHash("sha256")
    .update(JSON.stringify(["firstParty", email, info.organization ?? ""]))
    .digest("hex");
  const id = `claude:${digest}`;
  const account: ProviderAccount = {
    id,
    label: boundLabel(email, "Claude account"),
  };
  if (
    selected &&
    (selected.provider !== "claude" || selected.accountId !== id)
  ) {
    fail("account-changed", "Claude account differs from the selected account");
  }

  if (init?.fast_mode_state !== "off")
    fail("unsafe-configuration", "Claude fast mode must be off");
  isEmpty(mcp, "MCP servers");
  isEmpty(context?.mcpTools, "MCP tools");
  isEmpty(context?.memoryFiles, "memory files");
  isEmpty(context?.agents, "agents");
  isEmpty(context?.systemTools, "system tools", false);
  isEmpty(context?.deferredBuiltinTools, "deferred tools", false);
  if (context.skills && context.skills.includedSkills !== 0)
    fail("unsafe-configuration", "Claude session exposes skills");

  const byId = new Map<string, { model: ProviderModel; named: boolean }>();
  for (const row of Array.isArray(init?.models) ? init.models : []) {
    const modelId =
      typeof row?.resolvedModel === "string" ? row.resolvedModel.trim() : "";
    if (!modelId || modelId.length > 128) continue;
    const named = row.value !== "default";
    const existing = byId.get(modelId);
    if (existing && (existing.named || !named)) continue;
    byId.set(modelId, {
      model: { id: modelId, label: boundLabel(row.displayName, modelId) },
      named,
    });
  }
  const models = [...byId.values()].map((entry) => entry.model);

  const contextModel = typeof context?.model === "string" ? context.model : "";
  if (!contextModel || !byId.has(contextModel))
    fail("model-unavailable", "Claude session model is not in the catalogue");
  if (
    selected &&
    (!byId.has(selected.modelId) || contextModel !== selected.modelId)
  ) {
    fail("model-unavailable", "Selected Claude model is unavailable");
  }

  const limits = quota?.rate_limits;
  if (
    !quota.rate_limits_available ||
    typeof quota.subscription_type !== "string" ||
    !quota.subscription_type ||
    !limits
  )
    fail("quota-exceeded", "Claude plan limits are unavailable");
  if (limits!.extra_usage?.is_enabled !== false)
    fail("unsafe-configuration", "Claude extra usage must be disabled");
  const windows = [
    checkWindow(limits!.five_hour, "five-hour", true),
    checkWindow(limits!.seven_day, "weekly", true),
    checkWindow(limits!.seven_day_oauth_apps, "weekly apps", false),
    checkWindow(limits!.seven_day_opus, "weekly Opus", false),
    checkWindow(limits!.seven_day_sonnet, "weekly Sonnet", false),
  ];
  if (
    limits!.model_scoped !== undefined &&
    !Array.isArray(limits!.model_scoped)
  ) {
    fail("quota-exceeded", "Claude model limits are unreadable");
  }
  for (const scoped of limits!.model_scoped ?? []) {
    windows.push(
      checkWindow(
        scoped,
        `${boundLabel(scoped?.display_name, "model")} model`,
        true,
      ),
    );
  }
  const worst = windows.reduce<{ util: number; resetsAt?: number } | undefined>(
    (max, w) => (w && (!max || w.util > max.util) ? w : max),
    undefined,
  )!;

  return {
    account: {
      ...account,
      plan: boundLabel(info.subscriptionType, "unknown"),
    },
    models,
    modelId: contextModel,
    usage: {
      limit: {
        status: worst.util >= 90 ? "allowed_warning" : "allowed",
        utilization: worst.util / 100,
        ...(worst.resetsAt !== undefined ? { resetsAt: worst.resetsAt } : {}),
      },
    },
  };
}
