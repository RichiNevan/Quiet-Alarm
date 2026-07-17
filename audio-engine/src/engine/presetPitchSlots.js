export const SYMMETRY_NOTE_MIN_HZ = 80;
export const SYMMETRY_NOTE_MAX_HZ = 800;

const isFiniteNumber = (value) =>
  typeof value === 'number' && Number.isFinite(value);

const positiveFiniteNumber = (value) =>
  isFiniteNumber(value) && value > 0;

const toFrequencySlot = (slot) => {
  // Accept the stored shape `{ hz: [...] }` and the engine-expanded shape
  // `[...]` (a raw number array), so the same resolver works on a stored preset
  // voice and on an already-normalized engine voice (e.g. the volume mixer).
  const frequencies = Array.isArray(slot?.hz)
    ? slot.hz.filter(isFiniteNumber)
    : Array.isArray(slot)
      ? slot.filter(isFiniteNumber)
      : [];
  return frequencies.length > 0 ? frequencies : null;
};

export const hasExplicitSymmetryNoteSlots = (voice) =>
  Array.isArray(voice?.noteSlots);

export const resolveSymmetryNoteSlots = (voice) => {
  if (hasExplicitSymmetryNoteSlots(voice)) {
    const slots = voice.noteSlots.map(toFrequencySlot);
    if (slots.length > 0 && slots.every(Boolean)) {
      return slots;
    }
  }

  return [[100]];
};

export const resolveSymmetrySlotCount = (voice) =>
  resolveSymmetryNoteSlots(voice).length;

export const resolveSymmetryPulseRateHz = (voice) =>
  isFiniteNumber(voice?.pulseRateHz) && voice.pulseRateHz > 0
    ? voice.pulseRateHz
    : 1;

export const resolveSymmetryCycleSeconds = (voice) =>
  resolveSymmetrySlotCount(voice) / resolveSymmetryPulseRateHz(voice);

const resolveSweepBounds = (voice, fallbackCenterHz, fallbackAmplitudeHz) => {
  const centerHz = isFiniteNumber(fallbackCenterHz) ? fallbackCenterHz : 250;
  const amplitudeHz = positiveFiniteNumber(fallbackAmplitudeHz)
    ? fallbackAmplitudeHz
    : 90;
  const fallbackLowHz = centerHz - amplitudeHz;
  const fallbackHighHz = centerHz + amplitudeHz;
  const lowHz = isFiniteNumber(voice?.lowHz) ? voice.lowHz : fallbackLowHz;
  const highHz = isFiniteNumber(voice?.highHz) ? voice.highHz : fallbackHighHz;

  if (highHz > lowHz) {
    return { lowHz, highHz };
  }

  return { lowHz: fallbackLowHz, highHz: fallbackHighHz };
};

export const deriveMartigliPitchParams = (voice) => {
  const fallbackMf0 = isFiniteNumber(voice?.mf0) ? voice.mf0 : 250;
  const fallbackMa = positiveFiniteNumber(voice?.ma) ? voice.ma : 90;
  const { lowHz, highHz } = resolveSweepBounds(
    voice,
    fallbackMf0,
    fallbackMa,
  );
  const mf0 = (lowHz + highHz) / 2;
  const ma = (highHz - lowHz) / 2;

  return {
    mf0,
    ma,
    lowHz,
    highHz,
  };
};

const resolveBeatHz = (voice) => {
  if (isFiniteNumber(voice?.beat)) return voice.beat;
  if (isFiniteNumber(voice?.fl) && isFiniteNumber(voice?.fr)) {
    return voice.fr - voice.fl;
  }
  return 10;
};

export const deriveMartigliBinauralPitchParams = (voice) => {
  const beatHz = resolveBeatHz(voice);
  const fallbackCenterHz = isFiniteNumber(voice?.fl) && isFiniteNumber(voice?.fr)
    ? (voice.fl + voice.fr) / 2
    : 255;
  const fallbackMa = positiveFiniteNumber(voice?.ma) ? voice.ma : 90;
  const { lowHz, highHz } = resolveSweepBounds(
    voice,
    fallbackCenterHz,
    fallbackMa,
  );
  const centerHz = (lowHz + highHz) / 2;

  return {
    fl: centerHz - beatHz / 2,
    fr: centerHz + beatHz / 2,
    ma: (highHz - lowHz) / 2,
    lowHz,
    highHz,
    beatHz,
    centerHz,
  };
};

export const deriveBinauralPitchParams = (voice) => {
  const beatHz = resolveBeatHz(voice);
  const fallbackCenterHz = isFiniteNumber(voice?.fl) && isFiniteNumber(voice?.fr)
    ? (voice.fl + voice.fr) / 2
    : 205;
  const centerHz = isFiniteNumber(voice?.centerHz)
    ? voice.centerHz
    : fallbackCenterHz;
  return {
    centerHz,
    beatHz,
    fl: centerHz - beatHz / 2,
    fr: centerHz + beatHz / 2,
  };
};

export const withDerivedMartigliPitchParams = (voice) => {
  if (!voice || voice.type !== 'Martigli') {
    return voice;
  }
  return {
    ...voice,
    ...deriveMartigliPitchParams(voice),
  };
};
