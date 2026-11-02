import type { ReactNode } from "react";
import { Redirect } from "wouter";
import { useAuth } from "./useAuth";

// Route guard: redirect anonymous users to /login. Depends only on useAuth —
// never on the session mechanism.
export default function Protected({ children }: { children: ReactNode }) {
  const { user, isLoading } = useAuth();
  if (isLoading) return <div className="p-8 text-muted-foreground">Loading…</div>;
  if (!user) return <Redirect to="/login" />;
  return <>{children}</>;
}
