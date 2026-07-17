import { getRegisteredWebSessionAudioContext } from './sampleAudioBridge';

const WEB_AUDIO_ENGINE_WORKLET_WASM = 'worklet_wasm';

let sessionClipCount = 0;
let lastClipAt = null;
let sessionVoiceLabels = [];
let sessionOverlayLabels = [];
let sessionWaitingSamples = [];
let sessionEngineDiagnostics = {
  requestedEngine: WEB_AUDIO_ENGINE_WORKLET_WASM,
  effectiveEngine: WEB_AUDIO_ENGINE_WORKLET_WASM,
  engineFallbackReason: null,
  engineSelectionSource: 'global',
  workletWasmSupported: null,
  audioWorkletNodeSupported: null,
  wasmSupported: null,
  secureContext: null,
};

const emptyWorkletDiagnostics = () => ({
  workletStage: 'idle',
  workletWasmReady: null,
  workletStageError: null,
  workletErrorStage: null,
  workletRenderBudgetPct: null,
  workletRenderBudgetMaxPct: null,
  workletPossibleXrunCount: 0,
  workletProcessCalls: 0,
  workletQuantumMs: null,
  workletElapsed: null,
  workletElapsedAudioTime: null,
  workletElapsedReceivedAtMs: null,
});

let sessionWorkletDiagnostics = emptyWorkletDiagnostics();
let sessionAutomationUnderrunCount = 0;
let sessionAutomationUnderrunMaxMs = 0;
let lastAutomationUnderrunAt = null;
let nextDiagnosticEventId = 1;
let sessionDiagnosticEvents = [];
const MAX_DIAGNOSTIC_EVENTS = 12;
const LOOP_ZERO_THRESHOLD = 0.003;
const LOOP_SEARCH_WINDOW_SECONDS = 0.08;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const emptyDiagnostics = () => ({
  rmsDb: {
    left: -Infinity,
    right: -Infinity,
  },
  reductionDb: 0,
  peakDb: {
    left: -Infinity,
    right: -Infinity,
  },
  peakLinear: {
    left: 0,
    right: 0,
  },
  peakHoldDb: {
    left: -Infinity,
    right: -Infinity,
  },
  peakHoldLinear: {
    left: 0,
    right: 0,
  },
  automationUnderrunCount: 0,
  automationUnderrunMaxMs: 0,
  lastAutomationUnderrunAt: null,
});

export function setSessionDiagnosticVoices(labels = []) {
  sessionVoiceLabels = labels.filter(Boolean).slice(0, 8);
}

export function setSessionDiagnosticOverlay(label, isActive = true) {
  const normalizedLabel = String(label || '').trim();
  if (!normalizedLabel) return;

  sessionOverlayLabels = isActive
    ? [...new Set([...sessionOverlayLabels, normalizedLabel])]
    : sessionOverlayLabels.filter((entry) => entry !== normalizedLabel);
}

export function setSessionWaitingSample(label, isWaiting = true) {
  const normalizedLabel = String(label || '').trim();
  if (!normalizedLabel) return;

  sessionWaitingSamples = isWaiting
    ? [...new Set([...sessionWaitingSamples, normalizedLabel])]
    : sessionWaitingSamples.filter((entry) => entry !== normalizedLabel);
}

export function setSessionDiagnosticEngine({
  requestedEngine = WEB_AUDIO_ENGINE_WORKLET_WASM,
  effectiveEngine = WEB_AUDIO_ENGINE_WORKLET_WASM,
  fallbackReason = null,
  source = 'global',
  support = {},
} = {}) {
  sessionEngineDiagnostics = {
    requestedEngine,
    effectiveEngine,
    engineFallbackReason: fallbackReason,
    engineSelectionSource: source,
    workletWasmSupported: support.workletWasmSupported ?? null,
    audioWorkletNodeSupported: support.audioWorkletNodeSupported ?? null,
    wasmSupported: support.wasmSupported ?? null,
    secureContext: support.secureContext ?? null,
  };
}

export function setSessionDiagnosticWorkletStage(stage, errorMessage = null) {
  sessionWorkletDiagnostics = {
    ...sessionWorkletDiagnostics,
    workletStage: stage,
    workletStageError: errorMessage,
  };
}

export function setSessionDiagnosticWorkletError(stage, message) {
  sessionWorkletDiagnostics = {
    ...sessionWorkletDiagnostics,
    workletStage: 'failed',
    workletErrorStage: stage,
    workletStageError: message,
  };
}

export function setSessionDiagnosticWorkletReady(wasmReady) {
  sessionWorkletDiagnostics = {
    ...sessionWorkletDiagnostics,
    workletStage: 'ready',
    workletWasmReady: wasmReady === true,
    workletStageError: null,
    workletErrorStage: null,
  };
}

