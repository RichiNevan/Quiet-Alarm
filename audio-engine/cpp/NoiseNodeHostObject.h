#pragma once
#include "NoiseNode.h"
#include <audioapi/HostObjects/AudioNodeHostObject.h>
#include <jsi/jsi.h>

using namespace facebook;

namespace audioapi {

class NoiseNodeHostObject : public AudioNodeHostObject {
public:
  explicit NoiseNodeHostObject(const std::shared_ptr<NoiseNode> &node)
      : AudioNodeHostObject(node), node_(node) {}

  jsi::Value get(jsi::Runtime &runtime, const jsi::PropNameID &propNameId) override {
    auto propName = propNameId.utf8(runtime);

    if (propName == "noiseColor") {
      return jsi::Value(static_cast<double>(node_->noiseColor));
    }
    if (propName == "volume") {
      return jsi::Value(static_cast<double>(node_->volume));
    }
    if (propName == "isPaused") {
      return jsi::Value(node_->isPaused);
    }
    if (propName == "start") {
      return jsi::Function::createFromHostFunction(
        runtime,
        jsi::PropNameID::forAscii(runtime, "start"),
        0,
        [this](jsi::Runtime &runtime, const jsi::Value &thisValue, const jsi::Value *arguments, size_t count) -> jsi::Value {
          node_->start();
          return jsi::Value::undefined();
        });
    }
    if (propName == "stop") {
      return jsi::Function::createFromHostFunction(
        runtime,
        jsi::PropNameID::forAscii(runtime, "stop"),
        0,
        [this](jsi::Runtime &runtime, const jsi::Value &thisValue, const jsi::Value *arguments, size_t count) -> jsi::Value {
          node_->stop();
          return jsi::Value::undefined();
        });
    }
    if (propName == "pause") {
      return jsi::Function::createFromHostFunction(
        runtime,
        jsi::PropNameID::forAscii(runtime, "pause"),
        0,
        [this](jsi::Runtime &runtime, const jsi::Value &thisValue, const jsi::Value *arguments, size_t count) -> jsi::Value {
          node_->pause();
          return jsi::Value::undefined();
        });
    }
    if (propName == "resume") {
      return jsi::Function::createFromHostFunction(
        runtime,
        jsi::PropNameID::forAscii(runtime, "resume"),
        0,
        [this](jsi::Runtime &runtime, const jsi::Value &thisValue, const jsi::Value *arguments, size_t count) -> jsi::Value {
          node_->resume();
          return jsi::Value::undefined();
        });
    }
    if (propName == "setNoiseColor") {
      return jsi::Function::createFromHostFunction(
        runtime,
        jsi::PropNameID::forAscii(runtime, "setNoiseColor"),
        1,
        [this](jsi::Runtime &runtime, const jsi::Value &thisValue, const jsi::Value *arguments, size_t count) -> jsi::Value {
          if (count > 0) {
            node_->setNoiseColor(static_cast<int>(arguments[0].asNumber()));
          }
          return jsi::Value::undefined();
        });
    }

    return AudioNodeHostObject::get(runtime, propNameId);
  }

  void set(jsi::Runtime &runtime, const jsi::PropNameID &propNameId, const jsi::Value &value) override {
    auto propName = propNameId.utf8(runtime);

    if (propName == "noiseColor") {
      node_->noiseColor = static_cast<int>(value.asNumber());
      return;
    }
    if (propName == "volume") {
      node_->volume = static_cast<float>(value.asNumber());
      return;
    }

    AudioNodeHostObject::set(runtime, propNameId, value);
  }

private:
  std::shared_ptr<NoiseNode> node_;
};

} // namespace audioapi
