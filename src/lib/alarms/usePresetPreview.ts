import { ensureCustomNodesInstalled, SessionManager } from "@biosyncare/audio-engine";
import { useCallback, useEffect, useRef, useState } from "react";

import { getPreset } from "./presets";
import { FADE_OUT_MS } from "./timing";
import type { PresetId } from "./types";

const PREVIEW_MS = 10_000;

/**
 * Short-lived audition of a preset's sound from the alarm editor — deliberately
 * a fresh SessionManager, never the module-level singleton in iosEngine.ts,
 * which is reserved for the one real armed alarm and must not be clobbered by
 * a preview started while an alarm is soon due.
 */
export function usePresetPreview() {
  const [previewingId, setPreviewingId] = useState<PresetId | null>(null);

  const smRef = useRef<InstanceType<typeof SessionManager> | null>(null);
  const autoStopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cleanupTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimers = useCallback(() => {
    if (autoStopTimerRef.current) {
      clearTimeout(autoStopTimerRef.current);
      autoStopTimerRef.current = null;
    }
    if (cleanupTimerRef.current) {
      clearTimeout(cleanupTimerRef.current);
      cleanupTimerRef.current = null;
    }
  }, []);

  // fadeMs=0 on unmount/replace: the screen is going away or a new preview is
  // about to start, so there's no listener left to notice a click either way.
  const stop = useCallback(
    (fadeMs: number = FADE_OUT_MS) => {
      clearTimers();
      const sm = smRef.current;
      smRef.current = null;
      setPreviewingId(null);
      if (!sm) return;
      try {
        sm.stop({ fadeMs });
      } catch {
        // best-effort
      }
      // SessionManager.stop() schedules its own internal cleanup at `fadeMs`
      // (see SessionManager.js); wait a beat past that before destroy(), or
      // its call into stop() again re-triggers the stop machinery on stale
      // 'stopped' state instead of finding 'idle' and skipping (harmless, but
      // redundant — matches the buffer iosEngine.ts uses for the same reason).
      cleanupTimerRef.current = setTimeout(() => {
        sm.destroy();
      }, fadeMs + 500);
    },
    [clearTimers],
  );

  const start = useCallback(
    async (id: PresetId) => {
      stop(0);

      if (!ensureCustomNodesInstalled()) {
        return;
      }

      const sm = new SessionManager();
      smRef.current = sm;
      setPreviewingId(id);
      try {
        sm.loadPreset(getPreset(id).data);
        await sm.start();
      } catch {
        if (smRef.current === sm) {
          smRef.current = null;
          setPreviewingId(null);
        }
        try {
          sm.destroy();
        } catch {
          // best-effort
        }
        return;
      }

      // start() may have lost the race against a stop()/unmount that fired
      // while it was awaiting.
      if (smRef.current !== sm) {
        try {
          sm.stop({ fadeMs: 0 });
          sm.destroy();
        } catch {
          // best-effort
        }
        return;
      }

      autoStopTimerRef.current = setTimeout(() => stop(), PREVIEW_MS);
    },
    [stop],
  );

  const togglePreview = useCallback(
    (id: PresetId) => {
      if (previewingId === id) {
        stop();
      } else {
        void start(id);
      }
    },
    [previewingId, start, stop],
  );

  useEffect(() => () => stop(0), [stop]);

  return { previewingId, togglePreview, stopPreview: stop };
}
