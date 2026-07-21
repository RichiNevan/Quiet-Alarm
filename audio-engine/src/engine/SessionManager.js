// ============================================
// SESSION MANAGER
// ============================================
// Simplified audio engine for AVS sessions
// ============================================

import { crashlytics } from './engineLogger';
import {
  acquireForegroundService,
  releaseForegroundService,
} from './foregroundService';
import { AppState } from 'react-native';
import { AudioContext } from 'react-native-audio-api';
import {
  startBackgroundSessionStopGuard,
  stopBackgroundSessionStopGuard,
} from './backgroundSessionStopGuard';
import { DEFAULT_BREATHING_PERIOD, DEFAULT_MASTER_VOLUME, getDefaultVolume } from './AudioConfig';
import { resolveMartigliComfortGainDb } from './martigliComfortGain';
import {
  deriveBinauralPitchParams,
  deriveMartigliBinauralPitchParams,
  deriveMartigliPitchParams,
  resolveSymmetryCycleSeconds,
  resolveSymmetryNoteSlots,
  resolveSymmetryPulseRateHz,
} from './presetPitchSlots';
import { compileSymmetryPermutationProgram } from './symmetryPermutationProgram';
import {
  BinauralNode,
  MartigliBinauralNode,
  MartigliNode,
  SymmetryNode,
} from './types';
import { VoiceType, isBreathingVoice } from './voiceTypes';
import { recordSessionDebugEvent } from './sessionDebugFlag';

const linearToDb = (linear) =>
  linear > 0 ? 20 * Math.log10(linear) : -Infinity;

const nativeRoomDebug = (event, payload = {}) =>
  recordSessionDebugEvent('rooms-debug:SessionManager', event, payload);

export class SessionManager {
  // `options.context`: inject a pre-built BaseAudioContext (e.g. an
  // OfflineAudioContext) instead of creating a live AudioContext. Used by
  // renderOffline() to bounce a preset to a buffer without opening a device
  // audio stream. Defaults to the normal live AudioContext for every other
  // caller — no behavior change unless you pass this.
  constructor(options = {}) {
    this.audioContext = options.context ?? new AudioContext();
    this.voices = []; // {node, volume}
    this.preset = null;
    this.duration = 900;
    this.state = 'idle';
    this.appStateSubscription = AppState.addEventListener(
      'change',
      this._handleAppStateChange,
    );

    // Timing
    this.startTime = null;
    this.pausedTime = 0;
    this.initialElapsed = 0;
    this.timerId = null;

    // Animation
    this.animationId = null;
    this.animationValue = 0;
    this.breathingSnapshotState = new Map();

    // Volume
    this.masterVolume = DEFAULT_MASTER_VOLUME;

    // Callbacks
    this.onTimerUpdate = null;
    this.onLockScreenTimerUpdate = null;
    this.onAnimationUpdate = null;
    this.onStateChange = null;
    this.onSessionEnd = null; // Callback when session ends naturally (time runs out)
  }

  _debugSummary() {
    return {
      state: this.state,
      isRoomManaged: this.isRoomManaged,
      hasPreset: Boolean(this.preset),
      presetId: this.preset?._id ?? this.preset?.id ?? null,
      voiceCount: this.voices.length,
      duration: this.duration,
      initialElapsed: this.initialElapsed,
      audioContextState: this.audioContext?.state,
      snapshotCount: this.breathingSnapshotState.size,
    };
  }

  // ============================================
  // PUBLIC API
  // ============================================

  async unlock() {
    // 1. Resume context standard way
    if (this.audioContext.state !== 'running') {
      try {
        await this.audioContext.resume();
      } catch (e) {
        console.warn('Resume failed:', e);
      }
    }

    // 2. PLAY SILENT BUFFER (The actual fix)
    // We create a 1-sample empty sound and play it instantly.
    // This forces the OS to open the audio output channel.
    try {
      const buffer = this.audioContext.createBuffer(1, 1, 22050);
      const source = this.audioContext.createBufferSource();
      source.buffer = buffer;
      source.connect(this.audioContext.destination);
      source.start(0);
    } catch (e) {
      console.error('Failed to play silent buffer:', e);
      crashlytics.recordError(e);
    }
  }

