#include "NoiseNode.h"
#include <audioapi/utils/AudioBus.h>
#include <audioapi/utils/AudioArray.h>
#include <algorithm>

namespace audioapi {

namespace {

bsc::dsp::NoiseColor noiseColorFromInt(int color) {
  switch (color) {
    case 1:
      return bsc::dsp::NoiseColor::Pink;
    case 2:
      return bsc::dsp::NoiseColor::Brown;
    default:
      return bsc::dsp::NoiseColor::White;
  }
}

}  // namespace

NoiseNode::NoiseNode(BaseAudioContext *context)
    : AudioNode(context), _context(context) {
  channelCount_ = 2;
  channelCountMode_ = ChannelCountMode::EXPLICIT;
  channelInterpretation_ = ChannelInterpretation::SPEAKERS;
  isInitialized_ = true;
}

void NoiseNode::start() {
  shouldStart = true;
}

void NoiseNode::stop() {
  shouldStop = true;
}

void NoiseNode::pause() {
  shouldPause = true;
}

void NoiseNode::resume() {
  shouldResume = true;
}

void NoiseNode::setNoiseColor(int newColor) {
  // The desired color is forwarded to the shared engine on the next sync; the
  // engine crossfades from the currently committed color over a fixed window.
  noiseColor = std::max(0, std::min(2, newColor));
}

bsc::dsp::VoiceConfig NoiseNode::buildSharedConfig() const {
  bsc::dsp::VoiceConfig config;
  config.type = bsc::dsp::VoiceType::Noise;
  config.isOn = true;
  config.gain = 1.0;
  config.noiseColor = noiseColorFromInt(noiseColor);
  return config;
}

void NoiseNode::loadSharedEngine() {
  bsc::dsp::SessionConfig config;
  config.voices.push_back(buildSharedConfig());
  _sharedEngine.load(config);
  _sharedEngineLoaded = true;
}

void NoiseNode::syncSharedConfig() {
  if (_sharedEngineLoaded) {
    _sharedEngine.updateVoice(0, buildSharedConfig());
  }
}

void NoiseNode::processNode(
  const std::shared_ptr<AudioBus> &processingBus,
  int framesToProcess
) {
  if (shouldStart) {
    shouldStart = false;
    isRunning_ = true;
    isPaused = false;
    _smoothedVolume = volume;
    loadSharedEngine();
    // Gentle 2 s fade-in, owned by the shared engine's dB-shaped gate ramp.
    _sharedEngine.start(0.0, 2.0);
  }

  if (shouldStop) {
    shouldStop = false;
    if (_sharedEngineLoaded) {
      _sharedEngine.stop(0.3);
    }
  }

  if (shouldPause) {
    shouldPause = false;
    isPaused = true;
    if (_sharedEngineLoaded) {
      _sharedEngine.pause(0.5);
    }
  }

  if (shouldResume) {
    shouldResume = false;
    isPaused = false;
    isRunning_ = true;
    if (_sharedEngineLoaded) {
      _sharedEngine.resume(0.5);
    } else {
      loadSharedEngine();
      _sharedEngine.start(0.0, 0.5);
    }
  }

  if (!isRunning_) {
    processingBus->zero();
    return;
  }

  syncSharedConfig();

  auto *leftChannel = processingBus->getChannel(0)->getData();
  auto *rightChannel = processingBus->getChannel(1)->getData();

  const double sampleRate = _context->getSampleRate();

  for (int i = 0; i < framesToProcess; ++i) {
    float sampleL = 0.0f;
    float sampleR = 0.0f;
    if (_sharedEngineLoaded) {
      _sharedEngine.render(&sampleL, &sampleR, 1, sampleRate);
    }

    // Smooth volume changes (~300 ms) to avoid zipper noise on slider moves.
    _smoothedVolume += (volume - _smoothedVolume) * 0.01f;

    leftChannel[i] = sampleL * _smoothedVolume;
    rightChannel[i] = sampleR * _smoothedVolume;
  }
}

} // namespace audioapi
