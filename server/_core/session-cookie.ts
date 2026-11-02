import type { Context } from "hono";

const SESSION_MAX_AGE = 60 * 60 * 24 * 30;

/**
 * Host suffixes whose public URL is always HTTPS.
 *
 * On Cloudflare every deployed Worker is HTTPS-only, so this list exists for the
 * one case that is not obvious from the request: a request that arrives over
 * plain HTTP at the edge (a local `wrangler dev`, or a proxy that terminates TLS
 * upstream and forwards over HTTP). Naming the suffixes makes the assumption
 * explicit instead of relying on a header that may or may not be set.
 *
 * Add your own custom domain here if you serve the app from one and want the
 * partitioned cookie on the very first navigation (before any Origin/Referer is
 * available). A root missing here is not a hard failure — `requestIsSecure` has
 * weaker fallbacks — but a first navigation carrying no Origin/Referer would
 * then plant a Lax, unpartitioned cookie, which breaks the session the moment
 * the app is embedded in an iframe.
 *
 * The leading dot is part of the suffix, so `evil.example.com.attacker.net` and
 * `notexample.com` both miss.
 */
const HTTPS_HOST_SUFFIXES = [".workers.dev", ".pages.dev"] as const;

export type SessionCookieOptions = {
  httpOnly: true;
  path: "/";
  maxAge: number;
  sameSite: "None" | "Lax";
  secure: boolean;
  partitioned?: true;
};

/** HTTPS → CHIPS; localhost → Lax. */
export function sessionCookieOptions(https: boolean): SessionCookieOptions {
  if (https) {
    return {
      httpOnly: true,
      path: "/",
      maxAge: SESSION_MAX_AGE,
      sameSite: "None",
      secure: true,
      partitioned: true, // Hono writes this as ; Partitioned
    };
  }
  return {
    httpOnly: true,
    path: "/",
    maxAge: SESSION_MAX_AGE,
    sameSite: "Lax",
    secure: false,
  };
}

/**
 * Same-name cookies in different jars are independent: CHIPS, unpartitioned
 * None+Secure, and legacy Lax (with/without Secure). Logout must expire all
 * four or a stale copy in another jar will keep the user signed in.
 */
export function sessionCookieClearOptions(): Array<
  Pick<SessionCookieOptions, "path" | "sameSite" | "secure"> & { partitioned?: true }
> {
  return [
    { path: "/", sameSite: "None", secure: true, partitioned: true },
    { path: "/", sameSite: "None", secure: true },
    { path: "/", sameSite: "Lax", secure: true },
    { path: "/", sameSite: "Lax", secure: false },
  ];
}

/**
 * Whether the *browser* is on HTTPS.
 *
 * Cannot just look at this process's protocol: `wrangler dev` serves plain HTTP
 * on localhost while a proxy in front of it may terminate TLS, and the cookie
 * has to match what the BROWSER sees, not what the Worker sees.
 *
 * Positive signals only, in this order. `x-forwarded-proto: http` is NOT a veto
 * — a proxy often sets that while Origin is still https.
 */
export function requestIsSecure(c: Context): boolean {
  if (urlIsHttps(c.req.url)) return true;

  const forwardedHost = firstHop(c.req.header("x-forwarded-host"));
  const host = firstHop(c.req.header("host"));
  if (hostIsHttpsApp(forwardedHost) || hostIsHttpsApp(host)) return true;

  if (firstHop(c.req.header("x-forwarded-proto"))?.toLowerCase() === "https") return true;
  if ((c.req.header("x-forwarded-ssl") ?? "").trim().toLowerCase() === "on") return true;

  if (urlIsHttps(c.req.header("origin")) || urlIsHttps(c.req.header("referer"))) return true;

  return false;
}

function firstHop(raw: string | undefined): string | undefined {
  const hop = raw?.split(",")[0]?.trim();
  return hop || undefined;
}

function hostIsHttpsApp(host: string | undefined): boolean {
  if (!host) return false;
  const hostname = host.split(":")[0]?.trim().toLowerCase() ?? "";
  return HTTPS_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix));
}

function urlIsHttps(raw: string | undefined): boolean {
  if (!raw || !raw.includes("://")) return false;
  try {
    return new URL(raw).protocol === "https:";
  } catch {
    return false;
  }
}
