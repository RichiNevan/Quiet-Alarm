/**
 * Module-level singleton bridge so sample audio can be stopped from the audio
 * engine (AVSWeb / SessionManager via useSettingsPlayback) even when
 * SampleToggler is unmounted (e.g. EffectsMenu closed while session is active).
 */

let _webPlayer: any = null;
let _mobilePlayer: any = null;
let _webStatusListener: any = null;
let _mobileStatusListener: any = null;
let _mobileDownloadProgressListener: any = null;
let _mobileCachedSampleListener: any = null;
let _webSessionAudioContext: AudioContext | null = null;
let _webSessionAudioDestination: AudioNode | null = null;
const _webSessionAudioListeners = new Set<
  (context: AudioContext | null, destination: AudioNode | null) => void
>();

export function registerWebSoundscapePlayer(player: any): void {
  _webPlayer = player;
  _webPlayer?.setStatusListener?.(_webStatusListener);
  _webStatusListener?.(_webPlayer?.getStatus?.() || 'idle');
}

export function getRegisteredWebSoundscapePlayer(): any {
  return _webPlayer;
}

export function registerMobileSoundscapePlayer(player: any): void {
  _mobilePlayer = player;
  _mobilePlayer?.setStatusListener?.(_mobileStatusListener);
  _mobileStatusListener?.(_mobilePlayer?.getStatus?.() || 'idle');
}

export function getRegisteredMobileSoundscapePlayer(): any {
  return _mobilePlayer;
}

export function setRegisteredWebSoundscapeStatusListener(listener: any): void {
  _webStatusListener = listener;
  _webPlayer?.setStatusListener?.(listener);
  listener?.(_webPlayer?.getStatus?.() || 'idle');
}

export function setRegisteredMobileSoundscapeStatusListener(
  listener: any,
): void {
  _mobileStatusListener = listener;
  _mobilePlayer?.setStatusListener?.(listener);
  listener?.(_mobilePlayer?.getStatus?.() || 'idle');
}

export function setRegisteredMobileSoundscapeDownloadProgressListener(
  listener: any,
): void {
  _mobileDownloadProgressListener = listener;
}

export function notifyRegisteredMobileSoundscapeDownloadProgress(
  progress: number,
): void {
  _mobileDownloadProgressListener?.(progress);
}

export function setRegisteredMobileSoundscapeCachedSampleListener(
  listener: any,
): void {
  _mobileCachedSampleListener = listener;
}

export function notifyRegisteredMobileSoundscapeCachedSample(sample: any): void {
  _mobileCachedSampleListener?.(sample);
}

export async function disposeRegisteredSoundscapePlayers(): Promise<void> {
  const webPlayer = _webPlayer;
  const mobilePlayer = _mobilePlayer;

  _webPlayer = null;
  _mobilePlayer = null;

  try {
    webPlayer?.setStatusListener?.(null);
    webPlayer?.dispose?.();
  } catch {}

  try {
    mobilePlayer?.setStatusListener?.(null);
    await mobilePlayer?.dispose?.();
  } catch {}

  _webStatusListener?.('idle');
  _mobileStatusListener?.('idle');
}

/**
 * Stops the active soundscape player (web or mobile) for the current session.
 *
 * Callers:
 * - audio/webAVS.js AVSWeb.stop() — web explicit stop
 * - contexts/settings/useSettingsPlayback.ts handleStop() — mobile stop
 * - contexts/settings/useSettingsSessionInit.ts onSessionEnd — mobile and web natural session end (two call sites)
 * - hooks/sessionScreen/useSessionScreenPlayback.ts pauseSession() — pause button and interruption pause
 * - components/sessionScreen/SelectedSessionView.js stopEmbeddedRoomPlayback — embedded room stop/grace/exit (three call sites)
 *
 * Note: AVSWeb.pause() intentionally does not call this directly. Soundscape stop
 * on pause is owned by the UI pause path (pauseSession), not the engine, so that
 * any future programmatic pause that bypasses the UI is an explicit opt-in.
 */
/**
 * Web-only: lets the active Worklet/WASM session engine publish its
 * `AudioContext` and the master-bus `AudioNode` the soundscape should mix into.
 * The soundscape player reads through the bridge so it never has to reach into
 * the engine internals.
 *
 * Passing `null` for both args unregisters the current context, which the
 * engine should do on `destroy()` so a stale handle does not survive an
 * engine swap.
 */
export function registerWebSessionAudioContext(
  context: AudioContext | null,
  destination: AudioNode | null,
): void {
  _webSessionAudioContext = context;
  _webSessionAudioDestination = destination;
  _webSessionAudioListeners.forEach((listener) => {
    try {
      listener(_webSessionAudioContext, _webSessionAudioDestination);
    } catch {}
  });
}

export function getRegisteredWebSessionAudioContext(): {
  context: AudioContext | null;
  destination: AudioNode | null;
} {
  return {
    context: _webSessionAudioContext,
    destination: _webSessionAudioDestination,
  };
}

export function subscribeWebSessionAudioContext(
  listener: (
    context: AudioContext | null,
    destination: AudioNode | null,
  ) => void,
): () => void {
  _webSessionAudioListeners.add(listener);
  listener(_webSessionAudioContext, _webSessionAudioDestination);
  return () => {
    _webSessionAudioListeners.delete(listener);
  };
}

export function stopSoundscapeForSession(): Promise<void> | void {
  _webPlayer?.shutdown?.();
  if (_mobilePlayer?.shutdown) {
    return _mobilePlayer.shutdown();
  }
  return undefined;
}
