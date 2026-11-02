import type { Context } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { signJwt, verifyJwt } from "./jwt";
import { and, eq, isNull } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import type { AppDB } from "./db";
import { sessions, users } from "../../drizzle/schema";
import type { Env } from "./env";
import { sessionCookieName, type UserRole } from "../../shared/constants";
import type { SessionUser } from "../../shared/types";
import {
  requestIsSecure,
  sessionCookieClearOptions,
  sessionCookieOptions,
} from "./session-cookie";

// ─────────────────────────────────────────────────────────────────────────────
// Auth on Workers.
//
// Two things changed from the Node version, both forced by the runtime:
//
//   1. PASSWORD HASHING. `bcryptjs` is pure JS and would run, but it is slow
//      enough to blow a Worker's CPU budget on a modest password. Workers ship
//      Web Crypto, so PBKDF2-SHA256 (210k iterations, the OWASP figure) runs
//      natively. The stored format is self-describing:
//
//          pbkdf2$210000$<salt-b64>$<hash-b64>
//
//      so the iteration count can be raised later without invalidating
//      existing hashes — `verifyPassword` reads it from the stored string.
//
//   2. SESSIONS ARE REVOCABLE. The JWT carries a session id in `jti`, and every
//      request checks that row still exists and is not revoked. A JWT alone
//      cannot be logged out; this is what makes "log out" mean something.
// ─────────────────────────────────────────────────────────────────────────────

export interface AuthProvider {
  getSession(c: Context, env: Env, db: AppDB): Promise<SessionUser | null>;
  login(c: Context, env: Env, db: AppDB, email: string, password: string): Promise<SessionUser>;
  logout(c: Context, env: Env, db: AppDB): Promise<void>;
}

const PBKDF2_ITERATIONS = 210_000;
const SESSION_DAYS = 30;

function b64(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (const b of view) s += String.fromCharCode(b);
  return btoa(s);
}

function fromB64(value: string): Uint8Array {
  const raw = atob(value);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt as unknown as BufferSource, iterations, hash: "SHA-256" },
    key,
    256,
  );
  return new Uint8Array(bits);
}

