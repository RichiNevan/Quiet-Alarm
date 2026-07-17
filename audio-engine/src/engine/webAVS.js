import { stopSessionBus, volumeBus } from './controlBuses';
import { crashlytics } from './engineLogger';
import { stopSoundscapeForSession } from './sampleAudioBridge';
import { VoiceType, isBreathingVoice } from './voiceTypes';
import {
  deriveBinauralPitchParams,
  deriveMartigliBinauralPitchParams,
  deriveMartigliPitchParams,
  resolveSymmetryNoteSlots,
} from './presetPitchSlots';
import {
  clearSessionDiagnosticEvents,
  clearSessionDiagnosticMeta,
  pushSessionDiagnosticEvent,
  resetSessionDiagnostics,
  setSessionDiagnosticEngine,
  setSessionDiagnosticVoices,
} from './webAudioShared';
import {
  DEFAULT_WEB_AUDIO_ENGINE,
  resolveCachedWebAudioEngine,
} from './webAudioEngineConfig';
import {
  resumeSharedAudioContext,
  WorkletWasmSessionEngine,
} from './workletWasm/workletWasmSession';
import { recordSessionDebugEvent } from './sessionDebugFlag';

const webAvsRoomDebug = (event, payload = {}) =>
  recordSessionDebugEvent('rooms-debug:AVSWeb', event, payload);

const asErrorMessage = (error) =>
  error instanceof Error && error.message ? error.message : String(error);

export class AVSWeb {
  constructor(preset, callbacks = {}) {
    this.preset = preset || null;
    this.audioTracks = [];
    this.audioVoicesforVolumes = [];
    this.pausedVolumes = null;
    this.requestedEngine = DEFAULT_WEB_AUDIO_ENGINE;
    this.effectiveEngine = DEFAULT_WEB_AUDIO_ENGINE;
    this.engineFallbackReason = null;
    this.engineSelectionSource = 'global';
    this.engineSupport = {};
    this.workletEngine = null;
    this.workletSessionEndTimeoutId = null;

    this.state = 'idle';
    this.timerId = null;
    this.duration = this.preset?.header?.d ?? 900;
    this.userBreathRate = callbacks.userBreathRate || null;
    this.progressiveSlowdown = callbacks.progressiveSlowdown ?? true;
    this.stopTimeoutId = null;
    this.pauseTimeoutId = null;
    this.voicesArrayTimeoutId = null;
    this.isRoomManaged = false;

    this.onStateChange = callbacks.onStateChange || null;
    this.onTimerUpdate = callbacks.onTimerUpdate || null;
    this.onSessionEnd = callbacks.onSessionEnd || null;

    if (this.preset && this.userBreathRate) {
      this._applyUserBreathRate();
    }
  }

  _debugSummary() {
    return {
      state: this.state,
      isRoomManaged: this.isRoomManaged,
      hasPreset: Boolean(this.preset),
      presetId: this.preset?._id ?? this.preset?.id ?? null,
      requestedEngine: this.requestedEngine,
      effectiveEngine: this.effectiveEngine,
      fallbackReason: this.engineFallbackReason,
      workletState: this.workletEngine?.state,
      audioTracks: this.audioTracks.length,
      audioVoices: this.audioVoicesforVolumes.length,
      duration: this.duration,
    };
  }

  _applyUserBreathRate() {
    if (!this.preset || !this.userBreathRate) return;
    if (!Array.isArray(this.preset.voices) || this.preset.voices.length === 0) {
      console.error('AVSWeb: cannot apply breath rate without preset voices', {
        presetId: this.preset?._id,
      });
      return;
    }

    this.preset = {
      ...this.preset,
      voices: this.preset.voices.map((voice) => {
        if (!voice || typeof voice !== 'object') return voice;
        if (
          voice.type === VoiceType.Martigli ||
          voice.type === VoiceType.MartigliBinaural
        ) {
          return {
            ...voice,
            mp0: this.userBreathRate,
            mp1: this.progressiveSlowdown
              ? this.userBreathRate * 2
              : this.userBreathRate,
          };
        }
        return voice;
      }),
    };
  }

  get audioContext() {
    return this.workletEngine?.context ?? null;
  }