export function setSessionDiagnosticWorkletHealth({
  renderBudgetPct = null,
  renderBudgetMaxPct = null,
  possibleXruns = 0,
  processCalls = 0,
  quantumMs = null,
  wasmReady = null,
} = {}) {
  sessionWorkletDiagnostics = {
    ...sessionWorkletDiagnostics,
    workletRenderBudgetPct: renderBudgetPct,
    workletRenderBudgetMaxPct: renderBudgetMaxPct,
    workletPossibleXrunCount: possibleXruns,
    workletProcessCalls: processCalls,
    workletQuantumMs: quantumMs,
    workletWasmReady:
      wasmReady === null ? sessionWorkletDiagnostics.workletWasmReady : wasmReady,
  };
}

export function setSessionDiagnosticWorkletElapsed({
  elapsed = null,
  audioTime = null,
  receivedAtMs = null,
} = {}) {
  sessionWorkletDiagnostics = {
    ...sessionWorkletDiagnostics,
    workletElapsed: elapsed,
    workletElapsedAudioTime: audioTime,
    workletElapsedReceivedAtMs: receivedAtMs,
  };
}

export function resetSessionDiagnosticWorklet() {
  sessionWorkletDiagnostics = emptyWorkletDiagnostics();
}

export function getSessionDiagnosticWorklet() {
  return sessionWorkletDiagnostics;
}

export function clearSessionDiagnosticMeta() {
  sessionVoiceLabels = [];
  sessionOverlayLabels = [];
  sessionWaitingSamples = [];
}

export function resetSessionDiagnostics() {
  sessionClipCount = 0;
  lastClipAt = null;
  sessionAutomationUnderrunCount = 0;
  sessionAutomationUnderrunMaxMs = 0;
  lastAutomationUnderrunAt = null;
}

export function clearSessionDiagnosticEvents() {
  sessionDiagnosticEvents = [];
}

export function pushSessionDiagnosticEvent(type, details = '') {
  const event = {
    id: nextDiagnosticEventId++,
    at: Date.now(),
    type,
    details,
  };
  sessionDiagnosticEvents = [
    ...sessionDiagnosticEvents.slice(-(MAX_DIAGNOSTIC_EVENTS - 1)),
    event,
  ];
  return event;
}

export function getWebAudioContextSnapshot() {
  const { context } = getRegisteredWebSessionAudioContext();

  return {
    contextState: context?.state ?? 'unknown',
    latencyHint: context?.latencyHint ?? 'unknown',
    lookAhead: null,
    updateInterval: null,
    sampleRate: context?.sampleRate ?? null,
    contextCurrentTime: context?.currentTime ?? null,
    baseLatency:
      typeof context?.baseLatency === 'number' ? context.baseLatency : null,
    outputLatency:
      typeof context?.outputLatency === 'number' ? context.outputLatency : null,
  };
}

export function getSessionDiagnosticsSnapshot() {
  return {
    ...getWebAudioContextSnapshot(),
    ...emptyDiagnostics(),
    automationUnderrunCount: sessionAutomationUnderrunCount,
    automationUnderrunMaxMs: sessionAutomationUnderrunMaxMs,
    lastAutomationUnderrunAt,
    voiceLabels: sessionVoiceLabels,
    overlayLabels: sessionOverlayLabels,
    waitingSamples: sessionWaitingSamples,
    clipCount: sessionClipCount,
    lastClipAt,
    recentEvents: sessionDiagnosticEvents,
    ...sessionEngineDiagnostics,
    ...sessionWorkletDiagnostics,
  };
}

function installWebAudioDebugBridge() {
  if (
    typeof globalThis === 'undefined' ||
    typeof window === 'undefined' ||
    typeof __DEV__ === 'undefined' ||
    !__DEV__
  ) {
    return;
  }

  globalThis.__BSC_WEB_AUDIO_DEBUG__ = {
    snapshot: () => getSessionDiagnosticsSnapshot(),
    events: () => [...sessionDiagnosticEvents],
    context: () => getWebAudioContextSnapshot(),
    mark: (details = 'manual mark') =>
      pushSessionDiagnosticEvent('mark', String(details)),
    reset: () => {
      resetSessionDiagnostics();
      clearSessionDiagnosticEvents();
      clearSessionDiagnosticMeta();
    },
  };
}

installWebAudioDebugBridge();

