import { initTRPC, TRPCError } from "@trpc/server";
import { z } from "zod";
import type { Store, Device } from "./store.js";
import type { ProviderRuntime } from "./provider-runtime.js";
import { VaultError } from "./vault/service.js";
import { VaultCryptoError } from "./vault/crypto.js";
import { MAX_VAULT_SECRET_BYTES } from "../shared/vault.js";
export type Context = {
  store: Store;
  device: Device | null;
  providers: ProviderRuntime;
};
const t = initTRPC.context<Context>().create({
  errorFormatter({ shape, path, error }) {
    return {
      ...shape,
      ...(path?.startsWith("vault") && error.cause instanceof z.ZodError
        ? { message: "Invalid secure-store input." }
        : {}),
      data: { ...shape.data, stack: undefined },
    };
  },
});
const authenticated = t.procedure.use(({ ctx, next }) => {
  if (!ctx.device)
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message:
        "This device is disconnected or its access was revoked. Pair it again.",
    });
  return next({ ctx: { ...ctx, device: ctx.device } });
});
const selection = z
  .object({
    provider: z.literal("claude"),
    accountId: z.string().min(1).max(128),
    modelId: z.string().min(1).max(128),
  })
  .strict();
const recoveryInput = z
  .object({
    recoveryPassphrase: z.string().min(12).max(1024),
  })
  .strict();
const entryVersion = z
  .object({
    id: z.string().uuid(),
    expectedRevision: z.number().int().positive(),
  })
  .strict();
