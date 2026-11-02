import { createTRPCReact } from "@trpc/react-query";
import { httpBatchLink } from "@trpc/client";
import superjson from "superjson";
import type { AppRouter } from "../../../server/routers";

// Typed tRPC client. `AppRouter` is a TYPE-ONLY import from the server, so the
// whole API is end-to-end typed without shipping server code to the browser.
export const trpc = createTRPCReact<AppRouter>();

/**
 * Where the API lives.
 *
 * Default: same origin, `/trpc`. That is correct for the normal deployment —
 * one Worker serves both the SPA and the API — and for `wrangler dev`.
 *
 * Override with `VITE_API_URL` when the SPA is hosted separately from the
 * Worker (e.g. the SPA on Cloudflare Pages and the API on a Worker at
 * `https://dayline-api.example.workers.dev`). Set it at BUILD time:
 *
 *     VITE_API_URL=https://dayline-api.example.workers.dev pnpm build
 *
 * A trailing slash is stripped so the result is always `<base>/trpc`.
 */
export function apiBaseUrl(): string {
  const configured = import.meta.env.VITE_API_URL as string | undefined;
  const base = configured?.trim() ? configured.trim() : "";
  return `${base.replace(/\/+$/, "")}/trpc`;
}

export function makeTrpcClient() {
  return trpc.createClient({
    links: [
      httpBatchLink({
        url: apiBaseUrl(),
        transformer: superjson,
        // Cookies carry the session, so every request must include them. This
        // matters when the API is on a different origin from the SPA.
        fetch: (input, init) => fetch(input, { ...init, credentials: "include" }),
      }),
    ],
  });
}
