#include "SessionDspEngine.h"

#include <array>
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <limits>

namespace bsc::dsp {

namespace {

constexpr std::size_t kMaxDeterministicShuffleSlots = 64;
constexpr double kNoiseColorCrossfadeSeconds = 0.3;
constexpr double kMartigliComfortGainMinDb = -12.0;
constexpr double kMartigliComfortGainMaxDb = 6.0;

double safeHz(double hz) {
  return clamp(hz, 20.0, 20000.0);
}

double dbToGain(double db) {
  return std::pow(10.0, db / 20.0);
}

std::size_t maxChordSize(const VoiceConfig& config) {
  std::size_t result = 1;
  for (const auto& slot : config.noteSlots) {
    result = std::max(result, slot.size());
  }
  return result;
}

double periodForElapsed(const VoiceConfig& config, double elapsed) {
  if (config.md > 0.0) {
    return config.mp0 + (config.mp1 - config.mp0) * clamp(elapsed / config.md, 0.0, 1.0);
  }
  return config.mp1;
}

double inhaleRatioFor(const VoiceConfig& config) {
  return clamp(config.inhaleRatio, 0.05, 0.95);
}

}  // namespace

void SessionDspEngine::load(const SessionConfig& config) {
  voices_.clear();
  voices_.reserve(config.voices.size());
  elapsed_ = std::max(0.0, config.initialElapsed);
  active_ = false;
  pendingSilence_ = false;

  for (std::size_t index = 0; index < config.voices.size(); index += 1) {
    VoiceState state;
    state.config = config.voices[index];
    state.gain.setImmediate(std::max(0.0, state.config.gain));
    state.gate.setImmediate(0.0);
    resetSymmetryState(state);
    state.noise = NoiseGenerator(static_cast<std::uint32_t>(0x9e3779b9u + index * 101u));
    state.noiseSourceColor = state.config.noiseColor;
    state.noiseTargetColor = state.config.noiseColor;
    state.noiseCrossfadeRemaining = 0.0;
    refreshMartigliComfortGain(state);
    if (
        state.config.type == VoiceType::Martigli ||
        state.config.type == VoiceType::MartigliBinaural) {
      seedMartigliBreath(state, elapsed_);
    }
    voices_.push_back(state);
  }
}

void SessionDspEngine::start(double initialElapsed, double fadeSeconds) {
  elapsed_ = std::max(0.0, initialElapsed);
  active_ = true;
  pendingSilence_ = false;
  for (auto& voice : voices_) {
    voice.gain.setImmediate(std::max(0.0, voice.config.gain));
    voice.gate.setImmediate(0.0);
    voice.gate.start(1.0, fadeSeconds);
    voice.phaseL = 0.0;
    voice.phaseR = 0.0;
    voice.phaseM = 0.0;
    voice.panEnvPhaseTime = 0.0;
    voice.panOscPhase = 0.0;
    if (voice.config.type == VoiceType::Symmetry) {
      resetSymmetryState(voice);
    }
    if (
        voice.config.type == VoiceType::Martigli ||
        voice.config.type == VoiceType::MartigliBinaural) {
      seedMartigliBreath(voice, elapsed_);
    }
  }
}

void SessionDspEngine::pause(double fadeSeconds) {
  pendingSilence_ = true;
  for (auto& voice : voices_) {
    voice.gate.start(0.0, fadeSeconds);
  }
}

void SessionDspEngine::resume(double fadeSeconds) {
  active_ = true;
  pendingSilence_ = false;
  for (auto& voice : voices_) {
    voice.gate.start(1.0, fadeSeconds);
  }
}

void SessionDspEngine::stop(double fadeSeconds) {
  pendingSilence_ = true;
  for (auto& voice : voices_) {
    voice.gate.start(0.0, fadeSeconds);
  }
}

bool SessionDspEngine::setVoiceGain(std::size_t index, double gain, double fadeSeconds) {
  if (index >= voices_.size()) return false;
  voices_[index].config.gain = std::max(0.0, gain);
  voices_[index].gain.start(voices_[index].config.gain, framesFor(fadeSeconds, 48000.0));
  return true;
}

bool SessionDspEngine::updateVoice(std::size_t index, const VoiceConfig& config) {
  if (index >= voices_.size()) return false;
  auto& voice = voices_[index];
  const auto previousType = voice.config.type;
  const NoiseColor previousNoiseColor = voice.config.noiseColor;
  voice.config = config;
  voice.gain.setImmediate(std::max(0.0, config.gain));
  refreshMartigliComfortGain(voice);

  if (config.type == VoiceType::Noise) {
    if (
        previousType == VoiceType::Noise &&
        config.noiseColor != previousNoiseColor &&
        config.noiseColor != voice.noiseTargetColor) {
      // Crossfade from the previously committed color into the new one over a
      // fixed window, matching the mobile NoiseNode and web Worklet behavior.
      voice.noiseSourceColor = previousNoiseColor;
      voice.noiseTargetColor = config.noiseColor;
      voice.noiseCrossfadeRemaining = kNoiseColorCrossfadeSeconds;
    } else if (previousType != VoiceType::Noise) {
      voice.noiseSourceColor = config.noiseColor;
      voice.noiseTargetColor = config.noiseColor;
      voice.noiseCrossfadeRemaining = 0.0;
    }
  }

  if (previousType != config.type) {
    voice.phaseL = 0.0;
    voice.phaseR = 0.0;
    voice.phaseM = 0.0;
    voice.panEnvPhaseTime = 0.0;
    voice.panOscPhase = 0.0;
  }

  if (config.type == VoiceType::Symmetry) {
    // Only reset on an actual type change. renderVoice re-sizes symmetryPhases
    // to the active note's chord at every note boundary, so resetting here when
    // the current note's chord is merely smaller than the line's max chord is
    // both redundant and harmful: a same-type update arriving mid-note (mobile
    // calls updateVoice every audio quantum) would clear symmetryLastCycle /
    // symmetryLastSlotIndex and force a phase reset on the next render, i.e. a
    // ~quantum-rate discontinuity (audible buzz) on any held note whose chord is
    // smaller than maxChord. Web only updates on real parameter changes, so it
    // never hit this.
    if (previousType != VoiceType::Symmetry) {
      resetSymmetryState(voice);
    }
  } else {
    voice.symmetryPhases.clear();
  }

  if (
      previousType != config.type &&
      (config.type == VoiceType::Martigli || config.type == VoiceType::MartigliBinaural)) {
    seedMartigliBreath(voice, elapsed_);
  }
  return true;
}

bool SessionDspEngine::setInhaleRatio(std::size_t index, double ratio) {
  if (index >= voices_.size()) return false;
  const auto type = voices_[index].config.type;
  if (type != VoiceType::Martigli && type != VoiceType::MartigliBinaural) {
    return false;
  }
  voices_[index].config.inhaleRatio = clamp(ratio, 0.05, 0.95);
  return true;
}

void SessionDspEngine::setSyncedBreathValue(double breathValue01) {
  externalSyncedBreathValue01_ = clamp(breathValue01, 0.0, 1.0);
}

bool SessionDspEngine::resetVoicePhase(std::size_t index) {
  if (index >= voices_.size()) return false;
  auto& voice = voices_[index];
  if (voice.config.type != VoiceType::Martigli &&
      voice.config.type != VoiceType::MartigliBinaural) {
    return false;
  }

  const double currentPeriod = voice.periodRamping
      ? periodForElapsed(voice.config, voice.periodRampElapsed)
      : voice.config.mp1;
  voice.lfoPhaseTime = 0.0;
  voice.lastBreathPhase = 0.0;
  setMartigliCycleDurations(voice, currentPeriod);

  auto snapshot = voice.breathSnapshot;
  snapshot.audioTime = elapsed_;
  snapshot.cyclePhase01 = 0.0;
  snapshot.breathValue01 = 0.0;
  snapshot.direction = 1;
  snapshot.inhaleRatio = inhaleRatioFor(voice.config);
  snapshot.actualRatio = snapshot.inhaleRatio;
  snapshot.currentPeriod = currentPeriod;
  snapshot.targetPeriod = voice.config.mp1;
  snapshot.mp0 = voice.config.mp0;
  snapshot.mp1 = voice.config.mp1;
  voice.breathSnapshot = snapshot;
  return true;
}

void SessionDspEngine::render(float* outL, float* outR, int frames, double sampleRate) {
  if (!outL || !outR || frames <= 0 || sampleRate <= 0.0) return;

  for (int frame = 0; frame < frames; frame += 1) {
    double mixedL = 0.0;
    double mixedR = 0.0;
    double syncedBreathValue01 = externalSyncedBreathValue01_;

    for (auto& voice : voices_) {
      if (
          (voice.config.type == VoiceType::Martigli ||
           voice.config.type == VoiceType::MartigliBinaural) &&
          voice.config.isOn) {
        syncedBreathValue01 = voice.breathSnapshot.breathValue01;
        break;
      }
    }

    if (active_) {
      for (auto& voice : voices_) {
        double voiceL = 0.0;
        double voiceR = 0.0;
        renderVoice(voice, sampleRate, elapsed_, syncedBreathValue01, voiceL, voiceR);
        const double gain = voice.gain.process() * voice.gate.process(sampleRate);
        mixedL += voiceL * gain;
        mixedR += voiceR * gain;
      }
      elapsed_ += 1.0 / sampleRate;
      if (pendingSilence_ && allGatesSilent()) {
        active_ = false;
        pendingSilence_ = false;
      }
    }

    outL[frame] = static_cast<float>(clamp(mixedL, -1.0, 1.0));
    outR[frame] = static_cast<float>(clamp(mixedR, -1.0, 1.0));
  }
}

BreathSnapshot SessionDspEngine::getBreathSnapshot(std::size_t index) const {
  if (index >= voices_.size()) return {};
  return voices_[index].breathSnapshot;
}

int SessionDspEngine::framesFor(double seconds, double sampleRate) const {
  return std::max(0, static_cast<int>(std::round(seconds * sampleRate)));
}

bool SessionDspEngine::allGatesSilent() const {
  for (const auto& voice : voices_) {
    if (voice.gate.active() || voice.gate.target() > 0.0 || voice.gate.current() > 0.0) {
      return false;
    }
  }
  return true;
}

void SessionDspEngine::resetSymmetryState(VoiceState& voice) {
  voice.symmetryPhases.assign(maxChordSize(voice.config), 0.0);
  voice.symmetryLastCycle = -1;
  voice.symmetryLastSlotIndex = -1;
}

void SessionDspEngine::refreshMartigliComfortGain(VoiceState& voice) {
  const double lowDb = clamp(
      voice.config.martigliComfortGainLowDb,
      kMartigliComfortGainMinDb,
      kMartigliComfortGainMaxDb);
  const double highDb = clamp(
      voice.config.martigliComfortGainHighDb,
      kMartigliComfortGainMinDb,
      kMartigliComfortGainMaxDb);
  voice.martigliComfortLowGain = dbToGain(lowDb);
  voice.martigliComfortHighGain = dbToGain(highDb);
}

double SessionDspEngine::readMartigliComfortGain(
    const VoiceState& voice,
    const BreathFrame& breath) const {
  if (!voice.config.martigliComfortGainEnabled) {
    return 1.0;
  }
  const double position = clamp(breath.snapshot.breathValue01, 0.0, 1.0);
  return voice.martigliComfortLowGain +
      (voice.martigliComfortHighGain - voice.martigliComfortLowGain) * position;
}

void SessionDspEngine::setMartigliCycleDurations(VoiceState& voice, double period) {
  const double safePeriod = std::max(0.1, period);
  const double ratio = inhaleRatioFor(voice.config);
  voice.currentCycleInhale = safePeriod * ratio;
  voice.currentCycleExhale = safePeriod * (1.0 - ratio);
}

void SessionDspEngine::seedMartigliBreath(VoiceState& voice, double elapsed) {
  const double targetElapsed = std::max(0.0, elapsed);

  voice.lfoPhaseTime = 0.0;
  voice.lastBreathPhase = 0.0;
  voice.periodRampElapsed = 0.0;
  setMartigliCycleDurations(voice, periodForElapsed(voice.config, 0.0));

  auto commitSnapshot = [&]() {
    const double currentPeriod = voice.periodRamping
        ? periodForElapsed(voice.config, voice.periodRampElapsed)
        : voice.config.mp1;
    if (!(voice.currentCycleInhale + voice.currentCycleExhale > 0.0)) {
      setMartigliCycleDurations(voice, currentPeriod);
    }
    const double totalPeriod = voice.currentCycleInhale + voice.currentCycleExhale;
    const double phase = totalPeriod > 0.0 ? std::fmod(voice.lfoPhaseTime, totalPeriod) : 0.0;
    const bool inhaling = totalPeriod <= 0.0 || phase < voice.currentCycleInhale;
    const double signedValue = inhaling
        ? -std::cos(kPi * phase / std::max(voice.currentCycleInhale, 0.0001))
        : std::cos(
              kPi * (phase - voice.currentCycleInhale) /
              std::max(voice.currentCycleExhale, 0.0001));
    const double ratio = inhaleRatioFor(voice.config);

    voice.breathSnapshot.audioTime = targetElapsed;
    voice.breathSnapshot.cyclePhase01 = totalPeriod > 0.0 ? phase / totalPeriod : 0.0;
    voice.breathSnapshot.breathValue01 = (signedValue + 1.0) * 0.5;
    voice.breathSnapshot.direction = inhaling ? 1 : 0;
    voice.breathSnapshot.inhaleRatio = ratio;
    voice.breathSnapshot.actualRatio = ratio;
    voice.breathSnapshot.currentPeriod = currentPeriod;
    voice.breathSnapshot.targetPeriod = voice.config.mp1;
    voice.breathSnapshot.mp0 = voice.config.mp0;
    voice.breathSnapshot.mp1 = voice.config.mp1;
  };

  double remaining = targetElapsed;
  while (remaining > 0.0) {
    const double cycleTotal = voice.currentCycleInhale + voice.currentCycleExhale;
    if (!(cycleTotal > 0.0)) {
      break;
    }

    if (remaining < cycleTotal) {
      voice.lfoPhaseTime = remaining;
      voice.periodRampElapsed = targetElapsed;
      voice.lastBreathPhase = voice.lfoPhaseTime;
      voice.periodRamping = voice.config.md > 0.0 && targetElapsed < voice.config.md;
      commitSnapshot();
      return;
    }

    remaining -= cycleTotal;
    voice.periodRampElapsed = targetElapsed - remaining;
    setMartigliCycleDurations(voice, periodForElapsed(voice.config, voice.periodRampElapsed));
  }

  voice.lfoPhaseTime = 0.0;
  voice.lastBreathPhase = 0.0;
  voice.periodRampElapsed = targetElapsed;
  voice.periodRamping = voice.config.md > 0.0 && targetElapsed < voice.config.md;
  commitSnapshot();
}

BreathFrame SessionDspEngine::readMartigliBreath(
    VoiceState& voice,
    double sampleRate,
    double audioTime) {
  double currentPeriod = voice.periodRamping
      ? periodForElapsed(voice.config, voice.periodRampElapsed)
      : voice.config.mp1;
  if (voice.periodRamping && voice.periodRampElapsed >= voice.config.md) {
    voice.periodRamping = false;
    currentPeriod = voice.config.mp1;
  }

  if (!(voice.currentCycleInhale + voice.currentCycleExhale > 0.0)) {
    setMartigliCycleDurations(voice, currentPeriod);
  }

  double totalPeriod = voice.currentCycleInhale + voice.currentCycleExhale;
  double phase = std::fmod(voice.lfoPhaseTime, totalPeriod);
  if (phase < 0.0) phase += totalPeriod;

  if (phase < voice.lastBreathPhase) {
    voice.lfoPhaseTime = phase;
    setMartigliCycleDurations(voice, currentPeriod);
    totalPeriod = voice.currentCycleInhale + voice.currentCycleExhale;
  }
  voice.lastBreathPhase = phase;

  const bool inhaling = totalPeriod <= 0.0 || phase < voice.currentCycleInhale;
  const double signedValue = inhaling
      ? -std::cos(kPi * phase / std::max(voice.currentCycleInhale, 0.0001))
      : std::cos(
            kPi * (phase - voice.currentCycleInhale) /
            std::max(voice.currentCycleExhale, 0.0001));
  const double ratio = inhaleRatioFor(voice.config);

  BreathFrame frame;
  frame.signedValue = signedValue;
  frame.snapshot.audioTime = audioTime;
  frame.snapshot.cyclePhase01 = totalPeriod > 0.0 ? phase / totalPeriod : 0.0;
  frame.snapshot.breathValue01 = (signedValue + 1.0) * 0.5;
  frame.snapshot.direction = inhaling ? 1 : 0;
  frame.snapshot.inhaleRatio = ratio;
  frame.snapshot.actualRatio = ratio;
  frame.snapshot.currentPeriod = currentPeriod;
  frame.snapshot.targetPeriod = voice.config.mp1;
  frame.snapshot.mp0 = voice.config.mp0;
  frame.snapshot.mp1 = voice.config.mp1;

  voice.breathSnapshot = frame.snapshot;
  voice.lfoPhaseTime += 1.0 / sampleRate;
  if (voice.periodRamping) {
    voice.periodRampElapsed += 1.0 / sampleRate;
  }
  return frame;
}

double SessionDspEngine::readMartigliMonoPan(
    VoiceState& voice,
    const BreathFrame& breath,
    double sampleRate) {
  if (voice.config.panMode == PanMode::HoldCrossfade) {
    const double period = std::max(0.001, voice.config.panOscPeriod);
    const double transition = clamp(voice.config.panOscTrans, 0.0, period);
    const double phase = std::fmod(voice.panEnvPhaseTime, period * 2.0);
    double value = 0.0;
    if (transition <= 0.0) {
      value = phase < period ? 1.0 : 0.0;
    } else if (phase < transition) {
      value = phase / transition;
    } else if (phase < transition + period) {
      value = 1.0;
    } else if (phase < transition * 2.0 + period) {
      value = 1.0 - (phase - transition - period) / transition;
    }
    voice.panEnvPhaseTime += 1.0 / sampleRate;
    return value * 2.0 - 1.0;
  }

  if (voice.config.panMode == PanMode::Sine && voice.config.panOscPeriod > 0.0) {
    const double value = std::sin(voice.panOscPhase);
    voice.panOscPhase += kTwoPi / (sampleRate * voice.config.panOscPeriod);
    if (voice.panOscPhase >= kTwoPi) voice.panOscPhase -= kTwoPi;
    return value;
  }

  if (voice.config.panMode == PanMode::BreathSynced) {
    return breath.signedValue;
  }

  return 0.0;
}

double SessionDspEngine::readStereoPanSwap(
    VoiceState& voice,
    const BreathFrame* breath,
    double sampleRate) {
  if (voice.config.panMode == PanMode::HoldCrossfade) {
    const double swap = readHoldCrossfadePanSwap(
        voice.panEnvPhaseTime,
        voice.config.panOscPeriod,
        voice.config.panOscTrans);
    voice.panEnvPhaseTime += 1.0 / sampleRate;
    return swap;
  }

  if (voice.config.panMode == PanMode::Sine && voice.config.panOscPeriod > 0.0) {
    const double swap = clamp((std::sin(voice.panOscPhase) + 1.0) * 0.5, 0.0, 1.0);
    voice.panOscPhase += kTwoPi / (sampleRate * voice.config.panOscPeriod);
    if (voice.panOscPhase >= kTwoPi) voice.panOscPhase -= kTwoPi;
    return swap;
  }

  if (voice.config.panMode == PanMode::BreathSynced && breath) {
    return clamp(breath->snapshot.breathValue01, 0.0, 1.0);
  }

  return 0.0;
}

SessionDspEngine::SymmetryEnvelope SessionDspEngine::computeSymmetryEnvelope(
    double noteSep) const {
  const double safeNoteSep = std::max(0.02, noteSep);
  constexpr double kBaseAttack = 0.02;
  constexpr double kBaseDecay = 0.1;
  constexpr double kBaseSustain = 0.8;
  constexpr double kBaseRelease = 0.05;
  constexpr double kMinDecay = 0.02;
  constexpr double kMinRelease = 0.02;
  constexpr double kMinRamp = 0.01;

  SymmetryEnvelope envelope;

  if (safeNoteSep > 10.0) {
    const double noteDur = safeNoteSep / 2.0;
    envelope.attack = 2.0;
    envelope.decay = 2.0;
    envelope.sustain = 1.0;
    envelope.release = std::min(1.0, noteDur);
    envelope.soundDur = noteDur + envelope.release;
    return envelope;
  }

  if (safeNoteSep >= 2.0 * (kBaseAttack + kBaseDecay)) {
    const double noteDur = safeNoteSep / 2.0;
    envelope.attack = kBaseAttack;
    envelope.decay = kBaseDecay;
    envelope.sustain = kBaseSustain;
    envelope.release = std::min(kBaseRelease, safeNoteSep - noteDur);
    envelope.soundDur = noteDur + envelope.release;
    return envelope;
  }

  if (safeNoteSep >= kBaseAttack + kBaseDecay + kBaseRelease) {
    envelope.attack = kBaseAttack;
    envelope.decay = kBaseDecay;
    envelope.sustain = kBaseSustain;
    envelope.release = kBaseRelease;
    envelope.soundDur = safeNoteSep;
    return envelope;
  }

  envelope.soundDur = safeNoteSep;
  const double availableDecay = safeNoteSep - kBaseAttack - kBaseRelease;
  if (availableDecay >= kMinDecay) {
    envelope.attack = kBaseAttack;
    envelope.decay = std::min(kBaseDecay, availableDecay);
    envelope.sustain = kBaseSustain;
    envelope.release = kBaseRelease;
    return envelope;
  }

  if (safeNoteSep >= kBaseAttack + kBaseRelease) {
    envelope.attack = kBaseAttack;
    envelope.decay = 0.0;
    envelope.sustain = 1.0;
    envelope.release = kBaseRelease;
    return envelope;
  }

  const double availableRelease = safeNoteSep - kBaseAttack;
  if (availableRelease >= kMinRelease) {
    envelope.attack = kBaseAttack;
    envelope.decay = 0.0;
    envelope.sustain = 1.0;
    envelope.release = availableRelease;
    return envelope;
  }

  const double half = std::max(kMinRamp, safeNoteSep / 2.0);
  envelope.attack = half;
  envelope.decay = 0.0;
  envelope.sustain = 1.0;
  envelope.release = half;
  return envelope;
}

double SessionDspEngine::readSymmetryEnvelope(
    const SymmetryEnvelope& envelope,
    double timeInNote) const {
  if (timeInNote < 0.0 || timeInNote > envelope.soundDur) {
    return 0.0;
  }

  if (envelope.attack > 0.0 && timeInNote < envelope.attack) {
    return clamp(timeInNote / envelope.attack, 0.0, 1.0);
  }

  const double decayEnd = envelope.attack + envelope.decay;
  if (envelope.decay > 0.0 && timeInNote < decayEnd) {
    const double progress = (timeInNote - envelope.attack) / envelope.decay;
    return clamp(1.0 - (1.0 - envelope.sustain) * progress, 0.0, 1.0);
  }

  const double releaseStart = std::max(decayEnd, envelope.soundDur - envelope.release);
  if (timeInNote < releaseStart) {
    return clamp(envelope.sustain, 0.0, 1.0);
  }

  if (envelope.release <= 0.0) {
    return 0.0;
  }

  const double progress = (timeInNote - releaseStart) / envelope.release;
  return clamp(envelope.sustain * (1.0 - progress), 0.0, 1.0);
}

std::size_t SessionDspEngine::readSymmetrySourceIndex(
    const VoiceConfig& config,
    std::size_t slotIndex,
    long long cycle) const {
  const auto slotCount = config.noteSlots.size();
  if (slotCount == 0) return 0;

  if (!config.permutationRows.empty()) {
    const auto& row = config.permutationRows[
        static_cast<std::size_t>(std::max<long long>(0, cycle)) % config.permutationRows.size()];
    if (slotIndex < row.size()) {
      const int sourceIndex = row[slotIndex];
      if (sourceIndex >= 0 && static_cast<std::size_t>(sourceIndex) < slotCount) {
        return static_cast<std::size_t>(sourceIndex);
      }
    }
    return slotIndex;
  }

  if (config.permfunc == 0 && slotCount <= kMaxDeterministicShuffleSlots) {
    std::array<int, kMaxDeterministicShuffleSlots> order{};
    for (std::size_t index = 0; index < slotCount; index += 1) {
      order[index] = static_cast<int>(index);
    }

    std::uint32_t state = static_cast<std::uint32_t>(cycle + 1) * 0x6d2b79f5u;
    for (std::size_t index = slotCount - 1; index > 0; index -= 1) {
      state = (state ^ (state >> 15)) * (state | 1u);
      const auto signedState = static_cast<std::int32_t>(state);
      const std::uint32_t magnitude = signedState == std::numeric_limits<std::int32_t>::min()
          ? 0x80000000u
          : static_cast<std::uint32_t>(std::abs(signedState));
      const std::size_t swapIndex = magnitude % (index + 1);
      std::swap(order[index], order[swapIndex]);
    }
    return static_cast<std::size_t>(order[slotIndex]);
  }

  if (config.permfunc == 1) {
    return (slotIndex + slotCount -
            (static_cast<std::size_t>(cycle + 1) % slotCount)) % slotCount;
  }

  if (config.permfunc == 2) {
    return (slotIndex + static_cast<std::size_t>(cycle + 1)) % slotCount;
  }

  if (config.permfunc == 3 && cycle % 2 == 0) {
    return slotCount - slotIndex - 1;
  }

  return slotIndex;
}

void SessionDspEngine::renderVoice(
    VoiceState& voice,
    double sampleRate,
    double audioTime,
    double syncedBreathValue01,
    double& outL,
    double& outR) {
  if (!voice.config.isOn) return;

  if (voice.config.type == VoiceType::Binaural) {
    const double left = waveformSample(voice.phaseL, voice.config.waveformL);
    const double right = waveformSample(voice.phaseR, voice.config.waveformR);
    voice.phaseL = wrap01(voice.phaseL + safeHz(voice.config.fl) / sampleRate);
    voice.phaseR = wrap01(voice.phaseR + safeHz(voice.config.fr) / sampleRate);
    const double swap = readPanSwap(
        voice.config.panMode,
        elapsed_,
        voice.config.panOscPeriod,
        voice.config.panOscTrans,
        syncedBreathValue01);
    outL = left * (1.0 - swap) + right * swap;
    outR = right * (1.0 - swap) + left * swap;
    return;
  }

  if (voice.config.type == VoiceType::Martigli ||
      voice.config.type == VoiceType::MartigliBinaural) {
    const auto breath = readMartigliBreath(voice, sampleRate, audioTime);

    if (voice.config.type == VoiceType::Martigli) {
      const double hz = safeHz(voice.config.mf0 + voice.config.ma * breath.signedValue);
      const double sample =
          waveformSample(voice.phaseM, voice.config.waveformM) *
          readMartigliComfortGain(voice, breath);
      voice.phaseM = wrap01(voice.phaseM + hz / sampleRate);
      const double panValue = readMartigliMonoPan(voice, breath, sampleRate);
      outL = sample * (1.0 + panValue) * 0.5;
      outR = sample * (1.0 - panValue) * 0.5;
      return;
    }

    const double leftHz = safeHz(voice.config.fl + voice.config.ma * breath.signedValue);
    const double rightHz = safeHz(voice.config.fr + voice.config.ma * breath.signedValue);
    const double comfortGain = readMartigliComfortGain(voice, breath);
    const double left = waveformSample(voice.phaseL, voice.config.waveformL) * comfortGain;
    const double right = waveformSample(voice.phaseR, voice.config.waveformR) * comfortGain;
    voice.phaseL = wrap01(voice.phaseL + leftHz / sampleRate);
    voice.phaseR = wrap01(voice.phaseR + rightHz / sampleRate);
    const double swap = readStereoPanSwap(voice, &breath, sampleRate);
    outL = left * (1.0 - swap) + right * swap;
    outR = right * (1.0 - swap) + left * swap;
    return;
  }

  if (voice.config.type == VoiceType::Noise) {
    double sample;
    if (voice.noiseCrossfadeRemaining > 0.0) {
      const double oldSample = voice.noise.next(voice.noiseSourceColor);
      const double newSample = voice.noise.next(voice.noiseTargetColor);
      const double progress =
          clamp(1.0 - voice.noiseCrossfadeRemaining / kNoiseColorCrossfadeSeconds, 0.0, 1.0);
      sample = oldSample * (1.0 - progress) + newSample * progress;
      voice.noiseCrossfadeRemaining -= 1.0 / sampleRate;
      if (voice.noiseCrossfadeRemaining <= 0.0) {
        voice.noiseSourceColor = voice.noiseTargetColor;
        voice.noiseCrossfadeRemaining = 0.0;
      }
    } else {
      sample = voice.noise.next(voice.config.noiseColor);
    }
    outL = sample * kCenterGain;
    outR = sample * kCenterGain;
    return;
  }

  if (voice.config.type == VoiceType::Symmetry) {
    const auto& slots = voice.config.noteSlots;
    if (slots.empty()) return;
    const double noteSep = std::max(0.02, voice.config.noteSep);
    const double cycleSeconds = std::max(noteSep, voice.config.cycleSeconds);
    const auto cycle = static_cast<long long>(std::floor(audioTime / cycleSeconds));
    const double cyclePhase = audioTime - static_cast<double>(cycle) * cycleSeconds;
    const auto slotIndex = std::min(
        static_cast<std::size_t>(cyclePhase / noteSep),
        slots.size() - 1);
    const std::size_t sourceIndex = readSymmetrySourceIndex(voice.config, slotIndex, cycle);
    const auto& freqs = slots[sourceIndex];
    if (freqs.empty()) return;
    if (
        voice.symmetryLastCycle != cycle ||
        voice.symmetryLastSlotIndex != static_cast<int>(slotIndex) ||
        voice.symmetryPhases.size() != freqs.size()) {
      voice.symmetryPhases.assign(freqs.size(), 0.0);
      voice.symmetryLastCycle = cycle;
      voice.symmetryLastSlotIndex = static_cast<int>(slotIndex);
    }

    const auto envelope = computeSymmetryEnvelope(noteSep);
    const double timeInNote = cyclePhase - static_cast<double>(slotIndex) * noteSep;
    if (timeInNote > envelope.soundDur) {
      return;
    }

    double mono = 0.0;
    const double laneGain = 1.0 / static_cast<double>(freqs.size());
    for (std::size_t i = 0; i < freqs.size(); i += 1) {
      mono += waveformSample(voice.symmetryPhases[i], voice.config.waveform) * laneGain;
      voice.symmetryPhases[i] = wrap01(voice.symmetryPhases[i] + safeHz(freqs[i]) / sampleRate);
    }
    const double env = readSymmetryEnvelope(envelope, timeInNote);
    outL = mono * env * kCenterGain;
    outR = mono * env * kCenterGain;
  }
}

}  // namespace bsc::dsp
