import { AppState, Platform } from "react-native";

import { reconcileAndroid } from "./androidScheduler";
import { reconcile as reconcileIos } from "./iosEngine";
import { computeNextOccurrence } from "./nextOccurrence";
import { loadAlarms, saveAlarms } from "./storage";
import type { Alarm, AlarmDraft } from "./types";

/**
 * Module-level store shared by every screen that calls useAlarms(). Each
 * screen previously held its own private `useState`, so an add on the edit
 * screen never reached the still-mounted list screen underneath it — a real
 * bug (alarm silently missing from the list "sometimes", depending on
 * whether the list screen happened to remount). A single source of truth
 * read via useSyncExternalStore fixes that by construction: there is
 * exactly one `alarms` array, and every subscriber re-renders on any change
 * regardless of which screen made it.
 */

interface StoreState {
  alarms: Alarm[];
  loaded: boolean;
}

let state: StoreState = { alarms: [], loaded: false };
const listeners = new Set<() => void>();

function setState(next: StoreState) {
  state = next;
  listeners.forEach((l) => l());
}

export function getSnapshot(): StoreState {
  return state;
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function reconcilePlatform(alarms: Alarm[]) {
  if (Platform.OS === "android") {
    void reconcileAndroid(alarms);
  } else if (Platform.OS === "ios") {
    reconcileIos(alarms);
  }
}

// One-shot alarms that already fired (no repeat days, next occurrence is
// null) are stale "enabled" state — flip them off so the UI doesn't lie.
function settleFiredOneShots(alarms: Alarm[]): Alarm[] {
  let changed = false;
  const next = alarms.map((a) => {
    if (a.enabled && a.repeatDays.length === 0 && computeNextOccurrence(a) == null) {
      changed = true;
      return { ...a, enabled: false };
    }
    return a;
  });
  return changed ? next : alarms;
}

async function persistAndReconcile(next: Alarm[]) {
  setState({ alarms: next, loaded: true });
  await saveAlarms(next);
  reconcilePlatform(next);
}

let initPromise: Promise<void> | null = null;

/** Idempotent — safe to call from every screen's mount effect. */
export function ensureAlarmsLoaded(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      const stored = settleFiredOneShots(await loadAlarms());
      setState({ alarms: stored, loaded: true });
      reconcilePlatform(stored);
    })();
  }
  return initPromise;
}

// Registered once at module load (not per-screen-mount, unlike the old
// per-hook AppState listener this replaces) — re-reconciles on foreground
// to catch iOS's soonest-alarm re-arm and settle one-shots that fired while
// the app wasn't running.
AppState.addEventListener("change", (appState) => {
  if (appState !== "active" || !state.loaded) return;
  const settled = settleFiredOneShots(state.alarms);
  if (settled !== state.alarms) {
    void persistAndReconcile(settled);
  } else {
    reconcilePlatform(state.alarms);
  }
});

export async function addAlarm(draft: AlarmDraft): Promise<Alarm> {
  const alarm: Alarm = {
    ...draft,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: Date.now(),
  };
  await persistAndReconcile([...state.alarms, alarm]);
  return alarm;
}

export async function updateAlarm(id: string, patch: Partial<AlarmDraft>): Promise<void> {
  await persistAndReconcile(state.alarms.map((a) => (a.id === id ? { ...a, ...patch } : a)));
}

export async function removeAlarm(id: string): Promise<void> {
  await persistAndReconcile(state.alarms.filter((a) => a.id !== id));
}

export async function toggleAlarm(id: string, enabled: boolean): Promise<void> {
  await updateAlarm(id, { enabled });
}
