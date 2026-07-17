#pragma once

#include "DspPrimitives.h"
#include "SharedDspTypes.h"

#include <cstddef>
#include <vector>

namespace bsc::dsp {

class SessionDspEngine {
 public:
  void load(const SessionConfig& config);
  void start(double initialElapsed = 0.0, double fadeSeconds = 2.0);
  void pause(double fadeSeconds = 0.5);
  void resume(double fadeSeconds = 0.5);
  void stop(double fadeSeconds = 2.0);
  bool setVoiceGain(std::size_t index, double gain, double fadeSeconds = 0.5);
  bool updateVoice(std::size_t index, const VoiceConfig& config);
  bool setInhaleRatio(std::size_t index, double ratio);
  void setSyncedBreathValue(double breathValue01);
  bool resetVoicePhase(std::size_t index);
  void render(float* outL, float* outR, int frames, double sampleRate);
  BreathSnapshot getBreathSnapshot(std::size_t index = 0) const;
  bool isActive() const { return active_; }
  double elapsed() const { return elapsed_; }

 private:
  struct VoiceState {
    VoiceConfig config;
    GainRamp gain;
    DecibelGainRamp gate;
    double phaseL = 0.0;
    double phaseR = 0.0;
    double phaseM = 0.0;
    double lfoPhaseTime = 0.0;
    double periodRampElapsed = 0.0;
    double currentCycleInhale = 0.0;
    double currentCycleExhale = 0.0;
    double lastBreathPhase = 0.0;
    double panEnvPhaseTime = 0.0;
    double panOscPhase = 0.0;
    bool periodRamping = false;
    std::vector<double> symmetryPhases;
    long long symmetryLastCycle = -1;
    int symmetryLastSlotIndex = -1;
    BreathSnapshot breathSnapshot;
    NoiseGenerator noise;
    NoiseColor noiseSourceColor = NoiseColor::White;
    NoiseColor noiseTargetColor = NoiseColor::White;
    double noiseCrossfadeRemaining = 0.0;
    double martigliComfortLowGain = 1.0;
    double martigliComfortHighGain = 1.0;
  };

  struct SymmetryEnvelope {
    double attack = 0.02;
    double decay = 0.1;
    double sustain = 0.8;
    double release = 0.05;
    double soundDur = 0.5;
  };

  int framesFor(double seconds, double sampleRate) const;
  bool allGatesSilent() const;
  void resetSymmetryState(VoiceState& voice);
  void refreshMartigliComfortGain(VoiceState& voice);
  double readMartigliComfortGain(const VoiceState& voice, const BreathFrame& breath) const;
  void setMartigliCycleDurations(VoiceState& voice, double period);
  void seedMartigliBreath(VoiceState& voice, double elapsed);
  BreathFrame readMartigliBreath(VoiceState& voice, double sampleRate, double audioTime);
  double readMartigliMonoPan(VoiceState& voice, const BreathFrame& breath, double sampleRate);
  double readStereoPanSwap(VoiceState& voice, const BreathFrame* breath, double sampleRate);
  SymmetryEnvelope computeSymmetryEnvelope(double noteSep) const;
  double readSymmetryEnvelope(const SymmetryEnvelope& envelope, double timeInNote) const;
  std::size_t readSymmetrySourceIndex(
      const VoiceConfig& config,
      std::size_t slotIndex,
      long long cycle) const;
  void renderVoice(
      VoiceState& voice,
      double sampleRate,
      double audioTime,
      double syncedBreathValue01,
      double& outL,
      double& outR);

  std::vector<VoiceState> voices_;
  double elapsed_ = 0.0;
  double externalSyncedBreathValue01_ = 0.0;
  bool active_ = false;
  bool pendingSilence_ = false;
};

}  // namespace bsc::dsp
