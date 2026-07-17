import { Asset } from 'expo-asset';
import * as FileSystem from 'expo-file-system/legacy';

type MobileSoundscapeStatus =
  | 'idle'
  | 'loading'
  | 'playing'
  | 'stopping'
  | 'error';

type MobileSoundscapeStatusListener = (
  status: MobileSoundscapeStatus,
) => void;

type MobileSoundscapeSample = {
  label?: string;
  value?: string;
  bundledAsset?: unknown;
  isBundled?: boolean;
  isCached?: boolean;
};

type MobileSoundscapePlayOptions = {
  item: MobileSoundscapeSample;
  volumeDb: number;
  masterVolume?: number;
  trackProgress?: boolean;
  onCachedSample?: (sample: MobileSoundscapeSample) => void;
  onDownloadProgress?: (progress: number) => void;
};

type AppStateLike = 'active' | 'background' | 'inactive' | string;

type MobileSoundscapeDeps = {
  assetFromModule?: typeof Asset.fromModule;
  fileSystem?: typeof FileSystem;
  loadExpoAvModule?: () => Promise<any>;
  sleep?: (ms: number) => Promise<void>;
  // Platform the player adapts to ('android' | 'ios'). Defaults to React
  // Native's Platform.OS. Injectable so unit tests can pin both behaviors.
  platformOS?: string;
  // Subscribe to app foreground/background transitions. Defaults to React
  // Native's AppState. Returns an unsubscribe function. Injectable so the
  // player stays unit-testable without the RN runtime.
  subscribeAppState?: (
    listener: (state: AppStateLike) => void,
  ) => () => void;
};

const FADE_STEPS = 20;
const FADE_STEP_MS = 50;
const START_FADE_SECONDS = 2;
const START_FADE_STEP_MS = (START_FADE_SECONDS * 1000) / FADE_STEPS;

const SOUNDSCAPE_CROSSFADE_SECONDS = 3;
const MIN_SOUNDSCAPE_CROSSFADE_SECONDS = 0.5;
const SOUNDSCAPE_CROSSFADE_MAX_RATIO = 0.25;
const SOUNDSCAPE_SCHEDULE_LEAD_MS = 100;

// Android needs the duration probe retried: expo-av builds `durationMillis`
// from a raw int cast of the native player's duration, so ExoPlayer's
// C.TIME_UNSET ("not yet known") truncates to exactly 1 and the legacy
// MediaPlayer reports -1. Right after load that artifact is common, and a
// single instant probe silently disabled the crossfade on Android while iOS
// (whose AVPlayer reports a settled duration immediately) crossfaded fine.
const DURATION_PROBE_MAX_ATTEMPTS = 15;
const DURATION_PROBE_RETRY_MS = 200;

// Dev-build diagnostics promised by SOUNDSCAPE_RUNTIME.md: mode decision and
// per-seam timing, so a device run shows whether the crossfade engaged and why.
// Mirrors the `[BSC soundscape/mobile gain]` gating in SampleToggler.
const crossfadeDebug = (event: string, payload: Record<string, unknown>) => {
  if (typeof __DEV__ === 'undefined' || !__DEV__) return;
  if (typeof process !== 'undefined' && process.env?.JEST_WORKER_ID) return;
  globalThis.console?.warn?.(`[BSC soundscape/mobile crossfade] ${event}`, payload);
};

const resolveCrossfadeSeconds = (durationSec: number) => {
  if (!(durationSec > 0)) return 0;
  const clampedToRatio = durationSec * SOUNDSCAPE_CROSSFADE_MAX_RATIO;
  const target = Math.min(SOUNDSCAPE_CROSSFADE_SECONDS, clampedToRatio);
  return target >= MIN_SOUNDSCAPE_CROSSFADE_SECONDS ? target : 0;
};

const convertSoundscapeVolumeToLinear = (volumeDb: number) => {
  if (volumeDb <= -60) return 0;
  if (volumeDb >= 0) return 1;
  const linear = Math.pow(10, volumeDb / 20);
  return Math.max(0, Math.min(1, linear));
};

const linearToDb = (linear: number) =>
  linear > 0 ? 20 * Math.log10(linear) : -Infinity;

const defaultLoadExpoAvModule = () => import('expo-av');

// Lazy require so this module can be imported in non-RN contexts (web build,
// jest harness) without pulling in react-native. Defaults to 'ios', the more
// conservative looping behavior (see crossfadeLoopSafetyNet).
const defaultPlatformOS = (): string => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('react-native').Platform?.OS ?? 'ios';
  } catch {
    return 'ios';
  }
};

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

