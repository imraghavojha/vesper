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
