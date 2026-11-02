// ── AGENT-OWNED: tRPC API surface ────────────────────────────────────────────
// Thin procedures: validate with zod, delegate to server/db.ts. Auth comes from
// _core — never reimplemented here.
//
// The API surface is unchanged from the Postgres version, so the client needed
// no changes beyond the base URL. `files` (platform object storage) is gone:
// it was a Node-only platform integration with no D1 equivalent, and this app
// never used it.
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, publicProcedure, protectedProcedure } from "./_core/trpc";
import {
  authProvider,
  registerLocalUser,
  AuthError,
  EmailTakenError,
} from "./_core/auth";
import * as q from "./db";
import { CATEGORY_SLUGS, MAX_DURATION_MINUTES } from "../shared/activities";
import type { SyncActivity, SyncGoal } from "../shared/sync";

const authRouter = router({
  me: publicProcedure.query(({ ctx }) => ctx.user),

  signup: publicProcedure
    .input(z.object({ email: z.email(), password: z.string().min(8), name: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      try {
        const user = await registerLocalUser(
          ctx.appEnv,
          ctx.db,
          input.email,
          input.password,
          input.name,
        );
        await authProvider(ctx.appEnv).login(ctx.c, ctx.appEnv, ctx.db, input.email, input.password);
        return user;
      } catch (e: unknown) {
        if (e instanceof EmailTakenError)
          throw new TRPCError({ code: "CONFLICT", message: e.message });
        throw e;
      }
    }),

  login: publicProcedure
    .input(z.object({ email: z.email(), password: z.string() }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await authProvider(ctx.appEnv).login(
          ctx.c,
          ctx.appEnv,
          ctx.db,
          input.email,
          input.password,
        );
      } catch (e) {
        if (e instanceof AuthError)
          throw new TRPCError({ code: "UNAUTHORIZED", message: e.message });
        throw e;
      }
    }),

  logout: publicProcedure.mutation(async ({ ctx }) => {
    await authProvider(ctx.appEnv).logout(ctx.c, ctx.appEnv, ctx.db);
    return { ok: true };
  }),
});

const dayKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a YYYY-MM-DD date");

const activityInput = z.object({
  category: z.enum(CATEGORY_SLUGS),
  title: z.string().trim().min(1, "Give the activity a name").max(120),
  durationMinutes: z
    .number()
    .int("Duration must be whole minutes")
    .min(1, "Duration must be at least 1 minute")
    .max(MAX_DURATION_MINUTES, "A single entry cannot exceed 24 hours"),
  activityDate: dayKey,
  notes: z.string().max(2000).optional().nullable(),
});

const activitiesRouter = router({
  categories: protectedProcedure.query(({ ctx }) => q.listCategories(ctx.db)),

  list: protectedProcedure
    .input(
      z
        .object({
          from: dayKey.optional(),
          to: dayKey.optional(),
          category: z.enum(CATEGORY_SLUGS).optional(),
          limit: z.number().int().min(1).max(2000).optional(),
        })
        .optional(),
    )
    .query(({ ctx, input }) => q.listActivities(ctx.db, ctx.user.id, input ?? {})),

  get: protectedProcedure.input(z.object({ id: z.uuid() })).query(async ({ ctx, input }) => {
    const row = await q.getActivity(ctx.db, input.id, ctx.user.id);
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "That activity no longer exists." });
    return row;
  }),

  create: protectedProcedure.input(activityInput).mutation(({ ctx, input }) =>
    q.createActivity(ctx.db, ctx.user.id, input),
  ),

  update: protectedProcedure
    .input(activityInput.extend({ id: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { id, ...rest } = input;
      const row = await q.updateActivity(ctx.db, id, ctx.user.id, rest);
      if (!row)
        throw new TRPCError({ code: "NOT_FOUND", message: "That activity no longer exists." });
      return row;
    }),

  remove: protectedProcedure.input(z.object({ id: z.uuid() })).mutation(async ({ ctx, input }) => {
    const res = await q.deleteActivity(ctx.db, input.id, ctx.user.id);
    if (!res.ok)
      throw new TRPCError({ code: "NOT_FOUND", message: "That activity no longer exists." });
    return res;
  }),

  /** Idempotent: fills a brand-new account with sample entries. */
  seedSample: protectedProcedure.mutation(({ ctx }) =>
    q.seedSampleDataIfEmpty(ctx.db, ctx.user.id),
  ),
});

// ── Offline-first sync ───────────────────────────────────────────────────────
// The client keeps the whole store in IndexedDB and reconciles through these
// two procedures: `pull` downloads everything, `push` uploads local changes.
// Server-side merges are last-write-wins on `updated_at` (see server/db.ts).

const syncActivity = z.object({
  id: z.uuid(),
  category: z.enum(CATEGORY_SLUGS),
  title: z.string().trim().min(1).max(120),
  durationMinutes: z.number().int().min(1).max(MAX_DURATION_MINUTES),
  activityDate: dayKey,
  startTime: z.string().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  intensity: z.string().nullable().optional(),
  location: z.string().nullable().optional(),
  tags: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  deletedAt: z.string().nullable(),
});

const syncGoal = z.object({
  id: z.uuid(),
  category: z.enum(CATEGORY_SLUGS),
  period: z.enum(["daily", "weekly"]),
  targetMinutes: z.number().int().min(5).max(10080),
  createdAt: z.string(),
  updatedAt: z.string(),
  deletedAt: z.string().nullable(),
});

const syncRouter = router({
  pull: protectedProcedure.query(({ ctx }) => q.syncPull(ctx.db, ctx.user.id)),

  push: protectedProcedure
    .input(
      z.object({
        activities: z.array(syncActivity).max(5000),
        goals: z.array(syncGoal).max(200),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [activities, goals] = await Promise.all([
        q.syncPushActivities(ctx.db, ctx.user.id, input.activities as SyncActivity[]),
        q.syncPushGoals(ctx.db, ctx.user.id, input.goals as SyncGoal[]),
      ]);
      return { activities, goals };
    }),
});

export const appRouter = router({
  auth: authRouter,
  activities: activitiesRouter,
  sync: syncRouter,
});

export type AppRouter = typeof appRouter;
