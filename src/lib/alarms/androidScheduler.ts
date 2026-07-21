import { AlarmScheduler } from "../../../modules/alarm-engine";
import { computeNextOccurrence } from "./nextOccurrence";
import { getPreset } from "./presets";
import { ensurePresetRendered, getCachedRenderPath } from "./renderPresetAndroid";
import type { Alarm } from "./types";

/**
 * Reconciles the full alarm list against the native AlarmManager state.
 * Unlike iOS, Android can keep every enabled alarm armed simultaneously —
 * that's the whole point of the exact-alarm + foreground-service chain
 * validated in docs/feasibility-and-test-protocol.md AND-1..7.
 */
export async function reconcileAndroid(alarms: Alarm[]): Promise<void> {
  if (!AlarmScheduler) return;

  const enabled = alarms.filter((a) => a.enabled);
  const enabledIds = new Set(enabled.map((a) => a.id));

  let status;
  try {
    status = await AlarmScheduler.getStatus();
  } catch (e) {
    console.warn("[alarms] getStatus failed", e);
    return;
  }

  // Cancel anything armed natively that's no longer in the enabled set
  // (deleted or toggled off).
  await Promise.all(
    status.armedIds
      .filter((id) => !enabledIds.has(id))
      .map((id) => AlarmScheduler!.cancel(id).catch(() => {})),
  );

  await Promise.all(
    enabled.map(async (alarm) => {
      const targetEpochMs = computeNextOccurrence(alarm);
      if (targetEpochMs == null) return;

      const preset = getPreset(alarm.presetId);
      // Best-effort real content: use whatever's cached right now so arming
      // isn't blocked on a render; kick a (re)render in the background so
      // next time it's ready. First-ever arm for a preset falls back to the
      // bundled tone for this one firing if no cache exists yet.
      const cachedUri = getCachedRenderPath(preset.id);
      void ensurePresetRendered(preset);

      try {
        await AlarmScheduler!.arm({
          id: alarm.id,
          targetEpochMs,
          hour: alarm.hour,
          minute: alarm.minute,
          repeatDays: alarm.repeatDays,
          audioUri: cachedUri,
          presetLabel: preset.label,
          durationMs: alarm.durationSeconds * 1000,
        });
      } catch (e) {
        console.warn(`[alarms] arm failed for ${alarm.id}`, e);
      }
    }),
  );
}
