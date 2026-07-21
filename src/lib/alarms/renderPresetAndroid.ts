import { ensureCustomNodesInstalled, SessionManager } from "@biosyncare/audio-engine";
import { File, Paths } from "expo-file-system";
import { AudioManager, OfflineAudioContext } from "react-native-audio-api";

import type { PresetOption } from "./presets";
import { encodeWav } from "./wavEncode";

/**
 * Android has no live JS when the alarm fires (see
 * docs/feasibility-and-test-protocol.md — the whole reason the Kotlin FGS
 * chain exists). So the real preset audio can't be synthesized live at fire
 * time the way it is on iOS. Instead, while the app IS alive (foreground,
 * right after the user picks/edits an alarm), we bounce the preset through
 * the real engine via an OfflineAudioContext into a plain WAV, cache it, and
 * hand the native alarm service a file path to play — reusing the exact
 * playback chain validated by the spike harness (AND-1..7), just swapping
 * the bundled placeholder tone for real content.
 *
 * This is genuinely new, unverified-on-device surface: whether the custom
 * JSI nodes (BinauralNode etc.) render correctly against an
 * OfflineAudioContext (as opposed to the live AudioContext they were
 * validated against) has not been confirmed on a real device. Every call
 * site must treat a null return as "fall back to the bundled tone", not as
 * an error to surface loudly — see modules/alarm-engine's SpikeAudioService
 * equivalent (AlarmAudioService) for the native-side fallback.
 */

const RENDER_SECONDS = 30;

function cacheFile(presetId: string): File {
  return new File(Paths.document, `alarm-render-${presetId}.wav`);
}

/** Returns a cached render if present without doing any engine work. */
export function getCachedRenderPath(presetId: string): string | null {
  const f = cacheFile(presetId);
  return f.exists ? f.uri : null;
}

/**
 * Renders `preset` through the real audio engine for RENDER_SECONDS and
 * caches the result. Returns the file URI, or null if rendering failed for
 * any reason (logged, never thrown — callers must fall back gracefully).
 */
export async function ensurePresetRendered(
  preset: PresetOption,
  { force = false }: { force?: boolean } = {},
): Promise<string | null> {
  const out = cacheFile(preset.id);
  if (out.exists && !force) {
    return out.uri;
  }

  try {
    // Idempotent — required before any SessionManager use (see
    // INTEGRATION.md); _layout.tsx also calls this once at app boot, but
    // this render can run before that effect has committed, so don't rely
    // on mount order.
    if (!ensureCustomNodesInstalled()) {
      console.warn(
        `[alarms] custom audio nodes not installed — cannot render "${preset.id}"`,
      );
      return null;
    }

    const sampleRate = AudioManager.getDevicePreferredSampleRate() || 44100;
    const numberOfChannels = 2;
    const length = Math.round(sampleRate * RENDER_SECONDS);

    const offlineCtx = new OfflineAudioContext({
      numberOfChannels,
      length,
      sampleRate,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sm = new (SessionManager as any)({ context: offlineCtx });
    let buffer;
    try {
      sm.loadPreset(preset.data);
      buffer = await sm.renderOffline();
    } finally {
      // renderOffline() never calls start()/stop(), so state stays 'idle'
      // and destroy()'s internal stop() is a no-op — this only exists to
      // drop the AppState subscription SessionManager's constructor always
      // registers, so repeated renders don't leak listeners.
      sm.destroy();
    }

    const wavBytes = encodeWav(buffer);
    if (out.exists) out.delete();
    out.create();
    out.write(wavBytes);

    console.log(
      `[alarms] rendered ${preset.id}: ${wavBytes.byteLength} bytes @ ${sampleRate}Hz -> ${out.uri}`,
    );
    return out.uri;
  } catch (e) {
    console.warn(
      `[alarms] offline render of "${preset.id}" failed — alarm will fall back to the bundled tone`,
      e,
    );
    return null;
  }
}
