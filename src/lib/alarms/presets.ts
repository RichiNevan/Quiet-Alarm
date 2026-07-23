import deepSleepCatalog from "../../../audioPresets/deepSleep.json";
import fallAsleepCatalog from "../../../audioPresets/fallAsleep.json";
import lucidDreamingCatalog from "../../../audioPresets/lucidDreaming.json";
import memoryRetentionCatalog from "../../../audioPresets/memoryRetention.json";
import morningActivationCatalog from "../../../audioPresets/morningActivation.json";
import type { BSIconName } from "../../components/bsIcons.generated";
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
  description: string;
  icon: BSIconName;
  data: PresetCatalogEntry;
}

const morningActivationEntry = (morningActivationCatalog as PresetCatalogEntry[])[0];
const lucidDreamingEntry = (lucidDreamingCatalog as PresetCatalogEntry[])[0];
const deepSleepEntry = (deepSleepCatalog as PresetCatalogEntry[])[0];
const memoryRetentionEntry = (memoryRetentionCatalog as PresetCatalogEntry[])[0];
const fallAsleepEntry = (fallAsleepCatalog as PresetCatalogEntry[])[0];

// Shortened by hand for the picker card (2-line clamp) — the full clinical
// copy lives in the preset JSON's header.description and stays untouched.
export const PRESETS: PresetOption[] = [
  {
    id: "morningActivation",
    label: "Morning Activation",
    description: "For mornings, slow starts, and the ramp-up to switch on.",
    icon: "morningActivation",
    data: morningActivationEntry,
  },
  {
    id: "lucidDreaming",
    label: "Lucid Dreaming",
    description: "For dream awareness and wake-back-to-bed practice.",
    icon: "lucidDream",
    data: lucidDreamingEntry,
  },
  {
    id: "deepSleep",
    label: "Deep Sleep",
    description: "Restorative sleep for staying asleep, not falling asleep.",
    icon: "deepSleep",
    data: deepSleepEntry,
  },
  {
    id: "memoryRetention",
    label: "Memory Retention",
    description: "Helps lock in what you studied and may boost dream recall.",
    icon: "memoryRetention",
    data: memoryRetentionEntry,
  },
  {
    id: "fallAsleep",
    label: "Fall Asleep",
    description: "For racing thoughts at bedtime and easing into sleep.",
    icon: "fallAsleep",
    data: fallAsleepEntry,
  },
];

export function getPreset(id: PresetId): PresetOption {
  const found = PRESETS.find((p) => p.id === id);
  if (!found) {
    throw new Error(`Unknown preset id: ${id}`);
  }
  return found;
}