  // Returns `{ ok, contextState }` so gesture-time preflight can verify the
  // AudioContext really entered `running` instead of trusting that the
  // promise resolved (failures are swallowed here by design).
  // PLATFORM_ROOM_STABILITY_PLAN § D4.
  async unlock() {
    let context = null;
    try {
      this._applyEngineSelection(resolveCachedWebAudioEngine());
      if (this.preset) {
        const engine = await this._ensureWorkletWasmInitialized({
          resumeContext: true,
        });
        context = engine?.context ?? null;
      } else {
        // No preset yet (e.g. a join gesture before the room preset is
        // known): still create/resume the shared AudioContext during the
        // gesture so WebKit counts it as user-activated when the countdown
        // start later builds the engine on it.
        context = await resumeSharedAudioContext();
      }
      pushSessionDiagnosticEvent(
        'engine',
        `unlock: ${this.requestedEngine} -> ${this.effectiveEngine}${
          this.engineFallbackReason ? ` | ${this.engineFallbackReason}` : ''
        }`,
      );
      return {
        ok: context?.state === 'running',
        contextState: context?.state ?? null,
      };
    } catch (error) {
      console.warn('Web Audio unlock failed:', error);
      this._recordWorkletError(error, 'unlock');
      return { ok: false, contextState: context?.state ?? null };
    }
  }

  reset() {
    webAvsRoomDebug('reset:begin', this._debugSummary());
    this._hardResetAudio();
    clearSessionDiagnosticEvents();
    clearSessionDiagnosticMeta();
    pushSessionDiagnosticEvent('reset');
    this.preset = null;
    this.duration = 900;
    this._setState('idle');
    webAvsRoomDebug('reset:end', this._debugSummary());
  }

  loadPreset(preset, options = {}) {
    webAvsRoomDebug('load-preset:begin', {
      ...this._debugSummary(),
      incomingPresetId: preset?._id ?? preset?.id ?? null,
      ignoreUserSettings: options.ignoreUserSettings === true,
      incomingVoiceCount: Array.isArray(preset?.voices)
        ? preset.voices.length
        : null,
    });
    if (this.state !== 'idle' && this.state !== 'stopped') {
      webAvsRoomDebug('load-preset:skipped', this._debugSummary());
      return;
    }

    if (!preset || typeof preset !== 'object') {
      console.error('AVSWeb: invalid preset passed to loadPreset', preset);
      return;
    }

    const normalizedVoices = Array.isArray(preset.voices)
      ? preset.voices
          .map((voice) =>
            voice && typeof voice === 'object' ? { ...voice } : null,
          )
          .filter(Boolean)
      : [];

    if (normalizedVoices.length === 0) {
      console.error('AVSWeb: preset passed to loadPreset has no voices', {
        presetId: preset?._id,
        preset,
      });
      return;
    }

    this.preset = {
      ...preset,
      header:
        preset.header && typeof preset.header === 'object'
          ? { ...preset.header }
          : {},
      voices: normalizedVoices,
    };
    this.duration = this.preset?.header?.d ?? 900;
    this._disposeTracks();
    this._destroyWorkletEngine();

    if (options.ignoreUserSettings === true) {
      this.userBreathRate = null;
      this.progressiveSlowdown = false;
    }

    if (options.ignoreUserSettings !== true && this.userBreathRate) {
      this._applyUserBreathRate();
    }

    this._applyHeaderInhaleRatioToPreset();

    pushSessionDiagnosticEvent(
      'load-preset',
      `voices ${this.preset?.voices?.length ?? 0} | duration ${this.duration}s`,
    );
    webAvsRoomDebug('load-preset:end', this._debugSummary());
  }

  setDuration(durationSeconds) {
    const nextDuration = Number(durationSeconds);
    if (!Number.isFinite(nextDuration) || nextDuration <= 0) return;

    this.duration = nextDuration;
    if (this.preset?.header) {
      this.preset.header.d = nextDuration;
    }

    if (this.state === 'playing' || this.state === 'paused') {
      this._scheduleSessionEnd();
    }
  }

  getState() {
    return this.state;
  }

  getVoices() {
    return this.audioVoicesforVolumes.map((voice, index) => ({
      index,
      type: voice.type,
      volume: voice.iniVolume || 0.5,
      setVolume: (vol) => {
        this.audioTracks[index]?.setVolume?.(vol);
      },
    }));
  }

  adjustBreathingPace(index, direction) {
    this.workletEngine?.adjustBreathingPace(index, direction);
  }

  setMasterVolume(value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return;
    this.workletEngine?.setMasterVolume(value);
  }

  setVoiceVolume(index, value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return false;
    const track = this.audioTracks[index];
    if (!track || typeof track.setVolume !== 'function') return false;
    track.setVolume(value);
    return true;
  }

