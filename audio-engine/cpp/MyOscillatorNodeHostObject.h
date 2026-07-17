#pragma once

#include "MyOscillatorNode.h"
#include <audioapi/HostObjects/AudioNodeHostObject.h>

#include <memory>
#include <vector>
#include <cstdio> // For printf debugging

namespace audioapi {
using namespace facebook;

class MyOscillatorNodeHostObject : public AudioNodeHostObject {
public:
  explicit MyOscillatorNodeHostObject(
      const std::shared_ptr<MyOscillatorNode> &node)
      : AudioNodeHostObject(node) {
    printf("MyOscillatorNodeHostObject: Creating MyOscillatorNodeHostObject\n");
    addGetters(JSI_EXPORT_PROPERTY_GETTER(MyOscillatorNodeHostObject, frequency));
    addSetters(JSI_EXPORT_PROPERTY_SETTER(MyOscillatorNodeHostObject, frequency));
    addGetters(JSI_EXPORT_PROPERTY_GETTER(MyOscillatorNodeHostObject, volume));
    addSetters(JSI_EXPORT_PROPERTY_SETTER(MyOscillatorNodeHostObject, volume));
  }

  ~MyOscillatorNodeHostObject() override {
      printf("MyOscillatorNodeHostObject: Destroying MyOscillatorNodeHostObject\n");
  }

  JSI_PROPERTY_GETTER(frequency) {
    auto oscillatorNode = std::static_pointer_cast<MyOscillatorNode>(node_);
    return {oscillatorNode->frequency};
  }

  JSI_PROPERTY_SETTER(frequency) {
    printf("MyOscillatorNodeHostObject: Setting frequency to %f\n", value.getNumber());
    auto oscillatorNode = std::static_pointer_cast<MyOscillatorNode>(node_);
    oscillatorNode->frequency = value.getNumber();
  }

  JSI_PROPERTY_GETTER(volume) {
    auto oscillatorNode = std::static_pointer_cast<MyOscillatorNode>(node_);
    return {oscillatorNode->volume};
  }

  JSI_PROPERTY_SETTER(volume) {
    printf("MyOscillatorNodeHostObject: Setting volume to %f\n", value.getNumber());
    auto oscillatorNode = std::static_pointer_cast<MyOscillatorNode>(node_);
    oscillatorNode->volume = value.getNumber();
  }
};
} // namespace audioapi
