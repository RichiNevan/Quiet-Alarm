import NativeCustomNodesModule from '../specs/NativeCustomNodesModule';

function factoriesReady(): boolean {
  const g = global as unknown as Record<string, unknown>;
  return (
    typeof g.createMartigliNode === 'function' &&
    typeof g.createBinauralNode === 'function' &&
    typeof g.createSymmetryNode === 'function' &&
    typeof g.createMartigliBinauralNode === 'function' &&
    typeof g.createNoiseNode === 'function'
  );
}

/**
 * Installs the custom C++ audio node factories onto the JS runtime as JSI
 * globals. Prefer ensureCustomNodesInstalled(), which is idempotent.
 * No-op on web (see NativeCustomNodesModule.web.ts).
 */
export function injectCustomProcessorInstaller(): void {
  NativeCustomNodesModule.injectCustomProcessorInstaller();
}

/**
 * Idempotently installs the custom node factories and returns whether they are
 * present. Safe to call before every session start.
 *
 * Ported from BioSynCare contexts/settings/useSettingsSessionInit.ts
 * (`ensureCustomNodesInstalled`), minus the React hook wrapper.
 */
export function ensureCustomNodesInstalled(): boolean {
  if (factoriesReady()) {
    return true;
  }
  if (!NativeCustomNodesModule) {
    return false;
  }
  try {
    NativeCustomNodesModule.injectCustomProcessorInstaller();
  } catch (error) {
    console.error('Failed to inject custom audio processors', error);
    return false;
  }
  const installed = factoriesReady();
  if (!installed) {
    console.error('Custom audio factories are still missing after injection.');
  }
  return installed;
}
