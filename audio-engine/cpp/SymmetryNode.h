#pragma once

#include <audioapi/core/AudioNode.h>
#include <audioapi/core/BaseAudioContext.h>
#include "dsp/shared/SessionDspEngine.h"

#include <vector>

namespace audioapi {

class SymmetryNode : public AudioNode {
public:
  explicit SymmetryNode(BaseAudioContext *context);
  ~SymmetryNode() override = default;

  void processNode(const std::shared_ptr<AudioBus> &bus, int framesToProcess) override;

  // Core parameters
  float f0 = 220.0f;           // Base frequency (Hz)
  float noctaves = 1.0f;       // Number of octaves to span
  int nnotes = 8;              // Number of notes in the sequence
  float d = 32.0f;             // Loop duration (seconds)
  int waveform = 0;            // 0=sine, 1=triangle, 2=square, 3=sawtooth
  int permfunc = 0;            // 0=shuffle, 1=rotateForward, 2=rotateBack, 3=reverse, 4=none
  float volume = 0.5f;         // Master volume (0.0 to 1.0)

  void setNoteSlots(const std::vector<std::vector<float>> &slots);
  void setPermutationRows(const std::vector<std::vector<int>> &rows);

  // Control flags
  bool shouldStart = false;
  bool shouldStop = false;
  bool shouldPause = false;
  bool shouldResume = false;

  // Debug/monitoring
  int frameCount = 0;

private:
  std::vector<std::vector<float>> _baseNotes;
  std::vector<std::vector<int>> _permutationRows;
  bool _hasExplicitNoteSlots = false;
  bool _isRunning = false;
  bool _sharedEngineLoaded = false;
  
  // Volume smoothing
  float _smoothedVolume = 0.2f;

  bsc::dsp::SessionDspEngine _sharedEngine;

  bsc::dsp::VoiceConfig buildSharedConfig() const;
  std::vector<std::vector<double>> resolveNoteSlots() const;
  void loadSharedEngine();
  void syncSharedConfig();
  void start();
  void pause();
  void resume();
  void stop();
};

} // namespace audioapi