const defaultSubscribeAppState = (
  listener: (state: AppStateLike) => void,
): (() => void) => {
  // Lazy require so this module can be imported in non-RN contexts (web build,
  // jest harness) without pulling in AppState.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { AppState } = require('react-native');
    const subscription = AppState.addEventListener('change', listener);
    // Seed the real current state: in a group session a remote soundscape
    // change can construct this player while the app is already backgrounded,
    // and play() must then arm the native loop instead of the frozen JS
    // scheduler.
    if (typeof AppState.currentState === 'string') {
      listener(AppState.currentState);
    }
    return () => subscription?.remove?.();
  } catch {
    return () => {};
  }
};

const getRequestKey = (item: MobileSoundscapeSample) =>
  item.label || item.value || '';

export class MobileSoundscapePlayer {
  private sound: any = null;
  private secondary: any = null;
  private mode: 'idle' | 'single' | 'crossfade' = 'idle';
  private sampleDurationSec = 0;
  private crossfadeSeconds = 0;
  private hopSeconds = 0;
  // Bumped at every seam. A volume ramp from a previous seam that is still
  // running (Android: each setVolumeAsync is a slow main-thread round trip)
  // must abort instead of fighting the newer seam over the same two players.
  private crossfadeRampGeneration = 0;
  // Android only: keep native looping enabled on both crossfade players so a
  // late seam degrades to a hard splice instead of silence. On iOS this must
  // stay OFF: expo-av maps isLooping to AVPlayer actionAtItemEnd. With
  // looping off the outgoing clip pauses itself at its natural end (silent,
  // the behavior the iOS crossfade shipped with); with looping on the queue
  // player advances and replays the loud clip head at residual ramp volume
  // until stopAsync lands — an audible click at every seam.
  private readonly crossfadeLoopSafetyNet: boolean;
  private nextPlayer: 'primary' | 'secondary' = 'primary';
  // Which player is currently audible. In crossfade mode the active sound
  // alternates as clips hand off; we track it so the background fallback knows
  // which sound to keep looping natively.
  private currentAudible: 'primary' | 'secondary' = 'primary';
  private nextStartWallMs = 0;
  private schedulerTimeout: ReturnType<typeof setTimeout> | null = null;
  // True while the app is backgrounded and we have collapsed an active
  // crossfade to a single natively-looping sound (see enterBackgroundLoop).
  private backgroundLoopActive = false;
  private appState: AppStateLike = 'active';
  // Serializes background/foreground transitions so two async handlers can
  // never interleave their awaits and corrupt loop state. Each transition is
  // chained onto this promise and guarded by transitionGeneration.
  private transitionChain: Promise<void> = Promise.resolve();
  private transitionGeneration = 0;
  private readonly unsubscribeAppState: () => void;
  private activeKey: string | null = null;
  private pendingKey: string | null = null;
  private activeDownload: any = null;
  private requestId = 0;
  private status: MobileSoundscapeStatus = 'idle';
  private statusListener: MobileSoundscapeStatusListener | null = null;
  private masterVolume = 1;
  private volumeDb = -30;
  private targetVolume = 0;
  private volumeRevision = 0;
  private activeSourceUri = '';
  private activeLabel = '';
  private activeSourceKind = 'none';
  private readonly assetFromModule: typeof Asset.fromModule;
  private readonly fileSystem: typeof FileSystem;
  private readonly loadExpoAvModule: () => Promise<any>;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(deps: MobileSoundscapeDeps = {}) {
    this.assetFromModule = deps.assetFromModule ?? Asset.fromModule;
    this.fileSystem = deps.fileSystem ?? FileSystem;
    this.loadExpoAvModule = deps.loadExpoAvModule ?? defaultLoadExpoAvModule;
    this.sleep = deps.sleep ?? defaultSleep;
    this.crossfadeLoopSafetyNet =
      (deps.platformOS ?? defaultPlatformOS()) === 'android';
    const subscribeAppState = deps.subscribeAppState ?? defaultSubscribeAppState;
    this.unsubscribeAppState = subscribeAppState((state) => {
      this.handleAppStateChange(state);
    });
  }

  private setStatus(status: MobileSoundscapeStatus) {
    this.status = status;
    this.statusListener?.(status);
  }

  private async unloadSound(sound: any) {
    if (!sound) return;
    try {
      await sound.unloadAsync?.();
    } catch {}
  }

