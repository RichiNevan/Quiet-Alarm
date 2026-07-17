import { crashlytics } from './engineLogger';
import { DEFAULT_MASTER_VOLUME, linearToDb } from './AudioConfig';
import { WebAudioBufferPlayer } from './webAudioBufferPlayer';
import {
  getRegisteredWebSessionAudioContext,
  subscribeWebSessionAudioContext,
} from './sampleAudioBridge';
import {
  pushSessionDiagnosticEvent,
  resolveBufferedLoopWindow,
  setSessionDiagnosticOverlay,
  setSessionWaitingSample,
} from './webAudioShared';

const SOUNDSCAPE_LOOP_TRIM_SECONDS = 0.02;
const SOUNDSCAPE_STOP_SECONDS = 0.15;
const MIN_SOUNDSCAPE_LOOP_SPAN_SECONDS = 1;

export const SOUNDSCAPE_CROSSFADE_SECONDS = 3;
const MIN_SOUNDSCAPE_CROSSFADE_SECONDS = 0.5;
const SOUNDSCAPE_CROSSFADE_MAX_RATIO = 0.25;
const SOUNDSCAPE_SCHEDULE_LEAD_SECONDS = 0.1;
const SOUNDSCAPE_SESSION_START_SECONDS = 2;
const SILENCE_DB = -100;

export type WebSoundscapeStatus =
  | 'idle'
  | 'loading'
  | 'playing'
  | 'stopping'
  | 'error';

type WebSoundscapeStatusListener = (status: WebSoundscapeStatus) => void;

const getSoundscapeLabel = (label?: string | null, uri?: string | null) =>
  String(label || uri?.split('/').pop() || 'soundscape').trim();

const resolveCrossfadeSeconds = (duration: number) => {
  if (!(duration > 0)) return 0;
  const clampedToRatio = duration * SOUNDSCAPE_CROSSFADE_MAX_RATIO;
  const target = Math.min(SOUNDSCAPE_CROSSFADE_SECONDS, clampedToRatio);
  return target >= MIN_SOUNDSCAPE_CROSSFADE_SECONDS ? target : 0;
};

const applyLoopWindow = (player: WebAudioBufferPlayer) => {
  const buffer = player.buffer;
  if (!buffer) return 0;
  const duration = buffer.duration ?? 0;
  if (duration <= MIN_SOUNDSCAPE_LOOP_SPAN_SECONDS) {
    return duration;
  }

  const loopWindow = resolveBufferedLoopWindow(buffer, {
    trimSeconds: SOUNDSCAPE_LOOP_TRIM_SECONDS,
    minLoopSpanSeconds: MIN_SOUNDSCAPE_LOOP_SPAN_SECONDS,
  });

  if (loopWindow) {
    player.setLoopPoints(loopWindow.loopStart, loopWindow.loopEnd);
  }

  return duration;
};

const readDestinationMasterDb = (destination: AudioNode | null): number => {
  const candidate = destination as { gain?: { value?: number } } | null;
  const linear = candidate?.gain?.value;
  if (typeof linear === 'number' && linear > 0) {
    return linearToDb(linear);
  }
  return DEFAULT_MASTER_VOLUME;
};

export class WebSoundscapePlayer {
  private primary: WebAudioBufferPlayer | null = null;
  private secondary: WebAudioBufferPlayer | null = null;
  private context: AudioContext | null = null;
  private destination: AudioNode | null = null;
  private contextUnsubscribe: (() => void) | null = null;
  private nextPlayer: 'primary' | 'secondary' = 'primary';
  private nextStartTime = 0;
  private sampleDuration = 0;
  private hopSeconds = 0;
  private crossfadeSeconds = 0;
  private primaryFadeIn = 0;
  private secondaryFadeIn = 0;
  private schedulerTimeout: ReturnType<typeof setTimeout> | null = null;
  private isFirstStart = true;

  private label = '';
  private uri = '';
  private volumeDb = -20;
  private masterVolumeDb = DEFAULT_MASTER_VOLUME;
  private isLoaded = false;
  private hasStarted = false;
  private wantsPlayback = false;
  private requestId = 0;
  private retiredTimeouts = new Set<ReturnType<typeof setTimeout>>();
  private status: WebSoundscapeStatus = 'idle';
  private statusListener: WebSoundscapeStatusListener | null = null;