  loadPreset(preset, options = {}) {
    nativeRoomDebug('load-preset:begin', {
      ...this._debugSummary(),
      incomingPresetId: preset?._id ?? preset?.id ?? null,
      incomingVoiceCount: Array.isArray(preset?.voices)
        ? preset.voices.length
        : null,
      ignoreUserSettings: options.ignoreUserSettings === true,
      progressiveSlowdown: options.progressiveSlowdown,
    });
    if (this.state !== 'idle') {
      nativeRoomDebug('load-preset:skipped', this._debugSummary());
      return;
    }

    if (!preset || typeof preset !== 'object') {
      console.error(
        'SessionManager.loadPreset received invalid preset.',
        preset,
      );
      return;
    }

    // Keep header/voices isolated from the source preset without relying on
    // JSON serialization, which can fail for non-JSON/circular metadata.
    const presetHeader =
      preset.header && typeof preset.header === 'object'
        ? { ...preset.header }
        : {};
    const voices = Array.isArray(preset.voices)
      ? preset.voices
          .map((voice) =>
            voice && typeof voice === 'object' ? { ...voice } : null,
          )
          .filter(Boolean)
      : [];

    if (voices.length === 0) {
      console.error(
        'SessionManager.loadPreset received preset without voices.',
        preset,
      );
      return;
    }

    this.preset = {
      ...preset,
      header: presetHeader,
      voices,
    };
    this.duration = this.preset?.header?.d ?? 900;

    // Apply progressive slowdown setting
    if (options.progressiveSlowdown === false && this.preset?.voices) {
      // Disable progressive slowdown by setting mp1 = mp0
      this.preset.voices = this.preset.voices.map((voice) => {
        if (voice.mp0 !== undefined && voice.mp1 !== undefined) {
          return { ...voice, mp1: voice.mp0 };
        }
        return voice;
      });
      console.warn('Progressive slowdown disabled - mp1 set to mp0');
    }

    this._applyHeaderInhaleRatioToPreset();
    nativeRoomDebug('load-preset:end', this._debugSummary());
  }

  // Seed each active breathing voice's inhaleRatio from header.inhaleExhaleRatio
  // so the canonical preset phase split takes effect on session start. A
  // voice-level inhaleRatio (legacy) wins if explicitly set. Catalog voices
  // store isOn as undefined (treated as on at node creation via `isOn ?? true`),
  // so the gate matches that with `isOn !== false` rather than `=== true`.
  _applyHeaderInhaleRatioToPreset() {
    const header = this.preset?.header;
    const ratio = header?.inhaleExhaleRatio;
    if (
      header?.hasBreathGuide !== true ||
      typeof ratio !== 'number' ||
      !Number.isFinite(ratio) ||
      ratio <= 0 ||
      ratio >= 1 ||
      !Array.isArray(this.preset?.voices)
    ) {
      return;
    }

    this.preset.voices = this.preset.voices.map((voice) => {
      if (
        voice &&
        voice.isOn !== false &&
        isBreathingVoice(String(voice.type ?? '')) &&
        typeof voice.inhaleRatio !== 'number'
      ) {
        return { ...voice, inhaleRatio: ratio };
      }
      return voice;
    });
  }

  setDuration(durationSeconds) {
    const nextDuration = Number(durationSeconds);
    if (!Number.isFinite(nextDuration) || nextDuration <= 0) {
      return;
    }

    this.duration = nextDuration;

    if (this.preset?.header) {
      this.preset.header.d = nextDuration;
    }
  }

  async start(options = {}) {
    // <--- Make this async
    nativeRoomDebug('start:begin', {
      ...this._debugSummary(),
      initialElapsed: options.initialElapsed || 0,
    });
    if (this.state !== 'idle' || !this.preset) {
      nativeRoomDebug('start:skipped', this._debugSummary());
      return;
    }

    // 1. Ensure Audio Context is Running (Fixes "Playing but Silent" bug)
    if (this.audioContext.state === 'suspended') {
      try {
        await this.audioContext.resume();
        console.warn('Audio Context resumed');
      } catch (e) {
        console.warn('Failed to resume audio context:', e);
      }
    }

    this.initialElapsed = options.initialElapsed || 0;

    // Re-seed inhaleRatio at start so a preset loaded before its header carried
    // the breath-guide ratio (or that skipped seeding in loadPreset) still
    // applies the canonical phase split to the audio nodes. Mirrors web's AVSWeb,
    // which re-applies this while initializing the Worklet/WASM session.
    this._applyHeaderInhaleRatioToPreset();
    this._createVoices();
    this._startVoices();
    this.startTime = Date.now();
    this.pausedTime = 0;
    this._startTimer();
    this._startStopGuard();
    this._acquireForegroundService();
    if (this.onAnimationUpdate) {
      this._startAnimation();
    }
    this._setState('playing');
    nativeRoomDebug('start:end', this._debugSummary());
  }

