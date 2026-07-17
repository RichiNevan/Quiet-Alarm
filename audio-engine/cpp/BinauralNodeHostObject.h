#pragma once

#include "BinauralNode.h"
#include <audioapi/HostObjects/AudioNodeHostObject.h>
#include <jsi/jsi.h>
#include <memory>
#include <cstdio>

using namespace facebook;

namespace audioapi {

#define BINAURAL_PROPERTY(type, name) \
  if (propName == #name) { \
    return jsi::Value(static_cast<double>(node_->name)); \
  }

#define BINAURAL_PROPERTY_SETTER(type, name) \
  if (propName == #name) { \
    node_->name = static_cast<type>(value.asNumber()); \
    return; \
  }

#define BINAURAL_PROPERTY_BOOL(name) \
  if (propName == #name) { \
    return jsi::Value(node_->name); \
  }

#define BINAURAL_PROPERTY_SETTER_BOOL(name) \
  if (propName == #name) { \
    printf("BinauralNodeHostObject: Setting " #name " to %s\n", value.asBool() ? "true" : "false"); \
    node_->name = value.asBool(); \
    return; \
  }

class BinauralNodeHostObject : public AudioNodeHostObject {
public:
  explicit BinauralNodeHostObject(std::shared_ptr<BinauralNode> node)
      : AudioNodeHostObject(std::static_pointer_cast<AudioNode>(node)), node_(node) {}

  jsi::Value get(jsi::Runtime &runtime, const jsi::PropNameID &propNameId) override {
    auto propName = propNameId.utf8(runtime);

    BINAURAL_PROPERTY(double, fl)
    BINAURAL_PROPERTY(double, fr)
    BINAURAL_PROPERTY(int, waveformL)
    BINAURAL_PROPERTY(int, waveformR)
    BINAURAL_PROPERTY(double, volume)
    BINAURAL_PROPERTY(int, panOsc)
    BINAURAL_PROPERTY(double, panOscPeriod)
    BINAURAL_PROPERTY(double, panOscTrans)
    BINAURAL_PROPERTY(float, martigliAnimationValue)
    BINAURAL_PROPERTY_BOOL(shouldStart)
    BINAURAL_PROPERTY_BOOL(shouldPause)
    BINAURAL_PROPERTY_BOOL(shouldResume)
    BINAURAL_PROPERTY_BOOL(shouldStop)
    BINAURAL_PROPERTY_BOOL(isPaused)
    BINAURAL_PROPERTY(int, frameCount)

    return AudioNodeHostObject::get(runtime, propNameId);
  }

  void set(jsi::Runtime &runtime, const jsi::PropNameID &propNameId, const jsi::Value &value) override {
    auto propName = propNameId.utf8(runtime);

    BINAURAL_PROPERTY_SETTER(double, fl)
    BINAURAL_PROPERTY_SETTER(double, fr)
    BINAURAL_PROPERTY_SETTER(int, waveformL)
    BINAURAL_PROPERTY_SETTER(int, waveformR)
    BINAURAL_PROPERTY_SETTER(double, volume)
    BINAURAL_PROPERTY_SETTER(int, panOsc)
    BINAURAL_PROPERTY_SETTER(double, panOscPeriod)
    BINAURAL_PROPERTY_SETTER(double, panOscTrans)
    BINAURAL_PROPERTY_SETTER(float, martigliAnimationValue)
    BINAURAL_PROPERTY_SETTER_BOOL(shouldStart)
    BINAURAL_PROPERTY_SETTER_BOOL(shouldPause)
    BINAURAL_PROPERTY_SETTER_BOOL(shouldResume)
    BINAURAL_PROPERTY_SETTER_BOOL(shouldStop)
    BINAURAL_PROPERTY_SETTER_BOOL(isPaused)

    AudioNodeHostObject::set(runtime, propNameId, value);
  }

private:
  std::shared_ptr<BinauralNode> node_;
};

#undef BINAURAL_PROPERTY
#undef BINAURAL_PROPERTY_SETTER
#undef BINAURAL_PROPERTY_BOOL
#undef BINAURAL_PROPERTY_SETTER_BOOL

} // namespace audioapi
