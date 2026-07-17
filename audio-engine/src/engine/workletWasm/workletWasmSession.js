import {
  DEFAULT_MASTER_VOLUME,
  dbToLinear,
  linearToDb,
} from '../AudioConfig';
import { registerWebSessionAudioContext } from '../sampleAudioBridge';
import { normalizeSharedDspVoice } from '../sharedDspConfig';
import { compileSymmetryPermutationProgram } from '../symmetryPermutationProgram';
import { VoiceType } from '../voiceTypes';
import {
  pushSessionDiagnosticEvent,
  resetSessionDiagnosticWorklet,
  setSessionDiagnosticWorkletElapsed,
  setSessionDiagnosticWorkletError,
  setSessionDiagnosticWorkletHealth,
  setSessionDiagnosticWorkletReady,
  setSessionDiagnosticWorkletStage,
} from '../webAudioShared';
import {
  getWorkletWasmProcessorSource,
  WORKLET_WASM_PROCESSOR_NAME,
} from '../workletWasm/workletWasmProcessorSource';

const WORKLET_READY_TIMEOUT_MS = 5000;
const DEFAULT_FADE_IN_MS = 2000;
const DEFAULT_PAUSE_FADE_MS = 500;
const DEFAULT_STOP_FADE_MS = 2000;
const PARAM_RAMP_MS = 500;

const isFiniteNumber = (value) =>
  typeof value === 'number' && Number.isFinite(value);

const getAudioScope = () =>
  typeof globalThis !== 'undefined' ? globalThis : {};

const createNativeAudioContext = () => {
  const scope = getAudioScope();
  const NativeAudioContext = scope.AudioContext ?? scope.webkitAudioContext;
  if (typeof NativeAudioContext !== 'function') {
    throw new Error('AudioContext is unavailable for Worklet/WASM audio.');
  }
  try {
    return new NativeAudioContext({ latencyHint: 'playback' });
  } catch {
    return new NativeAudioContext();
  }
};

// One AudioContext for the whole web session runtime, reused across engine
// rebuilds. WebKit ties audio playability to the context a user gesture
// unlocked: the room start sequence (unlock → reset → loadPreset → start)
// used to close the unlocked context during reset() and build a fresh one
// from the countdown timer, which Safari treats as never-activated — playback
// then silently failed after the countdown. Keeping one context alive
// preserves the gesture unlock; destroy() only tears down the per-session
// node graph. The worklet module is added once per context because
// re-registering the same processor name throws.
// PLATFORM_ROOM_STABILITY_PLAN § D4.
let sharedAudioContext = null;
let sharedContextModuleReady = false;

export const acquireSharedAudioContext = () => {
  if (sharedAudioContext && sharedAudioContext.state !== 'closed') {
    return sharedAudioContext;
  }
  sharedAudioContext = createNativeAudioContext();
  sharedContextModuleReady = false;
  return sharedAudioContext;
};

/**
 * Gesture-time unlock: create the shared context if needed and resume it.
 * Callable before any preset/engine exists so join/start gestures can satisfy
 * WebKit's user-activation requirement ahead of the shared countdown.
 */
// WebKit reports a non-standard 'interrupted' state after phone calls / Siri /
// route interruptions; resume() is the documented recovery for it, and with a
// long-lived shared context those interruptions now outlive engine rebuilds.
const contextNeedsResume = (context) =>
  context?.state === 'suspended' || context?.state === 'interrupted';

export const resumeSharedAudioContext = async () => {
  const context = acquireSharedAudioContext();
  if (contextNeedsResume(context)) {
    await context.resume();
  }
  return context;
};

const createWorkletUrl = () => {
  const scope = getAudioScope();
  if (
    typeof scope.Blob !== 'function' ||
    typeof scope.URL?.createObjectURL !== 'function'
  ) {
    throw new Error('Blob module URLs are unavailable for Worklet/WASM audio.');
  }

  return scope.URL.createObjectURL(
    new scope.Blob([getWorkletWasmProcessorSource()], {
      type: 'application/javascript',
    }),
  );
};

const revokeWorkletUrl = (url) => {
  const revoke = getAudioScope().URL?.revokeObjectURL;
  if (typeof revoke === 'function') {
    revoke(url);
  }
};

const createLimiter = (context) => {
  const limiter = context.createDynamicsCompressor();
  limiter.threshold.value = -1;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.08;
  return limiter;
};

