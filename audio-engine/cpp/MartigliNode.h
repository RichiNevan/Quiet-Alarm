#pragma once
#include <audioapi/core/AudioNode.h>
#include "dsp/shared/SessionDspEngine.h"

namespace audioapi {
class AudioBus;
class BaseAudioContext;

class MartigliNode : public AudioNode {
private:
  BaseAudioContext* _context;
  
public:
  explicit MartigliNode(BaseAudioContext *context);
  
  // Core parameters
  float mf0 = 250.0f;           // Base frequency
  float ma = 90.0f;             // Modulation amount
  float mp0 = 10.0f;            // Initial period
  float mp1 = 20.0f;            // Final period
  float md = 600.0f;            // Ramp duration
  float inhaleDur = -1.0f;      // Inhale duration (optional)
  float exhaleDur = -1.0f;      // Exhale duration (optional)
  bool martigliComfortGainEnabled = false;
  float martigliComfortLowDb = 0.0f;
  float martigliComfortHighDb = 0.0f;
  int waveformM = 0;            // Waveform type
  float volume = 0.5f;
  
  // Panning parameters
  int panOsc = 0;
  float panOscPeriod = 120.0f;
  float panOscTrans = 20.0f;
  
  // State
  float animationValue = 0.0f;
  bool isPaused = false;
  bool isOn = false;              // Only the active martigli publishes to registry
  bool shouldStart = false;
  bool shouldPause = false;
  bool shouldResume = false;
  bool shouldStop = false;
  bool shouldResetPhase = false;
  
  // Current calculated values (read-only, updated during processing)
  float currentInhaleDur = 0.0f;
  float currentExhaleDur = 0.0f;
  float currentPeriod = 0.0f;
  float cyclePhase01 = 0.0f;
  float direction = 1.0f;
  double audioTime = 0.0;
  float startElapsed = 0.0f;
  
  void start();
  void pause();
  void resume();
  void stop();
  void resetPhase();

private:
  bsc::dsp::VoiceConfig buildSharedConfig() const;
  void loadSharedEngine(float initialElapsed);
  void syncSharedConfig();
  void publishSharedSnapshot(double audioTime);

  bsc::dsp::SessionDspEngine _sharedEngine;
  bool _sharedEngineLoaded = false;

  // Volume smoothing
  float _smoothedVolume = 0.5f;

protected:
  void processNode(const std::shared_ptr<AudioBus> &bus, int framesToProcess) override;
};
} // namespace audioapi