  pause() {
    if (this.state !== 'playing') return;

    this._pauseVoices();
    this._stopTimer();
    this._stopStopGuard();
    this._releaseForegroundService();

    if (this.startTime != null) {
      this.pausedTime += Date.now() - this.startTime;
      this.startTime = null;
    }

    this._setState('paused');
  }

  resume() {
    if (this.state !== 'paused' && this.state !== 'playing') return;

    this._resetBreathingPhase();
    this._resumeVoices();

    // If an interruption left us in a stale 'playing' state, resume voices
    // without resetting timers/state; paused sessions still restore timing.
    if (this.state === 'paused') {
      this.startTime = Date.now();
      this._startTimer();
      this._startStopGuard();
      this._acquireForegroundService();
      this._setState('playing');
    } else if (!this.timerId) {
      // Interruption recovery can leave voices resumed while timer is stopped.
      this.startTime = Date.now();
      this._startTimer();
      this._startStopGuard();
      this._acquireForegroundService();
    }
  }

  stop(options = {}) {
    nativeRoomDebug('stop:begin', {
      ...this._debugSummary(),
      fadeMs: options.fadeMs,
    });
    if (this.state === 'idle') {
      nativeRoomDebug('stop:skipped', this._debugSummary());
      return;
    }
    const fadeMs =
      typeof options.fadeMs === 'number' && options.fadeMs >= 0
        ? options.fadeMs
        : 2500;

    this._stopTimer();
    this._stopStopGuard();
    this._stopAnimation();
    this._stopVoices();

    setTimeout(() => {
      this._cleanup();
    }, fadeMs);

    this._setState('stopped');
    nativeRoomDebug('stop:end', this._debugSummary());
  }

  // Bounce the loaded preset to an AudioBuffer using an injected
  // OfflineAudioContext (pass one via `new SessionManager({ context })`).
  // Renders exactly `context.length` samples (set at OfflineAudioContext
  // construction) as fast as the device can, no live audio device involved.
  // Does NOT touch the timer/animation/foreground-service/AppState machinery
  // that start() wires up — those all assume a live, foregrounded app, which
  // is precisely what an offline render does not have.
  async renderOffline() {
    if (typeof this.audioContext.startRendering !== 'function') {
      throw new Error(
        'renderOffline() requires a SessionManager constructed with an ' +
          'OfflineAudioContext: new SessionManager({ context: offlineCtx })',
      );
    }
    if (!this.preset) {
      throw new Error('renderOffline() called before loadPreset()');
    }
    this._createVoices();
    this._startVoices();
    const buffer = await this.audioContext.startRendering();
    this.voices.forEach(({ node }) => {
      try {
        node.disconnect();
      } catch (_e) {
        // already disconnected
      }
    });
    this.voices = [];
    return buffer;
  }

  setMasterVolume(volume) {
    this.masterVolume = Math.max(0, Math.min(1, volume));
    // Update all voices since master volume affects all
    this._updateVolumes();
  }

  setVoiceVolume(index, volume) {
    if (this.voices[index]) {
      this.voices[index].volume = Math.max(0, Math.min(1, volume));
      // Only update this specific voice's node
      const { node, volume: voiceVolume } = this.voices[index];
      node.volume = voiceVolume * this.masterVolume;
    }
  }

  getElapsedTime() {
    if (this.state === 'idle') return 0;
    const current = this.state === 'playing' ? Date.now() - this.startTime : 0;
    return Math.floor((this.pausedTime + current) / 1000) + this.initialElapsed;
  }

  getRemainingTime() {
    return Math.max(0, this.duration - this.getElapsedTime());
  }

  getAnimationValue() {
    return this.animationValue;
  }

  getState() {
    return this.state;
  }

