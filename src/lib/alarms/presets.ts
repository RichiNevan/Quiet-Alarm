import lucidDreamingCatalog from "../../../audioPresets/lucidDreaming.json";
import morningActivationCatalog from "../../../audioPresets/morningActivation.json";
import type { PresetId } from "./types";

// The catalog JSON files are exported by the design tool as an array
// containing a single preset object (`header` + `voices`). See
// audio-engine/src/engine/SessionManager.js `loadPreset()` for the shape
// SessionManager expects — we pass this object straight through.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type PresetCatalogEntry = any;

export interface PresetOption {
  id: PresetId;
  label: string;
  data: PresetCatalogEntry;
}

export const PRESETS: PresetOption[] = [
  {
    id: "morningActivation",
    label: "Morning Activation",
    data: (morningActivationCatalog as PresetCatalogEntry[])[0],
  },
  {
    id: "lucidDreaming",
    label: "Lucid Dreaming",
    data: (lucidDreamingCatalog as PresetCatalogEntry[])[0],
  },
];

export function getPreset(id: PresetId): PresetOption {
  const found = PRESETS.find((p) => p.id === id);
  if (!found) {
    throw new Error(`Unknown preset id: ${id}`);
  }
  return found;
}