const getLoopChannels = (buffer) => {
  if (!buffer || typeof buffer.getChannelData !== 'function') {
    return [];
  }

  const declaredChannelCount =
    Number.isFinite(buffer.numberOfChannels) && buffer.numberOfChannels > 0
      ? buffer.numberOfChannels
      : 2;
  const channels = [];

  for (
    let channelIndex = 0;
    channelIndex < declaredChannelCount;
    channelIndex += 1
  ) {
    try {
      const channelData = buffer.getChannelData(channelIndex);
      if (!channelData?.length) {
        break;
      }
      channels.push(channelData);
    } catch {
      break;
    }
  }

  return channels;
};

const getLoopIndexScore = (channels, index) => {
  let maxAbs = 0;
  let zeroCrossings = 0;

  channels.forEach((channel) => {
    const sample = channel[index] ?? 0;
    const nextIndex = Math.min(index + 1, channel.length - 1);
    const nextSample = channel[nextIndex] ?? sample;

    maxAbs = Math.max(maxAbs, Math.abs(sample));

    if (sample === 0 || sample * nextSample <= 0) {
      zeroCrossings += 1;
    }
  });

  return { maxAbs, zeroCrossings };
};

const findQuietLoopIndex = (
  channels,
  targetIndex,
  direction,
  maxDistance,
  minIndex,
  maxIndex,
) => {
  let bestIndex = clamp(targetIndex, minIndex, maxIndex);
  let bestScore = Number.POSITIVE_INFINITY;

  for (let distance = 0; distance <= maxDistance; distance += 1) {
    const candidateIndex = targetIndex + direction * distance;
    if (candidateIndex < minIndex || candidateIndex > maxIndex) {
      break;
    }

    const { maxAbs, zeroCrossings } = getLoopIndexScore(
      channels,
      candidateIndex,
    );
    const score =
      maxAbs +
      (zeroCrossings === channels.length ? 0 : LOOP_ZERO_THRESHOLD) +
      distance * 0.000001;

    if (score < bestScore) {
      bestScore = score;
      bestIndex = candidateIndex;
    }

    if (zeroCrossings === channels.length && maxAbs <= LOOP_ZERO_THRESHOLD) {
      return candidateIndex;
    }
  }

  return bestIndex;
};

export function resolveBufferedLoopWindow(
  buffer,
  {
    trimSeconds = 0.02,
    minLoopSpanSeconds = 1,
    searchWindowSeconds = LOOP_SEARCH_WINDOW_SECONDS,
  } = {},
) {
  const duration = buffer?.duration ?? 0;
  if (!(duration > minLoopSpanSeconds)) {
    return null;
  }

  const defaultTrim = Math.min(trimSeconds, duration / 8);
  const defaultLoopStart = defaultTrim;
  const defaultLoopEnd = Math.max(
    duration - defaultTrim,
    defaultLoopStart + defaultTrim,
  );
  const channels = getLoopChannels(buffer);

  if (!channels.length) {
    return {
      loopStart: defaultLoopStart,
      loopEnd: defaultLoopEnd,
    };
  }

  const totalSamples = channels[0]?.length ?? 0;
  const sampleRate = duration > 0 ? totalSamples / duration : 0;
  if (!(sampleRate > 0) || totalSamples < 4) {
    return {
      loopStart: defaultLoopStart,
      loopEnd: defaultLoopEnd,
    };
  }

  const minLoopSamples = Math.max(
    Math.round(minLoopSpanSeconds * sampleRate),
    2,
  );
  if (totalSamples <= minLoopSamples + 2) {
    return {
      loopStart: defaultLoopStart,
      loopEnd: defaultLoopEnd,
    };
  }

  const trimSamples = clamp(
    Math.round(defaultTrim * sampleRate),
    1,
    totalSamples - minLoopSamples - 1,
  );
  const maxSearchSamples = Math.max(
    Math.round(searchWindowSeconds * sampleRate),
    1,
  );
  const targetStartIndex = trimSamples;
  const targetEndIndex = totalSamples - trimSamples;
  const maxStartIndex = Math.max(targetEndIndex - minLoopSamples, 1);
  const startIndex = findQuietLoopIndex(
    channels,
    targetStartIndex,
    1,
    maxSearchSamples,
    0,
    maxStartIndex,
  );
  const endIndex = findQuietLoopIndex(
    channels,
    clamp(targetEndIndex, startIndex + minLoopSamples, totalSamples - 1),
    -1,
    maxSearchSamples,
    startIndex + minLoopSamples,
    totalSamples - 1,
  );
  const safeEndIndex = Math.max(
    endIndex,
    Math.min(totalSamples - 1, startIndex + minLoopSamples),
  );

  return {
    loopStart: startIndex / sampleRate,
    loopEnd: safeEndIndex / sampleRate,
  };
}

export function getWaveform(wf) {
  const waveforms = {
    0: 'sine',
    1: 'triangle',
    2: 'square',
    3: 'sawtooth',
  };
  return waveforms[wf] || 'sine';
}
