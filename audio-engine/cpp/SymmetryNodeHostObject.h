#pragma once

#include "SymmetryNode.h"
#include <audioapi/HostObjects/AudioNodeHostObject.h>
#include <jsi/jsi.h>
#include <memory>
#include <cstdio>
#include <vector>

using namespace facebook;

namespace audioapi {

#define SYMMETRY_PROPERTY(type, name) \
  if (propName == #name) { \
    return jsi::Value(static_cast<double>(node_->name)); \
  }

#define SYMMETRY_PROPERTY_SETTER(type, name) \
  if (propName == #name) { \
    node_->name = static_cast<type>(value.asNumber()); \
    return; \
  }

#define SYMMETRY_PROPERTY_BOOL(name) \
  if (propName == #name) { \
    return jsi::Value(node_->name); \
  }

#define SYMMETRY_PROPERTY_SETTER_BOOL(name) \
  if (propName == #name) { \
    node_->name = value.asBool(); \
    return; \
  }

class SymmetryNodeHostObject : public AudioNodeHostObject {
public:
  explicit SymmetryNodeHostObject(std::shared_ptr<SymmetryNode> node)
      : AudioNodeHostObject(std::static_pointer_cast<AudioNode>(node)), node_(node) {}

  jsi::Value get(jsi::Runtime &runtime, const jsi::PropNameID &propNameId) override {
    auto propName = propNameId.utf8(runtime);

    SYMMETRY_PROPERTY(double, f0)
    SYMMETRY_PROPERTY(double, noctaves)
    SYMMETRY_PROPERTY(int, nnotes)
    SYMMETRY_PROPERTY(double, d)
    SYMMETRY_PROPERTY(int, waveform)
    SYMMETRY_PROPERTY(int, permfunc)
    SYMMETRY_PROPERTY(double, volume)
    SYMMETRY_PROPERTY_BOOL(shouldStart)
    SYMMETRY_PROPERTY_BOOL(shouldPause)
    SYMMETRY_PROPERTY_BOOL(shouldResume)
    SYMMETRY_PROPERTY_BOOL(shouldStop)
    SYMMETRY_PROPERTY(int, frameCount)

    return AudioNodeHostObject::get(runtime, propNameId);
  }

  void set(jsi::Runtime &runtime, const jsi::PropNameID &propNameId, const jsi::Value &value) override {
    auto propName = propNameId.utf8(runtime);

    SYMMETRY_PROPERTY_SETTER(double, f0)
    SYMMETRY_PROPERTY_SETTER(double, noctaves)
    SYMMETRY_PROPERTY_SETTER(int, nnotes)
    SYMMETRY_PROPERTY_SETTER(double, d)
    SYMMETRY_PROPERTY_SETTER(int, waveform)
    SYMMETRY_PROPERTY_SETTER(int, permfunc)
    if (propName == "noteSlots") {
      std::vector<std::vector<float>> slots;
      if (!value.isNull() && !value.isUndefined()) {
        auto slotsArray = value.asObject(runtime).asArray(runtime);
        auto slotCount = slotsArray.size(runtime);
        slots.reserve(slotCount);
        for (size_t slotIndex = 0; slotIndex < slotCount; slotIndex++) {
          auto slotArray = slotsArray.getValueAtIndex(runtime, slotIndex)
                              .asObject(runtime)
                              .asArray(runtime);
          auto noteCount = slotArray.size(runtime);
          std::vector<float> slot;
          slot.reserve(noteCount);
          for (size_t noteIndex = 0; noteIndex < noteCount; noteIndex++) {
            slot.push_back(static_cast<float>(
                slotArray.getValueAtIndex(runtime, noteIndex).asNumber()));
          }
          slots.push_back(slot);
        }
      }
      node_->setNoteSlots(slots);
      return;
    }
    if (propName == "permutationRows") {
      std::vector<std::vector<int>> rows;
      if (!value.isNull() && !value.isUndefined()) {
        auto rowsArray = value.asObject(runtime).asArray(runtime);
        auto rowCount = rowsArray.size(runtime);
        rows.reserve(rowCount);
        for (size_t rowIndex = 0; rowIndex < rowCount; rowIndex++) {
          auto rowArray = rowsArray.getValueAtIndex(runtime, rowIndex)
                              .asObject(runtime)
                              .asArray(runtime);
          auto noteCount = rowArray.size(runtime);
          std::vector<int> row;
          row.reserve(noteCount);
          for (size_t noteIndex = 0; noteIndex < noteCount; noteIndex++) {
            row.push_back(static_cast<int>(
                rowArray.getValueAtIndex(runtime, noteIndex).asNumber()));
          }
          rows.push_back(row);
        }
      }
      node_->setPermutationRows(rows);
      return;
    }
    SYMMETRY_PROPERTY_SETTER(double, volume)
    SYMMETRY_PROPERTY_SETTER_BOOL(shouldStart)
    SYMMETRY_PROPERTY_SETTER_BOOL(shouldPause)
    SYMMETRY_PROPERTY_SETTER_BOOL(shouldResume)
    SYMMETRY_PROPERTY_SETTER_BOOL(shouldStop)

    AudioNodeHostObject::set(runtime, propNameId, value);
  }

private:
  std::shared_ptr<SymmetryNode> node_;
};

#undef SYMMETRY_PROPERTY
#undef SYMMETRY_PROPERTY_SETTER
#undef SYMMETRY_PROPERTY_BOOL
#undef SYMMETRY_PROPERTY_SETTER_BOOL

} // namespace audioapi