const rampAudioParam = (param, value, seconds = 0.1, now = 0) => {
  if (!param) return;
  param.cancelScheduledValues?.(now);
  param.setValueAtTime?.(param.value, now);
  if (typeof param.linearRampToValueAtTime === 'function') {
    param.linearRampToValueAtTime(value, now + seconds);
  } else {
    param.value = value;
  }
};

const assertRenderablePreset = (preset) => {
  const voices = Array.isArray(preset?.voices) ? preset.voices : [];
  if (voices.length === 0) {
    return { ok: false, reason: 'worklet_wasm_empty_preset' };
  }

  const unsupportedVoice = voices.find(
    (voice) => voice?.type === VoiceType.Sample,
  );
  if (unsupportedVoice) {
    return {
      ok: false,
      reason: 'worklet_wasm_sample_voice_unsupported',
      voice: unsupportedVoice,
    };
  }

  const unsupportedType = voices.find(
    (voice) =>
      voice?.type !== VoiceType.Binaural &&
      voice?.type !== VoiceType.Martigli &&
      voice?.type !== VoiceType.MartigliBinaural &&
      voice?.type !== VoiceType.Symmetry &&
      voice?.type !== VoiceType.Noise,
  );
  if (unsupportedType) {
    return {
      ok: false,
      reason: `worklet_wasm_unsupported_voice_${unsupportedType?.type ?? 'unknown'}`,
      voice: unsupportedType,
    };
  }

  return { ok: true, reason: null };
};

const compileSymmetryRows = (voice, slotCount) => {
  if (!voice?.permutationProgram) return null;
  try {
    return compileSymmetryPermutationProgram(
      voice.permutationProgram,
      slotCount,
    );
  } catch {
    return null;
  }
};

const normalizeVoiceForWorklet = (voice, index) => {
  const shared = normalizeSharedDspVoice(voice, index);
  if (!shared) return null;
  const gainDb = shared.gain <= 0 ? -100 : linearToDb(shared.gain);
  const base = { ...voice, ...shared, gainDb };

  if (shared.type === VoiceType.Binaural) {
    const centerHz = ((shared.fl ?? 200) + (shared.fr ?? 210)) / 2;
    return {
      ...base,
      type: VoiceType.Binaural,
      centerHz,
      beat: (shared.fr ?? 210) - (shared.fl ?? 200),
    };
  }

  if (shared.type === VoiceType.Martigli) {
    return {
      ...base,
      type: VoiceType.Martigli,
      lowHz: (shared.mf0 ?? 250) - (shared.ma ?? 90),
      highHz: (shared.mf0 ?? 250) + (shared.ma ?? 90),
    };
  }

  if (shared.type === VoiceType.MartigliBinaural) {
    const centerHz = ((shared.fl ?? 250) + (shared.fr ?? 260)) / 2;
    return {
      ...base,
      type: VoiceType.MartigliBinaural,
      beat: (shared.fr ?? 260) - (shared.fl ?? 250),
      lowHz: centerHz - (shared.ma ?? 90),
      highHz: centerHz + (shared.ma ?? 90),
    };
  }

  if (shared.type === VoiceType.Symmetry) {
    const noteSlots = shared.noteSlots ?? [[100]];
    const maxChordSize = Math.max(1, ...noteSlots.map((slot) => slot.length));
    return {
      ...base,
      type: VoiceType.Symmetry,
      noteSlots,
      maxChordSize,
      permutationRows: compileSymmetryRows(voice, noteSlots.length),
    };
  }

  return {
    ...base,
    type: VoiceType.Noise,
  };
};

const updateNormalizedVoiceParam = (voice, key, value) => {
  const next = { ...voice, [key]: value };
  if (
    voice.type === VoiceType.Binaural &&
    ['centerHz', 'beat', 'panOsc', 'panOscPeriod', 'panOscTrans'].includes(key)
  ) {
    return normalizeVoiceForWorklet(next, voice.index);
  }
  if (
    voice.type === VoiceType.Martigli &&
    [
      'lowHz',
      'highHz',
      'mf0',
      'ma',
      'mp0',
      'mp1',
      'md',
      'inhaleRatio',
      'martigliComfortGainEnabled',
      'martigliComfortLowDb',
      'martigliComfortHighDb',
    ].includes(key)
  ) {
    return normalizeVoiceForWorklet(next, voice.index);
  }
  if (
    voice.type === VoiceType.MartigliBinaural &&
    [
      'beat',
      'lowHz',
      'highHz',
      'panOsc',
      'panOscPeriod',
      'panOscTrans',
      'mp0',
      'mp1',
      'md',
      'inhaleRatio',
      'martigliComfortGainEnabled',
      'martigliComfortLowDb',
      'martigliComfortHighDb',
    ].includes(key)
  ) {
    return normalizeVoiceForWorklet(next, voice.index);
  }
  if (voice.type === VoiceType.Noise && key === 'noiseColor') {
    return normalizeVoiceForWorklet(next, voice.index);
  }
  return null;
};