  private async stopSound(sound: any, { fade }: { fade: boolean }) {
    if (!sound) return;

    try {
      const status = await sound.getStatusAsync?.();
      if (!status?.isLoaded) {
        try {
          await sound.stopAsync?.();
        } catch {}
        await this.unloadSound(sound);
        return;
      }

      const currentVolume = status.volume || 0.5;
      // The fade needs the setTimeout-based sleep between volume steps, and RN
      // pauses ALL JS timers while the app is backgrounded on Android
      // (JavaTimerManager.onHostPause) — the first sleep would hang forever and
      // the stopAsync/unloadAsync below would never run, leaving the soundscape
      // looping for good (this is exactly how a background session end failed
      // to stop the soundscape). Backgrounded: cut immediately instead,
      // matching how the session voices already stop.
      if (fade && this.appState === 'active') {
        const volumeDecrement = currentVolume / FADE_STEPS;
        for (let i = 0; i < FADE_STEPS; i += 1) {
          if (this.sound !== null) break;
          // The app can background mid-fade; bail before the sleep can hang.
          if (this.appState !== 'active') break;
          try {
            await sound.setVolumeAsync?.(
              Math.max(0, currentVolume - volumeDecrement * (i + 1)),
            );
            await this.sleep(FADE_STEP_MS);
          } catch {
            break;
          }
        }
      }

      try {
        await sound.stopAsync?.();
      } catch {}
      await this.unloadSound(sound);
    } catch {
      try {
        await sound.stopAsync?.();
      } catch {}
      await this.unloadSound(sound);
    }
  }

  private async fadeInSound(
    sound: any,
    requestId: number,
    volumeRevision: number,
  ) {
    for (let i = 0; i < FADE_STEPS; i += 1) {
      if (
        this.sound !== sound ||
        this.requestId !== requestId ||
        this.volumeRevision !== volumeRevision
      ) {
        return;
      }
      try {
        await sound.setVolumeAsync?.(
          Math.max(0, Math.min(1, (this.targetVolume * (i + 1)) / FADE_STEPS)),
        );
        await this.sleep(START_FADE_STEP_MS);
      } catch {
        if (this.sound === sound && this.requestId === requestId) {
          this.setStatus('error');
        }
        return;
      }
    }
  }

  private cancelScheduler() {
    if (this.schedulerTimeout !== null) {
      clearTimeout(this.schedulerTimeout);
      this.schedulerTimeout = null;
    }
  }

  private scheduleNextCrossfade(currentRequestId: number) {
    if (
      this.mode !== 'crossfade' ||
      this.requestId !== currentRequestId ||
      !this.pendingKey
    ) {
      return;
    }
    const delayMs = Math.max(
      0,
      this.nextStartWallMs - Date.now() - SOUNDSCAPE_SCHEDULE_LEAD_MS,
    );
    this.schedulerTimeout = setTimeout(() => {
      this.schedulerTimeout = null;
      void this.fireNextCrossfade(currentRequestId);
    }, delayMs);
  }

  // Ramp volumes from wall-clock progress, not a fixed step count. On Android
  // every setVolumeAsync is a bridge + main-thread round trip that can take
  // hundreds of ms while a session is rendering; a fixed 25-step loop then
  // stretched a 1.25 s crossfade past 10 s. Clock-based progress keeps the
  // ramp's total duration at crossfadeSeconds regardless of per-call latency —
  // slow devices just get a coarser ramp.
  private async crossfadeStep(
    outgoing: any,
    incoming: any,
    currentRequestId: number,
    volumeRevision: number,
    rampGeneration: number,
  ) {
    const fromVolume = this.targetVolume;
    const rampMs = Math.max(1, this.crossfadeSeconds * 1000);
    const rampStartMs = Date.now();
    const steps = Math.max(1, Math.round(rampMs / FADE_STEP_MS));
    for (let i = 1; i <= steps; i += 1) {
      if (
        this.mode !== 'crossfade' ||
        this.requestId !== currentRequestId ||
        this.volumeRevision !== volumeRevision ||
        this.crossfadeRampGeneration !== rampGeneration
      ) {
        return;
      }
      // Whichever is further along wins: the step index paces the ramp when
      // calls are fast; elapsed wall time catches the ramp up when they are
      // slow, so the ramp always completes in ~rampMs and ~steps iterations.
      const progress = Math.min(
        1,
        Math.max(i / steps, (Date.now() - rampStartMs) / rampMs),
      );
      try {
        await Promise.all([
          outgoing.setVolumeAsync?.(
            Math.max(0, fromVolume * (1 - progress)),
          ),
          incoming.setVolumeAsync?.(
            Math.max(0, Math.min(1, this.targetVolume * progress)),
          ),
        ]);
      } catch {
        return;
      }
      if (progress >= 1) return;
      await this.sleep(FADE_STEP_MS);
    }
  }

