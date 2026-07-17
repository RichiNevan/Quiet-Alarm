#include "BinauralNode.h"
#include "AnimationValueRegistry.h"

#include <algorithm>
#include <audioapi/core/BaseAudioContext.h>
#include <audioapi/utils/AudioArray.h>
#include <audioapi/utils/AudioBus.h>

namespace audioapi {

namespace {

bsc::dsp::Waveform waveformFromInt(int waveform) {
  switch (waveform) {
    case 1:
      return bsc::dsp::Waveform::Triangle;
    case 2:
      return bsc::dsp::Waveform::Square;
    case 3:
      return bsc::dsp::Waveform::Saw;
    default:
      return bsc::dsp::Waveform::Sine;
  }
}

bsc::dsp::PanMode panModeFromInt(int panOsc) {
  switch (panOsc) {
    case 1:
      return bsc::dsp::PanMode::HoldCrossfade;
    case 2:
      return bsc::dsp::PanMode::Sine;
    case 3:
      return bsc::dsp::PanMode::BreathSynced;
    default:
      return bsc::dsp::PanMode::None;
  }
}

}  // namespace

BinauralNode::BinauralNode(BaseAudioContext *context)
    : AudioNode(context), _context(context) {
  channelCount_ = 2;
  channelCountMode_ = ChannelCountMode::EXPLICIT;
  channelInterpretation_ = ChannelInterpretation::SPEAKERS;
  isInitialized_ = true;
}

bsc::dsp::VoiceConfig BinauralNode::buildSharedConfig() const {
  bsc::dsp::VoiceConfig config;
  config.type = bsc::dsp::VoiceType::Binaural;
  config.isOn = true;
  config.gain = 1.0;
  config.fl = fl;
  config.fr = fr;
  config.waveformL = waveformFromInt(waveformL);
  config.waveformR = waveformFromInt(waveformR);
  config.panMode = panModeFromInt(panOsc);
  config.panOscPeriod = panOscPeriod;
  config.panOscTrans = panOscTrans;
  return config;
}

void BinauralNode::loadSharedEngine() {
  bsc::dsp::SessionConfig config;
  config.voices.push_back(buildSharedConfig());
  _sharedEngine.load(config);
  _sharedEngineLoaded = true;
}

void BinauralNode::syncSharedConfig() {
  if (_sharedEngineLoaded) {
    _sharedEngine.updateVoice(0, buildSharedConfig());
  }
}

void BinauralNode::start() {
  isRunning_ = true;
  isPaused = false;
  _smoothedVolume = volume;
  loadSharedEngine();
  _sharedEngine.start(0.0, 2.0);
}

void BinauralNode::pause() {
  if (_sharedEngineLoaded) {
    _sharedEngine.pause(0.5);
  }
}

void BinauralNode::resume() {
  isRunning_ = true;
  isPaused = false;
  if (_sharedEngineLoaded) {
    _sharedEngine.resume(0.5);
  } else {
    loadSharedEngine();
    _sharedEngine.start(0.0, 0.5);
  }
}

void BinauralNode::stop() {
  if (_sharedEngineLoaded) {
    _sharedEngine.stop(2.0);
  }
}

void BinauralNode::processNode(
    const std::shared_ptr<AudioBus> &processingBus,
    int framesToProcess) {
  if (shouldStart) {
    start();
    shouldStart = false;
  }
  if (shouldStop) {
    stop();
    shouldStop = false;
  }
  if (shouldPause) {
    pause();
    shouldPause = false;
  }
  if (shouldResume) {
    resume();
    shouldResume = false;
  }

  if (!isRunning_) {
    processingBus->zero();
    return;
  }

  frameCount += 1;
  syncSharedConfig();

  auto *leftChannel = processingBus->getChannel(0)->getData();
  auto *rightChannel = processingBus->getChannel(1)->getData();
  const double sampleRate = _context->getSampleRate();

  for (int i = 0; i < framesToProcess; i += 1) {
    float sampleL = 0.0f;
    float sampleR = 0.0f;
    if (_sharedEngineLoaded) {
      if (panOsc == 3) {
        _sharedEngine.setSyncedBreathValue(
            AnimationValueRegistry::getInstance().getMartigliAnimationValue());
      }
      _sharedEngine.render(&sampleL, &sampleR, 1, sampleRate);
    }

    _smoothedVolume += (volume - _smoothedVolume) * 0.01f;
    leftChannel[i] = sampleL * _smoothedVolume;
    rightChannel[i] = sampleR * _smoothedVolume;
  }

  if (_sharedEngineLoaded && !_sharedEngine.isActive()) {
    isPaused = true;
  }
}

}  // namespace audioapi