const buildTrackProxy = (engine, voice) => {
  const volumeNode = {
    volume: {
      value: voice.gainDb,
    },
  };
  const proxy = {
    type: voice.type,
    s: voice,
    volume: {
      synthL: volumeNode,
      synthR: volumeNode,
      synthM: volumeNode,
      noise: volumeNode,
    },
    nodes: {},
    start: () => {},
    stop: () => {},
    dispose: () => {},
    setVolume: (value) => {
      if (!isFiniteNumber(value)) return;
      volumeNode.volume.value = value;
      engine.setVoiceVolume(voice.index, value);
    },
    setParam: (key, value) => engine.setVoiceParam(voice.index, key, value),
  };

  if (
    voice.type === VoiceType.Martigli ||
    voice.type === VoiceType.MartigliBinaural
  ) {
    proxy.setInhaleRatio = (ratio) => engine.setInhaleRatio(voice.index, ratio);
    proxy.adjustPace = (direction) =>
      engine.adjustBreathingPace(voice.index, direction);
    proxy.resetPhase = () => engine.resetBreathing(voice.index);
    proxy.getParams = () => engine.getBreathingParams(voice.index);
    proxy.getSnapshot = () => engine.getBreathingSnapshot(voice.index);
  }

  return proxy;
};

export class WorkletWasmSessionEngine {
  static canRenderPreset(preset) {
    return assertRenderablePreset(preset);
  }

  constructor(preset, { duration = 900 } = {}) {
    this.preset = preset;
    this.duration = duration;
    this.context = null;
    this.node = null;
    this.masterGain = null;
    this.limiter = null;
    this.voices = [];
    this.tracks = [];
    this.snapshots = new Map();
    this.state = 'idle';
    this.elapsedAtStart = 0;
    this.startedAtMs = 0;
    this.elapsedAtPause = 0;
    this.pauseFreezeTimeoutId = null;
    this.processorElapsed = null;
    this.processorElapsedReceivedAtMs = 0;
    this.workletHealth = null;
    this.workletError = null;
    this.wasmReady = null;
  }

  async init({ resumeContext = false } = {}) {
    resetSessionDiagnosticWorklet();
    setSessionDiagnosticWorkletStage('initializing');
    const renderability = assertRenderablePreset(this.preset);
    if (!renderability.ok) {
      setSessionDiagnosticWorkletError('preset', renderability.reason);
      throw new Error(renderability.reason);
    }

    try {
      this.context = acquireSharedAudioContext();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setSessionDiagnosticWorkletError('context', message);
      throw error;
    }
    if (resumeContext && contextNeedsResume(this.context)) {
      await this.context.resume();
    }

    if (!sharedContextModuleReady) {
      if (typeof this.context.audioWorklet?.addModule !== 'function') {
        const message = 'AudioWorklet.addModule is unavailable.';
        setSessionDiagnosticWorkletError('addModule', message);
        throw new Error(message);
      }

      setSessionDiagnosticWorkletStage('adding-module');
      const moduleUrl = createWorkletUrl();
      try {
        await this.context.audioWorklet.addModule(moduleUrl);
        sharedContextModuleReady = true;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setSessionDiagnosticWorkletError('addModule', message);
        throw error;
      } finally {
        revokeWorkletUrl(moduleUrl);
      }
    }

    const scope = getAudioScope();
    if (typeof scope.AudioWorkletNode !== 'function') {
      const message = 'AudioWorkletNode is unavailable.';
      setSessionDiagnosticWorkletError('node', message);
      throw new Error(message);
    }

    setSessionDiagnosticWorkletStage('constructing-node');
    this.node = new scope.AudioWorkletNode(
      this.context,
      WORKLET_WASM_PROCESSOR_NAME,
      {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [2],
      },
    );

    setSessionDiagnosticWorkletStage('awaiting-wasm');
    await this._waitForReady();
    setSessionDiagnosticWorkletReady(this.wasmReady === true);

    this.masterGain = this.context.createGain();
    this.masterGain.gain.value = dbToLinear(DEFAULT_MASTER_VOLUME);
    this.limiter = createLimiter(this.context);
    this.node.connect(this.masterGain);
    this.masterGain.connect(this.limiter);
    this.limiter.connect(this.context.destination);

    registerWebSessionAudioContext(this.context, this.masterGain);

    this.loadPreset(this.preset, this.duration);
  }

