import { ensureCustomNodesInstalled, SessionManager } from "@biosyncare/audio-engine";
import { AudioManager } from "react-native-audio-api";

import { appendAlarmLog } from "./alarmLog";
import { computeNextOccurrence } from "./nextOccurrence";
import { getPreset } from "./presets";
import { FADE_OUT_MS, RAMP_IN_MS, steadyMs } from "./timing";
import type { Alarm } from "./types";

/**
 * iOS has no exact-alarm API for third parties that stays quiet (AlarmKit
 * forces a full-screen alert — see docs/feasibility-and-test-protocol.md).
 * The only validated path (IOS-1/IOS-2) is keeping the app's audio session
 * alive: load the real preset and start it at volume 0 the moment an alarm
 * is armed, let it run silently until T, then ramp up. That means, unlike
 * Android, only ONE alarm can be "live-armed" at a time — this module
 * always arms the single soonest enabled alarm and re-arms the next one
 * automatically once the current one finishes. The user must not force-quit
 * the app; locking the phone is fine (that's the whole point).
 */

const RAMP_STEP_MS = 250;

export type IosEngineStatus =
  | { phase: "idle" }
  | { phase: "armed"; alarmId: string; targetEpochMs: number }
  | { phase: "ramping" | "playing"; alarmId: string };

let status: IosEngineStatus = { phase: "idle" };
const listeners = new Set<(s: IosEngineStatus) => void>();

function setStatus(next: IosEngineStatus) {
  status = next;
  listeners.forEach((l) => l(status));
}

export function getIosEngineStatus(): IosEngineStatus {
  return status;
}

export function subscribeIosEngine(
  listener: (s: IosEngineStatus) => void,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Lazily created, long-lived: recreating the AudioContext would mean
// re-opening the audio session (and losing the keep-alive) on every rearm.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let sm: any = null;
let interruptionSub: { remove: () => void } | null = null;
let fireTimer: ReturnType<typeof setTimeout> | null = null;
let rampInterval: ReturnType<typeof setInterval> | null = null;
let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
let armedAlarmId: string | null = null;
let currentAlarms: Alarm[] = [];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ensureSessionManager(): any {
  if (!sm) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sm = new (SessionManager as any)();
  }
  return sm;
}

function ensureInterruptionHandling() {
  if (interruptionSub) return;
  try {
    AudioManager.setAudioSessionOptions({
      iosCategory: "playback",
      iosMode: "default",
      iosOptions: [],
    });
    AudioManager.observeAudioInterruptions(true);
    interruptionSub = AudioManager.addSystemEventListener(
      "interruption",
      (event) => {
        appendAlarmLog(
          `interruption_${event.type}\tshouldResume=${event.shouldResume}`,
        );
        if (event.type === "ended" && sm) {
          try {
            AudioManager.setAudioSessionActivity(true);
            sm.audioContext?.resume?.();
            appendAlarmLog("interruption_resume_attempted");
          } catch (e) {
            appendAlarmLog(`interruption_resume_FAILED\t${e}`);
          }
        }
      },
    );
  } catch (e) {
    appendAlarmLog(`interruption_setup_FAILED\t${e}`);
  }
}

function clearTimers() {
  if (fireTimer) {
    clearTimeout(fireTimer);
    fireTimer = null;
  }
  if (rampInterval) {
    clearInterval(rampInterval);
    rampInterval = null;
  }
}

function startHeartbeat() {
  if (heartbeatInterval) return;
  heartbeatInterval = setInterval(() => {
    appendAlarmLog(`hb\tctxState=${sm?.audioContext?.state ?? "?"}`);
  }, 60_000);
}

function stopHeartbeat() {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
}

async function armAlarm(alarm: Alarm, targetEpochMs: number) {
  // Idempotent — safe (and required, per INTEGRATION.md) before every
  // session start. _layout.tsx also calls this once at app boot, but that
  // alone isn't enough: this module runs asynchronously and needs its own
  // guarantee independent of mount order.
  if (!ensureCustomNodesInstalled()) {
    appendAlarmLog(`arm_start_FAILED\tid=${alarm.id}\tcustom nodes not installed`);
    setStatus({ phase: "idle" });
    return;
  }

  const engine = ensureSessionManager();
  ensureInterruptionHandling();

  const preset = getPreset(alarm.presetId);
  try {
    engine.loadPreset(preset.data);
    // start() is async (see SessionManager.js) — awaiting is required for
    // this try/catch to actually catch a rejection instead of letting it
    // surface as an unhandled promise rejection.
    await engine.start();
    engine.setMasterVolume(0);
  } catch (e) {
    appendAlarmLog(`arm_start_FAILED\tid=${alarm.id}\t${e}`);
    setStatus({ phase: "idle" });
    return;
  }

  armedAlarmId = alarm.id;
  setStatus({ phase: "armed", alarmId: alarm.id, targetEpochMs });
  appendAlarmLog(
    `armed_ios\tid=${alarm.id}\ttarget=${new Date(targetEpochMs).toISOString()}`,
  );
  startHeartbeat();

  const delayMs = Math.max(0, targetEpochMs - Date.now());
  fireTimer = setTimeout(() => fireAlarm(alarm, targetEpochMs), delayMs);
}