  getVoices() {
    return this.voices.map((v, i) => {
      const s = v.settings || {};
      const type = v.node.constructor.name.replace('Node', '');
      const base = { index: i, type, volume: v.volume };
      if (type === 'Binaural') {
        const pitch = deriveBinauralPitchParams(s);
        base.centerHz = pitch.centerHz;
        base.beat = pitch.beatHz;
        base.fl = pitch.fl;
        base.fr = pitch.fr;
      } else if (type === 'Martigli') {
        const pitch = deriveMartigliPitchParams(s);
        base.mf0 = pitch.mf0;
        base.ma = pitch.ma;
        base.lowHz = pitch.lowHz;
        base.highHz = pitch.highHz;
      } else if (type === 'MartigliBinaural') {
        const pitch = deriveMartigliBinauralPitchParams(s);
        base.beat = pitch.beatHz;
        base.centerHz = pitch.centerHz;
        base.fl = pitch.fl;
        base.fr = pitch.fr;
        base.ma = pitch.ma;
        base.lowHz = pitch.lowHz;
        base.highHz = pitch.highHz;
      } else if (type === 'Symmetry') {
        base.noteSlots = s.noteSlots;
        base.pulseRateHz = resolveSymmetryPulseRateHz(s);
      }
      return base;
    });
  }

  getVolumeDiagnostics() {
    return {
      masterVolume: this.masterVolume,
      masterVolumeDb: linearToDb(this.masterVolume),
      voices: this.voices.map(({ node, volume, settings }, index) => {
        const appliedVolume = Number(
          node?.volume ?? volume * this.masterVolume,
        );
        return {
          index,
          type: settings?.type || node?.constructor?.name,
          sliderVolume: volume,
          sliderVolumeDb: linearToDb(volume),
          appliedVolume,
          appliedVolumeDb: linearToDb(appliedVolume),
        };
      }),
    };
  }

  getBreathingParams(voiceIndex) {
    const voice = this.voices[voiceIndex];
    if (!voice) return null;

    const node = voice.node;
    if (node.mp0 === undefined) return null; // Not a Martigli-type node

    const inhaleDur = node.currentInhaleDur || 0;
    const exhaleDur = node.currentExhaleDur || 0;
    const total = inhaleDur + exhaleDur;

    const ratio = total > 0 ? inhaleDur / total : 0.5;
    return {
      mp0: node.mp0 ?? DEFAULT_BREATHING_PERIOD,
      mp1: node.mp1 ?? 20,
      currentPeriod: node.currentPeriod ?? DEFAULT_BREATHING_PERIOD,
      targetPeriod: node.mp1 ?? 20,
      inhaleRatio: ratio,
      actualRatio: ratio, // native has no multi-cycle ratio ramp
    };
  }

  getBreathingSnapshot(voiceIndex) {
    const voice = this.voices[voiceIndex];
    if (!voice) return null;

    const node = voice.node;
    if (node.mp0 === undefined || node.animationValue === undefined) {
      return null;
    }

    const inhaleDur = node.currentInhaleDur || 0;
    const exhaleDur = node.currentExhaleDur || 0;
    const total = inhaleDur + exhaleDur;
    const inhaleRatio = total > 0 ? inhaleDur / total : 0.5;
    const breathValue01 = Math.max(
      0,
      Math.min(1, Number(node.animationValue) || 0),
    );
    const exactPhase = Number(node.cyclePhase01);
    const hasExactPhase = Number.isFinite(exactPhase);
    const exactAudioTime = Number(node.audioTime);
    const hasExactAudioTime = Number.isFinite(exactAudioTime);
    const previous = this.breathingSnapshotState.get(voiceIndex);
    const delta = breathValue01 - (previous?.breathValue01 ?? breathValue01);
    const fallbackDirection =
      delta > 0.0005
        ? 1
        : delta < -0.0005
          ? 0
          : (previous?.direction ?? (breathValue01 >= 0.5 ? 1 : 0));
    const exactDirection = Number(node.direction);
    const direction = Number.isFinite(exactDirection)
      ? exactDirection >= 0.5
        ? 1
        : 0
      : hasExactPhase
        ? exactPhase < inhaleRatio
          ? 1
          : 0
        : fallbackDirection;
    const currentPeriod = node.currentPeriod ?? total ?? node.mp0 ?? DEFAULT_BREATHING_PERIOD;
    const cyclePhase01 = hasExactPhase
      ? Math.max(0, Math.min(1, exactPhase))
      : direction === 1
        ? breathValue01 * 0.5
        : 0.5 + (1 - breathValue01) * 0.5;
    const audioTime = hasExactAudioTime
      ? exactAudioTime
      : typeof globalThis?.performance?.now === 'function'
        ? globalThis.performance.now() / 1000
        : Date.now() / 1000;
    const snapshot = {
      audioTime,
      cyclePhase01,
      breathValue01,
      direction,
      inhaleRatio,
      actualRatio: inhaleRatio,
      currentPeriod,
      targetPeriod: node.mp1 ?? currentPeriod,
      mp0: node.mp0 ?? currentPeriod,
      mp1: node.mp1 ?? currentPeriod,
    };

    this.breathingSnapshotState.set(voiceIndex, snapshot);
    return snapshot;
  }

