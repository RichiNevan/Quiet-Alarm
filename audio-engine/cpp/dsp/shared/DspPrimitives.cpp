#include "DspPrimitives.h"

#include <algorithm>
#include <cmath>

namespace bsc::dsp {

double clamp(double value, double minValue, double maxValue) {
  return std::max(minValue, std::min(maxValue, value));
}

double wrap01(double value) {
  return value - std::floor(value);
}

double waveformSample(double phase01, Waveform waveform) {
  const double phase = wrap01(phase01);
  switch (waveform) {
    case Waveform::Triangle:
      return 4.0 * std::abs(wrap01(phase + 0.75) - 0.5) - 1.0;
    case Waveform::Square:
      return phase < 0.5 ? 1.0 : -1.0;
    case Waveform::Saw:
      return 2.0 * phase - 1.0;
    case Waveform::Sine:
    default:
      return std::sin(kTwoPi * phase);
  }
}

void GainRamp::setImmediate(double gain) {
  currentGain_ = gain;
  targetGain_ = gain;
  step_ = 0.0;
  framesLeft_ = 0;
}

void GainRamp::start(double targetGain, int frames) {
  targetGain_ = targetGain;
  framesLeft_ = std::max(0, frames);
  if (framesLeft_ <= 0) {
    currentGain_ = targetGain_;
    step_ = 0.0;
    return;
  }
  step_ = (targetGain_ - currentGain_) / static_cast<double>(framesLeft_);
}

double GainRamp::process() {
  if (framesLeft_ <= 0) {
    return currentGain_;
  }
  currentGain_ += step_;
  framesLeft_ -= 1;
  if (framesLeft_ <= 0) {
    currentGain_ = targetGain_;
    step_ = 0.0;
  }
  return currentGain_;
}

void DecibelGainRamp::setImmediate(double gain) {
  currentGain_ = std::max(0.0, gain);
  targetGain_ = currentGain_;
  startDb_ = currentGain_ <= 0.0
      ? kFadeFloorDb
      : 20.0 * std::log10(std::max(currentGain_, kFadeFloorGain));
  targetDb_ = startDb_;
  duration_ = 0.0;
  elapsed_ = 0.0;
  active_ = false;
}

void DecibelGainRamp::start(double targetGain, double seconds) {
  targetGain_ = std::max(0.0, targetGain);
  duration_ = std::max(0.0, seconds);
  elapsed_ = 0.0;
  startDb_ = currentGain_ <= 0.0
      ? kFadeFloorDb
      : 20.0 * std::log10(std::max(currentGain_, kFadeFloorGain));
  targetDb_ = targetGain_ <= 0.0
      ? kFadeFloorDb
      : 20.0 * std::log10(std::max(targetGain_, kFadeFloorGain));

  if (duration_ <= 0.0) {
    currentGain_ = targetGain_;
    active_ = false;
    return;
  }

  active_ = true;
}

double DecibelGainRamp::process(double sampleRate) {
  if (!active_) {
    return currentGain_;
  }

  elapsed_ += 1.0 / std::max(1.0, sampleRate);
  const double t = duration_ > 0.0 ? elapsed_ / duration_ : 1.0;
  if (t >= 1.0) {
    currentGain_ = targetGain_;
    active_ = false;
    return currentGain_;
  }

  const double currentDb = startDb_ + (targetDb_ - startDb_) * t;
  currentGain_ = std::pow(10.0, currentDb / 20.0);
  return currentGain_;
}

BreathFrame readBreathAt(
    double elapsed,
    double audioTime,
    double mp0,
    double mp1,
    double md,
    double inhaleRatio) {
  const double safeMp0 = std::max(0.1, mp0);
  const double safeMp1 = std::max(0.1, mp1);
  const double rampProgress = md > 0.0 ? clamp(elapsed / md, 0.0, 1.0) : 1.0;
  const double period = std::max(0.1, safeMp0 + (safeMp1 - safeMp0) * rampProgress);
  const double ratio = clamp(inhaleRatio, 0.05, 0.95);
  const double phase = wrap01(elapsed / period);
  const bool inhale = phase < ratio;
  const double segmentPhase = inhale
      ? phase / ratio
      : (phase - ratio) / std::max(1.0 - ratio, 0.0001);
  const double signedValue = inhale
      ? -std::cos(kPi * segmentPhase)
      : std::cos(kPi * segmentPhase);

  BreathFrame frame;
  frame.signedValue = signedValue;
  frame.snapshot.audioTime = audioTime;
  frame.snapshot.cyclePhase01 = phase;
  frame.snapshot.breathValue01 = (signedValue + 1.0) * 0.5;
  frame.snapshot.direction = inhale ? 1 : 0;
  frame.snapshot.inhaleRatio = ratio;
  frame.snapshot.actualRatio = ratio;
  frame.snapshot.currentPeriod = period;
  frame.snapshot.targetPeriod = safeMp1;
  frame.snapshot.mp0 = safeMp0;
  frame.snapshot.mp1 = safeMp1;
  return frame;
}

double readHoldCrossfadePanSwap(
    double elapsed,
    double periodSeconds,
    double transitionSeconds) {
  const double period = std::max(0.001, periodSeconds);
  const double transition = clamp(transitionSeconds, 0.0, period);
  const double cycle = period * 2.0;
  const double phase = std::fmod(std::fmod(elapsed, cycle) + cycle, cycle);

  if (transition <= 0.0) {
    return phase < period ? 0.0 : 1.0;
  }

  const double firstHoldEnd = period - transition;
  if (phase < firstHoldEnd) return 0.0;
  if (phase < period) {
    return clamp((phase - firstHoldEnd) / transition, 0.0, 1.0);
  }

  const double secondHoldEnd = cycle - transition;
  if (phase < secondHoldEnd) return 1.0;
  return clamp(1.0 - (phase - secondHoldEnd) / transition, 0.0, 1.0);
}

double readPanSwap(
    PanMode mode,
    double elapsed,
    double periodSeconds,
    double transitionSeconds,
    double syncedBreathValue01) {
  if (mode == PanMode::HoldCrossfade) {
    return readHoldCrossfadePanSwap(elapsed, periodSeconds, transitionSeconds);
  }
  if (mode == PanMode::Sine && periodSeconds > 0.0) {
    return clamp((std::sin(kTwoPi * elapsed / periodSeconds) + 1.0) * 0.5, 0.0, 1.0);
  }
  if (mode == PanMode::BreathSynced) {
    return clamp(syncedBreathValue01, 0.0, 1.0);
  }
  return 0.0;
}

NoiseGenerator::NoiseGenerator(std::uint32_t seed) : state_(seed ? seed : 1) {}

double NoiseGenerator::nextWhite() {
  state_ = state_ * 1664525u + 1013904223u;
  const double unit = static_cast<double>(state_) / static_cast<double>(0xffffffffu);
  return unit * 2.0 - 1.0;
}

double NoiseGenerator::next(NoiseColor color) {
  const double white = nextWhite();
  if (color == NoiseColor::Pink) {
    pink_[0] = 0.99886 * pink_[0] + white * 0.0555179;
    pink_[1] = 0.99332 * pink_[1] + white * 0.0750759;
    pink_[2] = 0.96900 * pink_[2] + white * 0.1538520;
    pink_[3] = 0.86650 * pink_[3] + white * 0.3104856;
    pink_[4] = 0.55000 * pink_[4] + white * 0.5329522;
    pink_[5] = -0.7616 * pink_[5] - white * 0.0168980;
    const double pink =
        pink_[0] + pink_[1] + pink_[2] + pink_[3] + pink_[4] + pink_[5] +
        pink_[6] + white * 0.5362;
    pink_[6] = white * 0.115926;
    return pink * 0.11;
  }
  if (color == NoiseColor::Brown) {
    brown_ = (brown_ + 0.02 * white) / 1.02;
    return brown_ * 3.5;
  }
  return white * 0.35;
}

}  // namespace bsc::dsp
