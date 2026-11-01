// Pure team helpers: role rules and the combined weekly roll-up. The server
// enforces the same rules; keeping them here means the UI can hide an action
// for the same reason the API would refuse it.

import { categoryDef } from "./activities";
import { startOfWeek, type ActivityLike, type DayKey } from "./analytics";

export const TEAM_ROLES = ["owner", "member", "viewer"] as const;
export type TeamRole = (typeof TEAM_ROLES)[number];

export function isTeamRole(value: string): value is TeamRole {
  return (TEAM_ROLES as readonly string[]).includes(value);
}

export const ROLE_LABELS: Record<TeamRole, string> = {
  owner: "Owner",
  member: "Member",
  viewer: "Viewer",
};

export const ROLE_HINTS: Record<TeamRole, string> = {
  owner: "Manages the team, invites people, can remove members.",
  member: "Shares their weekly summary with the team.",
  viewer: "Sees the team dashboard; their own log stays private.",
};

/** Only the owner may invite, change roles, or remove people. */
export function canManageTeam(role: TeamRole | null | undefined): boolean {
  return role === "owner";
}

/** A viewer's own activity is not contributed to the team roll-up. */
export function contributesToTeam(role: TeamRole | null | undefined): boolean {
  return role === "owner" || role === "member";
}

export interface MemberSummary {
  userId: string;
  name: string;
  email: string;
  role: TeamRole;
  totalMinutes: number;
  entryCount: number;
  activeDays: number;
  topCategory: string | null;
  byCategory: Record<string, number>;
}

export interface TeamRollup {
  from: DayKey;
  to: DayKey;
  totalMinutes: number;
  entryCount: number;
  members: MemberSummary[];
  byCategory: { category: string; label: string; color: string; minutes: number; share: number }[];
  /** Members whose role means their log is not counted. */
  excludedCount: number;
}

/**
 * Combines members' rows for the current Monday–Sunday week (clipped to today).
 * `rowsByUser` holds only the rows the caller is allowed to see; a viewer's rows
 * are never passed in, and are counted in `excludedCount` instead.
 */
export function buildTeamRollup(
  members: { userId: string; name: string; email: string; role: TeamRole }[],
  rowsByUser: Map<string, ActivityLike[]>,
  today: DayKey,
): TeamRollup {
  const from = startOfWeek(today);
  const to = today;

  const summaries: MemberSummary[] = members.map((m) => {
    const rows = (rowsByUser.get(m.userId) ?? []).filter(
      (r) => r.activityDate >= from && r.activityDate <= to,
    );
    const byCategory: Record<string, number> = {};
    const days = new Set<string>();
    for (const r of rows) {
      byCategory[r.category] = (byCategory[r.category] ?? 0) + r.durationMinutes;
      days.add(r.activityDate);
    }
    const top = Object.entries(byCategory).sort((a, b) => b[1] - a[1])[0];
    return {
      userId: m.userId,
      name: m.name,
      email: m.email,
      role: m.role,
      totalMinutes: rows.reduce((s, r) => s + r.durationMinutes, 0),
      entryCount: rows.length,
      activeDays: days.size,
      topCategory: top ? top[0] : null,
      byCategory,
    };
  });

  const combined: Record<string, number> = {};
  for (const s of summaries) {
    if (!contributesToTeam(s.role)) continue;
    for (const [cat, mins] of Object.entries(s.byCategory)) {
      combined[cat] = (combined[cat] ?? 0) + mins;
    }
  }
  const totalMinutes = Object.values(combined).reduce((s, v) => s + v, 0);

  return {
    from,
    to,
    totalMinutes,
    entryCount: summaries
      .filter((s) => contributesToTeam(s.role))
      .reduce((s, m) => s + m.entryCount, 0),
    // Contributors first, by time; viewers last — their total is not part of
    // the roll-up, so ranking them against members would be misleading.
    members: summaries.sort((a, b) => {
      const ac = contributesToTeam(a.role) ? 0 : 1;
      const bc = contributesToTeam(b.role) ? 0 : 1;
      if (ac !== bc) return ac - bc;
      return b.totalMinutes - a.totalMinutes;
    }),
    byCategory: Object.entries(combined)
      .map(([category, minutes]) => ({
        category,
        label: categoryDef(category).label,
        color: categoryDef(category).color,
        minutes,
        share: totalMinutes > 0 ? minutes / totalMinutes : 0,
      }))
      .sort((a, b) => b.minutes - a.minutes),
    excludedCount: summaries.filter((s) => !contributesToTeam(s.role)).length,
  };
}

/** Initials for the member avatar: "Alex Rivera" → "AR". */
export function initials(name: string, email: string): string {
  const source = name.trim() || email.split("@")[0] || "?";
  const parts = source.split(/[\s._-]+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
