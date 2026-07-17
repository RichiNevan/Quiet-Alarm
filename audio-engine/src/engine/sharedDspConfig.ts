import {
  deriveBinauralPitchParams,
  deriveMartigliBinauralPitchParams,
  deriveMartigliPitchParams,
  resolveSymmetryCycleSeconds,
  resolveSymmetryNoteSlots,
  resolveSymmetryPulseRateHz,
} from './presetPitchSlots';
import { resolveMartigliComfortGainDb } from './martigliComfortGain';
import { VoiceType, type VoiceTypeName } from './voiceTypes';

type SharedDspVoiceType = Exclude<VoiceTypeName, typeof VoiceType.Sample>;

type SharedDspVoiceConfig = {
  index: number;
  type: SharedDspVoiceType;
  isOn: boolean;
  gain: number;
  fl?: number;
  fr?: number;
  mf0?: number;
  ma?: number;
  mp0?: number;
  mp1?: number;
  md?: number;
  inhaleRatio?: number;
  martigliComfortGainEnabled?: boolean;
  martigliComfortLowDb?: number;
  martigliComfortHighDb?: number;
  waveformL?: number;
  waveformR?: number;
  waveformM?: number;
  waveform?: number;
  panOsc?: number;
  panOscPeriod?: number;
  panOscTrans?: number;
  noiseColor?: number;
  noteSlots?: number[][];
  pulseRateHz?: number;
  noteSep?: number;
  cycleSeconds?: number;
  permutationRows?: number[][] | null;
  permfunc?: number;
};

type PresetVoice = Record<string, any>;

const DEFAULT_LINEAR_GAINS: Record<SharedDspVoiceType, number> = {
  [VoiceType.Binaural]: 0.18,
  [VoiceType.Martigli]: 0.25,
  [VoiceType.MartigliBinaural]: 0.25,
  [VoiceType.Symmetry]: 0.13,
  [VoiceType.Noise]: 0.1,
};

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const dbToSharedLinearGain = (db: number): number =>
  db <= -100 ? 0 : Math.pow(10, db / 20);

const normalizeSharedDspLinearGain = (
  voiceType: SharedDspVoiceType,
  iniVolume: unknown,
): number => {
  if (isFiniteNumber(iniVolume)) {
    if (iniVolume > 0 && iniVolume <= 1) return iniVolume;
    return dbToSharedLinearGain(Math.max(iniVolume, -100));
  }
  return DEFAULT_LINEAR_GAINS[voiceType];
};

export const normalizeSharedDspVoice = (
  voice: PresetVoice,
  index: number,
): SharedDspVoiceConfig | null => {
  const isOn = voice?.isOn !== false;

  if (voice?.type === VoiceType.Binaural) {
    const pitch = deriveBinauralPitchParams(voice);
    return {
      index,
      type: VoiceType.Binaural,
      isOn,
      gain: normalizeSharedDspLinearGain(VoiceType.Binaural, voice.iniVolume),
      fl: pitch.fl,
      fr: pitch.fr,
      waveformL: voice.waveformL ?? 0,
      waveformR: voice.waveformR ?? 0,
      panOsc: voice.panOsc ?? 0,
      panOscPeriod: voice.panOscPeriod ?? 120,
      panOscTrans: voice.panOscTrans ?? 20,
    };
  }

  if (voice?.type === VoiceType.Martigli) {
    const pitch = deriveMartigliPitchParams(voice);
    const comfortGain = resolveMartigliComfortGainDb(
      voice,
      pitch.lowHz,
      pitch.highHz,
    );
    return {
      index,
      type: VoiceType.Martigli,
      isOn,
      gain: normalizeSharedDspLinearGain(VoiceType.Martigli, voice.iniVolume),
      mf0: pitch.mf0,
      ma: pitch.ma,
      mp0: voice.mp0 ?? 8,
      mp1: voice.mp1 ?? 20,
      md: voice.md ?? 600,
      inhaleRatio: voice.inhaleRatio ?? 0.5,
      martigliComfortGainEnabled: comfortGain.enabled,
      martigliComfortLowDb: comfortGain.lowDb,
      martigliComfortHighDb: comfortGain.highDb,
      waveformM: voice.waveformM ?? voice.waveform ?? 0,
      panOsc: voice.panOsc ?? 0,
      panOscPeriod: voice.panOscPeriod ?? 120,
      panOscTrans: voice.panOscTrans ?? 20,
    };
  }

  if (voice?.type === VoiceType.MartigliBinaural) {
    const pitch = deriveMartigliBinauralPitchParams(voice);
    const comfortGain = resolveMartigliComfortGainDb(
      voice,
      pitch.lowHz,
      pitch.highHz,
    );
    return {
      index,
      type: VoiceType.MartigliBinaural,
      isOn,
      gain: normalizeSharedDspLinearGain(
        VoiceType.MartigliBinaural,
        voice.iniVolume,
      ),
      fl: pitch.fl,
      fr: pitch.fr,
      ma: pitch.ma,
      mp0: voice.mp0 ?? 8,
      mp1: voice.mp1 ?? 20,
      md: voice.md ?? 600,
      inhaleRatio: voice.inhaleRatio ?? 0.5,
      martigliComfortGainEnabled: comfortGain.enabled,
      martigliComfortLowDb: comfortGain.lowDb,
      martigliComfortHighDb: comfortGain.highDb,
      waveformL: voice.waveformL ?? 0,
      waveformR: voice.waveformR ?? 0,
      panOsc: voice.panOsc ?? 0,
      panOscPeriod: voice.panOscPeriod ?? 120,
      panOscTrans: voice.panOscTrans ?? 20,
    };
  }

  if (voice?.type === VoiceType.Symmetry) {
    const pulseRateHz = resolveSymmetryPulseRateHz(voice);
    return {
      index,
      type: VoiceType.Symmetry,
      isOn,
      gain: normalizeSharedDspLinearGain(VoiceType.Symmetry, voice.iniVolume),
      noteSlots: resolveSymmetryNoteSlots(voice).map((slot: number[]) =>
        slot.slice(),
      ),
      pulseRateHz,
      noteSep: 1 / pulseRateHz,
      cycleSeconds: resolveSymmetryCycleSeconds(voice),
      permutationRows: null,
      permfunc: voice.permfunc ?? 4,
      waveform: voice.waveform ?? 0,
    };
  }

  if (voice?.type === VoiceType.Noise) {
    return {
      index,
      type: VoiceType.Noise,
      isOn,
      gain: normalizeSharedDspLinearGain(VoiceType.Noise, voice.iniVolume),
      noiseColor: voice.noiseColor ?? 0,
    };
  }

  return null;
};