/** Hash a password for storage. Format: `pbkdf2$<iters>$<salt>$<hash>`. */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${b64(salt)}$${b64(hash)}`;
}

/**
 * Constant-time-ish comparison of two byte arrays. `crypto.subtle` has no
 * compare, so this walks the full length regardless of where a mismatch is —
 * an early return would leak the length of the matching prefix.
 */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** Verify a password against a stored hash. False for any malformed input. */
export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
  const iterations = Number(parts[1]);
  if (!Number.isFinite(iterations) || iterations < 1) return false;
  try {
    const salt = fromB64(parts[2]);
    const expected = fromB64(parts[3]);
    const actual = await pbkdf2(password, salt, iterations);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

function toSessionUser(row: typeof users.$inferSelect): SessionUser {
  // password_hash is intentionally dropped here — never leaves the auth layer.
  return { id: row.id, email: row.email, name: row.name, role: row.role as UserRole };
}

function cookieName(env: Env): string {
  return sessionCookieName(env.appSlug);
}

class LocalAuthProvider implements AuthProvider {
  async getSession(c: Context, env: Env, db: AppDB): Promise<SessionUser | null> {
    const token = getCookie(c, cookieName(env));
    if (!token) return null;
    try {
      const payload = await verifyJwt(token, env.jwtSecret);
      if (!payload) return null;
      const userId = payload.sub;
      const sessionId = payload.jti;

      // The JWT proves it was minted by us; this row proves it is still live.
      const [session] = await db
        .select()
        .from(sessions)
        .where(and(eq(sessions.id, sessionId), isNull(sessions.revokedAt)))
        .limit(1);
      if (!session) return null;
      if (session.userId !== userId) return null;
      if (Date.parse(session.expiresAt) <= Date.now()) return null;

      const [row] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
      return row ? toSessionUser(row) : null;
    } catch {
      return null; // expired / tampered / wrong key → treat as anonymous
    }
  }

  async login(
    c: Context,
    env: Env,
    db: AppDB,
    email: string,
    password: string,
  ): Promise<SessionUser> {
    const [row] = await db
      .select()
      .from(users)
      .where(eq(users.email, email.toLowerCase()))
      .limit(1);

    // Always run a verify, even when the user is missing, so a wrong email and
    // a wrong password take the same time. The dummy hash is a real PBKDF2
    // string so the work is identical, not merely similar.
    const stored =
      row?.passwordHash ??
      "pbkdf2$210000$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
    const ok = await verifyPassword(password, stored);
    if (!row || !row.passwordHash || !ok) throw new AuthError("Invalid email or password");

    await this.#setSession(c, env, db, row.id);
    return toSessionUser(row);
  }

  async logout(c: Context, env: Env, db: AppDB): Promise<void> {
    const token = getCookie(c, cookieName(env));
    if (token) {
      try {
        const payload = await verifyJwt(token, env.jwtSecret);
        if (payload?.jti) {
          // Revoke server-side, so the cookie is dead even if it is replayed.
          await db
            .update(sessions)
            .set({ revokedAt: new Date().toISOString() })
            .where(eq(sessions.id, payload.jti));
        }
      } catch {
        // Expired or tampered — nothing to revoke.
      }
    }
    for (const opt of sessionCookieClearOptions()) {
      deleteCookie(c, cookieName(env), opt);
    }
  }

  async #setSession(c: Context, env: Env, db: AppDB, userId: string): Promise<void> {
    const sessionId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000).toISOString();

    await db.insert(sessions).values({ id: sessionId, userId, expiresAt });

    const token = await signJwt(
      { sub: userId, jti: sessionId },
      env.jwtSecret,
      SESSION_DAYS * 86_400,
    );

    setCookie(c, cookieName(env), token, sessionCookieOptions(env.isProd || requestIsSecure(c)));
  }
}

// An app built without user accounts: nobody can ever be signed in, and any
// attempt to log in is refused. Throws TRPCError (FORBIDDEN) rather than
// AuthError on purpose: authRouter.signup only translates EmailTakenError and
// rethrows everything else, so an AuthError would surface as a 500.
const NO_ACCOUNTS_MESSAGE = "This app does not have user accounts.";
function noAccountsError(): TRPCError {
  return new TRPCError({ code: "FORBIDDEN", message: NO_ACCOUNTS_MESSAGE });
}

class NoAuthProvider implements AuthProvider {
  async getSession(): Promise<SessionUser | null> {
    return null;
  }
  async login(): Promise<SessionUser> {
    throw noAccountsError();
  }
  async logout(): Promise<void> {
    // No session exists, so there is nothing to clear.
  }
}

export class AuthError extends Error {}

/** Signup hit the `users.email` UNIQUE index — that address already has an
 *  account. A distinct type (not a string match on some driver's wording) so a
 *  router can answer 409 "log in instead" instead of leaking a 500. */
export class EmailTakenError extends AuthError {}

export function authProvider(env: Env): AuthProvider {
  // Anything other than "none" (including a typo) falls back to local.
  return env.authProvider === "none" ? new NoAuthProvider() : new LocalAuthProvider();
}

/** False when the app was built without user accounts (AUTH_PROVIDER=none). */
export function accountsEnabled(env: Env): boolean {
  return env.authProvider !== "none";
}

// Local-only helper for the signup flow (registration is inherently
// provider-specific; SSO signup happens at the IdP). Kept out of the interface.
export async function registerLocalUser(
  env: Env,
  db: AppDB,
  email: string,
  password: string,
  name?: string,
): Promise<SessionUser> {
  if (env.authProvider === "none") throw noAccountsError();
  const passwordHash = await hashPassword(password);
  try {
    const [row] = await db
      .insert(users)
      .values({ email: email.toLowerCase(), passwordHash, name: name ?? null })
      .returning();
    return { id: row.id, email: row.email, name: row.name, role: row.role as UserRole };
  } catch (e) {
    // `users` carries exactly one UNIQUE index (email) — `id` is generated — so
    // a constraint failure on this INSERT can only mean the address is taken.
    // Translating it HERE, rather than in each app's routers.ts, is what keeps a
    // second signup from surfacing as a 500 that quotes the INSERT and its bound
    // params (password hash included) back to the browser.
    if (isUniqueViolation(e)) {
      throw new EmailTakenError("That email is already registered — try logging in instead.");
    }
    throw e;
  }
}

/**
 * True when `e` (or anything it wraps) is a UNIQUE-index violation.
 *
 * SQLite reports these as `SQLITE_CONSTRAINT_UNIQUE` / `SQLITE_CONSTRAINT_PRIMARYKEY`
 * with the message `UNIQUE constraint failed: users.email`. D1 surfaces the
 * driver error directly (unlike Drizzle-on-Postgres, which wrapped it), but the
 * cause chain is still walked because a wrapper may be introduced at any layer.
 */
export function isUniqueViolation(e: unknown, constraint?: string): boolean {
  const seen = new Set<unknown>();
  for (let err: unknown = e; err && typeof err === "object" && !seen.has(err); ) {
    seen.add(err);
    const { code, message, cause } = err as Record<string, unknown>;
    const text = typeof message === "string" ? message : "";
    const isUnique =
      String(code).includes("SQLITE_CONSTRAINT") ||
      /UNIQUE constraint failed/i.test(text) ||
      /constraint failed: .*\.(email|id)/i.test(text);
    if (isUnique) {
      if (!constraint) return true;
      if (text.includes(constraint)) return true;
    }
    err = cause;
  }
  return false;
}
