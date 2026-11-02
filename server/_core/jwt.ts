// ─────────────────────────────────────────────────────────────────────────────
// Minimal HS256 JWT, on Web Crypto.
//
// Why not `jose`: v6 fails under workerd with
//   DataError: Imported HMAC key length (0) must be a non-zero value…
// when handed a raw Uint8Array key — the key arrives at `crypto.subtle.importKey`
// as zero bytes. Rather than pin an older version and hope, this is the whole
// algorithm in ~60 lines: HS256 is HMAC-SHA256 over `base64url(header).base64url(payload)`,
// and Web Crypto is available in every Worker. One less dependency, and nothing
// between us and the primitive.
//
// Scope: this signs and verifies OUR OWN session tokens. It is not a general
// JWT library — no RS256, no JWKS, no `none` algorithm (which is the one that
// must never be accepted).
// ─────────────────────────────────────────────────────────────────────────────

export interface JwtPayload {
  /** Subject — the user id. */
  sub: string;
  /** JWT id — the session id, so a token can be revoked server-side. */
  jti: string;
  /** Issued at, seconds since epoch. */
  iat: number;
  /** Expiry, seconds since epoch. */
  exp: number;
}

const HEADER = { alg: "HS256", typ: "JWT" } as const;

function b64urlEncode(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  const bytes = new TextEncoder().encode(secret);
  if (bytes.length === 0) throw new Error("JWT secret is empty");
  return crypto.subtle.importKey(
    "raw",
    bytes as unknown as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

/** Constant-time comparison — an early return would leak the matching prefix. */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** Sign a session token. `ttlSeconds` sets `exp`. */
export async function signJwt(
  claims: { sub: string; jti: string },
  secret: string,
  ttlSeconds: number,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload: JwtPayload = { sub: claims.sub, jti: claims.jti, iat: now, exp: now + ttlSeconds };

  const enc = new TextEncoder();
  const signingInput = `${b64urlEncode(enc.encode(JSON.stringify(HEADER)))}.${b64urlEncode(
    enc.encode(JSON.stringify(payload)),
  )}`;

  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(signingInput) as unknown as BufferSource);
  return `${signingInput}.${b64urlEncode(new Uint8Array(sig))}`;
}

/**
 * Verify a token and return its claims, or null for anything that is not a
 * valid, unexpired token we signed. Never throws — a bad cookie is an anonymous
 * request, not a 500.
 */
export async function verifyJwt(token: string, secret: string): Promise<JwtPayload | null> {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [headerB64, payloadB64, sigB64] = parts;

    // Reject any algorithm but ours. Accepting the header's `alg` is how the
    // classic "alg: none" and HS/RS confusion attacks work.
    const header = JSON.parse(new TextDecoder().decode(b64urlDecode(headerB64))) as {
      alg?: string;
      typ?: string;
    };
    if (header.alg !== "HS256") return null;

    const key = await hmacKey(secret);
    const expected = await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(`${headerB64}.${payloadB64}`) as unknown as BufferSource,
    );
    if (!timingSafeEqual(new Uint8Array(expected), b64urlDecode(sigB64))) return null;

    const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(payloadB64))) as JwtPayload;
    if (typeof payload.sub !== "string" || typeof payload.jti !== "string") return null;
    if (typeof payload.exp !== "number" || payload.exp * 1000 <= Date.now()) return null;

    return payload;
  } catch {
    return null;
  }
}
