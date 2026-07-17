// ── Voice Type Constants ──
// Shared across mobile, web, and server contexts.
// Keep this file free of native module dependencies (e.g. react-native-audio-api).

export const VoiceType = {
  Binaural: 'Binaural',
  Martigli: 'Martigli',
  MartigliBinaural: 'Martigli-Binaural',
  Symmetry: 'Symmetry',
  Noise: 'Noise',
  Sample: 'Sample',
} as const;

export type VoiceTypeName = (typeof VoiceType)[keyof typeof VoiceType];

/** Returns true for Martigli or Martigli-Binaural (including legacy camelCase variant). */
export function isBreathingVoice(type: string): boolean {
  return (
    type === VoiceType.Martigli ||
    type === VoiceType.MartigliBinaural ||
    type === 'MartigliBinaural'
  );
}
