/**
 * Admin-only web session sample recorder.
 *
 * Captures the live session audio (generated voices AND any toggled soundscape)
 * straight off the Web Audio graph and downloads it as a stereo 16-bit WAV, for
 * use as social-media sample clips.
 *
 * Why this tap point works for free:
 *   - The Worklet/WASM session node connects to `masterGain`
 *     (see workletWasmSession.js -> registerWebSessionAudioContext(context, masterGain)).
 *   - The web soundscape players connect to that SAME node
 *     (webSoundscape.ts uses the registered `destination`, which is masterGain).
 * So `masterGain` is the single mix bus for both. Tapping it captures the full
 * session as heard, minus only the post-masterGain DynamicsCompressor limiter,
 * which is effectively inert at normal session levels.
 *
 * Web-only: depends on Web Audio + ScriptProcessorNode + Blob downloads.
 */
import {
  getRegisteredWebSessionAudioContext,
  subscribeWebSessionAudioContext,
} from './sampleAudioBridge';

export type WebSessionRecordingState =
  | 'waiting-for-audio'
  | 'recording'
  | 'finalizing'
  | 'done'
  | 'cancelled'
  | 'error';

export type WebSessionRecordingHandle = {
  /** Stop early and download whatever has been captured so far. */
  stop: () => void;
  /** Abort without downloading. */
  cancel: () => void;
  /** Seconds captured so far. */
  elapsedSeconds: () => number;
};

type StartOptions = {
  maxSeconds?: number;
  /** Base filename (without extension); a timestamp + ".wav" are appended. */
  fileLabel?: string;
  onState?: (state: WebSessionRecordingState, info?: { error?: string }) => void;
  /** Max time to wait for the session audio context to come up. */
  waitForAudioMs?: number;
};

const SCRIPT_BUFFER_SIZE = 4096;
const DEFAULT_MAX_SECONDS = 120;
const DEFAULT_WAIT_MS = 8000;

let activeRecording: { cancel: () => void } | null = null;

export const isWebSessionRecordingSupported = (): boolean => {
  if (typeof window === 'undefined') return false;
  const w = window as unknown as {
    AudioContext?: unknown;
    webkitAudioContext?: unknown;
    Blob?: unknown;
    URL?: { createObjectURL?: unknown };
  };
  return (
    (typeof w.AudioContext === 'function' ||
      typeof w.webkitAudioContext === 'function') &&
    typeof w.Blob === 'function' &&
    typeof w.URL?.createObjectURL === 'function'
  );
};

const sanitize = (label: string): string =>
  label
    .replace(/[^a-z0-9-_]+/gi, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80) || 'session';

const buildFilename = (fileLabel?: string): string => {
  const stamp = new Date()
    .toISOString()
    .replace(/[:.]/g, '-')
    .replace('T', '_')
    .slice(0, 19);
  return `${sanitize(fileLabel ?? 'session')}_${stamp}.wav`;
};

const encodeWavPcm16 = (
  chunksL: Float32Array[],
  chunksR: Float32Array[],
  totalFrames: number,
  sampleRate: number,
): Blob => {
  const blockAlign = 2 /* channels */ * 2 /* bytes */;
  const dataBytes = totalFrames * blockAlign;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);

  const writeAscii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) {
      view.setUint8(offset + i, text.charCodeAt(i));
    }
  };

  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 2, true); // channels
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeAscii(36, 'data');
  view.setUint32(40, dataBytes, true);

  let offset = 44;
  let written = 0;
  for (let c = 0; c < chunksL.length && written < totalFrames; c += 1) {
    const l = chunksL[c];
    const r = chunksR[c];
    for (let i = 0; i < l.length && written < totalFrames; i += 1) {
      const sl = Math.max(-1, Math.min(1, l[i]));
      const sr = Math.max(-1, Math.min(1, r[i]));
      view.setInt16(offset, sl < 0 ? sl * 0x8000 : sl * 0x7fff, true);
      view.setInt16(offset + 2, sr < 0 ? sr * 0x8000 : sr * 0x7fff, true);
      offset += 4;
      written += 1;
    }
  }

  return new Blob([buffer], { type: 'audio/wav' });
};

const downloadBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  // Revoke on the next tick so the download has a chance to start.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

/**
 * Begin recording the live web session. Safe to call right when starting
 * playback: it waits (up to `waitForAudioMs`) for the session audio context to
 * register before it begins capturing.
 */