  private async fireNextCrossfade(currentRequestId: number) {
    if (
      this.mode !== 'crossfade' ||
      this.requestId !== currentRequestId ||
      !this.pendingKey
    ) {
      return;
    }
    const incoming =
      this.nextPlayer === 'primary' ? this.sound : this.secondary;
    const outgoing =
      this.nextPlayer === 'primary' ? this.secondary : this.sound;
    if (!incoming || !outgoing) return;

    const volumeRevision = this.volumeRevision;
    const scheduledStartWallMs = this.nextStartWallMs;
    const incomingStartedAt = Date.now();
    try {
      await incoming.setPositionAsync?.(0);
      await incoming.setVolumeAsync?.(0);
      await incoming.playAsync?.();
    } catch {
      // The incoming player failed to start. Keep the loop alive and try this
      // seam again one hop out instead of going permanently silent (on
      // Android the outgoing clip keeps looping natively in the meantime; on
      // iOS it plays out and pauses until the retry).
      this.nextStartWallMs = Date.now() + this.hopSeconds * 1000;
      this.scheduleNextCrossfade(currentRequestId);
      return;
    }

    crossfadeDebug('seam', {
      label: this.activeLabel,
      incoming: this.nextPlayer,
      lateMs: incomingStartedAt - scheduledStartWallMs,
      hopSeconds: this.hopSeconds,
      crossfadeSeconds: this.crossfadeSeconds,
    });

    // `incoming` was `this.nextPlayer`; it is now the audible sound. Flip
    // nextPlayer so the *other* sound becomes the next incoming.
    this.currentAudible = this.nextPlayer;
    this.nextPlayer = this.nextPlayer === 'primary' ? 'secondary' : 'primary';
    this.nextStartWallMs = incomingStartedAt + this.hopSeconds * 1000;
    const rampGeneration = ++this.crossfadeRampGeneration;

    // Schedule the next seam *before* running the volume ramp. The ramp's
    // bridge calls can be slow on Android; chaining the schedule behind it
    // pushed every subsequent seam late and left gaps between repetitions.
    if (this.appState === 'active') {
      this.scheduleNextCrossfade(currentRequestId);
    }

    await this.crossfadeStep(
      outgoing,
      incoming,
      currentRequestId,
      volumeRevision,
      rampGeneration,
    );

    if (this.mode !== 'crossfade' || this.requestId !== currentRequestId) {
      return;
    }

    // If a newer seam started while this ramp was still running, "outgoing"
    // is that seam's incoming (now audible) sound — leave it alone.
    if (this.crossfadeRampGeneration === rampGeneration) {
      try {
        await outgoing.stopAsync?.();
      } catch {}
    }

    // The handoff completed while backgrounded (rare, but possible if the JS
    // thread ran briefly). Collapse straight to the native loop so we don't
    // depend on another timer firing.
    if (this.appState !== 'active') {
      this.collapseToBackgroundLoop();
    }
  }

  private getSound(which: 'primary' | 'secondary') {
    return which === 'primary' ? this.sound : this.secondary;
  }

  private handleAppStateChange(state: AppStateLike) {
    const wasActive = this.appState === 'active';
    // Treat anything that is not 'active' (background, inactive, unknown) as
    // "not foreground". This matches how the rest of the app reads AppState.
    const isActive = state === 'active';
    if (wasActive === isActive) {
      // No foreground/background edge (e.g. inactive -> background, or a
      // repeated 'active'). Record the state but do nothing.
      this.appState = state;
      return;
    }
    this.appState = state;
    // Each edge supersedes any in-flight transition. Bump the generation so a
    // still-running handler from the previous edge aborts before it mutates
    // sound state, then queue this edge after the previous one settles.
    const generation = ++this.transitionGeneration;
    const run = isActive
      ? () => this.restoreForegroundCrossfade(generation)
      : () => this.enterBackgroundLoop(generation);
    this.transitionChain = this.transitionChain.then(run, run);
    void this.transitionChain;
  }

  // Queue a collapse-to-native-loop on the same serialized chain the AppState
  // edges use. Called from internal paths (a crossfade armed or completing while
  // already backgrounded) so they cannot race a concurrent foreground edge.
  private collapseToBackgroundLoop() {
    const generation = ++this.transitionGeneration;
    const run = () => this.enterBackgroundLoop(generation);
    this.transitionChain = this.transitionChain.then(run, run);
    void this.transitionChain;
  }

  // True if a newer transition (or a play/stop/dispose) has happened since this
  // transition captured `generation`. Stale handlers must not touch sound state.
  private isTransitionStale(generation: number) {
    return this.transitionGeneration !== generation;
  }

