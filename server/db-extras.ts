// ── AGENT-OWNED: reminders, timers, teams, share links ───────────────────────
// Split out of db.ts to keep each file readable. Every function here is
// owner-scoped or capability-scoped (a share token), never "any row".
import { and, asc, desc, eq, gte, inArray, isNull, lte, ne, sql } from "drizzle-orm";
import { db } from "./_core/db";
import {
  activities,
  reminders,
  shareLinks,
  teamMembers,
  teams,
  timers,
  users,
} from "../drizzle/schema";
import { daysToText, parseDays } from "../shared/reminders";
import { isTeamRole, type TeamRole } from "../shared/team";

// ── Reminders ────────────────────────────────────────────────────────────────

export interface ReminderInput {
  category?: string | null;
  title: string;
  message?: string | null;
  timeOfDay: string;
  daysOfWeek: string;
  enabled?: boolean;
}

export async function listReminders(ownerId: string) {
  return db
    .select()
    .from(reminders)
    .where(eq(reminders.ownerId, ownerId))
    .orderBy(asc(reminders.timeOfDay), asc(reminders.title));
}

function cleanReminder(input: ReminderInput) {
  return {
    category: input.category?.trim() ? input.category.trim() : null,
    title: input.title.trim(),
    message: input.message?.trim() ? input.message.trim() : null,
    timeOfDay: input.timeOfDay.trim(),
    daysOfWeek: daysToText(parseDays(input.daysOfWeek)),
    enabled: input.enabled ?? true,
  };
}

export async function createReminder(ownerId: string, input: ReminderInput) {
  const [row] = await db
    .insert(reminders)
    .values({ ownerId, ...cleanReminder(input) })
    .returning();
  return row;
}

export async function updateReminder(id: string, ownerId: string, input: ReminderInput) {
  const [row] = await db
    .update(reminders)
    .set({ ...cleanReminder(input), updatedAt: new Date() })
    .where(and(eq(reminders.id, id), eq(reminders.ownerId, ownerId)))
    .returning();
  return row ?? null;
}

export async function setReminderEnabled(id: string, ownerId: string, enabled: boolean) {
  const [row] = await db
    .update(reminders)
    .set({ enabled, updatedAt: new Date() })
    .where(and(eq(reminders.id, id), eq(reminders.ownerId, ownerId)))
    .returning();
  return row ?? null;
}

export async function deleteReminder(id: string, ownerId: string) {
  const rows = await db
    .delete(reminders)
    .where(and(eq(reminders.id, id), eq(reminders.ownerId, ownerId)))
    .returning({ id: reminders.id });
  return { ok: rows.length > 0 };
}

/**
 * Records that a reminder was shown today. Guarded on `last_fired_on` so two
 * open tabs cannot both claim the same firing — the second update matches zero
 * rows and reports `ok: false`, which the client treats as "someone else got it".
 */
export async function markReminderFired(id: string, ownerId: string, day: string) {
  const rows = await db
    .update(reminders)
    .set({ lastFiredOn: day })
    .where(
      and(
        eq(reminders.id, id),
        eq(reminders.ownerId, ownerId),
        sql`(${reminders.lastFiredOn} is null or ${reminders.lastFiredOn} <> ${day})`,
      ),
    )
    .returning({ id: reminders.id });
  return { ok: rows.length > 0 };
}

// ── Live stopwatch ───────────────────────────────────────────────────────────

export async function getRunningTimer(ownerId: string) {
  const [row] = await db.select().from(timers).where(eq(timers.ownerId, ownerId)).limit(1);
  return row ?? null;
}

/**
 * Starts a timer. One per user: the unique index on owner_id is the arbiter, so
 * a double-click cannot create two. Returns the existing timer when one is
 * already running rather than throwing — the UI just shows it.
 */
export async function startTimer(
  ownerId: string,
  input: { category: string; title: string; notes?: string | null },
) {
  const [row] = await db
    .insert(timers)
    .values({
      ownerId,
      category: input.category,
      title: input.title.trim(),
      notes: input.notes?.trim() ? input.notes.trim() : null,
    })
    .onConflictDoNothing({ target: timers.ownerId })
    .returning();
  if (row) return { timer: row, alreadyRunning: false };
  const existing = await getRunningTimer(ownerId);
  return { timer: existing, alreadyRunning: true };
}

export async function cancelTimer(ownerId: string) {
  const rows = await db
    .delete(timers)
    .where(eq(timers.ownerId, ownerId))
    .returning({ id: timers.id });
  return { ok: rows.length > 0 };
}

/**
 * Stops the timer and writes the activity in one atomic unit: the delete is
 * guarded on the timer's own id, so two concurrent stops cannot both produce an
 * entry. Zero deleted rows means somebody already stopped it.
 */
