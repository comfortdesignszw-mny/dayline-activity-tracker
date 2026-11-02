import { Link, useLocation } from "wouter";
import { LayoutDashboard, Plus, History, LogOut, Activity } from "lucide-react";
import { useAuth } from "@/_core/useAuth";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { SyncStatus } from "@/components/SyncStatus";
import { InstallApp } from "@/components/InstallApp";

const NAV = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/log", label: "Log activity", icon: Plus },
  { href: "/history", label: "History", icon: History },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const [path] = useLocation();
  const { user, logout } = useAuth();

  const isActive = (href: string) =>
    href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`);

  return (
    <div className="min-h-screen bg-background">
      {/* ── Desktop sidebar ─────────────────────────────────────────────── */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[236px] flex-col border-r border-border bg-card/60 px-4 py-6 lg:flex">
        <Link to="/" className="mb-8 flex items-center gap-2.5 px-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-primary text-primary-foreground">
            <Activity className="h-4 w-4" strokeWidth={2.25} />
          </span>
          <span className="text-[15px] font-semibold tracking-tight">Dayline</span>
        </Link>

        <nav className="flex flex-col gap-1">
          {NAV.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              to={href}
              className={cn(
                "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors",
                isActive(href)
                  ? "bg-accent font-medium text-accent-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <Icon className="h-4 w-4" strokeWidth={1.9} />
              {label}
            </Link>
          ))}
        </nav>

        <div className="mt-auto space-y-3 border-t border-border pt-4">
          <div className="flex items-center gap-2 px-2">
            <SyncStatus />
            <InstallApp />
          </div>
          <div className="px-2">
            <p className="truncate text-sm font-medium">{user?.name || "Your log"}</p>
            <p className="truncate text-xs text-muted-foreground">{user?.email}</p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start gap-2 text-muted-foreground"
            onClick={() => void logout()}
          >
            <LogOut className="h-4 w-4" strokeWidth={1.9} />
            Log out
          </Button>
        </div>
      </aside>

      {/* ── Mobile top bar ──────────────────────────────────────────────── */}
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-border bg-background/90 px-4 py-3 backdrop-blur lg:hidden">
        <Link to="/" className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Activity className="h-3.5 w-3.5" strokeWidth={2.25} />
          </span>
          <span className="text-sm font-semibold tracking-tight">Dayline</span>
        </Link>
        <div className="flex items-center gap-2">
          <SyncStatus />
          <nav className="flex items-center gap-1">
            {NAV.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                to={href}
                aria-label={label}
                className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-lg transition-colors",
                  isActive(href)
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-muted",
                )}
              >
                <Icon className="h-4 w-4" strokeWidth={1.9} />
              </Link>
            ))}
          </nav>
        </div>
      </header>

      <main className="lg:pl-[236px]">
        <div className="mx-auto w-full max-w-[1180px] px-4 py-6 sm:px-6 lg:px-10 lg:py-10">
          {children}
        </div>
      </main>
    </div>
  );
}
