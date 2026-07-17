#include "DspPrimitives.h"
#include "SessionDspEngine.h"

#include <algorithm>
#include <cstdint>
#include <cmath>
#include <vector>

namespace {

constexpr int kQuantumFrames = 128;
constexpr int kMaxSymmetryLanes = 32;
constexpr int kMaxSymmetrySlots = 32;
constexpr int kMaxSymmetrySlotValues = kMaxSymmetrySlots * kMaxSymmetryLanes;
constexpr int kMaxSymmetryRows = 32;
constexpr int kMaxSymmetryRowValues = kMaxSymmetryRows * kMaxSymmetrySlots;

double phaseScratch[kMaxSymmetryLanes] = {};
double outL[kQuantumFrames] = {};
double outR[kQuantumFrames] = {};
double symmetryPhases[kMaxSymmetryLanes] = {};
double symmetryFreqs[kMaxSymmetryLanes] = {};
double symmetrySlotFreqs[kMaxSymmetrySlotValues] = {};
int symmetrySlotSizes[kMaxSymmetrySlots] = {};
int symmetryPermutationRows[kMaxSymmetryRowValues] = {};
float sessionOutL[kQuantumFrames] = {};
float sessionOutR[kQuantumFrames] = {};
double sessionSnapshot[10] = {};
bsc::dsp::SessionDspEngine sessionEngine;
std::vector<bsc::dsp::VoiceConfig> pendingSessionVoices;

bsc::dsp::Waveform waveformFromInt(int waveform) {
  switch (waveform) {
    case 1:
      return bsc::dsp::Waveform::Triangle;
    case 2:
      return bsc::dsp::Waveform::Square;
    case 3:
      return bsc::dsp::Waveform::Saw;
    case 0:
    default:
      return bsc::dsp::Waveform::Sine;
  }
}

double safeSampleRate(double sampleRate) {
  return sampleRate > 0.0 ? sampleRate : 48000.0;
}

double nonNegativeHz(double hz) {
  return std::max(0.0, hz);
}

double generatedVoiceHz(double hz) {
  return std::max(20.0, hz);
}

bsc::dsp::PanMode panModeFromInt(int panMode) {
  switch (panMode) {
    case 1:
      return bsc::dsp::PanMode::HoldCrossfade;
    case 2:
      return bsc::dsp::PanMode::Sine;
    case 3:
      return bsc::dsp::PanMode::BreathSynced;
    case 0:
    default:
      return bsc::dsp::PanMode::None;
  }
}

bsc::dsp::NoiseColor noiseColorFromInt(int color) {
  switch (color) {
    case 1:
      return bsc::dsp::NoiseColor::Pink;
    case 2:
      return bsc::dsp::NoiseColor::Brown;
    case 0:
    default:
      return bsc::dsp::NoiseColor::White;
  }
}

void applyNoiseConfig(
    bsc::dsp::VoiceConfig& config,
    int isOn,
    double gain,
    int noiseColor) {
  config.type = bsc::dsp::VoiceType::Noise;
  config.isOn = isOn != 0;
  config.gain = std::max(0.0, gain);
  config.noiseColor = noiseColorFromInt(noiseColor);
}

bsc::dsp::VoiceConfig baseMartigliConfig(
    int isOn,
    double gain,
    double mp0,
    double mp1,
    double md,
    double inhaleRatio,
    int martigliComfortGainEnabled,
    double martigliComfortLowDb,
    double martigliComfortHighDb,
    int panMode,
    double panOscPeriod,
    double panOscTrans) {
  bsc::dsp::VoiceConfig config;
  config.isOn = isOn != 0;
  config.gain = std::max(0.0, gain);
  config.mp0 = mp0;
  config.mp1 = mp1;
  config.md = md;
  config.inhaleRatio = inhaleRatio;
  config.martigliComfortGainEnabled = martigliComfortGainEnabled != 0;
  config.martigliComfortGainLowDb = martigliComfortLowDb;
  config.martigliComfortGainHighDb = martigliComfortHighDb;
  config.panMode = panModeFromInt(panMode);
  config.panOscPeriod = panOscPeriod;
  config.panOscTrans = panOscTrans;
  return config;
}

void applyBinauralConfig(
    bsc::dsp::VoiceConfig& config,
    int isOn,
    double gain,
    double fl,
    double fr,
    int waveformL,
    int waveformR,
    int panMode,
    double panOscPeriod,
    double panOscTrans) {
  config.type = bsc::dsp::VoiceType::Binaural;
  config.isOn = isOn != 0;
  config.gain = std::max(0.0, gain);
  config.fl = fl;
  config.fr = fr;
  config.waveformL = waveformFromInt(waveformL);
  config.waveformR = waveformFromInt(waveformR);
  config.panMode = panModeFromInt(panMode);
  config.panOscPeriod = panOscPeriod;
  config.panOscTrans = panOscTrans;
}

bool applySymmetryConfig(
    bsc::dsp::VoiceConfig& config,
    int isOn,
    double gain,
    int slotCount,
    int maxChordSize,
    int rowCount,
    int waveform,
    int permfunc,
    double noteSep,
    double cycleSeconds) {
  if (
      slotCount <= 0 ||
      slotCount > kMaxSymmetrySlots ||
      maxChordSize <= 0 ||
      maxChordSize > kMaxSymmetryLanes ||
      rowCount < 0 ||
      rowCount > kMaxSymmetryRows ||
      !std::isfinite(gain) ||
      !std::isfinite(noteSep) ||
      !std::isfinite(cycleSeconds)) {
    return false;
  }

  config.type = bsc::dsp::VoiceType::Symmetry;
  config.isOn = isOn != 0;
  config.gain = std::max(0.0, gain);
  config.waveform = waveformFromInt(waveform);
  config.permfunc = permfunc;
  config.noteSep = std::max(0.02, noteSep);
  config.cycleSeconds = std::max(config.noteSep, cycleSeconds);
  config.noteSlots.clear();
  config.noteSlots.reserve(static_cast<std::size_t>(slotCount));

  for (int slotIndex = 0; slotIndex < slotCount; slotIndex += 1) {
    const int slotSize = symmetrySlotSizes[slotIndex];
    if (slotSize <= 0 || slotSize > maxChordSize) {
      return false;
    }

    std::vector<double> slot;
    slot.reserve(static_cast<std::size_t>(slotSize));
    for (int lane = 0; lane < slotSize; lane += 1) {
      const int flatIndex = slotIndex * kMaxSymmetryLanes + lane;
      const double frequency = symmetrySlotFreqs[flatIndex];
      if (!std::isfinite(frequency) || frequency <= 0.0 || frequency > 20000.0) {
        return false;
      }
      slot.push_back(frequency);
    }
    config.noteSlots.push_back(slot);
  }

  config.permutationRows.clear();
  config.permutationRows.reserve(static_cast<std::size_t>(rowCount));
  for (int rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
    std::vector<int> row;
    row.reserve(static_cast<std::size_t>(slotCount));
    for (int slotIndex = 0; slotIndex < slotCount; slotIndex += 1) {
      const int sourceIndex = symmetryPermutationRows[rowIndex * kMaxSymmetrySlots + slotIndex];
      if (sourceIndex < 0 || sourceIndex >= slotCount) {
        return false;
      }
      row.push_back(sourceIndex);
    }
    config.permutationRows.push_back(row);
  }

  return true;
}

void writeSnapshot(const bsc::dsp::BreathSnapshot& snapshot) {
  sessionSnapshot[0] = snapshot.audioTime;
  sessionSnapshot[1] = snapshot.cyclePhase01;
  sessionSnapshot[2] = snapshot.breathValue01;
  sessionSnapshot[3] = static_cast<double>(snapshot.direction);
  sessionSnapshot[4] = snapshot.inhaleRatio;
  sessionSnapshot[5] = snapshot.actualRatio;
  sessionSnapshot[6] = snapshot.currentPeriod;
  sessionSnapshot[7] = snapshot.targetPeriod;
  sessionSnapshot[8] = snapshot.mp0;
  sessionSnapshot[9] = snapshot.mp1;
}

}  // namespace

