import { useMemo } from "react";
import { addDays, localToday } from "@shared/analytics";
import { useOfflineStore } from "./useOfflineStore";

/**
 * Loads the activity log for a window ending today from the offline store.
 * The store is the source of truth; the sync engine keeps it reconciled with
 * the server in the background, so this works with the network fully off.
 */
export function useActivityLog(days = 90) {
  const today = localToday();
  const from = addDays(today, -(days - 1));

  const { activities, loading, isSyncing } = useOfflineStore();

  const rows = useMemo(
    () => activities.filter((r) => r.activityDate >= from && r.activityDate <= today),
    [activities, from, today],
  );

  return {
    today,
    from,
    rows,
    isLoading: loading,
    isError: false,
    isSeeding: false,
    isSyncing,
    refetch: () => Promise.resolve(),
  };
}