  setVoiceParam(index, key, value) {
    const track = this.audioTracks[index];
    const voice = this.preset?.voices?.[index];
    if (!track || !voice || typeof track.setParam !== 'function') {
      return false;
    }

    const handled = track.setParam(key, value);
    if (!handled) return false;

    voice[key] = value;
    if (this.audioVoicesforVolumes[index]) {
      this.audioVoicesforVolumes[index] = {
        ...this.audioVoicesforVolumes[index],
        [key]: value,
      };
    }
    return true;
  }

  setInhaleRatio(index, ratio) {
    this.audioTracks[index]?.setInhaleRatio?.(ratio);
  }

  getBreathingParams(index) {
    return this.audioTracks[index]?.getParams?.() ?? null;
  }

  getBreathingSnapshot(index) {
    return this.audioTracks[index]?.getSnapshot?.() ?? null;
  }

  async start(options = {}) {
    webAvsRoomDebug('start:begin', {
      ...this._debugSummary(),
      initialElapsed: options.initialElapsed || 0,
    });
    if ((this.state !== 'idle' && this.state !== 'stopped') || !this.preset) {
      webAvsRoomDebug('start:skipped', this._debugSummary());
      return;
    }

    this._clearStopTimeout();
    this._clearWorkletSessionEndTimeout();
    // Engine selection is synchronous (constant Worklet/WASM mode). Nothing on
    // the start path may await Firestore: a stalled read here used to hang
    // `start()` itself, so Safari solo Play could silently no-op and room
    // countdown starts could stall with no alert (PLATFORM_ROOM_STABILITY_PLAN
    // § D3/D4).
    this._applyEngineSelection(resolveCachedWebAudioEngine());

    try {
      await this._startWorkletWasm(options.initialElapsed || 0, {
        resumeContext: true,
      });
    } catch (error) {
      this._recordWorkletError(error, 'start');
      this._destroyWorkletEngine();
    }
  }

  async _startWorkletWasm(initialElapsed = 0, { resumeContext = false } = {}) {
    webAvsRoomDebug('start-worklet:begin', {
      ...this._debugSummary(),
      initialElapsed,
      resumeContext,
    });
    await this._ensureWorkletWasmInitialized({ resumeContext });

    this.audioTracks = this.workletEngine.getTracks();
    this.audioVoicesforVolumes = this.workletEngine.getVoices().map((voice) => ({
      ...voice,
      iniVolume: voice.gainDb,
    }));
    if (this.audioTracks.length === 0) {
      throw new Error('worklet_wasm_zero_valid_voices');
    }

    setSessionDiagnosticVoices(
      this.preset.voices.map((voice, index) =>
        this._describeVoiceForDiagnostics(voice, index),
      ),
    );
    this._clearVoicesArrayTimeout();
    this.voicesArrayTimeoutId = setTimeout(() => {
      this.voicesArrayTimeoutId = null;
      volumeBus.emit('voicesArrayWEB', this.audioTracks);
    }, 0);

    resetSessionDiagnostics();
    clearSessionDiagnosticEvents();
    pushSessionDiagnosticEvent(
      'engine',
      `start: ${this.requestedEngine} -> ${this.effectiveEngine}${
        this.engineFallbackReason ? ` | ${this.engineFallbackReason}` : ''
      }`,
    );
    pushSessionDiagnosticEvent(
      'start',
      `voices ${this.audioTracks.length} | duration ${this.duration}s | elapsed ${initialElapsed}s`,
    );

    await this.workletEngine.start({ initialElapsed });
    this._startTimerLoop();
    this._setState('playing');
    this._scheduleSessionEnd();
    webAvsRoomDebug('start-worklet:end', this._debugSummary());
  }

  async _ensureWorkletWasmInitialized({ resumeContext = false } = {}) {
    const renderability = WorkletWasmSessionEngine.canRenderPreset(this.preset);
    if (!renderability.ok) {
      throw new Error(renderability.reason);
    }
    this._applyHeaderInhaleRatioToPreset();
    this._disposeTracks();

    if (!this.workletEngine) {
      this.workletEngine = new WorkletWasmSessionEngine(this.preset, {
        duration: this.duration,
      });
      await this.workletEngine.init({ resumeContext });
    } else if (
      resumeContext &&
      (this.workletEngine.context?.state === 'suspended' ||
        this.workletEngine.context?.state === 'interrupted')
    ) {
      await this.workletEngine.context.resume();
    }

    return this.workletEngine;
  }