export async function stopTimer(
  ownerId: string,
  input: { durationMinutes: number; activityDate: string; startTime: string | null },
) {
  const running = await getRunningTimer(ownerId);
  if (!running) return { ok: false as const, reason: "no_timer" as const };

  const [deleted] = await db
    .delete(timers)
    .where(and(eq(timers.id, running.id), eq(timers.ownerId, ownerId)))
    .returning();
  if (!deleted) return { ok: false as const, reason: "no_timer" as const };

  const [activity] = await db
    .insert(activities)
    .values({
      ownerId,
      category: deleted.category,
      title: deleted.title,
      durationMinutes: input.durationMinutes,
      activityDate: input.activityDate,
      startTime: input.startTime,
      notes: deleted.notes,
    })
    .returning();

  return { ok: true as const, activity, timer: deleted };
}

// ── Teams ────────────────────────────────────────────────────────────────────

function inviteCode(): string {
  // 24 hex chars from a UUID: unguessable enough for a link capability.
  return crypto.randomUUID().replace(/-/g, "").slice(0, 24);
}

export async function listTeamsForUser(userId: string) {
  const memberships = await db
    .select({
      teamId: teamMembers.teamId,
      role: teamMembers.role,
      joinedAt: teamMembers.joinedAt,
      name: teams.name,
      ownerId: teams.ownerId,
      inviteCode: teams.inviteCode,
      createdAt: teams.createdAt,
    })
    .from(teamMembers)
    .innerJoin(teams, eq(teams.id, teamMembers.teamId))
    .where(eq(teamMembers.userId, userId))
    .orderBy(asc(teams.name));

  if (memberships.length === 0) return [];

  const counts = await db
    .select({ teamId: teamMembers.teamId, n: sql<number>`count(*)::int` })
    .from(teamMembers)
    .where(
      inArray(
        teamMembers.teamId,
        memberships.map((m) => m.teamId),
      ),
    )
    .groupBy(teamMembers.teamId);
  const countMap = new Map(counts.map((c) => [c.teamId, c.n]));

  return memberships.map((m) => ({
    id: m.teamId,
    name: m.name,
    ownerId: m.ownerId,
    inviteCode: m.inviteCode,
    createdAt: m.createdAt,
    role: m.role as TeamRole,
    memberCount: countMap.get(m.teamId) ?? 1,
  }));
}

export async function getTeamForUser(teamId: string, userId: string) {
  const [row] = await db
    .select({
      id: teams.id,
      name: teams.name,
      ownerId: teams.ownerId,
      inviteCode: teams.inviteCode,
      createdAt: teams.createdAt,
      role: teamMembers.role,
    })
    .from(teams)
    .innerJoin(teamMembers, and(eq(teamMembers.teamId, teams.id), eq(teamMembers.userId, userId)))
    .where(eq(teams.id, teamId))
    .limit(1);
  return row ? { ...row, role: row.role as TeamRole } : null;
}

export async function createTeam(ownerId: string, name: string) {
  const id = crypto.randomUUID();
  const code = inviteCode();
  const [team] = await db
    .insert(teams)
    .values({ id, name: name.trim(), ownerId, inviteCode: code })
    .returning();
  await db
    .insert(teamMembers)
    .values({ teamId: id, userId: ownerId, role: "owner" })
    .onConflictDoNothing();
  return team;
}

export async function listTeamMembers(teamId: string) {
  return db
    .select({
      userId: teamMembers.userId,
      role: teamMembers.role,
      joinedAt: teamMembers.joinedAt,
      name: users.name,
      email: users.email,
    })
    .from(teamMembers)
    .innerJoin(users, eq(users.id, teamMembers.userId))
    .where(eq(teamMembers.teamId, teamId))
    .orderBy(asc(teamMembers.joinedAt));
}

/** Joins by invite code. Idempotent: re-joining keeps the existing role. */
export async function joinTeamByCode(userId: string, code: string) {
  const [team] = await db
    .select()
    .from(teams)
    .where(eq(teams.inviteCode, code.trim()))
    .limit(1);
  if (!team) return { ok: false as const, reason: "not_found" as const };

  const [existing] = await db
    .select({ role: teamMembers.role })
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, team.id), eq(teamMembers.userId, userId)))
    .limit(1);
  if (existing) return { ok: true as const, team, alreadyMember: true };

  await db
    .insert(teamMembers)
    .values({ teamId: team.id, userId, role: "member" })
    .onConflictDoNothing();
  return { ok: true as const, team, alreadyMember: false };
}

export async function updateMemberRole(
  teamId: string,
  actorId: string,
  targetUserId: string,
  role: TeamRole,
) {
  if (!isTeamRole(role)) return { ok: false as const, reason: "bad_role" as const };
  const team = await getTeamForUser(teamId, actorId);
  if (!team || team.role !== "owner") return { ok: false as const, reason: "forbidden" as const };
  if (targetUserId === team.ownerId) return { ok: false as const, reason: "owner_immutable" as const };

  const rows = await db
    .update(teamMembers)
    .set({ role })
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, targetUserId)))
    .returning({ userId: teamMembers.userId });
  return rows.length ? { ok: true as const } : { ok: false as const, reason: "not_found" as const };
}

