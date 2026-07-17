#pragma once
#include <audioapi/core/AudioNode.h>
#include <audioapi/core/BaseAudioContext.h>
#include "dsp/shared/SessionDspEngine.h"
#include <memory>

namespace audioapi {

class NoiseNode : public AudioNode {
public:
  explicit NoiseNode(BaseAudioContext *context);
  ~NoiseNode() override = default;

  void processNode(
    const std::shared_ptr<AudioBus> &processingBus,
    int framesToProcess
  ) override;

  // Control methods
  void start();
  void stop();
  void pause();
  void resume();

  // Noise color setter. The shared DSP engine owns the crossfade between the
  // currently committed color and the requested one.
  void setNoiseColor(int newColor);

  // Properties
  int noiseColor = 0;  // 0=white, 1=pink, 2=brown
  float volume = 0.3;
  bool isPaused = false;

private:
  BaseAudioContext *_context;
  bool isRunning_ = false;

  // Control flags
  bool shouldStart = false;
  bool shouldStop = false;
  bool shouldPause = false;
  bool shouldResume = false;

  // Volume smoothing (matches the other shared-core node adapters).
  float _smoothedVolume = 0.3f;

  bool _sharedEngineLoaded = false;
  bsc::dsp::SessionDspEngine _sharedEngine;

  bsc::dsp::VoiceConfig buildSharedConfig() const;
  void loadSharedEngine();
  void syncSharedConfig();
};

} // namespace audioapi
