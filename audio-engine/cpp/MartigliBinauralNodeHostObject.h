#pragma once

#include <audioapi/HostObjects/AudioNodeHostObject.h>
#include "MartigliBinauralNode.h"

namespace audioapi {

// Macro to reduce boilerplate for property getters/setters
#define MARTIGLI_BINAURAL_PROPERTY(type, name) \
  JSI_PROPERTY_GETTER(name) { \
    return {std::static_pointer_cast<MartigliBinauralNode>(node_)->name}; \
  } \
  JSI_PROPERTY_SETTER(name) { \
    std::static_pointer_cast<MartigliBinauralNode>(node_)->name = value.get##type(); \
  }

class MartigliBinauralNodeHostObject : public AudioNodeHostObject {
public:
    explicit MartigliBinauralNodeHostObject(std::shared_ptr<MartigliBinauralNode> node)
        : AudioNodeHostObject(node) {
        // Add getters
        addGetters(JSI_EXPORT_PROPERTY_GETTER(MartigliBinauralNodeHostObject, fl));
        addGetters(JSI_EXPORT_PROPERTY_GETTER(MartigliBinauralNodeHostObject, fr));
        addGetters(JSI_EXPORT_PROPERTY_GETTER(MartigliBinauralNodeHostObject, waveformL));
        addGetters(JSI_EXPORT_PROPERTY_GETTER(MartigliBinauralNodeHostObject, waveformR));
        addGetters(JSI_EXPORT_PROPERTY_GETTER(MartigliBinauralNodeHostObject, ma));
        addGetters(JSI_EXPORT_PROPERTY_GETTER(MartigliBinauralNodeHostObject, mp0));
        addGetters(JSI_EXPORT_PROPERTY_GETTER(MartigliBinauralNodeHostObject, mp1));
        addGetters(JSI_EXPORT_PROPERTY_GETTER(MartigliBinauralNodeHostObject, md));
        addGetters(JSI_EXPORT_PROPERTY_GETTER(MartigliBinauralNodeHostObject, inhaleDur));
        addGetters(JSI_EXPORT_PROPERTY_GETTER(MartigliBinauralNodeHostObject, exhaleDur));
        addGetters(JSI_EXPORT_PROPERTY_GETTER(MartigliBinauralNodeHostObject, martigliComfortGainEnabled));
        addGetters(JSI_EXPORT_PROPERTY_GETTER(MartigliBinauralNodeHostObject, martigliComfortLowDb));
        addGetters(JSI_EXPORT_PROPERTY_GETTER(MartigliBinauralNodeHostObject, martigliComfortHighDb));
        addGetters(JSI_EXPORT_PROPERTY_GETTER(MartigliBinauralNodeHostObject, volume));
        addGetters(JSI_EXPORT_PROPERTY_GETTER(MartigliBinauralNodeHostObject, panOsc));
        addGetters(JSI_EXPORT_PROPERTY_GETTER(MartigliBinauralNodeHostObject, panOscPeriod));
        addGetters(JSI_EXPORT_PROPERTY_GETTER(MartigliBinauralNodeHostObject, panOscTrans));
        addGetters(JSI_EXPORT_PROPERTY_GETTER(MartigliBinauralNodeHostObject, isOn));
        addGetters(JSI_EXPORT_PROPERTY_GETTER(MartigliBinauralNodeHostObject, isPaused));
        addGetters(JSI_EXPORT_PROPERTY_GETTER(MartigliBinauralNodeHostObject, animationValue));
        addGetters(JSI_EXPORT_PROPERTY_GETTER(MartigliBinauralNodeHostObject, currentInhaleDur));
        addGetters(JSI_EXPORT_PROPERTY_GETTER(MartigliBinauralNodeHostObject, currentExhaleDur));
        addGetters(JSI_EXPORT_PROPERTY_GETTER(MartigliBinauralNodeHostObject, currentPeriod));
        addGetters(JSI_EXPORT_PROPERTY_GETTER(MartigliBinauralNodeHostObject, cyclePhase01));
        addGetters(JSI_EXPORT_PROPERTY_GETTER(MartigliBinauralNodeHostObject, direction));
        addGetters(JSI_EXPORT_PROPERTY_GETTER(MartigliBinauralNodeHostObject, audioTime));
        addGetters(JSI_EXPORT_PROPERTY_GETTER(MartigliBinauralNodeHostObject, startElapsed));
        addGetters(JSI_EXPORT_PROPERTY_GETTER(MartigliBinauralNodeHostObject, shouldStart));
        addGetters(JSI_EXPORT_PROPERTY_GETTER(MartigliBinauralNodeHostObject, shouldPause));
        addGetters(JSI_EXPORT_PROPERTY_GETTER(MartigliBinauralNodeHostObject, shouldResume));
        addGetters(JSI_EXPORT_PROPERTY_GETTER(MartigliBinauralNodeHostObject, shouldStop));
        addGetters(JSI_EXPORT_PROPERTY_GETTER(MartigliBinauralNodeHostObject, shouldResetPhase));

        // Add setters
        addSetters(JSI_EXPORT_PROPERTY_SETTER(MartigliBinauralNodeHostObject, fl));
        addSetters(JSI_EXPORT_PROPERTY_SETTER(MartigliBinauralNodeHostObject, fr));
        addSetters(JSI_EXPORT_PROPERTY_SETTER(MartigliBinauralNodeHostObject, waveformL));
        addSetters(JSI_EXPORT_PROPERTY_SETTER(MartigliBinauralNodeHostObject, waveformR));
        addSetters(JSI_EXPORT_PROPERTY_SETTER(MartigliBinauralNodeHostObject, ma));
        addSetters(JSI_EXPORT_PROPERTY_SETTER(MartigliBinauralNodeHostObject, mp0));
        addSetters(JSI_EXPORT_PROPERTY_SETTER(MartigliBinauralNodeHostObject, mp1));
        addSetters(JSI_EXPORT_PROPERTY_SETTER(MartigliBinauralNodeHostObject, md));
        addSetters(JSI_EXPORT_PROPERTY_SETTER(MartigliBinauralNodeHostObject, inhaleDur));
        addSetters(JSI_EXPORT_PROPERTY_SETTER(MartigliBinauralNodeHostObject, exhaleDur));
        addSetters(JSI_EXPORT_PROPERTY_SETTER(MartigliBinauralNodeHostObject, martigliComfortGainEnabled));
        addSetters(JSI_EXPORT_PROPERTY_SETTER(MartigliBinauralNodeHostObject, martigliComfortLowDb));
        addSetters(JSI_EXPORT_PROPERTY_SETTER(MartigliBinauralNodeHostObject, martigliComfortHighDb));
        addSetters(JSI_EXPORT_PROPERTY_SETTER(MartigliBinauralNodeHostObject, volume));
        addSetters(JSI_EXPORT_PROPERTY_SETTER(MartigliBinauralNodeHostObject, panOsc));
        addSetters(JSI_EXPORT_PROPERTY_SETTER(MartigliBinauralNodeHostObject, panOscPeriod));
        addSetters(JSI_EXPORT_PROPERTY_SETTER(MartigliBinauralNodeHostObject, panOscTrans));
        addSetters(JSI_EXPORT_PROPERTY_SETTER(MartigliBinauralNodeHostObject, isOn));
        addSetters(JSI_EXPORT_PROPERTY_SETTER(MartigliBinauralNodeHostObject, startElapsed));
        addSetters(JSI_EXPORT_PROPERTY_SETTER(MartigliBinauralNodeHostObject, shouldStart));
        addSetters(JSI_EXPORT_PROPERTY_SETTER(MartigliBinauralNodeHostObject, shouldPause));
        addSetters(JSI_EXPORT_PROPERTY_SETTER(MartigliBinauralNodeHostObject, shouldResume));
        addSetters(JSI_EXPORT_PROPERTY_SETTER(MartigliBinauralNodeHostObject, shouldStop));
        addSetters(JSI_EXPORT_PROPERTY_SETTER(MartigliBinauralNodeHostObject, shouldResetPhase));
    }

