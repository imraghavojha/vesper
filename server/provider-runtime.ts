import { TRPCError } from "@trpc/server";
import type { Store } from "./store.js";
import type {
  ChatProvider,
  ProviderRunHandle,
  ProviderTerminal,
} from "./providers/contract.js";
export function createProviderRuntime(store: Store, adapter: ChatProvider) {
  const active = new Map<string, ProviderRunHandle>();
  const jobs = new Map<string, Promise<void>>();
  const initializedRuns = new Set<string>();
  store.interruptProviderRuns();
  async function execute(id: string) {
    if (!store.claimProviderRun(id)) return;
    const run = store.providerRun(id);
    let handle: ProviderRunHandle | undefined;
    let text = run.text;
    let queuedText: string | null = null;
    let flushTimer: ReturnType<typeof setTimeout> | undefined;
    let terminal = false;
    let initialized = false;
    const validateTerminal = (result: ProviderTerminal) => {
      if (
        result.runId !== id ||
        ((result.status === "completed" || result.text.length > 0) &&
          !initialized)
      )
        throw new Error(
          "Provider terminal identity or initialization mismatch.",
        );
    };
    const flush = () => {
      clearTimeout(flushTimer);
      flushTimer = undefined;
      if (queuedText !== null) {
        store.updateProviderText(id, queuedText);
        queuedText = null;
      }
    };
    try {
      handle = adapter.start({
        runId: id,
        selection: run.selection,
        prompt: store.providerPrompt(id),
      });
      active.set(id, handle);
      void handle.ready.catch(() => {});
      for await (const event of handle.events) {
        if (event.runId !== id) throw new Error("Provider event run mismatch.");
        if (event.kind === "initialized") {
          const proof = event.attestation;
          if (
            proof.selection.accountId !== run.selection.accountId ||
            proof.selection.modelId !== run.selection.modelId ||
            proof.selection.provider !== run.selection.provider ||
            proof.tools.length ||
            proof.mcpServers.length ||
            proof.toolsProof !== "sdk-turn-init"
          )
            throw new Error("Provider initialization mismatch.");
          store.initializeProviderRun(id, event.nativeSessionId);
          initialized = true;
          initializedRuns.add(id);
        } else if (event.kind === "text") {
          if (!initialized)
            throw new Error("Provider text arrived before initialization.");
          text = event.text;
          queuedText = text;
          if (!flushTimer)
            flushTimer = setTimeout(() => {
              try {
                flush();
              } catch {
                void handle?.cancel().catch(() => {});
              }
            }, 100);
        } else if (event.kind === "terminal") {
          validateTerminal(event);
          flush();
          store.finishProviderRun(id, event);
          terminal = true;
        }
      }
      if (!terminal) {
        const result = await handle.completion;
        validateTerminal(result);
        flush();
        store.finishProviderRun(id, result);
        terminal = true;
      }
    } catch {
      let stopped: ProviderTerminal | undefined;
      try {
        stopped = await handle?.cancel();
        if (stopped) validateTerminal(stopped);
      } catch {
        stopped = undefined;
        /* The run stays visibly failed. */
      }
      const failed: ProviderTerminal = {
        kind: "terminal",
        runId: id,
        selection: run.selection,
        status: "failed",
        text: text.slice(0, 50000),
        error: {
          code: "internal",
          message:
            handle && !stopped
              ? "Provider completion could not be confirmed. This reply was not automatically retried."
              : "The provider connection failed. This reply was not automatically retried.",
        },
        receipt: stopped?.receipt ?? (handle ? "unknown" : "not-started"),
      };
      store.finishProviderRun(id, failed);
    } finally {
      clearTimeout(flushTimer);
      active.delete(id);
      initializedRuns.delete(id);
      try {
        await handle?.close();
      } catch {
        /* Terminal state already records the outcome. */
      }
    }
  }
  return {
    async discover() {
      return adapter.discover();
    },
    start(id: string) {
      if (jobs.has(id)) return;
      const job = execute(id).finally(() => jobs.delete(id));
      jobs.set(id, job);
      void job.catch(() => {}); // Storage failure must not take down the API.
    },
    async cancel(id: string) {
      const current = store.cancelProviderRun(id);
      if (current.status !== "cancelling") return current;
      const handle = active.get(id);
      if (!handle)
        throw new TRPCError({
          code: "CONFLICT",
          message:
            "The host is recovering this reply. Refresh its status before trying again.",
        });
      const receipt = await handle.cancel();
      const saved = store.providerRun(id);
      if (receipt.runId !== id)
        throw new Error("Provider cancellation run mismatch.");
      if (
        !["queued", "initializing", "running", "cancelling"].includes(
          saved.status,
        )
      )
        return saved;
      if (
        (receipt.status === "completed" || receipt.text.length > 0) &&
        !initializedRuns.has(id) &&
        saved.status !== "completed"
      )
        throw new Error("Provider cancellation run mismatch.");
      store.finishProviderRun(id, receipt);
      return store.providerRun(id);
    },
    async close() {
      await Promise.allSettled(
        [...active.values()].map((handle) => handle.cancel()),
      );
      await Promise.allSettled([...jobs.values()]);
    },
  };
}
export type ProviderRuntime = ReturnType<typeof createProviderRuntime>;