  loadPreset(preset, duration = this.duration) {
    const renderability = assertRenderablePreset(preset);
    if (!renderability.ok) {
      throw new Error(renderability.reason);
    }

    this.preset = preset;
    this.duration = duration;
    this.voices = preset.voices.map((voice, index) =>
      normalizeVoiceForWorklet(voice, index),
    );
    this.tracks = this.voices.map((voice) => buildTrackProxy(this, voice));
    this.node?.port?.postMessage({
      type: 'load',
      voices: this.voices,
      duration,
      initialElapsed: this.getElapsedTime(),
    });
  }

  async start({ initialElapsed = 0 } = {}) {
    if (!this.node || !this.context) {
      throw new Error('Worklet/WASM engine is not initialized.');
    }

    if (contextNeedsResume(this.context)) {
      await this.context.resume();
    }

    this.elapsedAtStart = Math.max(0, initialElapsed);
    this.elapsedAtPause = this.elapsedAtStart;
    this.startedAtMs = performance.now();
    this.processorElapsed = null;
    this.processorElapsedReceivedAtMs = 0;
    this.state = 'playing';
    this._clearPauseFreezeTimeout();
    this.node.port.postMessage({
      type: 'start',
      initialElapsed: this.elapsedAtStart,
      fadeMs: DEFAULT_FADE_IN_MS,
    });
  }

  pause(fadeMs = DEFAULT_PAUSE_FADE_MS) {
    if (this.state !== 'playing') return;
    const estimatedFadeEndElapsed = this._readLiveElapsed() + fadeMs / 1000;
    this.node?.port?.postMessage({ type: 'pause', fadeMs });
    this.state = 'pausing';
    this._clearPauseFreezeTimeout();
    this.pauseFreezeTimeoutId = setTimeout(() => {
      this.elapsedAtPause = estimatedFadeEndElapsed;
      this.state = 'paused';
      this.pauseFreezeTimeoutId = null;
    }, fadeMs);
  }

  resume(fadeMs = DEFAULT_PAUSE_FADE_MS) {
    if (this.state !== 'paused' && this.state !== 'pausing') return;
    this._clearPauseFreezeTimeout();
    this.elapsedAtStart = this.elapsedAtPause;
    this.startedAtMs = performance.now();
    this.processorElapsed = null;
    this.processorElapsedReceivedAtMs = 0;
    this.state = 'playing';
    this.node?.port?.postMessage({ type: 'resume', fadeMs });
  }

  stop(fadeMs = DEFAULT_STOP_FADE_MS) {
    if (this.state === 'idle' || this.state === 'stopped') return;
    this.elapsedAtPause = this._readLiveElapsed();
    this.state = 'stopped';
    this._clearPauseFreezeTimeout();
    this.node?.port?.postMessage({ type: 'stop', fadeMs });
  }

  setMasterVolume(value) {
    if (!isFiniteNumber(value) || !this.masterGain) return;
    rampAudioParam(
      this.masterGain.gain,
      dbToLinear(value),
      0.1,
      this.context?.currentTime ?? 0,
    );
  }

  setVoiceVolume(index, value) {
    if (!isFiniteNumber(value) || !this.voices[index]) return false;
    this.voices[index] = {
      ...this.voices[index],
      gainDb: value,
    };
    this.node?.port?.postMessage({
      type: 'setVoiceVolume',
      index,
      gainDb: value,
      fadeMs: PARAM_RAMP_MS,
    });
    return true;
  }

  setVoiceParam(index, key, value) {
    const voice = this.voices[index];
    const validValue =
      isFiniteNumber(value) ||
      value === undefined ||
      (key === 'martigliComfortGainEnabled' && typeof value === 'boolean');
    if (!voice || !validValue) return false;
    const nextVoice = updateNormalizedVoiceParam(voice, key, value);
    if (!nextVoice) return false;
    this.voices[index] = nextVoice;
    if (this.preset?.voices?.[index]) {
      const nextPresetVoice = {
        ...this.preset.voices[index],
        [key]: value,
      };
      if (value === undefined) {
        delete nextPresetVoice[key];
      }
      this.preset.voices[index] = nextPresetVoice;
    }
    this.node?.port?.postMessage({
      type: 'updateVoice',
      index,
      voice: nextVoice,
    });
    return true;
  }