  // Backgrounding (or screen lock) freezes the JS timers that drive the
  // crossfade scheduler, so a crossfaded soundscape — which has native looping
  // disabled — would play its current clip out and then fall silent. To keep
  // audio alive without any JS, collapse to a single natively-looping sound:
  // the audio engine sustains a looping clip on its own thread even while JS is
  // suspended. Single-loop mode already loops natively, so it needs nothing.
  private async enterBackgroundLoop(generation: number) {
    if (this.isTransitionStale(generation)) return;
    if (!this.sound || this.backgroundLoopActive) return;

    if (this.mode === 'single') {
      // Single mode already loops natively, but a startup fade frozen mid-ramp
      // by the suspended JS thread would leave the clip quiet for the entire
      // background stay. Cancel the fade and snap to the target volume.
      this.volumeRevision += 1;
      try {
        await this.sound.setVolumeAsync?.(this.targetVolume);
      } catch {}
      return;
    }

    if (this.mode !== 'crossfade') return;
    this.backgroundLoopActive = true;
    this.cancelScheduler();
    // Cancel any in-flight startup or crossfade ramp so it cannot overwrite the
    // full-volume level we set below once the JS thread resumes mid-loop.
    this.volumeRevision += 1;
    crossfadeDebug('background-collapse', {
      label: this.activeLabel,
      audible: this.currentAudible,
    });

    const audible = this.getSound(this.currentAudible);
    const other = this.getSound(
      this.currentAudible === 'primary' ? 'secondary' : 'primary',
    );

    // Stop the non-audible clip so a half-faded second sound can't linger
    // underneath the looping one.
    if (other) {
      try {
        await other.stopAsync?.();
      } catch {}
      if (this.isTransitionStale(generation)) return;
      try {
        await other.setVolumeAsync?.(0);
      } catch {}
    }

    if (this.isTransitionStale(generation)) return;

    if (audible) {
      try {
        // Make sure the audible clip is at full target volume (a crossfade may
        // have been interrupted mid-ramp) and looping natively.
        await audible.setVolumeAsync?.(this.targetVolume);
      } catch {}
      if (this.isTransitionStale(generation)) return;
      try {
        await audible.setIsLoopingAsync?.(true);
      } catch {}
    }
  }

  // Returning to the foreground: hand control back to the JS crossfade
  // scheduler and reschedule the next crossfade relative to where the clip is
  // now. On Android native looping stays enabled (late-seam safety net); on
  // iOS it is re-disabled below. The scheduler stops the outgoing clip
  // explicitly at each handoff either way.
  private async restoreForegroundCrossfade(generation: number) {
    if (!this.backgroundLoopActive) return;
    this.backgroundLoopActive = false;
    if (this.mode !== 'crossfade' || !this.sound) return;

    const audible = this.getSound(this.currentAudible);
    if (!audible) return;

    let positionSec = 0;
    try {
      const status = await audible.getStatusAsync?.();
      if (status?.isLoaded && typeof status.positionMillis === 'number') {
        positionSec = status.positionMillis / 1000;
      }
    } catch {}

    if (this.isTransitionStale(generation)) return;

    // The background collapse enabled native looping on the audible clip. On
    // Android it stays on (late-seam safety net); on iOS it must be turned
    // back off so clip ends pause instead of audibly wrapping (see the
    // crossfadeLoopSafetyNet field comment).
    if (!this.crossfadeLoopSafetyNet) {
      try {
        await audible.setIsLoopingAsync?.(false);
      } catch {}
    }

    if (this.isTransitionStale(generation) || this.mode !== 'crossfade') return;

    // Schedule the next handoff for when this clip reaches its hop point. If it
    // already looped past that point while backgrounded, fire as soon as
    // possible (the scheduler clamps the delay to >= 0).
    const remainingSec = Math.max(0, this.hopSeconds - positionSec);
    this.nextStartWallMs = Date.now() + remainingSec * 1000;
    crossfadeDebug('foreground-restore', {
      label: this.activeLabel,
      audible: this.currentAudible,
      positionSec,
      remainingSec,
    });
    this.scheduleNextCrossfade(this.requestId);
  }

  private async cancelDownload() {
    const download = this.activeDownload;
    this.activeDownload = null;
    if (!download) return;
    try {
      await download.pauseAsync?.();
    } catch {}
  }

  private getEffectiveVolume(volumeDb: number) {
    return convertSoundscapeVolumeToLinear(volumeDb) * this.masterVolume;
  }

