// Subscribes to the sync engine's status and exposes the current version
// counter, which bumps after every sync so `useOfflineStore` re-reads IDB.

import { useEffect, useState } from "react";
import { subscribeSync, type SyncState } from "@/lib/syncEngine";

export function useSync() {
  const [state, setState] = useState<SyncState>(() => ({
    status: "idle",
    pending: 0,
    lastSyncAt: null,
  }));
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let prevStatus = "";
    return subscribeSync((s) => {
      setState(s);
      if (prevStatus === "syncing" && s.status === "idle") setVersion((v) => v + 1);
      prevStatus = s.status;
    });
  }, []);

  return {
    status: state.status,
    pending: state.pending,
    lastSyncAt: state.lastSyncAt,
    isSyncing: state.status === "syncing",
    version,
  };
}
