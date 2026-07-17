import { web } from './platform';
import { VoiceType } from './voiceTypes';

// ============================================
// AUDIO CONFIGURATION
// ============================================
// Centralized audio settings for the AVS engine
// Mobile: Linear volumes (0-1 scale)
// Web: Decibel volumes (-∞ to 0 dB scale)
// ============================================

/**
 * Convert linear volume (0 to 1) to decibels (-∞ to 0).
 */
export function linearToDb(linear) {
  if (linear <= 0) return -Infinity;
  return 20 * Math.log10(linear);
}

/**
 * Convert decibels to linear volume (0 to 1).
 */
export function dbToLinear(db) {
  if (db <= -100) return 0; // Practical silence
  return Math.pow(10, db / 20);
}

/**
 * Slider dB floor shared by every dB-as-value slider in the UI. Below this
 * the slider is treated as muted for display purposes.
 */
export const VOLUME_SLIDER_MIN_DB = -60;

/**
 * Default breathing cycle period (one full inhale + exhale) in seconds.
 * Used as the fallback when a voice/user has no mp0 set yet.
 */
export const DEFAULT_BREATHING_PERIOD = 8;

/**
 * Default volumes for each voice type (stored as Linear 0-1)
 * These are unified to represent a consistent baseline for both Mobile and Web platforms.
 */
const DEFAULT_VOLUMES = {
  [VoiceType.Martigli]: 0.25, // ≈ -12 dB
  [VoiceType.MartigliBinaural]: 0.25, // ≈ -12 dB
  [VoiceType.Binaural]: 0.18, // ≈ -15 dB
  [VoiceType.Symmetry]: 0.13, // ≈ -18 dB
  [VoiceType.Noise]: 0.1, // ≈ -20 dB
};

/**
 * Master volume default
 * Approximately -10 dB translates to roughly 0.316 linear.
 */
const BASE_MASTER_VOLUME = 0.316;
export const DEFAULT_MASTER_VOLUME = web
  ? linearToDb(BASE_MASTER_VOLUME)
  : BASE_MASTER_VOLUME;

/**
 * Get default volume for a voice type
 * Returns preset iniVolume if specified, otherwise uses default
 */
export function getDefaultVolume(voiceType, iniVolume = null) {
  if (iniVolume !== null && iniVolume !== undefined) {
    // If value > 0 and <= 1, it was saved as linear (mobile)
    // If value <= 0 or > 1, assume it was saved as decibels (web)
    // (Note: 0 linear is complete silence, but 0 dB is max volume.
    // Usually, volume is > 0 on mobile unless muted. We treat 0 as dB here.)
    const isLinear = iniVolume > 0 && iniVolume <= 1;

    if (web) {
      if (isLinear) {
        return linearToDb(iniVolume);
      }
      return iniVolume; // Already dB
    } else {
      // Mobile (linear)
      if (!isLinear) {
        return dbToLinear(Math.max(iniVolume, -100)); // Cap to avoid math errors via -Infinity
      }
      return iniVolume; // Already linear
    }
  }

  const defaultLinear = DEFAULT_VOLUMES[voiceType] ?? 0.25;
  return web ? linearToDb(defaultLinear) : defaultLinear;
}