function vaultOperation<T>(
  ctx: Context & { device: Device },
  operation: () => T,
): T {
  // Context authentication may precede input parsing. Recheck revocation at use.
  ctx.store.assertDeviceActive(ctx.device.id);
  try {
    return operation();
  } catch (error) {
    if (error instanceof VaultError) {
      const code =
        error.code === "CONFLICT"
          ? "CONFLICT"
          : error.code === "NOT_FOUND"
            ? "NOT_FOUND"
            : error.code === "INVALID_INPUT"
              ? "BAD_REQUEST"
              : error.code === "REVOKED" || error.code === "SCOPE_MISMATCH"
                ? "FORBIDDEN"
                : "PRECONDITION_FAILED";
      throw new TRPCError({ code, message: error.message });
    }
    if (error instanceof VaultCryptoError)
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Check the recovery passphrase and try again.",
      });
    // Storage/crypto diagnostics and supplied secrets never enter an RPC error.
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message:
        "The vault operation could not be confirmed. Refresh its metadata before retrying.",
    });
  }
}
export const appRouter = t.router({
  vaultSnapshot: authenticated.query(({ ctx }) =>
    vaultOperation(ctx, () => ctx.store.vault.snapshot()),
  ),
  vaultInitialize: authenticated
    .input(recoveryInput)
    .mutation(({ ctx, input }) =>
      vaultOperation(ctx, () =>
        ctx.store.vault.initialize(input.recoveryPassphrase),
      ),
    ),
  vaultPut: authenticated
    .input(
      z
        .object({
          id: z.string().uuid(),
          expectedRevision: z.number().int().min(0),
          kind: z.enum(["password", "token", "oauth"]),
          label: z.string().trim().min(1).max(80),
          accountId: z.string().min(1).max(256),
          origins: z.array(z.string().min(1).max(2048)).min(1).max(8),
          secret: z
            .string()
            .min(1)
            .max(MAX_VAULT_SECRET_BYTES)
            .refine(
              (value) =>
                Buffer.byteLength(value, "utf8") <= MAX_VAULT_SECRET_BYTES,
              "Secret is too long.",
            )
            .optional(),
        })
        .strict(),
    )
    .mutation(({ ctx, input }) =>
      vaultOperation(ctx, () => ctx.store.vault.put(input)),
    ),
  vaultRevoke: authenticated
    .input(entryVersion)
    .mutation(({ ctx, input }) =>
      vaultOperation(ctx, () => ctx.store.vault.revoke(input)),
    ),
  vaultRemove: authenticated
    .input(entryVersion)
    .mutation(({ ctx, input }) =>
      vaultOperation(ctx, () => ctx.store.vault.remove(input)),
    ),
  vaultLock: authenticated.mutation(({ ctx }) =>
    vaultOperation(ctx, () => ctx.store.vault.lock()),
  ),
  vaultUnlock: authenticated.mutation(({ ctx }) =>
    vaultOperation(ctx, () => ctx.store.vault.unlock()),
  ),
  vaultRecover: authenticated
    .input(recoveryInput)
    .mutation(({ ctx, input }) =>
      vaultOperation(ctx, () =>
        ctx.store.vault.recover(input.recoveryPassphrase),
      ),
    ),
  vaultRotate: authenticated
    .input(
      recoveryInput
        .extend({ expectedRevision: z.number().int().positive() })
        .strict(),
    )
    .mutation(({ ctx, input }) =>
      vaultOperation(ctx, () => ctx.store.vault.rotate(input)),
    ),
  providerAvailability: authenticated.query(({ ctx }) =>
    ctx.providers.discover(),
  ),
  bindProvider: authenticated
    .input(
      z
        .object({
          requestId: z.string().uuid(),
          conversationId: z.string().uuid(),
          selection: selection.nullable(),
          expectedRevision: z.number().int().min(0),
        })
        .strict(),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.selection) {
        const available = await ctx.providers.discover();
        if (
          available.status !== "available" ||
          available.account?.id !== input.selection.accountId ||
          !available.models.some(
            (model) => model.id === input.selection!.modelId,
          )
        )
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message:
              available.reason ??
              "Refresh the available account and model before connecting.",
          });
      }
      return ctx.store.bindProvider(ctx.device.id, input);
    }),
  askProvider: authenticated
    .input(
      z
        .object({
          requestId: z.string().uuid(),
          conversationId: z.string().uuid(),
          text: z
            .string()
            .min(1)
            .max(10000)
            .refine((value) => value.trim().length > 0),
          selection,
          bindingRevision: z.number().int().positive(),
        })
        .strict(),
    )
    .mutation(({ ctx, input }) => {
      const receipt = ctx.store.askProvider(ctx.device.id, input);
      ctx.providers.start(receipt.id);
      return receipt;
    }),
  providerRun: authenticated
    .input(z.object({ id: z.string().uuid() }))
    .query(({ ctx, input }) => ctx.store.providerRun(input.id)),
  cancelProviderRun: authenticated
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ ctx, input }) => ctx.providers.cancel(input.id)),

  syncSnapshot: authenticated
    .input(
      z.object({ conversationId: z.string().uuid().optional() }).default({}),
    )
    .query(({ ctx, input }) => ({
      workspaceId: ctx.store.identity().id,
      ...ctx.store.syncSnapshot(input.conversationId),
    })),
  changes: authenticated
    .input(
      z.object({
        after: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
        limit: z.number().int().min(1).max(200).default(100),
      }),
    )
    .query(({ ctx, input }) => ctx.store.changes(input.after, input.limit)),
  messages: authenticated
    .input(
      z.object({
        conversationId: z.string().uuid(),
        before: z.number().int().positive().optional(),
      }),
    )
    .query(({ ctx, input }) =>
      ctx.store.messagePage(input.conversationId, input.before),
    ),
  mutationReceipt: authenticated
    .input(z.object({ requestId: z.string().uuid() }))
    .query(({ ctx, input }) => ctx.store.mutationReceipt(input.requestId)),
  createConversation: authenticated
    .input(
      z
        .object({
          requestId: z.string().uuid(),
          title: z.string().trim().min(1).max(80),
        })
        .strict(),
    )
    .mutation(({ ctx, input }) =>
      ctx.store.createConversation(ctx.device.id, input),
    ),
  renameConversation: authenticated
    .input(
      z
        .object({
          requestId: z.string().uuid(),
          id: z.string().uuid(),
          title: z.string().trim().min(1).max(80),
          expectedRevision: z.number().int().positive(),
        })
        .strict(),
    )
    .mutation(({ ctx, input }) =>
      ctx.store.renameConversation(ctx.device.id, input),
    ),
  sendMessage: authenticated
    .input(
      z
        .object({
          requestId: z.string().uuid(),
          conversationId: z.string().uuid(),
          text: z
            .string()
            .min(1)
            .max(10000)
            .refine((text) => text.trim().length > 0),
        })
        .strict(),
    )
    .mutation(({ ctx, input }) => ctx.store.sendMessage(ctx.device.id, input)),
  setAppearance: authenticated
    .input(
      z
        .object({
          requestId: z.string().uuid(),
          appearance: z.enum(["system", "light", "dark"]),
          expectedRevision: z.number().int().positive(),
        })
        .strict(),
    )
    .mutation(({ ctx, input }) =>
      ctx.store.setAppearance(ctx.device.id, input),
    ),
  pair: t.procedure
    .input(
      z.object({
        code: z.string().trim().min(16).max(128),
        name: z.string().trim().min(1).max(80),
        platform: z.enum(["web", "mac", "android"]),
      }),
    )
    .mutation(({ ctx, input }) => ctx.store.pair(input)),
  workspace: authenticated.query(({ ctx }) => ctx.store.snapshot(ctx.device)),
  createPairingCode: authenticated.mutation(({ ctx }) =>
    ctx.store.createPairingCode(),
  ),
  renameWorkspace: authenticated
    .input(
      z.object({
        name: z.string().trim().min(1).max(80),
        expectedVersion: z.number().int().positive(),
      }),
    )
    .mutation(({ ctx, input }) => {
      ctx.store.rename(input.name, input.expectedVersion);
      return ctx.store.snapshot(ctx.device);
    }),
  revokeDevice: authenticated
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ ctx, input }) => {
      ctx.store.revoke(input.id);
      return { revoked: true };
    }),
});
export type AppRouter = typeof appRouter;
