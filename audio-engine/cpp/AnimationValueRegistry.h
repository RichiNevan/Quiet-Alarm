#pragma once
#include <atomic>
#include <functional>
#include <jsi/jsi.h>

namespace audioapi {

// Lightweight singleton for sharing animation values between nodes
// Used to pass Martigli breathing animation to Binaural/Martigli-Binaural panning
// and to expose the breathing snapshot to the Reanimated worklet runtime.
class AnimationValueRegistry {
public:
  static AnimationValueRegistry& getInstance() {
    static AnimationValueRegistry instance;
    return instance;
  }

  // MartigliNode calls this to publish its animation value
  // Only publishes if isActive is true (controlled by session's isOn parameter)
  void setMartigliAnimationValue(float value, bool isActive) {
    if (isActive) {
      martigliValue_.store(value, std::memory_order_relaxed);
    }
  }

  // BinauralNode/Martigli-BinauralNode call this to read the value for panOsc=3
  float getMartigliAnimationValue() const {
    return martigliValue_.load(std::memory_order_relaxed);
  }

  // Called from the audio thread every buffer with the three fields needed by the
  // visual bridge. isActive gates publishing so an inactive voice does not clobber
  // the active one.
  void setBreathingSnapshot(float breathValue01, float cyclePhase01, float direction, bool isActive) {
    if (isActive) {
      breathValue01_.store(breathValue01, std::memory_order_relaxed);
      cyclePhase01_.store(cyclePhase01, std::memory_order_relaxed);
      direction_.store(direction, std::memory_order_relaxed);
    }
  }

  // Called from any thread (including Reanimated UI/worklet thread via JSI global).
  float getBreathValue01() const { return breathValue01_.load(std::memory_order_relaxed); }
  float getCyclePhase01() const  { return cyclePhase01_.load(std::memory_order_relaxed); }
  float getDirection() const     { return direction_.load(std::memory_order_relaxed); }

  // Called once from platform code (iOS ObjC / Android JNI) to supply a
  // callback that returns the Reanimated UI worklet runtime pointer.
  // NativeCustomNodesModule calls getWorkletRuntime() inside
  // injectCustomProcessorInstaller to also install getBreathingAnimationSnapshot
  // on the worklet runtime, cutting JS out of the animation hot path.
  void setWorkletRuntimeProvider(std::function<facebook::jsi::Runtime*()> provider) {
    workletRuntimeProvider_ = std::move(provider);
  }

  // Returns nullptr if not set or if the runtime is not yet available.
  facebook::jsi::Runtime* getWorkletRuntime() const {
    if (workletRuntimeProvider_) {
      return workletRuntimeProvider_();
    }
    return nullptr;
  }

private:
  AnimationValueRegistry() = default;
  std::atomic<float> martigliValue_{0.0f};
  std::atomic<float> breathValue01_{0.0f};
  std::atomic<float> cyclePhase01_{0.0f};
  std::atomic<float> direction_{1.0f};
  std::function<facebook::jsi::Runtime*()> workletRuntimeProvider_;

  // Prevent copying
  AnimationValueRegistry(const AnimationValueRegistry&) = delete;
  AnimationValueRegistry& operator=(const AnimationValueRegistry&) = delete;
};

} // namespace audioapi
