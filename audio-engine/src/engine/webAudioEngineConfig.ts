export const WEB_AUDIO_ENGINE_WORKLET_WASM = 'worklet_wasm';
export const DEFAULT_WEB_AUDIO_ENGINE = WEB_AUDIO_ENGINE_WORKLET_WASM;
export const WEB_AUDIO_ENGINE_LOCAL_OVERRIDE_KEY =
  'biosyncare:webAudioEngineOverride';

export type WebAudioEngineMode = typeof WEB_AUDIO_ENGINE_WORKLET_WASM;

export type WebAudioEngineSupport = {
  audioContextSupported: boolean;
  audioWorkletNodeSupported: boolean;
  secureContext: boolean;
  wasmSupported: boolean;
  workletWasmSupported: boolean;
};

export type WebAudioEngineResolution = {
  requestedEngine: WebAudioEngineMode;
  effectiveEngine: WebAudioEngineMode;
  fallbackReason: string | null;
  source: 'global' | 'local';
  support: WebAudioEngineSupport;
};

// Worklet/WASM is the only web engine since the Tone.js removal (2026-06-05),
// so engine resolution is a constant and needs no Firestore read. The
// `general/webAudioConfig` doc remains admin-writable for a future rollout
// knob, but nothing may await it on a playback path: the previous awaited
// `getDoc` could stall `AVSWeb` construction and `start()` on Safari — see
// referenceDocuments/currentWork/PLATFORM_ROOM_STABILITY_PLAN.md § D3.
export const normalizeWebAudioEngineMode = (
  _value: unknown,
): WebAudioEngineMode =>
  WEB_AUDIO_ENGINE_WORKLET_WASM;

export const isWebAudioEngineMode = (
  value: unknown,
): value is WebAudioEngineMode =>
  value === WEB_AUDIO_ENGINE_WORKLET_WASM;

const getBrowserStorage = (): Storage | null => {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    return window.localStorage;
  } catch {
    return null;
  }
};

export const readLocalWebAudioEngineOverride = (): WebAudioEngineMode | null => {
  const storage = getBrowserStorage();
  if (!storage) return null;

  const storedValue = storage.getItem(WEB_AUDIO_ENGINE_LOCAL_OVERRIDE_KEY);
  if (!storedValue) return null;
  if (isWebAudioEngineMode(storedValue)) return storedValue;

  storage.removeItem(WEB_AUDIO_ENGINE_LOCAL_OVERRIDE_KEY);
  return null;
};

export const writeLocalWebAudioEngineOverride = (
  value: WebAudioEngineMode,
) => {
  const storage = getBrowserStorage();
  if (!storage) return false;
  storage.setItem(WEB_AUDIO_ENGINE_LOCAL_OVERRIDE_KEY, value);
  return true;
};

export const clearLocalWebAudioEngineOverride = () => {
  const storage = getBrowserStorage();
  if (!storage) return false;
  storage.removeItem(WEB_AUDIO_ENGINE_LOCAL_OVERRIDE_KEY);
  return true;
};

export function getWebAudioEngineSupport(): WebAudioEngineSupport {
  const scope = typeof globalThis !== 'undefined' ? (globalThis as any) : {};
  const win = typeof window !== 'undefined' ? window : null;
  const audioContextSupported =
    typeof scope.AudioContext === 'function' ||
    typeof scope.webkitAudioContext === 'function';
  const audioWorkletNodeSupported =
    typeof scope.AudioWorkletNode === 'function';
  const wasmSupported =
    typeof scope.WebAssembly === 'object' &&
    typeof scope.WebAssembly.instantiate === 'function';
  const secureContext = !win || win.isSecureContext !== false;

  return {
    audioContextSupported,
    audioWorkletNodeSupported,
    secureContext,
    wasmSupported,
    workletWasmSupported:
      audioContextSupported &&
      audioWorkletNodeSupported &&
      secureContext &&
      wasmSupported,
  };
}

export function resolveCachedWebAudioEngine(): WebAudioEngineResolution {
  const localOverride = readLocalWebAudioEngineOverride();
  const support = getWebAudioEngineSupport();

  return {
    requestedEngine: localOverride ?? DEFAULT_WEB_AUDIO_ENGINE,
    effectiveEngine: WEB_AUDIO_ENGINE_WORKLET_WASM,
    fallbackReason: support.workletWasmSupported
      ? null
      : 'worklet_wasm_unsupported',
    source: localOverride ? 'local' : 'global',
    support,
  };
}