  setInhaleRatio(index, ratio) {
    if (!isFiniteNumber(ratio) || ratio <= 0 || ratio >= 1) return false;
    return this.setVoiceParam(index, 'inhaleRatio', ratio);
  }

  resetBreathing(index) {
    // Reset the engine's breathing cycle to the empty-lungs boundary so resume
    // re-enters from there (see referenceDocuments/audio/BREATHING_ANIMATION.md).
    // Optimistically settle the local snapshot to empty lungs first so the
    // visual reads the boundary on the very next animation frame, ahead of the
    // processor's confirming snapshot message.
    const prev = this.snapshots.get(index);
    if (prev) {
      this.snapshots.set(index, {
        ...prev,
        cyclePhase01: 0,
        breathValue01: 0,
        direction: 1,
        signed: -1,
      });
    }
    this.node?.port?.postMessage({ type: 'resetBreathing', index });
  }

  adjustBreathingPace(index, direction) {
    const voice = this.voices[index];
    if (
      !voice ||
      (voice.type !== VoiceType.Martigli &&
        voice.type !== VoiceType.MartigliBinaural)
    ) {
      return null;
    }
    // The displayed period ramps mp0 -> mp1 over `md` as
    //   currentPeriod = mp0 + (mp1 - mp0) * (elapsed / md).
    // Shift BOTH endpoints by the same delta so the on-screen period changes by
    // exactly one step in the pressed direction, no matter where the
    // progressive-slowdown ramp currently sits, and keep `md` unchanged so the
    // ramp progress (elapsed / md) is preserved. The previous version re-anchored
    // mp0 to currentPeriod and halved `md`; halving `md` doubled elapsed / md,
    // which jumped the period along the (rising) slowdown ramp and could make '-'
    // read as a *slower* breath. (Mobile shifts mp0/mp1 together too — see
    // SessionManager.adjustBreathingPace — so both engines now stay monotonic.)
    const step = direction === 'increase' ? -1 : 1; // '-' shortens, '+' lengthens
    const currentPeriod =
      this.getBreathingParams(index)?.currentPeriod ?? voice.mp0 ?? 10;
    const baseMp0 = voice.mp0 ?? currentPeriod;
    const baseMp1 = voice.mp1 ?? baseMp0;
    // Clamp the shift so neither endpoint (nor the interpolated period) drops
    // below 1s, while keeping the shift uniform so the change stays monotonic.
    const minEndpoint = Math.min(baseMp0, baseMp1, currentPeriod);
    const delta = minEndpoint + step < 1 ? 1 - minEndpoint : step;
    const nextMp0 = baseMp0 + delta;
    const nextMp1 = baseMp1 + delta;
    const nextVoice = normalizeVoiceForWorklet(
      { ...voice, mp0: nextMp0, mp1: nextMp1 },
      index,
    );
    this.voices[index] = nextVoice;
    this.node?.port?.postMessage({
      type: 'updateVoice',
      index,
      voice: nextVoice,
    });
    return { mp0: nextMp0, mp1: nextMp1 };
  }

  getTracks() {
    return this.tracks;
  }

  getVoices() {
    return this.voices;
  }

  getBreathingParams(index) {
    const voice = this.voices[index];
    if (
      !voice ||
      (voice.type !== VoiceType.Martigli &&
        voice.type !== VoiceType.MartigliBinaural)
    ) {
      return null;
    }
    const snapshot = this.getBreathingSnapshot(index);
    return {
      mp0: voice.mp0,
      mp1: voice.mp1,
      inhaleRatio: voice.inhaleRatio,
      actualRatio: snapshot?.actualRatio ?? voice.inhaleRatio,
      currentPeriod: snapshot?.currentPeriod ?? voice.mp0,
      targetPeriod: voice.mp1,
      getCurrentValue: () =>
        this.getBreathingSnapshot(index)?.breathValue01 ?? 0,
    };
  }

  getBreathingSnapshot(index) {
    return this.snapshots.get(index) ?? null;
  }

  getWorkletHealthSnapshot() {
    return this.workletHealth;
  }

  getWorkletError() {
    return this.workletError;
  }