  constructor() {
    this.contextUnsubscribe = subscribeWebSessionAudioContext(
      (context, destination) => {
        this.context = context;
        this.destination = destination;
        if (destination) {
          this.masterVolumeDb = readDestinationMasterDb(destination);
        }
      },
    );
  }

  private setStatus(status: WebSoundscapeStatus) {
    this.status = status;
    this.statusListener?.(status);
  }

  private getEffectiveVolumeDb() {
    return this.volumeDb - this.masterVolumeDb;
  }

  private disposePlayer(player: WebAudioBufferPlayer | null) {
    player?.dispose?.();
  }

  private cancelScheduler() {
    if (this.schedulerTimeout !== null) {
      clearTimeout(this.schedulerTimeout);
      this.schedulerTimeout = null;
    }
  }

  private retirePlayer(
    player: WebAudioBufferPlayer | null,
    label: string,
    { immediate = false }: { immediate?: boolean } = {},
  ) {
    setSessionWaitingSample(label, false);
    setSessionDiagnosticOverlay(label, false);

    if (!player) return;

    const stopDelaySeconds = immediate ? 0 : SOUNDSCAPE_STOP_SECONDS;
    pushSessionDiagnosticEvent('soundscape-stop', label);

    try {
      player.setVolume(SILENCE_DB, stopDelaySeconds);
      player.stop({ fadeOutSeconds: stopDelaySeconds });
    } catch (error) {
      crashlytics.recordError(
        error instanceof Error ? error : new Error(String(error)),
      );
    }

    if (stopDelaySeconds === 0) {
      this.disposePlayer(player);
      return;
    }

    const timeoutId = setTimeout(() => {
      this.disposePlayer(player);
      this.retiredTimeouts.delete(timeoutId);
    }, stopDelaySeconds * 1000 + 50);

    this.retiredTimeouts.add(timeoutId);
  }

  private retireActivePlayers({ immediate }: { immediate: boolean }) {
    this.cancelScheduler();
    const a = this.primary;
    const b = this.secondary;
    this.primary = null;
    this.secondary = null;
    if (a) this.retirePlayer(a, this.label, { immediate });
    if (b) this.retirePlayer(b, this.label, { immediate });
  }

  private getCurrentTime(): number {
    return this.context?.currentTime ?? 0;
  }

  private startCrossfadeScheduler(eventLabel: string) {
    const now = this.getCurrentTime();
    this.nextStartTime = now + SOUNDSCAPE_SCHEDULE_LEAD_SECONDS;
    this.nextPlayer = 'primary';
    this.isFirstStart = true;
    this.hasStarted = true;
    this.primaryFadeIn = Math.max(
      this.crossfadeSeconds,
      SOUNDSCAPE_SESSION_START_SECONDS,
    );
    this.secondaryFadeIn = this.crossfadeSeconds;
    setSessionWaitingSample(this.label, false);
    setSessionDiagnosticOverlay(this.label, true);
    this.setStatus('playing');
    pushSessionDiagnosticEvent(
      'soundscape-start',
      `${this.label} | ${eventLabel} | crossfade ${this.crossfadeSeconds.toFixed(2)}s / hop ${this.hopSeconds.toFixed(2)}s`,
    );
    this.scheduleNextCrossfade();
  }

  private scheduleNextCrossfade() {
    if (!this.wantsPlayback) return;
    const now = this.getCurrentTime();
    const delayMs = Math.max(
      0,
      (this.nextStartTime - now - SOUNDSCAPE_SCHEDULE_LEAD_SECONDS) * 1000,
    );
    this.schedulerTimeout = setTimeout(() => {
      this.schedulerTimeout = null;
      this.fireNextCrossfade();
    }, delayMs);
  }