  setInhaleRatio(voiceIndex, ratio) {
    const entry = this.voices?.[voiceIndex];
    if (!entry) return;
    const { node } = entry;
    if (node?.inhaleDur !== undefined && node?.exhaleDur !== undefined) {
      node.inhaleDur = ratio;
      node.exhaleDur = 1 - ratio;
    }
  }

  adjustBreathingPace(voiceIndex, direction) {
    // Adjust ALL Martigli-type voices (Martigli and MartigliBinaural)
    const factor = direction === 'increase' ? 0.85 : 1.15; // 15% change
    this.voices.forEach(({ node }) => {
      if (node.mp0 !== undefined && node.mp1 !== undefined) {
        node.mp0 = Math.max(1, node.mp0 * factor); // Min 1 second
        node.mp1 = Math.max(1, node.mp1 * factor); // Min 1 second
      }
    });
  }

  destroy() {
    this.stop();
    if (this.appStateSubscription) {
      this.appStateSubscription.remove();
    }
    this.audioContext = null;
  }

  // ============================================
  // PRIVATE METHODS
  // ============================================

  _createVoices() {
    this.voices = [];
    this.breathingSnapshotState.clear();
    if (!this.preset?.voices) return;

    this.preset.voices.forEach((settings) => {
      const node = this._createNode(settings);
      if (!node) return;

      node.connect(this.audioContext.destination);
      const volume = getDefaultVolume(settings.type, settings.iniVolume);
      this.voices.push({ node, volume, settings });
    });
  }

  _handleAppStateChange = (nextAppState) => {
    if (nextAppState === 'active') {
      if (this.state === 'playing' && this.onAnimationUpdate) {
        this._startAnimation();
      }
    } else {
      this._stopAnimation();
    }
  };