  getElapsedTime() {
    if (this.state === 'idle') return 0;
    if (this.state === 'playing' || this.state === 'pausing') {
      return Math.floor(this._readLiveElapsed());
    }
    return Math.floor(this.elapsedAtPause);
  }

  getRemainingTime() {
    return Math.max(0, this.duration - this.getElapsedTime());
  }

  destroy() {
    this.stop(0);
    this._clearPauseFreezeTimeout();
    registerWebSessionAudioContext(null, null);
    this.node?.disconnect?.();
    this.masterGain?.disconnect?.();
    this.limiter?.disconnect?.();
    // The shared AudioContext deliberately stays open (see
    // acquireSharedAudioContext): closing it here would discard the
    // user-gesture unlock WebKit requires and break the next room/solo start.
    this.context = null;
    this.node = null;
    this.masterGain = null;
    this.limiter = null;
    this.voices = [];
    this.tracks = [];
    this.snapshots.clear();
    this.state = 'idle';
    this.processorElapsed = null;
    this.processorElapsedReceivedAtMs = 0;
    this.workletHealth = null;
    setSessionDiagnosticWorkletStage('destroyed');
  }

  _readLiveElapsed() {
    if (this.state !== 'playing' && this.state !== 'pausing') {
      return this.elapsedAtPause;
    }
    if (
      this.processorElapsed !== null &&
      this.processorElapsedReceivedAtMs > 0
    ) {
      const driftSeconds =
        (performance.now() - this.processorElapsedReceivedAtMs) / 1000;
      return this.processorElapsed + Math.max(0, driftSeconds);
    }
    return this.elapsedAtStart + (performance.now() - this.startedAtMs) / 1000;
  }

  _clearPauseFreezeTimeout() {
    if (!this.pauseFreezeTimeoutId) return;
    clearTimeout(this.pauseFreezeTimeoutId);
    this.pauseFreezeTimeoutId = null;
  }

  _handleProcessorMessage(message) {
    if (!message || typeof message !== 'object') return;
    if (message.type === 'breathingSnapshot') {
      this.snapshots.set(message.index, message.snapshot);
      return;
    }
    if (message.type === 'health') {
      this.workletHealth = {
        renderBudgetPct: message.renderBudgetPct,
        renderBudgetMaxPct: message.renderBudgetMaxPct,
        possibleXruns: message.possibleXruns,
        processCalls: message.processCalls,
        quantumMs: message.quantumMs,
        wasmReady: message.wasmReady,
      };
      setSessionDiagnosticWorkletHealth(this.workletHealth);
      return;
    }
    if (message.type === 'elapsed') {
      this.processorElapsed = message.elapsed;
      this.processorElapsedReceivedAtMs = performance.now();
      setSessionDiagnosticWorkletElapsed({
        elapsed: message.elapsed,
        audioTime: message.audioTime,
        receivedAtMs: this.processorElapsedReceivedAtMs,
      });
      return;
    }
    if (message.type === 'error') {
      this.workletError = {
        stage: message.stage ?? 'unknown',
        message: message.message ?? 'Worklet/WASM processor failed.',
      };
      setSessionDiagnosticWorkletError(
        this.workletError.stage,
        this.workletError.message,
      );
      pushSessionDiagnosticEvent(
        'worklet-error',
        `${this.workletError.stage} | ${this.workletError.message}`,
      );
    }
  }

  _waitForReady() {
    return new Promise((resolve, reject) => {
      let settled = false;
      const timeoutId = setTimeout(() => {
        if (settled) return;
        settled = true;
        setSessionDiagnosticWorkletError(
          'ready-timeout',
          `Worklet/WASM processor did not become ready within ${WORKLET_READY_TIMEOUT_MS} ms.`,
        );
        reject(new Error('Worklet/WASM processor did not become ready.'));
      }, WORKLET_READY_TIMEOUT_MS);

      this.node.port.onmessage = (event) => {
        const message = event.data ?? {};
        this._handleProcessorMessage(message);

        if (settled) return;
        if (message.type === 'ready') {
          settled = true;
          clearTimeout(timeoutId);
          this.wasmReady = message.wasmReady === true;
          resolve();
        } else if (message.type === 'error') {
          settled = true;
          clearTimeout(timeoutId);
          reject(
            new Error(
              `${message.stage ?? 'unknown'}: ${
                message.message || 'Worklet/WASM processor failed.'
              }`,
            ),
          );
        }
      };
    });
  }
}