  private async resolveSampleForPlayback(
    item: MobileSoundscapeSample,
    shouldTrackProgress: boolean,
    onDownloadProgress?: (progress: number) => void,
  ) {
    if (item.bundledAsset) {
      const asset = this.assetFromModule(item.bundledAsset as number);
      if (!asset.localUri) {
        await asset.downloadAsync();
      }
      return {
        ...item,
        value: asset.localUri || asset.uri,
        isBundled: true,
      };
    }

    const sourceUri = item.value;
    if (!sourceUri) return item;

    const safeFileName =
      sourceUri
        .split('/')
        .pop()
        ?.replace(/[^a-zA-Z0-9._-]/g, '_') ?? `${item.label}.mp3`;
    const dirUri = `${this.fileSystem.documentDirectory}cached_audio/`;
    const localUri = `${dirUri}${safeFileName}`;

    const fileInfo = await this.fileSystem.getInfoAsync(localUri);
    if (fileInfo.exists) {
      return { ...item, value: localUri, isCached: true };
    }

    await this.fileSystem.makeDirectoryAsync(dirUri, { intermediates: true });

    const resumable = this.fileSystem.createDownloadResumable(
      sourceUri,
      localUri,
      {},
      shouldTrackProgress
        ? ({ totalBytesWritten, totalBytesExpectedToWrite }: any) => {
            if (totalBytesExpectedToWrite > 0) {
              onDownloadProgress?.(
                totalBytesWritten / totalBytesExpectedToWrite,
              );
            }
          }
        : undefined,
    );

    this.activeDownload = resumable;
    const downloadResult = await resumable.downloadAsync();
    if (this.activeDownload === resumable) {
      this.activeDownload = null;
    }

    if (downloadResult?.status === 200) {
      return { ...item, value: localUri, isCached: true };
    }

    return item;
  }

  // Read the sample duration for the crossfade/single mode decision, retrying
  // while the platform reports the "not yet known" artifact (see the
  // DURATION_PROBE_* constants). A `durationMillis` that is absent entirely
  // keeps the pre-existing behavior: immediate single-loop fallback, no
  // retries — only the numeric <= 1 artifact (ExoPlayer TIME_UNSET → 1,
  // MediaPlayer unknown → -1) is worth waiting out. Aborts as soon as a newer
  // request or stop supersedes this sound.
  private async probeSampleDurationSec(
    sound: any,
    currentRequestId: number,
  ): Promise<{ durationSec: number; attempts: number }> {
    let attempts = 0;
    while (attempts < DURATION_PROBE_MAX_ATTEMPTS) {
      attempts += 1;
      let status: any = null;
      try {
        status = await sound.getStatusAsync?.();
      } catch {
        return { durationSec: 0, attempts };
      }
      if (this.requestId !== currentRequestId || this.sound !== sound) {
        return { durationSec: 0, attempts };
      }
      const durationMillis = status?.isLoaded
        ? status.durationMillis
        : undefined;
      if (typeof durationMillis !== 'number') {
        return { durationSec: 0, attempts };
      }
      if (durationMillis > 1) {
        return { durationSec: durationMillis / 1000, attempts };
      }
      if (attempts >= DURATION_PROBE_MAX_ATTEMPTS) break;
      await this.sleep(DURATION_PROBE_RETRY_MS);
      if (this.requestId !== currentRequestId || this.sound !== sound) {
        return { durationSec: 0, attempts };
      }
    }
    return { durationSec: 0, attempts };
  }

  setStatusListener(listener: MobileSoundscapeStatusListener | null) {
    this.statusListener = listener;
    listener?.(this.status);
  }

  getStatus(): MobileSoundscapeStatus {
    return this.status;
  }

  getActiveKey(): string | null {
    return this.activeKey;
  }