export const startWebSessionRecording = (
  options: StartOptions = {},
): WebSessionRecordingHandle => {
  const {
    maxSeconds = DEFAULT_MAX_SECONDS,
    fileLabel,
    onState,
    waitForAudioMs = DEFAULT_WAIT_MS,
  } = options;

  // One recording at a time; cancel any prior one.
  activeRecording?.cancel();

  let cancelled = false;
  let started = false;
  let capturedFrames = 0;
  let sampleRate = 48000;
  const chunksL: Float32Array[] = [];
  const chunksR: Float32Array[] = [];

  let scriptNode: ScriptProcessorNode | null = null;
  let muteGain: GainNode | null = null;
  let source: AudioNode | null = null;
  let unsubscribe: (() => void) | null = null;
  let waitTimer: ReturnType<typeof setTimeout> | null = null;

  const emit = (state: WebSessionRecordingState, info?: { error?: string }) => {
    try {
      onState?.(state, info);
    } catch {
      /* listener errors must not break recording */
    }
  };

  const teardownGraph = () => {
    try {
      source?.disconnect(scriptNode as AudioNode);
    } catch {
      /* ignore */
    }
    try {
      scriptNode?.disconnect();
    } catch {
      /* ignore */
    }
    try {
      muteGain?.disconnect();
    } catch {
      /* ignore */
    }
    if (scriptNode) scriptNode.onaudioprocess = null;
    scriptNode = null;
    muteGain = null;
    source = null;
  };

  const finalize = (download: boolean) => {
    if (waitTimer) {
      clearTimeout(waitTimer);
      waitTimer = null;
    }
    unsubscribe?.();
    unsubscribe = null;
    teardownGraph();
    if (activeRecording && activeRecording.cancel === cancel) {
      activeRecording = null;
    }

    if (!download) {
      emit('cancelled');
      return;
    }
    emit('finalizing');
    try {
      const blob = encodeWavPcm16(chunksL, chunksR, capturedFrames, sampleRate);
      downloadBlob(blob, buildFilename(fileLabel));
      emit('done');
    } catch (error) {
      emit('error', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  function cancel() {
    if (cancelled) return;
    cancelled = true;
    finalize(false);
  }

  const stop = () => {
    if (cancelled) return;
    cancelled = true;
    finalize(true);
  };

  const begin = (context: AudioContext, masterGain: AudioNode) => {
    if (cancelled || started) return;
    started = true;
    if (waitTimer) {
      clearTimeout(waitTimer);
      waitTimer = null;
    }
    unsubscribe?.();
    unsubscribe = null;

    sampleRate = context.sampleRate || 48000;
    const maxFrames = Math.round(maxSeconds * sampleRate);
    source = masterGain;

    scriptNode = context.createScriptProcessor(SCRIPT_BUFFER_SIZE, 2, 2);
    // Keep the tap silent: route through a zero-gain node so it can be pulled
    // by the graph without adding a second copy of the audio to the output.
    muteGain = context.createGain();
    muteGain.gain.value = 0;

    scriptNode.onaudioprocess = (event: AudioProcessingEvent) => {
      if (cancelled) return;
      const input = event.inputBuffer;
      const left = input.getChannelData(0);
      const right =
        input.numberOfChannels > 1 ? input.getChannelData(1) : left;
      const remaining = maxFrames - capturedFrames;
      if (remaining <= 0) {
        stop();
        return;
      }
      const take = Math.min(left.length, remaining);
      chunksL.push(left.slice(0, take));
      chunksR.push(right.slice(0, take));
      capturedFrames += take;
      // Output stays silent (we never write event.outputBuffer).
      if (capturedFrames >= maxFrames) {
        stop();
      }
    };

    masterGain.connect(scriptNode);
    scriptNode.connect(muteGain);
    muteGain.connect(context.destination);
    emit('recording');
  };

  // Start now if audio is already up; otherwise wait for it to register.
  const existing = getRegisteredWebSessionAudioContext();
  if (existing.context && existing.destination) {
    begin(existing.context, existing.destination as AudioNode);
  } else {
    emit('waiting-for-audio');
    unsubscribe = subscribeWebSessionAudioContext((context, destination) => {
      if (context && destination) {
        begin(context, destination as AudioNode);
      }
    });
    waitTimer = setTimeout(() => {
      if (!started && !cancelled) {
        cancelled = true;
        finalize(false);
        emit('error', { error: 'Session audio did not start in time.' });
      }
    }, waitForAudioMs);
  }

  activeRecording = { cancel };

  return {
    stop,
    cancel,
    elapsedSeconds: () => capturedFrames / sampleRate,
  };
};

export const cancelActiveWebSessionRecording = (): void => {
  activeRecording?.cancel();
};