extern "C" {

__attribute__((used)) int bsc_quantum_frames() {
  return kQuantumFrames;
}

__attribute__((used)) std::uintptr_t bsc_phase_ptr() {
  return reinterpret_cast<std::uintptr_t>(phaseScratch);
}

__attribute__((used)) std::uintptr_t bsc_out_l_ptr() {
  return reinterpret_cast<std::uintptr_t>(outL);
}

__attribute__((used)) std::uintptr_t bsc_out_r_ptr() {
  return reinterpret_cast<std::uintptr_t>(outR);
}

__attribute__((used)) std::uintptr_t bsc_symmetry_phases_ptr() {
  return reinterpret_cast<std::uintptr_t>(symmetryPhases);
}

__attribute__((used)) std::uintptr_t bsc_symmetry_freqs_ptr() {
  return reinterpret_cast<std::uintptr_t>(symmetryFreqs);
}

__attribute__((used)) std::uintptr_t bsc_symmetry_slot_freqs_ptr() {
  return reinterpret_cast<std::uintptr_t>(symmetrySlotFreqs);
}

__attribute__((used)) std::uintptr_t bsc_symmetry_slot_sizes_ptr() {
  return reinterpret_cast<std::uintptr_t>(symmetrySlotSizes);
}

__attribute__((used)) std::uintptr_t bsc_symmetry_rows_ptr() {
  return reinterpret_cast<std::uintptr_t>(symmetryPermutationRows);
}

__attribute__((used)) std::uintptr_t bsc_session_out_l_ptr() {
  return reinterpret_cast<std::uintptr_t>(sessionOutL);
}

__attribute__((used)) std::uintptr_t bsc_session_out_r_ptr() {
  return reinterpret_cast<std::uintptr_t>(sessionOutR);
}

__attribute__((used)) std::uintptr_t bsc_session_snapshot_ptr() {
  return reinterpret_cast<std::uintptr_t>(sessionSnapshot);
}

__attribute__((used)) void bsc_session_clear() {
  pendingSessionVoices.clear();
  bsc::dsp::SessionConfig config;
  sessionEngine.load(config);
}

__attribute__((used)) int bsc_session_add_binaural(
    int isOn,
    double gain,
    double fl,
    double fr,
    int waveformL,
    int waveformR,
    int panMode,
    double panOscPeriod,
    double panOscTrans) {
  bsc::dsp::VoiceConfig config;
  applyBinauralConfig(
      config,
      isOn,
      gain,
      fl,
      fr,
      waveformL,
      waveformR,
      panMode,
      panOscPeriod,
      panOscTrans);
  pendingSessionVoices.push_back(config);
  return static_cast<int>(pendingSessionVoices.size() - 1);
}

__attribute__((used)) int bsc_session_add_symmetry(
    int isOn,
    double gain,
    int slotCount,
    int maxChordSize,
    int rowCount,
    int waveform,
    int permfunc,
    double noteSep,
    double cycleSeconds) {
  bsc::dsp::VoiceConfig config;
  if (!applySymmetryConfig(
          config,
          isOn,
          gain,
          slotCount,
          maxChordSize,
          rowCount,
          waveform,
          permfunc,
          noteSep,
          cycleSeconds)) {
    return -1;
  }
  pendingSessionVoices.push_back(config);
  return static_cast<int>(pendingSessionVoices.size() - 1);
}

__attribute__((used)) int bsc_session_add_martigli(
    int isOn,
    double gain,
    double mf0,
    double ma,
    double mp0,
    double mp1,
    double md,
    double inhaleRatio,
    int waveformM,
    int martigliComfortGainEnabled,
    double martigliComfortLowDb,
    double martigliComfortHighDb,
    int panMode,
    double panOscPeriod,
    double panOscTrans) {
  auto config = baseMartigliConfig(
      isOn,
      gain,
      mp0,
      mp1,
      md,
      inhaleRatio,
      martigliComfortGainEnabled,
      martigliComfortLowDb,
      martigliComfortHighDb,
      panMode,
      panOscPeriod,
      panOscTrans);
  config.type = bsc::dsp::VoiceType::Martigli;
  config.mf0 = mf0;
  config.ma = ma;
  config.waveformM = waveformFromInt(waveformM);
  pendingSessionVoices.push_back(config);
  return static_cast<int>(pendingSessionVoices.size() - 1);
}

__attribute__((used)) int bsc_session_add_martigli_binaural(
    int isOn,
    double gain,
    double fl,
    double fr,
    double ma,
    double mp0,
    double mp1,
    double md,
    double inhaleRatio,
    int waveformL,
    int waveformR,
    int martigliComfortGainEnabled,
    double martigliComfortLowDb,
    double martigliComfortHighDb,
    int panMode,
    double panOscPeriod,
    double panOscTrans) {
  auto config = baseMartigliConfig(
      isOn,
      gain,
      mp0,
      mp1,
      md,
      inhaleRatio,
      martigliComfortGainEnabled,
      martigliComfortLowDb,
      martigliComfortHighDb,
      panMode,
      panOscPeriod,
      panOscTrans);
  config.type = bsc::dsp::VoiceType::MartigliBinaural;
  config.fl = fl;
  config.fr = fr;
  config.ma = ma;
  config.waveformL = waveformFromInt(waveformL);
  config.waveformR = waveformFromInt(waveformR);
  pendingSessionVoices.push_back(config);
  return static_cast<int>(pendingSessionVoices.size() - 1);
}

__attribute__((used)) int bsc_session_add_noise(
    int isOn,
    double gain,
    int noiseColor) {
  bsc::dsp::VoiceConfig config;
  applyNoiseConfig(config, isOn, gain, noiseColor);
  pendingSessionVoices.push_back(config);
  return static_cast<int>(pendingSessionVoices.size() - 1);
}

__attribute__((used)) void bsc_session_load(double initialElapsed) {
  bsc::dsp::SessionConfig config;
  config.voices = pendingSessionVoices;
  config.initialElapsed = std::max(0.0, initialElapsed);
  sessionEngine.load(config);
}

__attribute__((used)) void bsc_session_start(double initialElapsed, double fadeSeconds) {
  sessionEngine.start(initialElapsed, fadeSeconds);
}

__attribute__((used)) void bsc_session_pause(double fadeSeconds) {
  sessionEngine.pause(fadeSeconds);
}

__attribute__((used)) void bsc_session_resume(double fadeSeconds) {
  sessionEngine.resume(fadeSeconds);
}

__attribute__((used)) int bsc_session_reset_breathing(int index) {
  if (index < 0) return 0;
  return sessionEngine.resetVoicePhase(static_cast<std::size_t>(index)) ? 1 : 0;
}

__attribute__((used)) void bsc_session_stop(double fadeSeconds) {
  sessionEngine.stop(fadeSeconds);
}

__attribute__((used)) int bsc_session_set_voice_gain(
    int index,
    double gain,
    double fadeSeconds) {
  if (index < 0) return 0;
  return sessionEngine.setVoiceGain(
      static_cast<std::size_t>(index),
      std::max(0.0, gain),
      fadeSeconds) ? 1 : 0;
}

__attribute__((used)) int bsc_session_update_binaural(
    int index,
    int isOn,
    double gain,
    double fl,
    double fr,
    int waveformL,
    int waveformR,
    int panMode,
    double panOscPeriod,
    double panOscTrans) {
  if (index < 0) return 0;
  bsc::dsp::VoiceConfig config;
  applyBinauralConfig(
      config,
      isOn,
      gain,
      fl,
      fr,
      waveformL,
      waveformR,
      panMode,
      panOscPeriod,
      panOscTrans);
  return sessionEngine.updateVoice(static_cast<std::size_t>(index), config) ? 1 : 0;
}

__attribute__((used)) int bsc_session_update_symmetry(
    int index,
    int isOn,
    double gain,
    int slotCount,
    int maxChordSize,
    int rowCount,
    int waveform,
    int permfunc,
    double noteSep,
    double cycleSeconds) {
  if (index < 0) return 0;
  bsc::dsp::VoiceConfig config;
  if (!applySymmetryConfig(
          config,
          isOn,
          gain,
          slotCount,
          maxChordSize,
          rowCount,
          waveform,
          permfunc,
          noteSep,
          cycleSeconds)) {
    return 0;
  }
  return sessionEngine.updateVoice(static_cast<std::size_t>(index), config) ? 1 : 0;
}

__attribute__((used)) int bsc_session_update_martigli(
    int index,
    int isOn,
    double gain,
    double mf0,
    double ma,
    double mp0,
    double mp1,
    double md,
    double inhaleRatio,
    int waveformM,
    int martigliComfortGainEnabled,
    double martigliComfortLowDb,
    double martigliComfortHighDb,
    int panMode,
    double panOscPeriod,
    double panOscTrans) {
  if (index < 0) return 0;
  auto config = baseMartigliConfig(
      isOn,
      gain,
      mp0,
      mp1,
      md,
      inhaleRatio,
      martigliComfortGainEnabled,
      martigliComfortLowDb,
      martigliComfortHighDb,
      panMode,
      panOscPeriod,
      panOscTrans);
  config.type = bsc::dsp::VoiceType::Martigli;
  config.mf0 = mf0;
  config.ma = ma;
  config.waveformM = waveformFromInt(waveformM);
  return sessionEngine.updateVoice(static_cast<std::size_t>(index), config) ? 1 : 0;
}

__attribute__((used)) int bsc_session_update_martigli_binaural(
    int index,
    int isOn,
    double gain,
    double fl,
    double fr,
    double ma,
    double mp0,
    double mp1,
    double md,
    double inhaleRatio,
    int waveformL,
    int waveformR,
    int martigliComfortGainEnabled,
    double martigliComfortLowDb,
    double martigliComfortHighDb,
    int panMode,
    double panOscPeriod,
    double panOscTrans) {
  if (index < 0) return 0;
  auto config = baseMartigliConfig(
      isOn,
      gain,
      mp0,
      mp1,
      md,
      inhaleRatio,
      martigliComfortGainEnabled,
      martigliComfortLowDb,
      martigliComfortHighDb,
      panMode,
      panOscPeriod,
      panOscTrans);
  config.type = bsc::dsp::VoiceType::MartigliBinaural;
  config.fl = fl;
  config.fr = fr;
  config.ma = ma;
  config.waveformL = waveformFromInt(waveformL);
  config.waveformR = waveformFromInt(waveformR);
  return sessionEngine.updateVoice(static_cast<std::size_t>(index), config) ? 1 : 0;
}

__attribute__((used)) int bsc_session_update_noise(
    int index,
    int isOn,
    double gain,
    int noiseColor) {
  if (index < 0) return 0;
  bsc::dsp::VoiceConfig config;
  applyNoiseConfig(config, isOn, gain, noiseColor);
  return sessionEngine.updateVoice(static_cast<std::size_t>(index), config) ? 1 : 0;
}

__attribute__((used)) int bsc_session_set_inhale_ratio(int index, double ratio) {
  if (index < 0) return 0;
  return sessionEngine.setInhaleRatio(static_cast<std::size_t>(index), ratio) ? 1 : 0;
}

__attribute__((used)) void bsc_session_render(int frames, double sampleRate) {
  const int frameCount = std::min(std::max(0, frames), kQuantumFrames);
  std::fill(sessionOutL, sessionOutL + kQuantumFrames, 0.0f);
  std::fill(sessionOutR, sessionOutR + kQuantumFrames, 0.0f);
  sessionEngine.render(sessionOutL, sessionOutR, frameCount, safeSampleRate(sampleRate));
}

__attribute__((used)) int bsc_session_get_breath_snapshot(int index) {
  if (index < 0) return 0;
  writeSnapshot(sessionEngine.getBreathSnapshot(static_cast<std::size_t>(index)));
  return 1;
}

__attribute__((used)) double bsc_session_elapsed() {
  return sessionEngine.elapsed();
}

__attribute__((used)) double wave(double phase, int waveform) {
  return bsc::dsp::waveformSample(phase, waveformFromInt(waveform));
}

__attribute__((used)) void renderStereoQuantum(
    double phaseL,
    double phaseR,
    int waveformL,
    int waveformR,
    double fl,
    double fr,
    double sampleRate,
    double panSwap) {
  const double sr = safeSampleRate(sampleRate);
  const auto wfL = waveformFromInt(waveformL);
  const auto wfR = waveformFromInt(waveformR);
  const double swap = bsc::dsp::clamp(panSwap, 0.0, 1.0);
  const double stepL = nonNegativeHz(fl) / sr;
  const double stepR = nonNegativeHz(fr) / sr;

  for (int frame = 0; frame < kQuantumFrames; frame += 1) {
    const double left = bsc::dsp::waveformSample(phaseL, wfL);
    const double right = bsc::dsp::waveformSample(phaseR, wfR);
    outL[frame] = left * (1.0 - swap) + right * swap;
    outR[frame] = right * (1.0 - swap) + left * swap;
    phaseL = bsc::dsp::wrap01(phaseL + stepL);
    phaseR = bsc::dsp::wrap01(phaseR + stepR);
  }

  phaseScratch[0] = phaseL;
  phaseScratch[1] = phaseR;
}

__attribute__((used)) void renderMartigliQuantum(
    double phase,
    int waveform,
    double hz,
    double sampleRate) {
  const double sr = safeSampleRate(sampleRate);
  const auto wf = waveformFromInt(waveform);
  const double step = generatedVoiceHz(hz) / sr;

  for (int frame = 0; frame < kQuantumFrames; frame += 1) {
    const double sample = bsc::dsp::waveformSample(phase, wf) * bsc::dsp::kCenterGain;
    outL[frame] = sample;
    outR[frame] = sample;
    phase = bsc::dsp::wrap01(phase + step);
  }

  phaseScratch[0] = phase;
}

__attribute__((used)) void renderSymmetryQuantum(
    int phaseCount,
    int freqCount,
    double envStart,
    double envStep,
    int waveform,
    double sampleRate) {
  if (
      phaseCount <= 0 || freqCount <= 0 ||
      phaseCount > kMaxSymmetryLanes || freqCount > kMaxSymmetryLanes) {
    return;
  }

  const double sr = safeSampleRate(sampleRate);
  const auto wf = waveformFromInt(waveform);
  const double laneLevel = 1.0 / static_cast<double>(freqCount);

  for (int frame = 0; frame < kQuantumFrames; frame += 1) {
    double mono = 0.0;
    for (int freqIndex = 0; freqIndex < freqCount; freqIndex += 1) {
      const int lane = freqIndex % phaseCount;
      mono += bsc::dsp::waveformSample(symmetryPhases[lane], wf) * laneLevel;
      symmetryPhases[lane] = bsc::dsp::wrap01(
          symmetryPhases[lane] + generatedVoiceHz(symmetryFreqs[freqIndex]) / sr);
    }

    const double env = std::max(0.0, envStart + envStep * static_cast<double>(frame));
    const double sample = mono * env * bsc::dsp::kCenterGain;
    outL[frame] = sample;
    outR[frame] = sample;
  }
}

}  // extern "C"
