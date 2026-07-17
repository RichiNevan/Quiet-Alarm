#include "MartigliBinauralNode.h"
#include <audioapi/utils/AudioBus.h>
#include <audioapi/utils/AudioArray.h>
#include <algorithm>
#include <cmath>

namespace audioapi {

namespace {

bsc::dsp::Waveform waveformFromInt(int waveform) {
    switch (waveform) {
        case 1: return bsc::dsp::Waveform::Triangle;
        case 2: return bsc::dsp::Waveform::Square;
        case 3: return bsc::dsp::Waveform::Saw;
        default: return bsc::dsp::Waveform::Sine;
    }
}

bsc::dsp::PanMode panModeFromInt(int panOsc) {
    switch (panOsc) {
        case 1: return bsc::dsp::PanMode::HoldCrossfade;
        case 2: return bsc::dsp::PanMode::Sine;
        case 3: return bsc::dsp::PanMode::BreathSynced;
        default: return bsc::dsp::PanMode::None;
    }
}

double inhaleRatioFromDurations(float inhaleDur, float exhaleDur) {
    if (inhaleDur > 0.0f && exhaleDur > 0.0f) {
        const double total = static_cast<double>(inhaleDur) + static_cast<double>(exhaleDur);
        return std::max(0.05, std::min(static_cast<double>(inhaleDur) / total, 0.95));
    }

    return 0.5;
}

} // namespace

MartigliBinauralNode::MartigliBinauralNode(BaseAudioContext *context) : AudioNode(context) {
    channelCount_ = 2;
    channelCountMode_ = ChannelCountMode::EXPLICIT;
    channelInterpretation_ = ChannelInterpretation::SPEAKERS;
    isInitialized_ = true;
}

bsc::dsp::VoiceConfig MartigliBinauralNode::buildSharedConfig() const {
    bsc::dsp::VoiceConfig config;
    config.type = bsc::dsp::VoiceType::MartigliBinaural;
    config.isOn = true;
    config.gain = 1.0;
    config.fl = fl;
    config.fr = fr;
    config.ma = ma;
    config.mp0 = mp0;
    config.mp1 = mp1;
    config.md = md;
    config.inhaleRatio = inhaleRatioFromDurations(inhaleDur, exhaleDur);
    config.martigliComfortGainEnabled = martigliComfortGainEnabled;
    config.martigliComfortGainLowDb = martigliComfortLowDb;
    config.martigliComfortGainHighDb = martigliComfortHighDb;
    config.waveformL = waveformFromInt(waveformL);
    config.waveformR = waveformFromInt(waveformR);
    config.panMode = panModeFromInt(panOsc);
    config.panOscPeriod = panOscPeriod;
    config.panOscTrans = panOscTrans;
    return config;
}

void MartigliBinauralNode::loadSharedEngine(float initialElapsed) {
    bsc::dsp::SessionConfig config;
    config.initialElapsed = std::max(0.0f, initialElapsed);
    config.voices.push_back(buildSharedConfig());
    _sharedEngine.load(config);
    _sharedEngineLoaded = true;
}

void MartigliBinauralNode::syncSharedConfig() {
    if (_sharedEngineLoaded) {
        _sharedEngine.updateVoice(0, buildSharedConfig());
    }
}

void MartigliBinauralNode::publishSharedSnapshot(double snapshotAudioTime) {
    const auto snapshot = _sharedEngine.getBreathSnapshot(0);
    animationValue = static_cast<float>(snapshot.breathValue01);
    cyclePhase01 = static_cast<float>(snapshot.cyclePhase01);
    direction = static_cast<float>(snapshot.direction);
    currentPeriod = static_cast<float>(snapshot.currentPeriod);
    currentInhaleDur = static_cast<float>(snapshot.currentPeriod * snapshot.actualRatio);
    currentExhaleDur = static_cast<float>(snapshot.currentPeriod * (1.0 - snapshot.actualRatio));
    audioTime = snapshotAudioTime;
    AnimationValueRegistry::getInstance().setMartigliAnimationValue(animationValue, isOn);
    AnimationValueRegistry::getInstance().setBreathingSnapshot(animationValue, cyclePhase01, direction, isOn);
}

void MartigliBinauralNode::start() {
    // Initialize smoothed volume to current volume to avoid initial jump
    _smoothedVolume = volume;

    // Gentle 2 s fade-in, linear in dB (perceptually flat loudness ramp).
    isPaused = false;
    loadSharedEngine(startElapsed);
    _sharedEngine.start(startElapsed, 2.0);
    startElapsed = 0.0f;
}

void MartigliBinauralNode::pause() {
    if (_sharedEngineLoaded) {
        _sharedEngine.pause(0.5);
    }
}

void MartigliBinauralNode::resume() {
    isPaused = false;
    if (_sharedEngineLoaded) {
        _sharedEngine.resume(0.5);
    }
}

void MartigliBinauralNode::resetPhase() {
    if (_sharedEngineLoaded) {
        _sharedEngine.resetVoicePhase(0);
    }
    animationValue = 0.0f;
    cyclePhase01 = 0.0f;
    direction = 1.0f;
    AnimationValueRegistry::getInstance().setMartigliAnimationValue(animationValue, isOn);
    AnimationValueRegistry::getInstance().setBreathingSnapshot(animationValue, cyclePhase01, direction, isOn);
}

void MartigliBinauralNode::stop() {
    if (_sharedEngineLoaded) {
        _sharedEngine.stop(2.0);
    }
}

void MartigliBinauralNode::processNode(const std::shared_ptr<AudioBus> &bus, int framesToProcess) {
    auto sampleRate = context_->getSampleRate();
    float dt = 1.0f / sampleRate;
    const double blockStartTime = context_ ? context_->getCurrentTime() : 0.0;
    
    // Handle control flags
    if (shouldStart) { start(); shouldStart = false; }
    if (shouldPause) { pause(); shouldPause = false; }
    if (shouldResume) { resume(); shouldResume = false; }
    if (shouldStop) { stop(); shouldStop = false; }
    if (shouldResetPhase) { resetPhase(); shouldResetPhase = false; }
    
    syncSharedConfig();
    int numChannels = bus->getNumberOfChannels();
    auto leftChannel = numChannels >= 1 ? bus->getChannel(0)->getData() : nullptr;
    auto rightChannel = numChannels >= 2 ? bus->getChannel(1)->getData() : nullptr;
    
    for (int i = 0; i < framesToProcess; ++i) {
        float sampleL = 0.0f;
        float sampleR = 0.0f;
        if (_sharedEngineLoaded) {
            _sharedEngine.render(&sampleL, &sampleR, 1, sampleRate);
        }

        _smoothedVolume += (volume - _smoothedVolume) * 0.01f;
        if (leftChannel) leftChannel[i] = sampleL * _smoothedVolume;
        if (rightChannel) rightChannel[i] = sampleR * _smoothedVolume;
    }

    // Publish the breathing snapshot once per block, not once per sample. The UI
    // bridge reads these atomics at ~30fps and any same-block audio consumer only
    // ever observes the block-end value (each node renders its whole block before
    // the next runs), so a single block-end publish is functionally identical to
    // the old per-sample publish while removing ~127 redundant snapshot copies +
    // atomic stores per block from the audio thread. Matches the
    // AnimationValueRegistry contract ("called ... every buffer").
    if (_sharedEngineLoaded && framesToProcess > 0) {
        publishSharedSnapshot(blockStartTime + static_cast<double>(framesToProcess - 1) * dt);
    }

    if (_sharedEngineLoaded && !_sharedEngine.isActive()) {
        isPaused = true;
    }
}

} // namespace audioapi
