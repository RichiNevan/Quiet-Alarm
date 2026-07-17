/**
 * Background session stop guard (Android only).
 *
 * Why this exists: on Android, React Native pauses ALL JS timers the moment the
 * host activity pauses (JavaTimerManager.onHostPause — screen off or app
 * backgrounded). SessionManager's setInterval countdown therefore never fires in
 * the background, so a session that expires while backgrounded keeps playing
 * forever. iOS is unaffected (UIBackgroundModes audio keeps JS timers running).
 *
 * The loophole: native→JS *events* are still delivered while RN timers are
 * paused — only the timer tick loop stops, not the JS thread. expo-av drives its
 * playback-status callbacks from a native Android Handler loop (ProgressLooper),
 * which keeps firing in the background; the soundscape player already relies on
 * expo-av playback surviving backgrounding.
 *
 * So: while a session is playing we keep a muted, looping, generated-silence
 * expo-av sound alive purely as a background clock. Its 1 Hz status callbacks
 * check the wall-clock remaining time and, on expiry, fire the exact same stop
 * path as SessionManager's foreground timer (onSessionEnd → soundscape shutdown
 * included, then stop()). No notification, no foreground service, no rebuild.
 *
 * Every step is failure-isolated: if anything here throws (module missing, file
 * write fails, player fails), the guard silently does nothing and the session
 * plays exactly as before — the guard must never be able to break playback.
 */

type GuardManager = {
  getState?: () => string;
  getRemainingTime?: () => number;
  onSessionEnd?: (() => void) | null;
  stop?: () => void;
  state?: string;
};

const TICK_INTERVAL_MS = 1000;
const SILENCE_FILENAME = 'bsc-background-clock-silence.wav';

let activeGeneration = 0;
let activeSound: any = null;
let silenceUriPromise: Promise<string | null> | null = null;

function isAndroid(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('react-native').Platform?.OS === 'android';
  } catch {
    return false;
  }
}

// Minimal base64 encoder so we don't depend on a global btoa being present.
const BASE64_CHARS =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
export function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += BASE64_CHARS[b0 >> 2];
    out += BASE64_CHARS[((b0 & 3) << 4) | (b1 >> 4)];
    out +=
      i + 1 < bytes.length ? BASE64_CHARS[((b1 & 15) << 2) | (b2 >> 6)] : '=';
    out += i + 2 < bytes.length ? BASE64_CHARS[b2 & 63] : '=';
  }
  return out;
}

// 1 second of 8 kHz mono 16-bit PCM silence wrapped in a canonical WAV header.
export function buildSilentWavBytes(
  seconds = 1,
  sampleRate = 8000,
): Uint8Array {
  const numSamples = Math.max(1, Math.floor(seconds * sampleRate));
  const dataSize = numSamples * 2;
  const bytes = new Uint8Array(44 + dataSize); // PCM zeros = silence
  const writeStr = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) {
      bytes[offset + i] = text.charCodeAt(i);
    }
  };
  const writeU32 = (offset: number, value: number) => {
    bytes[offset] = value & 255;
    bytes[offset + 1] = (value >> 8) & 255;
    bytes[offset + 2] = (value >> 16) & 255;
    bytes[offset + 3] = (value >>> 24) & 255;
  };
  const writeU16 = (offset: number, value: number) => {
    bytes[offset] = value & 255;
    bytes[offset + 1] = (value >> 8) & 255;
  };

  writeStr(0, 'RIFF');
  writeU32(4, 36 + dataSize);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  writeU32(16, 16); // PCM fmt chunk size
  writeU16(20, 1); // PCM
  writeU16(22, 1); // mono
  writeU32(24, sampleRate);
  writeU32(28, sampleRate * 2); // byte rate
  writeU16(32, 2); // block align
  writeU16(34, 16); // bits per sample
  writeStr(36, 'data');
  writeU32(40, dataSize);
  return bytes;
}

async function ensureSilenceUri(): Promise<string | null> {
  if (!silenceUriPromise) {
    silenceUriPromise = (async () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const FileSystem = require('expo-file-system/legacy');
        const directory = FileSystem.cacheDirectory;
        if (!directory) return null;
        const uri = `${directory}${SILENCE_FILENAME}`;
        const info = await FileSystem.getInfoAsync(uri);
        if (!info?.exists) {
          await FileSystem.writeAsStringAsync(
            uri,
            bytesToBase64(buildSilentWavBytes()),
            { encoding: FileSystem.EncodingType.Base64 },
          );
        }
        return uri;
      } catch (e) {
        console.warn('[backgroundStopGuard] silence file failed:', e);
        return null;
      }
    })();
  }
  return silenceUriPromise;
}

async function unloadSound(sound: any) {
  if (!sound) return;
  try {
    sound.setOnPlaybackStatusUpdate?.(null);
  } catch {}
  try {
    await sound.stopAsync?.();
  } catch {}
  try {
    await sound.unloadAsync?.();
  } catch {}
}

// Mirrors the expiry branch of SessionManager._startTimer exactly: the
// onSessionEnd callback (which also shuts the soundscape down via
// stopSoundscapeForSession in useSettingsSessionInit) followed by stop().
function fireSessionExpiry(manager: GuardManager) {
  try {
    manager.onSessionEnd?.();
  } catch (e) {
    console.warn('[backgroundStopGuard] onSessionEnd failed:', e);
  }
  try {
    manager.stop?.();
  } catch (e) {
    console.warn('[backgroundStopGuard] stop failed:', e);
  }
}

export function startBackgroundSessionStopGuard(manager: GuardManager): void {
  if (!isAndroid() || !manager) return;

  const generation = ++activeGeneration;
  const previous = activeSound;
  activeSound = null;
  if (previous) void unloadSound(previous);

  void (async () => {
    try {
      const uri = await ensureSilenceUri();
      if (!uri || generation !== activeGeneration) return;

      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { Audio } = require('expo-av');
      const { sound } = await Audio.Sound.createAsync(
        { uri },
        {
          shouldPlay: true,
          isLooping: true,
          volume: 0,
          isMuted: true,
          progressUpdateIntervalMillis: TICK_INTERVAL_MS,
        },
      );

      if (generation !== activeGeneration) {
        await unloadSound(sound);
        return;
      }
      activeSound = sound;

      sound.setOnPlaybackStatusUpdate?.((status: any) => {
        if (generation !== activeGeneration) return;
        if (!status?.isLoaded) return;

        const state = manager.getState ? manager.getState() : manager.state;
        if (state !== 'playing') return;

        const remaining = manager.getRemainingTime?.();
        if (typeof remaining === 'number' && remaining <= 0) {
          // Tear the clock down first so stop() re-entry is a no-op.
          stopBackgroundSessionStopGuard();
          fireSessionExpiry(manager);
        }
      });
    } catch (e) {
      // Never let the guard break playback — degrade to foreground-only stop.
      console.warn('[backgroundStopGuard] start failed:', e);
    }
  })();
}

export function stopBackgroundSessionStopGuard(): void {
  activeGeneration += 1;
  const sound = activeSound;
  activeSound = null;
  if (sound) void unloadSound(sound);
}
