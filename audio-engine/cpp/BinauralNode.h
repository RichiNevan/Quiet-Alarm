#pragma once
#include <audioapi/core/AudioNode.h>
#include "dsp/shared/SessionDspEngine.h"

namespace audioapi {
class AudioBus;
class BaseAudioContext;

class BinauralNode : public AudioNode {
private:
  BaseAudioContext* _context;

  // Audio state
  bool isRunning_ = false;

public:
  explicit BinauralNode(BaseAudioContext *context);

  // Oscillator frequencies
  double fl = 340.0;
  double fr = 160.0;

  // Waveforms (0=sine, 1=triangle, 2=square, 3=sawtooth)
  int waveformL = 0;
  int waveformR = 0;

  // Volume
  double volume = 0.5;

  // Panning oscillator settings
  int panOsc = 0;          // 0=none, 1=envelope, 2=independent sine, 3=synced to martigli
  double panOscPeriod = 120.0;
  double panOscTrans = 20.0;
  float martigliAnimationValue = 0.0f; // For panOsc=3: 0.0 to 1.0 from Martigli voice

  // Control flags
  bool shouldStart = false;
  bool shouldPause = false;
  bool shouldResume = false;
  bool shouldStop = false;
  bool isPaused = false;
  
  // Debug counter
  int frameCount = 0;

private:
  bsc::dsp::VoiceConfig buildSharedConfig() const;
  void loadSharedEngine();
  void syncSharedConfig();
  void start();
  void pause();
  void resume();
  void stop();

  bsc::dsp::SessionDspEngine _sharedEngine;
  bool _sharedEngineLoaded = false;
  
  // Volume smoothing
  float _smoothedVolume = 0.5f;

protected:
  void processNode(const std::shared_ptr<AudioBus> &bus, int framesToProcess) override;
};

} // namespace audioapi
