export const MARTIGLI_COMFORT_GAIN_MIN_DB = -12;
export const MARTIGLI_COMFORT_GAIN_MAX_DB = 6;

const DEFAULT_HIGH_ATTENUATION_DB_PER_OCTAVE = 3;
const DEFAULT_HIGH_ATTENUATION_MAX_DB = 6;

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

const clampComfortDb = (value: number) =>
  clamp(
    value,
    MARTIGLI_COMFORT_GAIN_MIN_DB,
    MARTIGLI_COMFORT_GAIN_MAX_DB,
  );

export const getDefaultMartigliComfortGainDb = (
  lowHz: unknown,
  highHz: unknown,
) => {
  if (
    !isFiniteNumber(lowHz) ||
    !isFiniteNumber(highHz) ||
    lowHz <= 0 ||
    highHz <= lowHz
  ) {
    return { lowDb: 0, highDb: 0 };
  }

  const octaves = Math.log2(highHz / lowHz);
  return {
    lowDb: 0,
    highDb: -Math.min(
      DEFAULT_HIGH_ATTENUATION_MAX_DB,
      octaves * DEFAULT_HIGH_ATTENUATION_DB_PER_OCTAVE,
    ),
  };
};

export const resolveMartigliComfortGainDb = (
  voice: Record<string, unknown>,
  lowHz: number,
  highHz: number,
) => {
  const defaults = getDefaultMartigliComfortGainDb(lowHz, highHz);
  return {
    enabled: voice?.martigliComfortGainEnabled === true,
    lowDb: isFiniteNumber(voice?.martigliComfortLowDb)
      ? clampComfortDb(voice.martigliComfortLowDb)
      : defaults.lowDb,
    highDb: isFiniteNumber(voice?.martigliComfortHighDb)
      ? clampComfortDb(voice.martigliComfortHighDb)
      : defaults.highDb,
  };
};