  pause() {
    if (this.state !== 'playing' || this.pauseTimeoutId || !this.workletEngine) {
      return;
    }
    this.workletEngine.pause(500);
    this._clearWorkletSessionEndTimeout();
    this.pauseTimeoutId = setTimeout(() => {
      this.pauseTimeoutId = null;
      if (this.state !== 'playing') return;
      this._stopTimerLoop();
      stopSessionBus.emit('pauseSession');
      this._setState('paused');
      pushSessionDiagnosticEvent(
        'pause',
        `elapsed ${this.workletEngine.getElapsedTime()}s`,
      );
    }, 800);
  }

  resume() {
    if (this.state !== 'paused' || !this.workletEngine) return;
    this._resetBreathingPhase();
    this.workletEngine.resume(500);
    stopSessionBus.emit('resumeSession');
    this._setState('playing');
    this._scheduleSessionEnd();
    this._startTimerLoop();
    pushSessionDiagnosticEvent(
      'resume',
      `elapsed ${this.workletEngine.getElapsedTime()}s`,
    );
  }

  stop(options = {}) {
    webAvsRoomDebug('stop:begin', {
      ...this._debugSummary(),
      fadeMs: options.fadeMs,
    });
    if (this.state === 'idle' || this.state === 'stopped') return;
    const hasFadeOverride =
      typeof options.fadeMs === 'number' && options.fadeMs >= 0;
    const fadeMs = hasFadeOverride ? options.fadeMs : 2500;

    stopSoundscapeForSession();
    this._stopTimerLoop();
    this._clearPauseTimeout();
    this._clearWorkletSessionEndTimeout();
    this.pausedVolumes = null;
    const elapsed = this.workletEngine?.getElapsedTime?.() ?? 0;
    this.workletEngine?.stop(fadeMs);
    this._setState('stopped');
    pushSessionDiagnosticEvent('stop', `elapsed ${elapsed}s`);
    webAvsRoomDebug('stop-worklet:end', this._debugSummary());
  }

  _cleanup() {}

  getElapsedTime() {
    if (this.state === 'idle') return 0;
    return this.workletEngine?.getElapsedTime?.() ?? 0;
  }

  getRemainingTime() {
    return Math.max(0, this.duration - this.getElapsedTime());
  }

  _startTimerLoop() {
    const loop = () => {
      const elapsed = this.getElapsedTime();
      const remaining = this.getRemainingTime();

      if (this.onTimerUpdate) {
        this.onTimerUpdate(elapsed, remaining, this.duration);
      }

      if (this.state === 'playing') {
        this.timerId = requestAnimationFrame(loop);
      }
    };
    this.timerId = requestAnimationFrame(loop);
  }

  _stopTimerLoop() {
    if (!this.timerId) return;
    cancelAnimationFrame(this.timerId);
    this.timerId = null;
  }

  _setState(newState) {
    if (this.state === newState) return;
    this.state = newState;
    this.onStateChange?.(newState);
  }

  _clearStopTimeout() {
    if (!this.stopTimeoutId) return;
    clearTimeout(this.stopTimeoutId);
    this.stopTimeoutId = null;
  }

  _clearPauseTimeout() {
    if (!this.pauseTimeoutId) return;
    clearTimeout(this.pauseTimeoutId);
    this.pauseTimeoutId = null;
  }

  _resetBreathingPhase() {
    this.audioTracks.forEach((track) => {
      track?.resetPhase?.();
    });
  }

  _clearVoicesArrayTimeout() {
    if (!this.voicesArrayTimeoutId) return;
    clearTimeout(this.voicesArrayTimeoutId);
    this.voicesArrayTimeoutId = null;
  }

  _scheduleSessionEnd() {
    this._clearWorkletSessionEndTimeout();
    if (this.state === 'paused') return;
    const remainingMs = Math.max(0, this.getRemainingTime() * 1000);
    this.workletSessionEndTimeoutId = setTimeout(() => {
      this.workletSessionEndTimeoutId = null;
      this.onSessionEnd?.();
      this.stop();
    }, remainingMs);
  }

  _clearWorkletSessionEndTimeout() {
    if (!this.workletSessionEndTimeoutId) return;
    clearTimeout(this.workletSessionEndTimeoutId);
    this.workletSessionEndTimeoutId = null;
  }

  _disposeTracks() {
    this.audioTracks.forEach((track) => {
      if (!track.dispose) return;
      try {
        track.dispose();
      } catch (error) {
        console.error('AVSWeb: failed to dispose track', error);
        crashlytics.recordError(
          error instanceof Error ? error : new Error(String(error)),
        );
      }
    });
    this.audioTracks = [];
    this.audioVoicesforVolumes = [];
  }

