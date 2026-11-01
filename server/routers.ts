// ── AGENT-OWNED: tRPC API surface ────────────────────────────────────────────
// Thin procedures: validate with zod, delegate to server/db.ts. Auth comes from
// _core — never reimplemented here.
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, publicProcedure, protectedProcedure } from "./_core/trpc";
import { authProvider, registerLocalUser, AuthError, EmailTakenError } from "./_core/auth";
import {
  storageCommit,
  storageDeleteOwned,
  storageListByOwner,
  storagePutUrl,
  StorageError,
} from "./_core/storage";
import * as q from "./db";
import { CATEGORY_SLUGS, MAX_DURATION_MINUTES } from "../shared/activities";
import type { SyncActivity, SyncGoal } from "../shared/sync";

const authRouter = router({
  me: publicProcedure.query(({ ctx }) => ctx.user),

  signup: publicProcedure
    .input(z.object({ email: z.email(), password: z.string().min(8), name: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      try {
        const user = await registerLocalUser(input.email, input.password, input.name);
        await authProvider().login(ctx.c, input.email, input.password);
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
        return await authProvider().login(ctx.c, input.email, input.password);
      } catch (e) {
        if (e instanceof AuthError)
          throw new TRPCError({ code: "UNAUTHORIZED", message: e.message });
        throw e;
      }
    }),

  logout: publicProcedure.mutation(async ({ ctx }) => {
    await authProvider().logout(ctx.c);
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
  categories: protectedProcedure.query(() => q.listCategories()),

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
    .query(({ ctx, input }) => q.listActivities(ctx.user.id, input ?? {})),

  get: protectedProcedure.input(z.object({ id: z.uuid() })).query(async ({ ctx, input }) => {
    const row = await q.getActivity(input.id, ctx.user.id);
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "That activity no longer exists." });
    return row;
  }),

  create: protectedProcedure.input(activityInput).mutation(({ ctx, input }) =>
    q.createActivity(ctx.user.id, input),
  ),

  update: protectedProcedure
    .input(activityInput.extend({ id: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { id, ...rest } = input;
      const row = await q.updateActivity(id, ctx.user.id, rest);
      if (!row)
        throw new TRPCError({ code: "NOT_FOUND", message: "That activity no longer exists." });
      return row;
    }),

  remove: protectedProcedure.input(z.object({ id: z.uuid() })).mutation(async ({ ctx, input }) => {
    const res = await q.deleteActivity(input.id, ctx.user.id);
    if (!res.ok)
      throw new TRPCError({ code: "NOT_FOUND", message: "That activity no longer exists." });
    return res;
  }),

  /** Idempotent: fills a brand-new account with sample entries. */
  seedSample: protectedProcedure.mutation(({ ctx }) => q.seedSampleDataIfEmpty(ctx.user.id)),
});

export function sanitizeBasename(name: string): string {
  const last = name.split(/[/\\]/).pop() ?? "";
  const dot = last.lastIndexOf(".");
  const rawStem = dot > 0 ? last.slice(0, dot) : last;
  const rawExt = dot > 0 ? last.slice(dot + 1) : "";
  const stem = rawStem.replace(/[^A-Za-z0-9._-]/g, "").replace(/^\.+/, "") || "upload";
  const ext = rawExt.replace(/[^A-Za-z0-9]/g, "").slice(0, 10);
  return ext ? `${stem}.${ext}` : stem;
}

const filesRouter = router({
  uploadUrl: protectedProcedure
    .input(z.object({ name: z.string().min(1), contentType: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const key = `${crypto.randomUUID()}-${sanitizeBasename(input.name)}`;
      try {
        const { uploadUrl, publicPath } = await storagePutUrl(key, input.contentType, {
          ownerId: ctx.user.id,
        });
        return { key, uploadUrl, publicPath };
      } catch (e) {
        if (e instanceof StorageError && e.code === "failed") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "upload rejected by storage — check contentType is on the platform's whitelist " +
              "(see AGENT.md: png/jpeg/gif/webp/avif, pdf, text/plain, csv, json, mpeg/wav audio, mp4/webm video)",
          });
        }
        throw e;
      }
    }),

  commit: protectedProcedure
    .input(z.object({ key: z.string().min(1), name: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await storageCommit(input.key, { ownerId: ctx.user.id, name: input.name });
      } catch (e) {
        if (e instanceof StorageError && e.code === "not_found") {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "upload not found — did the PUT succeed?",
          });
        }
        if (e instanceof StorageError && e.code === "forbidden") {
          throw new TRPCError({ code: "FORBIDDEN", message: "that key belongs to another user" });
        }
        throw e;
      }
    }),

  list: protectedProcedure.query(({ ctx }) => storageListByOwner(ctx.user.id)),

  remove: protectedProcedure
    .input(z.object({ key: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await storageDeleteOwned(ctx.user.id, input.key);
      } catch (e) {
        if (e instanceof StorageError && e.code === "forbidden") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "malformed key" });
        }
        throw e;
      }
    }),
});

// ── Offline-first sync ──────────────────────────────────────────────────
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
  pull: protectedProcedure.query(({ ctx }) => q.syncPull(ctx.user.id)),

  push: protectedProcedure
    .input(
      z.object({
        activities: z.array(syncActivity).max(5000),
        goals: z.array(syncGoal).max(200),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [activities, goals] = await Promise.all([
        q.syncPushActivities(ctx.user.id, input.activities as SyncActivity[]),
        q.syncPushGoals(ctx.user.id, input.goals as SyncGoal[]),
      ]);
      return { activities, goals };
    }),
});

export const appRouter = router({
  auth: authRouter,
  activities: activitiesRouter,
  files: filesRouter,
  sync: syncRouter,
});

export type AppRouter = typeof appRouter;
