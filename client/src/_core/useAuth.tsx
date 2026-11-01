import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { trpc } from "./trpc";
import type { SessionUser } from "@shared/types";
import { requestStorageAccessIfEmbedded } from "./storage-access";

// Frontend auth seam. Wraps the tRPC auth router so pages consume a single
// `useAuth()` — they never see the session mechanism (cookie/JWT/SSO). Mirrors
// the server AuthProvider abstraction (DESIGN §5.1).
//
// OFFLINE: the session lives in an httpOnly cookie, which the browser keeps
// across a cold start, but `auth.me` still needs a round trip to answer. With
// the network off that query never resolves, so the guard would sit on
// "Loading…" and then bounce to /login — the app would be unusable offline,
// which defeats the point of the PWA. The last confirmed user is therefore
// mirrored into localStorage and used as the identity while the network is
// unavailable. It is a UI hint only: every server call still re-checks the
// cookie, so a stale cache can never grant access to another account's data.
interface AuthContextValue {
  user: SessionUser | null;
  isLoading: boolean;
  /** True when the identity came from the offline cache, not the server. */
  isOfflineSession: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (email: string, password: string, name?: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const CACHE_KEY = "dayline:last-user";

function readCachedUser(): SessionUser | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SessionUser;
    return parsed && typeof parsed.id === "string" ? parsed : null;
  } catch {
    return null;
  }
}

function writeCachedUser(user: SessionUser | null): void {
  if (typeof localStorage === "undefined") return;
  try {
    if (user) localStorage.setItem(CACHE_KEY, JSON.stringify(user));
    else localStorage.removeItem(CACHE_KEY);
  } catch {
    // Private mode / quota — the cache is an optimisation, never required.
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const utils = trpc.useUtils();
  const me = trpc.auth.me.useQuery(undefined, {
    // Keep the last good answer so a remount does not flash the login screen.
    staleTime: 60_000,
    retry: 1,
  });
  const loginM = trpc.auth.login.useMutation();
  const signupM = trpc.auth.signup.useMutation();
  const logoutM = trpc.auth.logout.useMutation();

  const [cached, setCached] = useState<SessionUser | null>(() => readCachedUser());

  // Mirror every confirmed server answer into the cache.
  useEffect(() => {
    if (me.data) {
      setCached(me.data);
      writeCachedUser(me.data);
    } else if (me.isSuccess && me.data === null) {
      // The server explicitly said "nobody is signed in" — trust it.
      setCached(null);
      writeCachedUser(null);
    }
  }, [me.data, me.isSuccess]);

  const offline = typeof navigator !== "undefined" && !navigator.onLine;
  // While the query is in flight we already know the answer if we have a cache.
  const usingCache = !me.data && !!cached && (offline || me.isError || me.isLoading);

  const value = useMemo<AuthContextValue>(
    () => ({
      user: me.data ?? (usingCache ? cached : null),
      // Only "loading" when we have nothing at all to show.
      isLoading: me.isLoading && !cached,
      isOfflineSession: usingCache,
      login: async (email, password) => {
        await requestStorageAccessIfEmbedded();
        const user = await loginM.mutateAsync({ email, password });
        if (user) {
          setCached(user as SessionUser);
          writeCachedUser(user as SessionUser);
        }
        await utils.auth.me.invalidate();
      },
      signup: async (email, password, name) => {
        await requestStorageAccessIfEmbedded();
        const user = await signupM.mutateAsync({ email, password, name });
        if (user) {
          setCached(user as SessionUser);
          writeCachedUser(user as SessionUser);
        }
        await utils.auth.me.invalidate();
      },
      logout: async () => {
        await requestStorageAccessIfEmbedded();
        await logoutM.mutateAsync();
        setCached(null);
        writeCachedUser(null);
        await utils.auth.me.invalidate();
      },
    }),
    [me.data, me.isLoading, me.isError, cached, usingCache, loginM, signupM, logoutM, utils],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>");
  return ctx;
}
