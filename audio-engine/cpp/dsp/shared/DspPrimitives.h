#pragma once

#include "SharedDspTypes.h"

#include <array>
#include <cstdint>

namespace bsc::dsp {

constexpr double kPi = 3.14159265358979323846;
constexpr double kTwoPi = kPi * 2.0;
constexpr double kCenterGain = 0.7071067811865476;
constexpr double kFadeFloorDb = -80.0;
constexpr double kFadeFloorGain = 0.0001;

double clamp(double value, double minValue, double maxValue);
double wrap01(double value);
double waveformSample(double phase01, Waveform waveform);

class GainRamp {
 public:
  void setImmediate(double gain);
  void start(double targetGain, int frames);
  double process();
  double current() const { return currentGain_; }
  double target() const { return targetGain_; }
  bool active() const { return framesLeft_ > 0; }

 private:
  double currentGain_ = 0.0;
  double targetGain_ = 0.0;
  double step_ = 0.0;
  int framesLeft_ = 0;
};

class DecibelGainRamp {
 public:
  void setImmediate(double gain);
  void start(double targetGain, double seconds);
  double process(double sampleRate);
  double current() const { return currentGain_; }
  double target() const { return targetGain_; }
  bool active() const { return active_; }

 private:
  double currentGain_ = 0.0;
  double targetGain_ = 0.0;
  double startDb_ = kFadeFloorDb;
  double targetDb_ = kFadeFloorDb;
  double duration_ = 0.0;
  double elapsed_ = 0.0;
  bool active_ = false;
};

BreathFrame readBreathAt(
    double elapsed,
    double audioTime,
    double mp0,
    double mp1,
    double md,
    double inhaleRatio);

double readHoldCrossfadePanSwap(
    double elapsed,
    double periodSeconds,
    double transitionSeconds);

double readPanSwap(
    PanMode mode,
    double elapsed,
    double periodSeconds,
    double transitionSeconds,
    double syncedBreathValue01);

class NoiseGenerator {
 public:
  explicit NoiseGenerator(std::uint32_t seed = 0x12345678);
  double next(NoiseColor color);

 private:
  double nextWhite();

  std::uint32_t state_;
  double brown_ = 0.0;
  std::array<double, 7> pink_{};
};

}  // namespace bsc::dsp