  private fireNextCrossfade() {
    if (!this.wantsPlayback) return;
    const player =
      this.nextPlayer === 'primary' ? this.primary : this.secondary;
    if (!player) return;

    const fadeIn = this.isFirstStart
      ? this.primaryFadeIn
      : this.secondaryFadeIn;

    try {
      player.start({
        when: this.nextStartTime,
        offset: 0,
        duration: this.sampleDuration,
        fadeInSeconds: fadeIn,
        fadeOutSeconds: this.crossfadeSeconds,
        volumeDb: this.getEffectiveVolumeDb(),
        loop: false,
      });
    } catch (error) {
      crashlytics.recordError(
        error instanceof Error ? error : new Error(String(error)),
      );
      return;
    }

    pushSessionDiagnosticEvent(
      this.isFirstStart ? 'soundscape-start' : 'soundscape-crossfade-start',
      `${this.label} | ${this.nextPlayer} @ ${this.nextStartTime.toFixed(2)}s`,
    );

    this.isFirstStart = false;
    this.nextPlayer = this.nextPlayer === 'primary' ? 'secondary' : 'primary';
    this.nextStartTime += this.hopSeconds;
    this.scheduleNextCrossfade();
  }

  private startSingleLoop(
    player: WebAudioBufferPlayer,
    eventLabel: string,
  ) {
    player.setLoop(true);
    player.start({
      when: 0,
      offset: 0,
      fadeInSeconds: SOUNDSCAPE_SESSION_START_SECONDS,
      volumeDb: this.getEffectiveVolumeDb(),
      loop: true,
    });
    this.hasStarted = true;
    setSessionWaitingSample(this.label, false);
    setSessionDiagnosticOverlay(this.label, true);
    this.setStatus('playing');
    pushSessionDiagnosticEvent(
      'soundscape-start',
      `${this.label} | ${eventLabel}`,
    );
  }

  private startIfReady(eventLabel = 'ready') {
    if (
      !this.primary ||
      !this.isLoaded ||
      !this.wantsPlayback ||
      this.hasStarted ||
      this.status === 'error'
    ) {
      return;
    }

    if (this.secondary && this.crossfadeSeconds > 0) {
      this.startCrossfadeScheduler(eventLabel);
    } else {
      this.startSingleLoop(this.primary, eventLabel);
    }
  }

  setStatusListener(listener: WebSoundscapeStatusListener | null) {
    this.statusListener = listener;
    listener?.(this.status);
  }

  getStatus(): WebSoundscapeStatus {
    return this.status;
  }

