#pragma once

#include <audioapi/core/AudioNode.h>
#include <audioapi/core/BaseAudioContext.h>
#include "AnimationValueRegistry.h"
#include "dsp/shared/SessionDspEngine.h"

namespace audioapi {

class MartigliBinauralNode : public AudioNode {
public:
    explicit MartigliBinauralNode(BaseAudioContext *context);
    ~MartigliBinauralNode() override = default;

    void processNode(const std::shared_ptr<AudioBus> &bus, int framesToProcess) override;
    
    // Control methods
    void start();
    void pause();
    void resume();
    void stop();
    void resetPhase();
    
    // Public parameters
    float fl = 250.0f;           // Left carrier frequency
    float fr = 260.0f;           // Right carrier frequency
    int waveformL = 0;           // Left waveform (0=sine, 1=tri, 2=square, 3=saw)
    int waveformR = 0;           // Right waveform
    float ma = 90.0f;            // Modulation amount
    float mp0 = 11.0f;           // Initial period
    float mp1 = 20.0f;           // Final period
    float md = 600.0f;           // Ramp duration
    float inhaleDur = 5.0f;      // Inhale duration (base)
    float exhaleDur = 5.0f;      // Exhale duration (base)
    bool martigliComfortGainEnabled = false;
    float martigliComfortLowDb = 0.0f;
    float martigliComfortHighDb = 0.0f;
    float volume = 1.0f;         // Master volume
    int panOsc = 0;              // Panning mode (0=none, 1=envelope, 2=sine, 3=LFO)
    float panOscPeriod = 120.0f; // Panning period
    float panOscTrans = 20.0f;   // Panning transition time
    bool isOn = false;           // Publish to AnimationValueRegistry
    
    // Control flags
    bool shouldStart = false;
    bool shouldPause = false;
    bool shouldResume = false;
    bool shouldStop = false;
    bool shouldResetPhase = false;
    bool isPaused = false;
    
    // Exposed values for UI
    float animationValue = 0.0f;
    float currentInhaleDur = 0.0f;
    float currentExhaleDur = 0.0f;
    float currentPeriod = 0.0f;
    float cyclePhase01 = 0.0f;
    float direction = 1.0f;
    double audioTime = 0.0;
    float startElapsed = 0.0f;
    
private:
    bsc::dsp::VoiceConfig buildSharedConfig() const;
    void loadSharedEngine(float initialElapsed);
    void syncSharedConfig();
    void publishSharedSnapshot(double audioTime);

    bsc::dsp::SessionDspEngine _sharedEngine;
    bool _sharedEngineLoaded = false;
    
    // Volume smoothing
    float _smoothedVolume = 0.5f;
};

} // namespace audioapi
