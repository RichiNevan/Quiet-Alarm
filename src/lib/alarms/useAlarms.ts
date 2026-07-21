import { useEffect, useSyncExternalStore } from "react";

import {
  addAlarm,
  ensureAlarmsLoaded,
  getSnapshot,
  removeAlarm,
  subscribe,
  toggleAlarm,
  updateAlarm,
} from "./alarmsStore";

/** Thin view over the shared alarmsStore — see alarmsStore.ts for why this
 * has to be a single external store rather than a per-screen useState. */
export function useAlarms() {
  const { alarms, loaded } = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  useEffect(() => {
    void ensureAlarmsLoaded();
  }, []);

  return { alarms, loaded, addAlarm, updateAlarm, removeAlarm, toggleAlarm };
}
