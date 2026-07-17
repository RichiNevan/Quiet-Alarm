#include "SymmetryNode.h"

#include <algorithm>
#include <audioapi/utils/AudioArray.h>
#include <audioapi/utils/AudioBus.h>
#include <cmath>

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

}  // namespace

SymmetryNode::SymmetryNode(BaseAudioContext *context)
    : AudioNode(context) {
  isInitialized_ = true;
  channelCount_ = 2;
  channelCountMode_ = ChannelCountMode::EXPLICIT;
  channelInterpretation_ = ChannelInterpretation::SPEAKERS;
}

std::vector<std::vector<double>> SymmetryNode::resolveNoteSlots() const {
  if (_hasExplicitNoteSlots && !_baseNotes.empty()) {
    std::vector<std::vector<double>> slots;
    slots.reserve(_baseNotes.size());
    for (const auto& slot : _baseNotes) {
      std::vector<double> nextSlot;
      nextSlot.reserve(slot.size());
      for (float frequency : slot) {
        nextSlot.push_back(static_cast<double>(frequency));
      }
      slots.push_back(nextSlot);
    }
    return slots;
  }

  const int count = std::max(1, nnotes);
  const double freqFact = std::pow(2.0, static_cast<double>(noctaves) / count);
  std::vector<std::vector<double>> slots;
  slots.reserve(static_cast<std::size_t>(count));
  for (int index = 0; index < count; index += 1) {
    slots.push_back({static_cast<double>(f0) * std::pow(freqFact, index)});
  }
  return slots;
}

bsc::dsp::VoiceConfig SymmetryNode::buildSharedConfig() const {
  bsc::dsp::VoiceConfig config;
  config.type = bsc::dsp::VoiceType::Symmetry;
  config.isOn = true;
  config.gain = 1.0;
  config.waveform = waveformFromInt(waveform);
  config.permfunc = permfunc;
  config.noteSlots = resolveNoteSlots();
  config.noteSep = config.noteSlots.empty()
      ? 1.0
      : std::max(0.02, static_cast<double>(d) / config.noteSlots.size());
  config.cycleSeconds = std::max(config.noteSep, static_cast<double>(d));
  config.permutationRows = _permutationRows;
  return config;
}

void SymmetryNode::loadSharedEngine() {
  bsc::dsp::SessionConfig config;
  config.voices.push_back(buildSharedConfig());
  _sharedEngine.load(config);
  _sharedEngineLoaded = true;
}

void SymmetryNode::syncSharedConfig() {
  if (_sharedEngineLoaded) {
    _sharedEngine.updateVoice(0, buildSharedConfig());
  }
}

void SymmetryNode::start() {
  _isRunning = true;
  _smoothedVolume = volume;
  loadSharedEngine();
  _sharedEngine.start(0.0, 2.0);
}

void SymmetryNode::pause() {
  if (_sharedEngineLoaded) {
    _sharedEngine.pause(0.5);
  }
}

void SymmetryNode::resume() {
  _isRunning = true;
  if (_sharedEngineLoaded) {
    _sharedEngine.resume(0.5);
  } else {
    loadSharedEngine();
    _sharedEngine.start(0.0, 0.5);
  }
}

void SymmetryNode::stop() {
  if (_sharedEngineLoaded) {
    _sharedEngine.stop(2.0);
  }
}

void SymmetryNode::processNode(const std::shared_ptr<AudioBus> &bus, int framesToProcess) {
  if (framesToProcess == 0 || bus->getNumberOfChannels() < 2) {
    return;
  }

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

  if (!_isRunning) {
    bus->zero();
    return;
  }

  syncSharedConfig();

  auto *leftChannel = bus->getChannel(0)->getData();
  auto *rightChannel = bus->getChannel(1)->getData();
  const double sampleRate = context_->getSampleRate();

  for (int frame = 0; frame < framesToProcess; frame += 1) {
    frameCount += 1;
    float sampleL = 0.0f;
    float sampleR = 0.0f;
    if (_sharedEngineLoaded) {
      _sharedEngine.render(&sampleL, &sampleR, 1, sampleRate);
    }

    _smoothedVolume += (volume - _smoothedVolume) * 0.01f;
    leftChannel[frame] = sampleL * _smoothedVolume;
    rightChannel[frame] = sampleR * _smoothedVolume;
  }
}

void SymmetryNode::setNoteSlots(const std::vector<std::vector<float>> &slots) {
  _baseNotes.clear();
  _hasExplicitNoteSlots = false;

  if (slots.empty()) {
    return;
  }

  for (const auto &slot : slots) {
    if (slot.empty()) {
      _baseNotes.clear();
      return;
    }

    std::vector<float> normalizedSlot;
    normalizedSlot.reserve(slot.size());
    for (float frequency : slot) {
      if (!std::isfinite(frequency) || frequency <= 0.0f || frequency > 20000.0f) {
        _baseNotes.clear();
        return;
      }
      normalizedSlot.push_back(frequency);
    }
    _baseNotes.push_back(normalizedSlot);
  }

  _hasExplicitNoteSlots = true;
  nnotes = static_cast<int>(_baseNotes.size());
}

void SymmetryNode::setPermutationRows(const std::vector<std::vector<int>> &rows) {
  _permutationRows.clear();

  if (rows.empty()) {
    return;
  }

  for (const auto &row : rows) {
    if (row.size() != static_cast<std::size_t>(nnotes)) {
      _permutationRows.clear();
      return;
    }

    std::vector<bool> seen(static_cast<std::size_t>(nnotes), false);
    for (int noteIndex : row) {
      if (noteIndex < 0 || noteIndex >= nnotes || seen[static_cast<std::size_t>(noteIndex)]) {
        _permutationRows.clear();
        return;
      }
      seen[static_cast<std::size_t>(noteIndex)] = true;
    }

    _permutationRows.push_back(row);
  }
}

}  // namespace audioapi