  async play({
    item,
    volumeDb,
    masterVolume = 1,
    trackProgress = false,
    onCachedSample,
    onDownloadProgress,
  }: MobileSoundscapePlayOptions) {
    if (!item?.value && !item?.bundledAsset) return;

    const requestKey = getRequestKey(item);
    const currentRequestId = ++this.requestId;
    this.pendingKey = requestKey;
    this.volumeDb = volumeDb;
    this.masterVolume = Math.max(0, Math.min(1, masterVolume));

    if (this.sound && this.activeKey === requestKey) {
      await this.setVolume(volumeDb);
      return;
    }

    this.cancelScheduler();
    this.backgroundLoopActive = false;
    // Invalidate any queued/in-flight background transition: a new sample is
    // loading, so a stale enterBackgroundLoop must not touch the players.
    this.transitionGeneration += 1;
    const previousPrimary = this.sound;
    const previousSecondary = this.secondary;
    this.sound = null;
    this.secondary = null;
    this.mode = 'idle';
    this.activeKey = null;
    await this.cancelDownload();
    await this.unloadSound(previousPrimary);
    if (previousSecondary) await this.unloadSound(previousSecondary);

    this.setStatus('loading');

    let resolvedItem: MobileSoundscapeSample;
    try {
      resolvedItem = await this.resolveSampleForPlayback(
        item,
        trackProgress,
        onDownloadProgress,
      );
    } catch {
      if (this.requestId === currentRequestId) {
        this.setStatus('error');
      }
      return;
    }

    if (
      this.pendingKey !== requestKey ||
      this.requestId !== currentRequestId ||
      !resolvedItem.value
    ) {
      return;
    }

    if (resolvedItem.isCached && !resolvedItem.isBundled) {
      onCachedSample?.(resolvedItem);
    }

    try {
      const { Audio } = await this.loadExpoAvModule();
      this.targetVolume = this.getEffectiveVolume(volumeDb);
      const { sound: newSound } = await Audio.Sound.createAsync(
        { uri: resolvedItem.value },
        {
          shouldPlay: true,
          volume: 0,
          isLooping: true,
        },
      );
      // The clip starts playing when createAsync resolves. The duration probe
      // and secondary load below can take seconds (Android), so the first seam
      // must be scheduled relative to this instant, not relative to setup end.
      const primaryStartedWallMs = Date.now();

      if (
        this.pendingKey !== requestKey ||
        this.requestId !== currentRequestId
      ) {
        await this.unloadSound(newSound);
        return;
      }

      this.sound = newSound;
      this.activeKey = requestKey;
      this.activeSourceUri = resolvedItem.value;
      this.activeLabel = resolvedItem.label || requestKey;
      this.activeSourceKind = resolvedItem.isBundled
        ? 'bundled'
        : resolvedItem.isCached
          ? 'cached'
          : 'remote';
      newSound.setOnPlaybackStatusUpdate?.((status: any) => {
        if (!status.isLoaded && status.error) {
          this.setStatus('error');
        }
      });

      const { durationSec, attempts: probeAttempts } =
        await this.probeSampleDurationSec(newSound, currentRequestId);

      // The probe can span several retry sleeps; a stop() or newer play() in
      // that window has already torn this sound down — bail without touching
      // mode or status.
      if (
        this.pendingKey !== requestKey ||
        this.requestId !== currentRequestId ||
        this.sound !== newSound
      ) {
        return;
      }

      const crossfadeSeconds = resolveCrossfadeSeconds(durationSec);
      crossfadeDebug('mode-decision', {
        label: this.activeLabel,
        durationMs: Math.round(durationSec * 1000),
        probeAttempts,
        crossfadeSeconds,
        mode: crossfadeSeconds > 0 ? 'crossfade' : 'single',
      });

      if (crossfadeSeconds > 0) {
        let secondary: any = null;
        try {
          const created = await Audio.Sound.createAsync(
            { uri: resolvedItem.value },
            {
              shouldPlay: false,
              volume: 0,
              // Android: crossfade players keep native looping enabled as a
              // safety net — if a seam ever fires late (slow JS thread, slow
              // bridge), the audible clip wraps with a hard splice (the
              // pre-crossfade behavior) instead of playing out and going
              // silent. The outgoing clip is explicitly stopped at the end of
              // each ramp, so in the normal case the loop never wraps
              // audibly. iOS: looping must stay off — see the
              // crossfadeLoopSafetyNet field comment (the AVQueuePlayer wrap
              // clicks at every seam).
              isLooping: this.crossfadeLoopSafetyNet,
            },
          );
          secondary = created.sound;
        } catch {}

        if (
          !secondary ||
          this.pendingKey !== requestKey ||
          this.requestId !== currentRequestId
        ) {
          if (secondary) await this.unloadSound(secondary);
          this.mode = 'single';
          this.setStatus('playing');
          void this.fadeInSound(newSound, currentRequestId, this.volumeRevision);
          return;
        }

        secondary.setOnPlaybackStatusUpdate?.((status: any) => {
          if (!status.isLoaded && status.error) {
            this.setStatus('error');
          }
        });

        // Android: native looping stays ON for the primary (it was created
        // looping) — the JS scheduler stops the outgoing clip at the end of
        // each ramp, and looping is only the safety net for a late seam (see
        // the secondary's creation comment); disabling it is what made every
        // scheduler hiccup surface as a multi-second silence. iOS: looping
        // must be turned OFF so the outgoing clip pauses itself at its
        // natural end instead of audibly wrapping mid-ramp (see the
        // crossfadeLoopSafetyNet field comment).
        if (!this.crossfadeLoopSafetyNet) {
          try {
            await newSound.setIsLoopingAsync?.(false);
          } catch {}
        }

        this.secondary = secondary;
        this.mode = 'crossfade';
        this.sampleDurationSec = durationSec;
        this.crossfadeSeconds = crossfadeSeconds;
        this.hopSeconds = durationSec - crossfadeSeconds;
        this.nextPlayer = 'secondary';
        this.currentAudible = 'primary';
        // Relative to when the primary actually started, not to setup end —
        // the duration probe and secondary load may have eaten several
        // seconds of the first pass already (Android).
        this.nextStartWallMs = primaryStartedWallMs + this.hopSeconds * 1000;
        this.setStatus('playing');
        void this.fadeInSound(newSound, currentRequestId, this.volumeRevision);
        if (this.appState === 'active') {
          this.scheduleNextCrossfade(currentRequestId);
        } else {
          // Started (or re-armed) while backgrounded: skip the JS scheduler and
          // loop natively so it survives the suspended JS thread.
          this.collapseToBackgroundLoop();
        }
        return;
      }

      this.mode = 'single';
      this.setStatus('playing');
      void this.fadeInSound(newSound, currentRequestId, this.volumeRevision);
    } catch {
      if (this.requestId === currentRequestId) {
        this.setStatus('error');
      }
    }
  }

