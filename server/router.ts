import { initTRPC, TRPCError } from "@trpc/server";
import { z } from "zod";
import type { Store, Device } from "./store.js";
export type Context = { store: Store; device: Device | null };
const t = initTRPC.context<Context>().create({
  errorFormatter({ shape }) {
    return { ...shape, data: { ...shape.data, stack: undefined } };
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
export const appRouter = t.router({
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