export async function removeTeamMember(teamId: string, actorId: string, targetUserId: string) {
  const team = await getTeamForUser(teamId, actorId);
  if (!team) return { ok: false as const, reason: "forbidden" as const };
  // A member may remove themselves; only the owner may remove anyone else.
  if (targetUserId !== actorId && team.role !== "owner") {
    return { ok: false as const, reason: "forbidden" as const };
  }
  if (targetUserId === team.ownerId) return { ok: false as const, reason: "owner_immutable" as const };

  const rows = await db
    .delete(teamMembers)
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, targetUserId)))
    .returning({ userId: teamMembers.userId });
  return rows.length ? { ok: true as const } : { ok: false as const, reason: "not_found" as const };
}

export async function regenerateInvite(teamId: string, actorId: string) {
  const team = await getTeamForUser(teamId, actorId);
  if (!team || team.role !== "owner") return null;
  const [row] = await db
    .update(teams)
    .set({ inviteCode: inviteCode() })
    .where(eq(teams.id, teamId))
    .returning();
  return row ?? null;
}

export async function deleteTeam(teamId: string, actorId: string) {
  const team = await getTeamForUser(teamId, actorId);
  if (!team || team.role !== "owner") return { ok: false as const };
  const rows = await db
    .delete(teams)
    .where(and(eq(teams.id, teamId), eq(teams.ownerId, actorId)))
    .returning({ id: teams.id });
  return { ok: rows.length > 0 };
}

/**
 * Activity rows for a set of members over a window. Only called with ids the
 * caller has already been authorised to see (see the team router).
 */
export async function activitiesForUsers(userIds: string[], from: string, to: string) {
  if (userIds.length === 0) return [];
  return db
    .select({
      ownerId: activities.ownerId,
      id: activities.id,
      category: activities.category,
      title: activities.title,
      durationMinutes: activities.durationMinutes,
      activityDate: activities.activityDate,
      startTime: activities.startTime,
      notes: activities.notes,
      intensity: activities.intensity,
      location: activities.location,
      tags: activities.tags,
    })
    .from(activities)
    .where(
      and(
        inArray(activities.ownerId, userIds),
        gte(activities.activityDate, from),
        lte(activities.activityDate, to),
      ),
    )
    .orderBy(desc(activities.activityDate));
}

// ── Share links ──────────────────────────────────────────────────────────────

export async function listShareLinks(ownerId: string) {
  return db
    .select()
    .from(shareLinks)
    .where(eq(shareLinks.ownerId, ownerId))
    .orderBy(desc(shareLinks.createdAt));
}

export async function createShareLink(
  ownerId: string,
  input: { scope: string; label?: string | null; expiresInDays?: number | null },
) {
  const token = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().slice(0, 8);
  const expiresAt =
    input.expiresInDays && input.expiresInDays > 0
      ? new Date(Date.now() + input.expiresInDays * 86_400_000)
      : null;
  const [row] = await db
    .insert(shareLinks)
    .values({
      ownerId,
      token,
      scope: input.scope,
      label: input.label?.trim() ? input.label.trim() : null,
      expiresAt,
    })
    .returning();
  return row;
}

export async function revokeShareLink(id: string, ownerId: string) {
  const [row] = await db
    .update(shareLinks)
    .set({ revokedAt: new Date() })
    .where(and(eq(shareLinks.id, id), eq(shareLinks.ownerId, ownerId)))
    .returning();
  return row ?? null;
}

export async function deleteShareLink(id: string, ownerId: string) {
  const rows = await db
    .delete(shareLinks)
    .where(and(eq(shareLinks.id, id), eq(shareLinks.ownerId, ownerId)))
    .returning({ id: shareLinks.id });
  return { ok: rows.length > 0 };
}

/**
 * Resolves a share token to its owner and scope. Returns null for an unknown,
 * revoked, or expired token — the caller cannot tell those apart, which is
 * deliberate: a revoked link should look like a link that never existed.
 */
export async function resolveShareToken(token: string) {
  const [row] = await db
    .select({
      id: shareLinks.id,
      ownerId: shareLinks.ownerId,
      scope: shareLinks.scope,
      label: shareLinks.label,
      expiresAt: shareLinks.expiresAt,
      revokedAt: shareLinks.revokedAt,
      ownerName: users.name,
      ownerEmail: users.email,
    })
    .from(shareLinks)
    .innerJoin(users, eq(users.id, shareLinks.ownerId))
    .where(eq(shareLinks.token, token))
    .limit(1);

  if (!row) return null;
  if (row.revokedAt) return null;
  if (row.expiresAt && row.expiresAt.getTime() < Date.now()) return null;
  return row;
}

/** The shared owner's rows for a window — the read side of a share link. */
export async function sharedActivities(ownerId: string, from: string, to: string) {
  return db
    .select()
    .from(activities)
    .where(
      and(
        eq(activities.ownerId, ownerId),
        gte(activities.activityDate, from),
        lte(activities.activityDate, to),
      ),
    )
    .orderBy(desc(activities.activityDate), desc(activities.createdAt));
}

/** Display name for a user id, used by the team roll-up. */
export async function userDisplay(userId: string) {
  const [row] = await db
    .select({ name: users.name, email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row ?? null;
}

export { isNull, ne };