function fireAlarm(alarm: Alarm, targetEpochMs: number) {
  const engine = sm;
  if (!engine) return;
  const driftMs = Date.now() - targetEpochMs;
  appendAlarmLog(`ramp_started\tid=${alarm.id}\tdrift_ms=${driftMs}`);
  setStatus({ phase: "ramping", alarmId: alarm.id });

  const rampSteps = Math.ceil(RAMP_IN_MS / RAMP_STEP_MS);
  let step = 0;
  rampInterval = setInterval(() => {
    step++;
    const v = Math.min(1, step / rampSteps);
    try {
      engine.setMasterVolume(v);
    } catch {
      // engine may have been torn down concurrently; ramp is best-effort
    }
    if (step >= rampSteps) {
      if (rampInterval) clearInterval(rampInterval);
      rampInterval = null;
      appendAlarmLog(`ramp_done\tid=${alarm.id}`);
      setStatus({ phase: "playing", alarmId: alarm.id });
    }
  }, RAMP_STEP_MS);

  fireTimer = setTimeout(() => {
    appendAlarmLog(`stop_scheduled\tid=${alarm.id}`);
    try {
      engine.stop({ fadeMs: FADE_OUT_MS });
    } catch (e) {
      appendAlarmLog(`stop_FAILED\tid=${alarm.id}\t${e}`);
    }
    // stop() fades over FADE_OUT_MS, then the engine's own cleanup flips
    // state back to 'idle' asynchronously (see SessionManager.stop()) —
    // wait a beat longer than the fade before treating it as done, or a
    // loadPreset() for the next alarm would silently no-op on stale state.
    fireTimer = setTimeout(() => {
      armedAlarmId = null;
      stopHeartbeat();
      setStatus({ phase: "idle" });
      appendAlarmLog(`session_idle\tid=${alarm.id}`);
      reconcile(currentAlarms);
    }, FADE_OUT_MS + 500);
  }, steadyMs(alarm.durationSeconds * 1000));
}

function disarmCurrent(onDone?: () => void) {
  clearTimers();
  stopHeartbeat();
  if (sm && armedAlarmId) {
    try {
      sm.stop({ fadeMs: 0 });
    } catch {
      // best-effort
    }
    armedAlarmId = null;
    setStatus({ phase: "idle" });
    // Same asynchronous-cleanup caveat as above — give stop()'s internal
    // setTimeout(0) a tick before the caller loads a new preset.
    setTimeout(() => onDone?.(), 60);
    return;
  }
  armedAlarmId = null;
  setStatus({ phase: "idle" });
  onDone?.();
}

/**
 * Call whenever the alarm list changes (add/edit/delete/toggle) and once on
 * app foreground. Arms the single soonest enabled alarm; leaves an
 * actively-firing alarm alone.
 */
export function reconcile(alarms: Alarm[]) {
  currentAlarms = alarms;

  let soonest: { alarm: Alarm; targetEpochMs: number } | null = null;
  for (const alarm of alarms) {
    const next = computeNextOccurrence(alarm);
    if (next == null) continue;
    if (!soonest || next < soonest.targetEpochMs) {
      soonest = { alarm, targetEpochMs: next };
    }
  }

  if (status.phase === "ramping" || status.phase === "playing") {
    return; // an alarm is actively firing — never interrupt it
  }

  if (!soonest) {
    if (armedAlarmId) disarmCurrent();
    return;
  }

  if (armedAlarmId === soonest.alarm.id && status.phase === "armed") {
    return; // already correctly armed
  }

  disarmCurrent(() => armAlarm(soonest.alarm, soonest.targetEpochMs));
}

export function stopPlaybackNow() {
  if (sm) {
    try {
      sm.stop({ fadeMs: FADE_OUT_MS });
    } catch (e) {
      appendAlarmLog(`manual_stop_FAILED\t${e}`);
    }
  }
  clearTimers();
  stopHeartbeat();
  armedAlarmId = null;
  setStatus({ phase: "idle" });
  appendAlarmLog("stopped_by_user");
}
