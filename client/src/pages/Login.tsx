import { useState, type FormEvent } from "react";
import { Link, Redirect } from "wouter";
import { Activity, ArrowRight } from "lucide-react";
import { useAuth } from "@/_core/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function Login() {
  const { login, user } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(email, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setBusy(false);
    }
  }

  if (user) return <Redirect to="/" />;

  return (
    <main className="flex min-h-screen flex-col lg:flex-row">
      <aside className="relative hidden flex-1 flex-col justify-between overflow-hidden bg-[#1C1917] p-12 text-[#FAF8F5] lg:flex">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-[#C2410C]">
            <Activity className="h-4 w-4" strokeWidth={2.25} />
          </span>
          <span className="text-[15px] font-semibold tracking-tight">Dayline</span>
        </div>

        <div className="max-w-md">
          <h2 className="text-[34px] font-semibold leading-[1.15] tracking-tight">
            See where your days
            <br />
            actually go.
          </h2>
          <p className="mt-4 text-[15px] leading-relaxed text-[#FAF8F5]/60">
            Log exercise, work, reading, sleep and everything else in seconds. Dayline turns
            it into a weekly trend, a category split, and streaks worth keeping.
          </p>

          <div className="mt-10 grid grid-cols-3 gap-4 border-t border-white/10 pt-6">
            {[
              ["8", "categories"],
              ["7-day", "trend view"],
              ["∞", "streaks"],
            ].map(([big, small]) => (
              <div key={small}>
                <p className="display-num text-xl">{big}</p>
                <p className="mt-0.5 text-[11px] uppercase tracking-wider text-[#FAF8F5]/40">
                  {small}
                </p>
              </div>
            ))}
          </div>
        </div>

        <p className="text-[11px] text-[#FAF8F5]/30">Your log is private to your account.</p>
      </aside>

      <div className="flex flex-1 items-center justify-center px-5 py-12 sm:px-8">
        <div className="w-full max-w-[380px]">
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <span className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-primary text-primary-foreground">
              <Activity className="h-4 w-4" strokeWidth={2.25} />
            </span>
            <span className="text-[15px] font-semibold tracking-tight">Dayline</span>
          </div>

          <h1 className="text-[24px] font-semibold tracking-tight">Welcome back</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Log in to pick up your streak.
          </p>

          <form onSubmit={onSubmit} className="mt-7 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            {error && (
              <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            )}
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? "Logging in…" : "Log in"}
              {!busy && <ArrowRight className="h-4 w-4" />}
            </Button>
          </form>

          <p className="mt-6 text-center text-sm text-muted-foreground">
            No account?{" "}
            <Link to="/register" className="font-medium text-primary hover:underline">
              Create one
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}
