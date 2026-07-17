// Public API for @biosyncare/audio-engine.

// --- Native custom-node installation (JSI globals) ---
export {
  ensureCustomNodesInstalled,
  injectCustomProcessorInstaller,
} from './engine/ensureCustomNodesInstalled';
export { default as NativeCustomNodesModule } from './specs/NativeCustomNodesModule';

// --- Integration seams: the host app wires these once at startup ---
// setEngineErrorReporter(crashlytics)
// setEngineControlBuses({ volumeBus, stopSessionBus })  // from the app's eventBuses
// setForegroundServiceController({ acquire, release })  // Android FGS lease
export { setEngineErrorReporter } from './engine/engineLogger';
export {
  setEngineControlBuses,
  volumeBus,
  stopSessionBus,
} from './engine/controlBuses';
export { setForegroundServiceController } from './engine/foregroundService';

// --- Engine (native/mobile) ---
export { SessionManager } from './engine/SessionManager';

// --- Engine (web AudioWorklet) ---
export { AVSWeb } from './engine/webAVS';
export { WebSoundscapePlayer } from './engine/webSoundscape';

// --- Node wrappers + voice types ---
export * from './engine/types';
export { VoiceType, isBreathingVoice } from './engine/voiceTypes';

// --- Integration smoke test (drop-in button; see INTEGRATION.md) ---
export { BinauralSmokeTestButton } from './demo/BinauralSmokeTestButton';