  _createNode(settings) {
    const ctx = this.audioContext;
    let node = null;

    // 1. Protection: Fallback values for all possible parameters
    const safe = (key, fallback = 0) =>
      typeof settings[key] === 'number' ? settings[key] : fallback;

    switch (settings.type) {
      case VoiceType.Symmetry:
        node = new SymmetryNode(ctx, global.createSymmetryNode(ctx.context));
        {
          const noteSlots = resolveSymmetryNoteSlots(settings);
          node.noteSlots = noteSlots;
          node.nnotes = noteSlots.length;
        }
        node.d = resolveSymmetryCycleSeconds(settings);
        node.waveform = safe('waveform', 0);
        node.permfunc = safe('permfunc', 4);
        if (settings.permutationProgram) {
          try {
            node.permutationRows = compileSymmetryPermutationProgram(
              settings.permutationProgram,
              node.nnotes,
            );
          } catch (error) {
            crashlytics.recordError(
              error instanceof Error ? error : new Error(String(error)),
            );
          }
        }
        break;

      case VoiceType.Binaural:
        node = new BinauralNode(ctx, global.createBinauralNode(ctx.context));
        {
          const pitch = deriveBinauralPitchParams(settings);
          node.fl = pitch.fl;
          node.fr = pitch.fr;
        }
        node.waveformL = safe('waveformL', 0);
        node.waveformR = safe('waveformR', 0);
        node.panOsc = safe('panOsc', 0);
        node.panOscPeriod = safe('panOscPeriod', 120);
        node.panOscTrans = safe('panOscTrans', 20);
        break;

      case VoiceType.Martigli:
        node = new MartigliNode(ctx, global.createMartigliNode(ctx.context));
        {
          const pitch = deriveMartigliPitchParams(settings);
          const comfortGain = resolveMartigliComfortGainDb(
            settings,
            pitch.lowHz,
            pitch.highHz,
          );
          node.mf0 = pitch.mf0;
          node.ma = pitch.ma;
          node.martigliComfortGainEnabled = comfortGain.enabled;
          node.martigliComfortLowDb = comfortGain.lowDb;
          node.martigliComfortHighDb = comfortGain.highDb;
        }
        node.mp0 = safe('mp0', 10);
        node.mp1 = safe('mp1', 20);
        node.md = safe('md', 600);
        node.inhaleDur = safe('inhaleDur', 0);
        node.exhaleDur = safe('exhaleDur', 0);
        node.startElapsed = this.initialElapsed || 0;
        node.waveformM = safe('waveformM', 0);
        node.panOsc = safe('panOsc', 0);
        node.panOscPeriod = safe('panOscPeriod', 120);
        node.panOscTrans = safe('panOscTrans', 20);
        node.isOn = settings.isOn ?? true;
        // inhaleRatio overrides inhaleDur/exhaleDur when present
        if (typeof settings.inhaleRatio === 'number') {
          node.inhaleDur = settings.inhaleRatio;
          node.exhaleDur = 1 - settings.inhaleRatio;
        }
        break;

      case VoiceType.MartigliBinaural:
        node = new MartigliBinauralNode(
          ctx,
          global.createMartigliBinauralNode(ctx.context),
        );
        {
          const pitch = deriveMartigliBinauralPitchParams(settings);
          const comfortGain = resolveMartigliComfortGainDb(
            settings,
            pitch.lowHz,
            pitch.highHz,
          );
          node.fl = pitch.fl;
          node.fr = pitch.fr;
          node.ma = pitch.ma;
          node.martigliComfortGainEnabled = comfortGain.enabled;
          node.martigliComfortLowDb = comfortGain.lowDb;
          node.martigliComfortHighDb = comfortGain.highDb;
        }
        node.mp0 = safe('mp0', 10);
        node.mp1 = safe('mp1', 20);
        node.md = safe('md', 600);
        node.inhaleDur = safe('inhaleDur', 0);
        node.exhaleDur = safe('exhaleDur', 0);
        node.startElapsed = this.initialElapsed || 0;
        node.waveformL = safe('waveformL', 0);
        node.waveformR = safe('waveformR', 0);
        node.panOsc = safe('panOsc', 0);
        node.panOscPeriod = safe('panOscPeriod', 120);
        node.panOscTrans = safe('panOscTrans', 20);
        node.isOn = settings.isOn ?? true;
        // inhaleRatio overrides inhaleDur/exhaleDur when present
        if (typeof settings.inhaleRatio === 'number') {
          node.inhaleDur = settings.inhaleRatio;
          node.exhaleDur = 1 - settings.inhaleRatio;
        }
        break;
    }
    return node;
  }

  _startVoices() {
    this.voices.forEach(({ node }) => {
      // 2. Protection: Ensure node exists and has a start function before calling it
      if (node && typeof node.start === 'function') {
        try {
          node.start();
          if (node.isOn !== undefined) node.isOn = true;
        } catch (e) {
          console.error('Failed to start voice node:', e);
          crashlytics.recordError(e);
        }
      }
    });
    this._updateVolumes();
  }

  _stopVoices() {
    this.voices.forEach(({ node }) => {
      if (node.isOn !== undefined) {
        node.isOn = false;
      }
      node.stop();
    });
  }

  _pauseVoices() {
    this.voices.forEach(({ node }) => {
      if (node.pause) {
        node.pause();
      }
    });
  }

  _resumeVoices() {
    this.voices.forEach(({ node }) => {
      if (node.resume) {
        node.resume();
      }
    });
  }

  _resetBreathingPhase() {
    this.breathingSnapshotState.clear();
    this.voices.forEach(({ node }) => {
      if (node?.resetPhase) {
        node.resetPhase();
      }
    });
  }

  _updateVolumes() {
    this.voices.forEach(({ node, volume }) => {
      // Only multiply by masterVolume when setting the actual audio node
      // Keep voice.volume as the independent slider value
      node.volume = volume * this.masterVolume;
    });
  }

  // Android-only background watchdog. RN pauses setInterval whenever the host
  // activity pauses (screen off / backgrounded), so _startTimer's expiry check
  // cannot run back there; the guard rides expo-av's native status-update loop
  // to fire the same expiry (onSessionEnd + stop, soundscape included) on time.
  // Both wrappers are failure-isolated: a guard problem must never affect
  // playback (a previous native-routing attempt crashed the app on play).
  _startStopGuard() {
    try {
      startBackgroundSessionStopGuard(this);
    } catch (e) {
      console.warn('Failed to start background stop guard:', e);
    }
  }