  async stop() {
    this.requestId += 1;
    this.pendingKey = null;
    this.backgroundLoopActive = false;
    // Invalidate any queued/in-flight background transition so it cannot loop or
    // restart a sound we are tearing down.
    this.transitionGeneration += 1;
    this.cancelScheduler();
    const currentPrimary = this.sound;
    const currentSecondary = this.secondary;
    const wasCrossfade = this.mode === 'crossfade';
    this.sound = null;
    this.secondary = null;
    this.mode = 'idle';
    this.activeKey = null;
    this.activeSourceUri = '';
    this.activeLabel = '';
    this.activeSourceKind = 'none';
    this.setStatus('stopping');
    await this.cancelDownload();
    if (wasCrossfade && currentSecondary) {
      await Promise.all([
        this.stopSound(currentPrimary, { fade: true }),
        this.stopSound(currentSecondary, { fade: true }),
      ]);
    } else {
      await this.stopSound(currentPrimary, { fade: true });
      if (currentSecondary) {
        try {
          await currentSecondary.stopAsync?.();
        } catch {}
        await this.unloadSound(currentSecondary);
      }
    }
    this.setStatus('idle');
  }

  async shutdown() {
    await this.stop();
  }

  async dispose() {
    this.requestId += 1;
    this.pendingKey = null;
    this.backgroundLoopActive = false;
    // Invalidate any queued/in-flight background transition before teardown.
    this.transitionGeneration += 1;
    this.cancelScheduler();
    try {
      this.unsubscribeAppState();
    } catch {}
    const currentPrimary = this.sound;
    const currentSecondary = this.secondary;
    this.sound = null;
    this.secondary = null;
    this.mode = 'idle';
    this.activeKey = null;
    this.activeSourceUri = '';
    this.activeLabel = '';
    this.activeSourceKind = 'none';
    await this.cancelDownload();
    await this.unloadSound(currentPrimary);
    if (currentSecondary) await this.unloadSound(currentSecondary);
    this.setStatus('idle');
  }

  async setVolume(volumeDb: number) {
    this.volumeRevision += 1;
    this.volumeDb = volumeDb;
    this.targetVolume = this.getEffectiveVolume(volumeDb);
    if (!this.sound) return;
    try {
      if (this.mode === 'crossfade' && this.secondary) {
        await Promise.all([
          this.sound.setVolumeAsync?.(this.targetVolume),
          this.secondary.setVolumeAsync?.(this.targetVolume),
        ]);
      } else {
        await this.sound.setVolumeAsync?.(this.targetVolume);
      }
    } catch {
      this.setStatus('error');
    }
  }

  async setMasterVolume(masterVolume: number) {
    this.masterVolume = Math.max(0, Math.min(1, masterVolume));
    await this.setVolume(this.volumeDb);
  }

  getVolumeDiagnostics() {
    const sliderLinear = convertSoundscapeVolumeToLinear(this.volumeDb);
    return {
      activeKey: this.activeKey,
      label: this.activeLabel,
      sourceKind: this.activeSourceKind,
      sourceUri: this.activeSourceUri,
      volumeDb: this.volumeDb,
      sliderLinear,
      sliderLinearDb: linearToDb(sliderLinear),
      masterVolume: this.masterVolume,
      targetVolume: this.targetVolume,
      targetVolumeDb: linearToDb(this.targetVolume),
      status: this.status,
    };
  }
}