    MARTIGLI_BINAURAL_PROPERTY(Number, fl)
    MARTIGLI_BINAURAL_PROPERTY(Number, fr)
    MARTIGLI_BINAURAL_PROPERTY(Number, waveformL)
    MARTIGLI_BINAURAL_PROPERTY(Number, waveformR)
    MARTIGLI_BINAURAL_PROPERTY(Number, ma)
    MARTIGLI_BINAURAL_PROPERTY(Number, mp0)
    MARTIGLI_BINAURAL_PROPERTY(Number, mp1)
    MARTIGLI_BINAURAL_PROPERTY(Number, md)
    MARTIGLI_BINAURAL_PROPERTY(Number, inhaleDur)
    MARTIGLI_BINAURAL_PROPERTY(Number, exhaleDur)
    MARTIGLI_BINAURAL_PROPERTY(Bool, martigliComfortGainEnabled)
    MARTIGLI_BINAURAL_PROPERTY(Number, martigliComfortLowDb)
    MARTIGLI_BINAURAL_PROPERTY(Number, martigliComfortHighDb)
    MARTIGLI_BINAURAL_PROPERTY(Number, volume)
    MARTIGLI_BINAURAL_PROPERTY(Number, panOsc)
    MARTIGLI_BINAURAL_PROPERTY(Number, panOscPeriod)
    MARTIGLI_BINAURAL_PROPERTY(Number, panOscTrans)
    MARTIGLI_BINAURAL_PROPERTY(Number, startElapsed)
    MARTIGLI_BINAURAL_PROPERTY(Bool, isOn)
    MARTIGLI_BINAURAL_PROPERTY(Bool, shouldStart)
    MARTIGLI_BINAURAL_PROPERTY(Bool, shouldPause)
    MARTIGLI_BINAURAL_PROPERTY(Bool, shouldResume)
    MARTIGLI_BINAURAL_PROPERTY(Bool, shouldStop)
    MARTIGLI_BINAURAL_PROPERTY(Bool, shouldResetPhase)

    // Read-only properties
    JSI_PROPERTY_GETTER(isPaused) {
        return {std::static_pointer_cast<MartigliBinauralNode>(node_)->isPaused};
    }

    JSI_PROPERTY_GETTER(animationValue) {
        return {std::static_pointer_cast<MartigliBinauralNode>(node_)->animationValue};
    }

    JSI_PROPERTY_GETTER(currentInhaleDur) {
        return {std::static_pointer_cast<MartigliBinauralNode>(node_)->currentInhaleDur};
    }

    JSI_PROPERTY_GETTER(currentExhaleDur) {
        return {std::static_pointer_cast<MartigliBinauralNode>(node_)->currentExhaleDur};
    }

    JSI_PROPERTY_GETTER(currentPeriod) {
        return {std::static_pointer_cast<MartigliBinauralNode>(node_)->currentPeriod};
    }

    JSI_PROPERTY_GETTER(cyclePhase01) {
        return {std::static_pointer_cast<MartigliBinauralNode>(node_)->cyclePhase01};
    }

    JSI_PROPERTY_GETTER(direction) {
        return {std::static_pointer_cast<MartigliBinauralNode>(node_)->direction};
    }

    JSI_PROPERTY_GETTER(audioTime) {
        return {std::static_pointer_cast<MartigliBinauralNode>(node_)->audioTime};
    }
};

#undef MARTIGLI_BINAURAL_PROPERTY

} // namespace audioapi