  _stopStopGuard() {
    try {
      stopBackgroundSessionStopGuard();
    } catch (e) {
      console.warn('Failed to stop background stop guard:', e);
    }
  }

  // Android media-playback foreground service — keeps the app process alive so a
  // backgrounded session keeps playing (without it the OS reclaims the process
  // after ~25 min: audio stops and the app cold-restarts on return). No-op on
  // iOS/web (the lease's native module is Android-only). Lazy-required and
  // failure-isolated: an FGS problem must never affect playback.
  _acquireForegroundService() {
    try {
      acquireForegroundService('session');
    } catch (e) {
      console.warn('Failed to acquire audio foreground service:', e);
    }
  }

  _releaseForegroundService() {
    try {
      releaseForegroundService('session');
    } catch (e) {
      console.warn('Failed to release audio foreground service:', e);
    }
  }

  _startTimer() {
    this.timerId = setInterval(() => {
      const elapsed = this.getElapsedTime();
      const remaining = this.getRemainingTime();

      // Breathing-params bridge: only the in-app UI consumes it, so gate to active.
      if (AppState.currentState === 'active' && this.onTimerUpdate) {
        this.onTimerUpdate(elapsed, remaining, this.duration);
      }
      // Lock-screen push must fire while backgrounded — its whole purpose is to
      // keep the locked widget's playbackState/speed/elapsed fresh so iOS does
      // not dim the controls thinking playback has stalled.
      if (this.onLockScreenTimerUpdate) {
        this.onLockScreenTimerUpdate(elapsed, remaining, this.duration);
      }

      // 2. logic to stop the session must ALWAYS run (keep this!)
      if (remaining <= 0) {
        if (this.onSessionEnd) {
          this.onSessionEnd();
        }
        this.stop();
      }
    }, 100);
  }

  _stopTimer() {
    if (this.timerId) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
  }

  _startAnimation() {
    if (this.animationId || !this.onAnimationUpdate) return;

    let lastTime = Date.now();
    // 30 FPS is enough for smooth breathing visuals while keeping CPU stable.
    const pollInterval = 1000 / 30;

    const loop = () => {
      this.animationId = requestAnimationFrame(loop);

      const now = Date.now();
      if (now - lastTime < pollInterval) return;
      lastTime = now - ((now - lastTime) % pollInterval);

      let val = 0;
      if (typeof global.getMartigliAnimationValue === 'function') {
        val = global.getMartigliAnimationValue();
      } else {
        const martigliVoice = this.voices.find(
          ({ node }) =>
            node.isOn !== undefined && node.animationValue !== undefined,
        );
        if (martigliVoice) {
          val = martigliVoice.node.animationValue ?? 0;
        }
      }

      if (typeof val === 'number' && !isNaN(val)) {
        // We strictly store the value internally. No React state, no broken pipelines.
        this.animationValue = val;
        if (this.onAnimationUpdate) {
          this.onAnimationUpdate(val);
        }
      }
    };

    this.animationId = requestAnimationFrame(loop);
  }

  _stopAnimation() {
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
    this.animationValue = 0;
  }

  _cleanup() {
    // Release after the fade-out completes (stop() schedules _cleanup after
    // fadeMs) so the process is not reclaimed mid-fade. reset() also routes
    // through here, so both teardown paths drop the lease.
    this._releaseForegroundService();
    this.voices.forEach(({ node }) => {
      try {
        node.disconnect();
      } catch (_e) {
        // Already disconnected
      }
    });
    this.voices = [];
    this.breathingSnapshotState.clear();
    this.preset = null;
    this.startTime = null;
    this.pausedTime = 0;
    this.initialElapsed = 0;

    this._setState('idle');
  }

  reset() {
    nativeRoomDebug('reset:begin', this._debugSummary());
    // 1. Kill any active timers immediately
    this._stopTimer();
    this._stopStopGuard();
    this._stopAnimation();
    this._stopVoices();

    // 2. Force cleanup of nodes (disconnect everything)
    this._cleanup();

    // 3. HARD RESET the state to idle so loadPreset works
    this.state = 'idle';
    this.preset = null;
    this.pausedTime = 0;
    this.initialElapsed = 0;
    this.breathingSnapshotState.clear();
    nativeRoomDebug('reset:end', this._debugSummary());
  }

  _setState(newState) {
    if (this.state === newState) return;
    this.state = newState;
    if (this.onStateChange) {
      this.onStateChange(newState);
    }
  }
}