  async play({
    uri,
    label,
    volumeDb,
  }: {
    uri: string;
    label?: string | null;
    volumeDb: number;
  }) {
    if (!uri) return;

    this.requestId += 1;
    const currentRequestId = this.requestId;
    const nextLabel = getSoundscapeLabel(label, uri);
    this.wantsPlayback = true;
    this.volumeDb = volumeDb;

    if (this.primary && this.uri === uri && this.status !== 'error') {
      this.label = nextLabel;
      this.setVolume(volumeDb);
      if (this.isLoaded) {
        this.startIfReady('resume');
      } else {
        this.setStatus('loading');
      }
      return;
    }

    this.retireActivePlayers({ immediate: true });
    this.isLoaded = false;
    this.hasStarted = false;
    this.uri = uri;
    this.label = nextLabel;

    setSessionWaitingSample(nextLabel, true);
    setSessionDiagnosticOverlay(nextLabel, false);
    this.setStatus('loading');
    pushSessionDiagnosticEvent('soundscape-wait', nextLabel);

    // Pull a fresh handle off the bridge each play(); the engine may have
    // swapped contexts since the last play.
    const { context, destination } = getRegisteredWebSessionAudioContext();
    if (!context || !destination) {
      this.setStatus('error');
      pushSessionDiagnosticEvent(
        'soundscape-error',
        `${nextLabel} | no session audio context`,
      );
      return;
    }
    this.context = context;
    this.destination = destination;
    this.masterVolumeDb = readDestinationMasterDb(destination);

    let primary: WebAudioBufferPlayer | null = null;
    try {
      primary = new WebAudioBufferPlayer({ context, destination });
      this.primary = primary;
      primary.setVolume(SILENCE_DB);
      await primary.load(uri);

      if (
        this.primary !== primary ||
        currentRequestId !== this.requestId ||
        !this.wantsPlayback
      ) {
        this.disposePlayer(primary);
        if (this.primary === primary) {
          this.primary = null;
        }
        setSessionWaitingSample(nextLabel, false);
        return;
      }

      const buffer = primary.buffer;
      const duration = buffer?.duration ?? 0;
      this.sampleDuration = duration;
      this.crossfadeSeconds = resolveCrossfadeSeconds(duration);

      if (this.crossfadeSeconds > 0 && buffer) {
        this.hopSeconds = duration - this.crossfadeSeconds;
        try {
          const secondary = new WebAudioBufferPlayer({
            context,
            destination,
            buffer,
          });
          secondary.setVolume(SILENCE_DB);
          this.secondary = secondary;
          pushSessionDiagnosticEvent(
            'soundscape-loaded',
            `${nextLabel} | ${duration.toFixed(2)} s | crossfade ${this.crossfadeSeconds.toFixed(2)} s | hop ${this.hopSeconds.toFixed(2)} s`,
          );
        } catch (error) {
          crashlytics.recordError(
            error instanceof Error ? error : new Error(String(error)),
          );
          this.secondary = null;
          this.crossfadeSeconds = 0;
          applyLoopWindow(primary);
          pushSessionDiagnosticEvent(
            'soundscape-loaded',
            `${nextLabel} | ${duration.toFixed(2)} s | loop ${primary.loopStart.toFixed(2)}-${primary.loopEnd.toFixed(2)} s (fallback)`,
          );
        }
      } else {
        applyLoopWindow(primary);
        pushSessionDiagnosticEvent(
          'soundscape-loaded',
          `${nextLabel} | ${duration.toFixed(2)} s | loop ${primary.loopStart.toFixed(2)}-${primary.loopEnd.toFixed(2)} s`,
        );
      }

      this.isLoaded = true;
      this.startIfReady('after-load');
    } catch (error) {
      if (this.primary === primary) {
        this.isLoaded = false;
        this.hasStarted = false;
        setSessionWaitingSample(nextLabel, false);
        setSessionDiagnosticOverlay(nextLabel, false);
        this.setStatus('error');
      }
      pushSessionDiagnosticEvent('soundscape-error', nextLabel);
      crashlytics.recordError(
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }

  stop() {
    this.requestId += 1;
    this.wantsPlayback = false;
    const wasPlaying = this.hasStarted;
    const label = this.label;

    this.setStatus('stopping');
    this.retireActivePlayers({ immediate: !wasPlaying });

    this.label = '';
    this.uri = '';
    this.isLoaded = false;
    this.hasStarted = false;
    this.sampleDuration = 0;
    this.hopSeconds = 0;
    this.crossfadeSeconds = 0;
    void label;
    this.setStatus('idle');
  }

  shutdown() {
    this.stop();
  }

  setVolume(volumeDb: number) {
    this.volumeDb = volumeDb;
    const target = this.getEffectiveVolumeDb();
    this.primary?.setVolume?.(target, 0.5);
    this.secondary?.setVolume?.(target, 0.5);
  }

  setMasterVolume(masterVolumeDb: number) {
    this.masterVolumeDb = masterVolumeDb;
    if (!this.hasStarted) return;
    const target = this.getEffectiveVolumeDb();
    this.primary?.setVolume?.(target, 0.5);
    this.secondary?.setVolume?.(target, 0.5);
  }

  dispose() {
    this.requestId += 1;
    this.wantsPlayback = false;
    this.cancelScheduler();
    this.retiredTimeouts.forEach((timeoutId) => clearTimeout(timeoutId));
    this.retiredTimeouts.clear();

    setSessionWaitingSample(this.label, false);
    setSessionDiagnosticOverlay(this.label, false);

    if (this.primary) this.disposePlayer(this.primary);
    if (this.secondary) this.disposePlayer(this.secondary);

    this.primary = null;
    this.secondary = null;
    this.label = '';
    this.uri = '';
    this.isLoaded = false;
    this.hasStarted = false;
    this.sampleDuration = 0;
    this.hopSeconds = 0;
    this.crossfadeSeconds = 0;
    if (this.contextUnsubscribe) {
      this.contextUnsubscribe();
      this.contextUnsubscribe = null;
    }
    this.setStatus('idle');
  }
}
