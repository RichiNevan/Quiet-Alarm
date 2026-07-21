// Shared playback envelope: fade in, hold, fade out. The fade shape (ramp-in
// / fade-out) is fixed; total duration is per-alarm (src/lib/alarms/types.ts
// Alarm.durationSeconds, picked via TimeWheelPicker). Kept identical on
// Android (modules/alarm-engine/.../AlarmAudioService.kt — literal
// duplicate, Kotlin can't import this file) so both platforms sound the same.
export const RAMP_IN_MS = 10_000;
export const FADE_OUT_MS = 2_000;

// TimeWheelPicker.tsx mirrors these (its own MIN_SECONDS/MAX_SECONDS
// constants — can't import across the wheel's standalone-component style).
export const MIN_DURATION_SECONDS = 60;
export const MAX_DURATION_SECONDS = 3600;
// Matches the catalog presets' own authored length (audioPresets/*.json
// header.d === 900) — the length the sound designer built them to run for.
export const DEFAULT_DURATION_SECONDS = 900;

/** Steady (full-volume) time within a session of `totalPlayMs`, after the
 * fixed ramp-in and before the fixed fade-out. Floored at 0 for a
 * pathologically short total (shouldn't happen given MIN_DURATION_SECONDS,
 * but a session shorter than the envelope itself must not go negative). */
export function steadyMs(totalPlayMs: number): number {
  return Math.max(0, totalPlayMs - RAMP_IN_MS - FADE_OUT_MS);
}

export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h <= 0 ? `${m} min` : `${h}h ${m}m`;
}