  _applyEngineSelection(selection) {
    this.requestedEngine = selection.requestedEngine;
    this.effectiveEngine = selection.effectiveEngine;
    this.engineFallbackReason = selection.fallbackReason;
    this.engineSelectionSource = selection.source;
    this.engineSupport = selection.support ?? {};

    setSessionDiagnosticEngine(selection);

    return selection;
  }

  _recordWorkletError(error, phase) {
    const errorMessage = asErrorMessage(error);
    const reason = errorMessage.startsWith('worklet_wasm_')
      ? errorMessage
      : `worklet_wasm_${phase}_failed`;
    this.engineFallbackReason = reason;
    setSessionDiagnosticEngine({
      requestedEngine: this.requestedEngine,
      effectiveEngine: this.effectiveEngine,
      fallbackReason: reason,
      source: this.engineSelectionSource,
      support: this.engineSupport,
    });
    const details =
      errorMessage && errorMessage !== reason
        ? `${reason} | ${errorMessage}`
        : reason;
    pushSessionDiagnosticEvent(
      'engine-error',
      details,
    );
    crashlytics.recordError(
      error instanceof Error ? error : new Error(String(error)),
    );
  }

  _destroyWorkletEngine() {
    if (!this.workletEngine) return;
    try {
      this.workletEngine.destroy();
    } catch (error) {
      console.error('AVSWeb: failed to destroy Worklet/WASM engine', error);
      crashlytics.recordError(
        error instanceof Error ? error : new Error(String(error)),
      );
    }
    this.workletEngine = null;
  }

  _applyHeaderInhaleRatioToPreset() {
    const header = this.preset?.header;
    const ratio = header?.inhaleExhaleRatio;
    if (
      header?.hasBreathGuide !== true ||
      typeof ratio !== 'number' ||
      !Number.isFinite(ratio) ||
      ratio <= 0 ||
      ratio >= 1
    ) {
      return;
    }

    this.preset = {
      ...this.preset,
      voices: this.preset.voices.map((voice) =>
        voice?.isOn === true &&
        isBreathingVoice(String(voice?.type ?? '')) &&
        typeof voice.inhaleRatio !== 'number'
          ? { ...voice, inhaleRatio: ratio }
          : voice,
      ),
    };
  }

  _hardResetAudio() {
    this._stopTimerLoop();
    this._clearStopTimeout();
    this._clearPauseTimeout();
    this._clearVoicesArrayTimeout();
    this._clearWorkletSessionEndTimeout();
    this.pausedVolumes = null;
    resetSessionDiagnostics();
    clearSessionDiagnosticMeta();
    this._disposeTracks();
    this._destroyWorkletEngine();
  }

  _describeVoiceForDiagnostics(voice, index) {
    const prefix = `${index + 1}.${voice?.type ?? 'Unknown'}`;

    if (voice?.type === VoiceType.Binaural) {
      const pitch = deriveBinauralPitchParams(voice);
      return `${prefix} ${pitch.fl}/${pitch.fr}Hz`;
    }

    if (voice?.type === VoiceType.MartigliBinaural) {
      const pitch = deriveMartigliBinauralPitchParams(voice);
      return `${prefix} ${pitch.fl}/${pitch.fr}Hz`;
    }

    if (voice?.type === VoiceType.Martigli) {
      return `${prefix} ${deriveMartigliPitchParams(voice).mf0}Hz`;
    }

    if (voice?.type === VoiceType.Symmetry) {
      return `${prefix} ${resolveSymmetryNoteSlots(voice)[0]?.[0] ?? '?'}Hz`;
    }

    if (voice?.type === VoiceType.Sample) {
      const sampleLabel =
        voice.sampleUri?.split('/').pop() ??
        voice.sampleUrl?.split('/').pop() ??
        'sample';
      return `${prefix} ${sampleLabel}`;
    }

    if (voice?.type === VoiceType.Noise) {
      return `${prefix} ${voice.noiseColor ?? 'noise'}`;
    }

    return prefix;
  }

  destroy() {
    this._hardResetAudio();
    clearSessionDiagnosticEvents();
    clearSessionDiagnosticMeta();
    pushSessionDiagnosticEvent('destroy');
    this.preset = null;
    this.duration = 900;
    this.state = 'idle';
    this.onStateChange = null;
    this.onTimerUpdate = null;
    this.onSessionEnd = null;
  }
}
