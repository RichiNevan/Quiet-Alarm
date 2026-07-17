#pragma once

#include <cstddef>
#include <vector>

namespace bsc::dsp {

enum class VoiceType {
  Binaural,
  Martigli,
  MartigliBinaural,
  Symmetry,
  Noise,
};

enum class Waveform {
  Sine = 0,
  Triangle = 1,
  Square = 2,
  Saw = 3,
};

enum class PanMode {
  None = 0,
  HoldCrossfade = 1,
  Sine = 2,
  BreathSynced = 3,
};

enum class NoiseColor {
  White = 0,
  Pink = 1,
  Brown = 2,
};

struct BreathSnapshot {
  double audioTime = 0.0;
  double cyclePhase01 = 0.0;
  double breathValue01 = 0.0;
  int direction = 1;
  double inhaleRatio = 0.5;
  double actualRatio = 0.5;
  double currentPeriod = 8.0;
  double targetPeriod = 8.0;
  double mp0 = 8.0;
  double mp1 = 8.0;
};

struct BreathFrame {
  double signedValue = 0.0;
  BreathSnapshot snapshot;
};

struct VoiceConfig {
  VoiceType type = VoiceType::Binaural;
  bool isOn = true;
  double gain = 1.0;

  double fl = 200.0;
  double fr = 210.0;
  double mf0 = 250.0;
  double ma = 90.0;

  double mp0 = 8.0;
  double mp1 = 8.0;
  double md = 0.0;
  double inhaleRatio = 0.5;
  bool martigliComfortGainEnabled = false;
  double martigliComfortGainLowDb = 0.0;
  double martigliComfortGainHighDb = 0.0;

  Waveform waveformL = Waveform::Sine;
  Waveform waveformR = Waveform::Sine;
  Waveform waveformM = Waveform::Sine;
  Waveform waveform = Waveform::Sine;

  PanMode panMode = PanMode::None;
  double panOscPeriod = 120.0;
  double panOscTrans = 20.0;

  NoiseColor noiseColor = NoiseColor::White;

  std::vector<std::vector<double>> noteSlots;
  std::vector<std::vector<int>> permutationRows;
  int permfunc = 4;
  double noteSep = 1.0;
  double cycleSeconds = 1.0;
};

struct SessionConfig {
  std::vector<VoiceConfig> voices;
  double initialElapsed = 0.0;
};

}  // namespace bsc::dsp
