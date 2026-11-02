// Sync status indicator: synced / syncing / offline (with pending count), plus
// a manual "Sync now" action. Reads the sync engine's live state.

import { useCallback } from "react";
import { Cloud, CloudOff, Loader2, RefreshCw } from "lucide-react";
import { syncNow } from "@/lib/syncEngine";
import { useSync } from "@/hooks/useSync";
import { cn } from "@/lib/utils";

export function SyncStatus() {
  const { status, pending } = useSync();

  const sync = useCallback(() => void syncNow(), []);

  const offline = status === "offline";
  const syncing = status === "syncing";

  const label = offline
    ? pending > 0
      ? `Offline · ${pending} pending`
      : "Offline"
    : syncing
      ? "Syncing…"
      : pending > 0
        ? `${pending} pending`
        : "Synced";

  return (
    <button
      type="button"
      onClick={sync}
      disabled={syncing}
      title={offline ? "You're offline — changes will sync when you reconnect" : "Sync now"}
      className={cn(
        "flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-medium transition-colors",
        offline
          ? "border-amber-500/30 bg-amber-500/10 text-amber-600"
          : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      {syncing ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : offline ? (
        <CloudOff className="h-3 w-3" />
      ) : (
        <Cloud className="h-3 w-3" />
      )}
      <span className="tnum">{label}</span>
      {!syncing && <RefreshCw className="h-3 w-3 opacity-60" />}
    </button>
  );
}
