import { dbToLinear } from './AudioConfig';

export interface WebAudioBufferPlayerOptions {
  context: AudioContext;
  destination?: AudioNode | null;
  buffer?: AudioBuffer | null;
}

export interface WebAudioBufferPlayerStartOptions {
  when?: number;
  offset?: number;
  duration?: number;
  fadeInSeconds?: number;
  fadeOutSeconds?: number;
  volumeDb?: number;
  loop?: boolean;
  loopStart?: number;
  loopEnd?: number;
}

export interface WebAudioBufferPlayerStopOptions {
  when?: number;
  fadeOutSeconds?: number;
}

const SILENCE_DB = -100;

export class WebAudioBufferPlayer {
  private context: AudioContext;
  private destination: AudioNode | null;
  private gainNode: GainNode;
  private source: AudioBufferSourceNode | null = null;
  private decodedBuffer: AudioBuffer | null = null;
  private loaded = false;
  private started = false;
  private disposed = false;
  private loadGeneration = 0;
  private storedLoopStart = 0;
  private storedLoopEnd = 0;
  private storedLoop = true;
  private currentVolumeDb = SILENCE_DB;

  constructor({ context, destination = null, buffer = null }: WebAudioBufferPlayerOptions) {
    if (!context) {
      throw new Error('WebAudioBufferPlayer requires an AudioContext.');
    }
    this.context = context;
    this.destination = destination;
    this.gainNode = context.createGain();
    this.gainNode.gain.value = 0;
    if (destination) {
      this.gainNode.connect(destination);
    }
    if (buffer) {
      this.provideBuffer(buffer);
    }
  }

  async load(url: string): Promise<void> {
    if (this.disposed) return;
    this.loadGeneration += 1;
    const generation = this.loadGeneration;
    const response = await fetch(url);
    if (this.disposed || generation !== this.loadGeneration) return;
    const arrayBuffer = await response.arrayBuffer();
    if (this.disposed || generation !== this.loadGeneration) return;
    const decoded = await this.context.decodeAudioData(arrayBuffer);
    if (this.disposed || generation !== this.loadGeneration) return;
    this.provideBuffer(decoded);
  }

  provideBuffer(buffer: AudioBuffer): void {
    if (this.disposed) return;
    this.decodedBuffer = buffer;
    this.loaded = true;
    if (this.storedLoopEnd <= this.storedLoopStart) {
      this.storedLoopEnd = buffer.duration;
    }
  }

  setLoopPoints(loopStart: number, loopEnd: number): void {
    this.storedLoopStart = Math.max(0, loopStart);
    this.storedLoopEnd = Math.max(this.storedLoopStart, loopEnd);
    if (this.source) {
      this.source.loopStart = this.storedLoopStart;
      this.source.loopEnd = this.storedLoopEnd;
    }
  }

  setLoop(loop: boolean): void {
    this.storedLoop = loop;
    if (this.source) {
      this.source.loop = loop;
    }
  }

  connect(destination: AudioNode | null): void {
    if (this.disposed || this.destination === destination) return;
    try {
      this.gainNode.disconnect();
    } catch {}
    this.destination = destination;
    if (destination) {
      this.gainNode.connect(destination);
    }
  }

  start(options: WebAudioBufferPlayerStartOptions = {}): void {
    if (this.disposed) return;
    if (!this.decodedBuffer || !this.loaded) {
      throw new Error('WebAudioBufferPlayer.start called before buffer was loaded.');
    }
    if (this.source) {
      this.stop({ fadeOutSeconds: 0 });
    }

    const now = this.context.currentTime;
    const startTime = options.when && options.when > now ? options.when : now;
    const fadeIn = Math.max(0, options.fadeInSeconds ?? 0);
    const fadeOut = Math.max(0, options.fadeOutSeconds ?? 0);
    const volumeDb = options.volumeDb ?? this.currentVolumeDb;
    const target = dbToLinear(volumeDb);
    const loop = options.loop ?? this.storedLoop;
    const loopStart = options.loopStart ?? this.storedLoopStart;
    const loopEnd = options.loopEnd ?? this.storedLoopEnd;
    const offset = Math.max(0, options.offset ?? 0);
    const duration = options.duration;

    const source = this.context.createBufferSource();
    source.buffer = this.decodedBuffer;
    source.loop = loop;
    if (loop) {
      source.loopStart = loopStart;
      source.loopEnd = loopEnd;
    }
    source.connect(this.gainNode);

    const gain = this.gainNode.gain;
    gain.cancelScheduledValues(startTime);
    if (fadeIn > 0) {
      gain.setValueAtTime(0, startTime);
      gain.linearRampToValueAtTime(target, startTime + fadeIn);
    } else {
      gain.setValueAtTime(target, startTime);
    }

    if (typeof duration === 'number' && duration > 0 && fadeOut > 0) {
      const fadeStart = Math.max(startTime + fadeIn, startTime + duration - fadeOut);
      gain.setValueAtTime(target, fadeStart);
      gain.linearRampToValueAtTime(0, startTime + duration);
    }

    if (typeof duration === 'number' && duration > 0) {
      source.start(startTime, offset, duration);
    } else {
      source.start(startTime, offset);
    }

    source.onended = () => {
      if (this.source === source) {
        this.source = null;
        this.started = false;
      }
    };

    this.source = source;
    this.started = true;
    this.storedLoop = loop;
    this.storedLoopStart = loopStart;
    this.storedLoopEnd = loopEnd;
    this.currentVolumeDb = volumeDb;
  }

  stop(options: WebAudioBufferPlayerStopOptions = {}): void {
    if (this.disposed || !this.source) {
      this.started = false;
      return;
    }
    const now = this.context.currentTime;
    const stopTime = options.when && options.when > now ? options.when : now;
    const fadeOut = Math.max(0, options.fadeOutSeconds ?? 0);
    const gain = this.gainNode.gain;
    gain.cancelScheduledValues(stopTime);
    if (fadeOut > 0) {
      gain.setValueAtTime(gain.value, stopTime);
      gain.linearRampToValueAtTime(0, stopTime + fadeOut);
    } else {
      gain.setValueAtTime(0, stopTime);
    }

    const source = this.source;
    try {
      source.stop(stopTime + fadeOut);
    } catch {}
    this.source = null;
    this.started = false;
  }

  setVolume(volumeDb: number, rampSeconds = 0): void {
    if (this.disposed) return;
    this.currentVolumeDb = volumeDb;
    const target = dbToLinear(volumeDb);
    const now = this.context.currentTime;
    const gain = this.gainNode.gain;
    gain.cancelScheduledValues(now);
    if (rampSeconds > 0) {
      gain.setValueAtTime(gain.value, now);
      gain.linearRampToValueAtTime(target, now + rampSeconds);
    } else {
      gain.setValueAtTime(target, now);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.loaded = false;
    this.started = false;
    if (this.source) {
      try {
        this.source.stop();
      } catch {}
      try {
        this.source.disconnect();
      } catch {}
      this.source = null;
    }
    try {
      this.gainNode.disconnect();
    } catch {}
    this.decodedBuffer = null;
  }

  get buffer(): AudioBuffer | null {
    return this.decodedBuffer;
  }

  get duration(): number {
    return this.decodedBuffer?.duration ?? 0;
  }

  get loopStart(): number {
    return this.storedLoopStart;
  }

  get loopEnd(): number {
    return this.storedLoopEnd;
  }

  get isLoaded(): boolean {
    return this.loaded;
  }

  get isStarted(): boolean {
    return this.started;
  }

  get isDisposed(): boolean {
    return this.disposed;
  }
}
