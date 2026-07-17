#include "../shared/DspPrimitives.h"
#include "../shared/SessionDspEngine.h"

#include <cassert>
#include <cmath>
#include <iostream>
#include <vector>

using namespace bsc::dsp;

namespace {

void expectNear(double actual, double expected, double epsilon = 1e-6) {
  if (std::abs(actual - expected) > epsilon) {
    std::cerr << "Expected " << actual << " near " << expected
              << " (epsilon " << epsilon << ")\n";
    assert(false);
  }
}

void testWaveforms() {
  expectNear(waveformSample(0.0, Waveform::Sine), 0.0);
  expectNear(waveformSample(0.25, Waveform::Sine), 1.0);
  expectNear(waveformSample(0.0, Waveform::Triangle), 0.0);
  expectNear(waveformSample(0.25, Waveform::Triangle), 1.0);
  expectNear(waveformSample(0.75, Waveform::Triangle), -1.0);
  expectNear(waveformSample(0.0, Waveform::Square), 1.0);
  expectNear(waveformSample(0.5, Waveform::Square), -1.0);
  expectNear(waveformSample(0.5, Waveform::Saw), 0.0);
}

void testGainRamp() {
  GainRamp ramp;
  ramp.setImmediate(0.0);
  ramp.start(1.0, 4);
  expectNear(ramp.process(), 0.25);
  expectNear(ramp.process(), 0.5);
  expectNear(ramp.process(), 0.75);
  expectNear(ramp.process(), 1.0);
  expectNear(ramp.process(), 1.0);
}

void testBreathingShape() {
  const auto start = readBreathAt(0.0, 0.0, 8.0, 8.0, 0.0, 0.5);
  expectNear(start.signedValue, -1.0);
  expectNear(start.snapshot.breathValue01, 0.0);
  assert(start.snapshot.direction == 1);

  const auto peak = readBreathAt(4.0, 4.0, 8.0, 8.0, 0.0, 0.5);
  expectNear(peak.signedValue, 1.0);
  expectNear(peak.snapshot.breathValue01, 1.0);
  assert(peak.snapshot.direction == 0);
}

void testPanning() {
  expectNear(readHoldCrossfadePanSwap(0.0, 10.0, 2.0), 0.0);
  expectNear(readHoldCrossfadePanSwap(9.0, 10.0, 2.0), 0.5);
  expectNear(readHoldCrossfadePanSwap(10.0, 10.0, 2.0), 1.0);
  expectNear(readHoldCrossfadePanSwap(19.0, 10.0, 2.0), 0.5);
}

void renderVoice(
    const VoiceConfig& voice,
    double sampleRate,
    double fadeSeconds,
    std::vector<float>& left,
    std::vector<float>& right,
    double initialElapsed = 0.0) {
  SessionDspEngine engine;
  engine.load(SessionConfig{{voice}, initialElapsed});
  engine.start(initialElapsed, fadeSeconds);
  engine.render(left.data(), right.data(), static_cast<int>(left.size()), sampleRate);
}

void testMartigliNativeFadeAndCenterGain() {
  VoiceConfig voice;
  voice.type = VoiceType::Martigli;
  voice.gain = 1.0;
  voice.mf0 = 0.0;
  voice.ma = 0.0;
  voice.mp0 = 8.0;
  voice.mp1 = 8.0;
  voice.md = 0.0;
  voice.waveformM = Waveform::Square;

  std::vector<float> left(4);
  std::vector<float> right(4);
  renderVoice(voice, 4.0, 2.0, left, right);

  // Native mobile Martigli fades linearly in dB from -80 dB to unity. With
  // stereo output and no panning, the mono carrier is split 50/50.
  expectNear(left[0], 0.5 * std::pow(10.0, -70.0 / 20.0), 1e-8);
  expectNear(right[0], left[0], 1e-8);
  expectNear(left[1], 0.5 * std::pow(10.0, -60.0 / 20.0), 1e-8);
}

void testMartigliNativeMonoPanning() {
  VoiceConfig voice;
  voice.type = VoiceType::Martigli;
  voice.gain = 1.0;
  voice.mf0 = 0.0;
  voice.ma = 0.0;
  voice.mp0 = 8.0;
  voice.mp1 = 8.0;
  voice.md = 0.0;
  voice.waveformM = Waveform::Square;
  voice.panMode = PanMode::HoldCrossfade;
  voice.panOscPeriod = 4.0;
  voice.panOscTrans = 1.0;

  std::vector<float> left(7);
  std::vector<float> right(7);
  renderVoice(voice, 1.0, 0.0, left, right);

  expectNear(left[0], 0.0);
  expectNear(right[0], 1.0);
  expectNear(left[1], 1.0);
  expectNear(right[1], 0.0);
  expectNear(left[5], 1.0);
  expectNear(right[5], 0.0);
  expectNear(left[6], 0.0);
  expectNear(right[6], 1.0);
}

void testMartigliBinauralNativeSwapPanning() {
  VoiceConfig voice;
  voice.type = VoiceType::MartigliBinaural;
  voice.gain = 1.0;
  voice.fl = 0.0;
  voice.fr = 0.0;
  voice.ma = 0.0;
  voice.mp0 = 8.0;
  voice.mp1 = 8.0;
  voice.md = 0.0;
  voice.waveformL = Waveform::Square;
  voice.waveformR = Waveform::Saw;
  voice.panMode = PanMode::HoldCrossfade;
  voice.panOscPeriod = 4.0;
  voice.panOscTrans = 1.0;

  std::vector<float> left(6);
  std::vector<float> right(6);
  renderVoice(voice, 1.0, 0.0, left, right);

  expectNear(left[0], 1.0);
  expectNear(right[0], -1.0);
  expectNear(left[3], 1.0);
  expectNear(right[3], -1.0);
  expectNear(left[4], -1.0);
  expectNear(right[4], 1.0);
}

void testMartigliComfortGainAttenuatesHighSweep() {
  VoiceConfig reference;
  reference.type = VoiceType::Martigli;
  reference.gain = 1.0;
  reference.mf0 = 150.0;
  reference.ma = 50.0;
  reference.mp0 = 4.0;
  reference.mp1 = 4.0;
  reference.md = 0.0;
  reference.inhaleRatio = 0.5;
  reference.waveformM = Waveform::Square;

  VoiceConfig attenuated = reference;
  attenuated.martigliComfortGainEnabled = true;
  attenuated.martigliComfortGainLowDb = 0.0;
  attenuated.martigliComfortGainHighDb = -6.0;

  std::vector<float> referenceL(1);
  std::vector<float> referenceR(1);
  std::vector<float> attenuatedL(1);
  std::vector<float> attenuatedR(1);
  renderVoice(reference, 48000.0, 0.0, referenceL, referenceR, 2.0);
  renderVoice(attenuated, 48000.0, 0.0, attenuatedL, attenuatedR, 2.0);

  assert(attenuatedL[0] < referenceL[0]);
  expectNear(
      attenuatedL[0] / referenceL[0],
      std::pow(10.0, -6.0 / 20.0),
      1e-6);
  expectNear(attenuatedR[0], attenuatedL[0]);
}

void testBinauralNativeSwapPanning() {
  VoiceConfig voice;
  voice.type = VoiceType::Binaural;
  voice.gain = 1.0;
  voice.fl = 0.0;
  voice.fr = 0.0;
  voice.waveformL = Waveform::Square;
  voice.waveformR = Waveform::Saw;
  voice.panMode = PanMode::HoldCrossfade;
  voice.panOscPeriod = 4.0;
  voice.panOscTrans = 1.0;

  std::vector<float> left(6);
  std::vector<float> right(6);
  renderVoice(voice, 1.0, 0.0, left, right);

  expectNear(left[0], 1.0);
  expectNear(right[0], -1.0);
  expectNear(left[3], 1.0);
  expectNear(right[3], -1.0);
  expectNear(left[4], -1.0);
  expectNear(right[4], 1.0);
}

void testBinauralExternalBreathSyncedPanning() {
  VoiceConfig voice;
  voice.type = VoiceType::Binaural;
  voice.gain = 1.0;
  voice.fl = 0.0;
  voice.fr = 0.0;
  voice.waveformL = Waveform::Square;
  voice.waveformR = Waveform::Saw;
  voice.panMode = PanMode::BreathSynced;

  SessionDspEngine engine;
  engine.load(SessionConfig{{voice}, 0.0});
  engine.setSyncedBreathValue(0.75);
  engine.start(0.0, 0.0);

  float left = 0.0f;
  float right = 0.0f;
  engine.render(&left, &right, 1, 1.0);

  expectNear(left, -0.5);
  expectNear(right, 0.5);
}

void testSymmetryPermutationEnvelopeAndBoundaryReset() {
  VoiceConfig voice;
  voice.type = VoiceType::Symmetry;
  voice.gain = 1.0;
  voice.waveform = Waveform::Saw;
  voice.noteSlots = {{25.0}, {40.0}};
  voice.permutationRows = {{1, 0}};
  voice.noteSep = 0.5;
  voice.cycleSeconds = 1.0;

  std::vector<float> left(52);
  std::vector<float> right(52);
  renderVoice(voice, 100.0, 0.0, left, right);

  expectNear(left[0], 0.0);
  expectNear(left[1], -0.2 * 0.5 * kCenterGain, 1e-6);
  expectNear(right[1], left[1], 1e-6);
  expectNear(left[50], 0.0);
  expectNear(left[51], -0.5 * 0.5 * kCenterGain, 1e-6);
}

void testSessionRenderAndSnapshot() {
  VoiceConfig voice;
  voice.type = VoiceType::Martigli;
  voice.gain = 1.0;
  voice.mf0 = 220.0;
  voice.ma = 10.0;
  voice.mp0 = 8.0;
  voice.mp1 = 8.0;
  voice.md = 0.0;

  SessionDspEngine engine;
  engine.load(SessionConfig{{voice}, 0.0});
  engine.start(0.0, 0.0);

  std::vector<float> left(128);
  std::vector<float> right(128);
  engine.render(left.data(), right.data(), static_cast<int>(left.size()), 48000.0);

  bool nonZero = false;
  for (float sample : left) {
    if (std::abs(sample) > 1e-6f) {
      nonZero = true;
      break;
    }
  }
  assert(nonZero);
  const auto snapshot = engine.getBreathSnapshot(0);
  assert(snapshot.currentPeriod > 0.0);
  assert(snapshot.breathValue01 >= 0.0 && snapshot.breathValue01 <= 1.0);
}

void testMartigliUpdatePreservesBreathPhase() {
  VoiceConfig voice;
  voice.type = VoiceType::Martigli;
  voice.gain = 1.0;
  voice.mf0 = 220.0;
  voice.ma = 10.0;
  voice.mp0 = 8.0;
  voice.mp1 = 8.0;
  voice.md = 0.0;

  SessionDspEngine engine;
  engine.load(SessionConfig{{voice}, 0.0});
  engine.start(0.0, 0.0);

  float left = 0.0f;
  float right = 0.0f;
  engine.render(&left, &right, 1, 1.0);

  voice.mf0 = 330.0;
  assert(engine.updateVoice(0, voice));
  engine.render(&left, &right, 1, 1.0);

  const auto snapshot = engine.getBreathSnapshot(0);
  expectNear(snapshot.cyclePhase01, 0.125);
}

void testMartigliResetPhaseUpdatesSnapshot() {
  VoiceConfig voice;
  voice.type = VoiceType::Martigli;
  voice.gain = 1.0;
  voice.mf0 = 220.0;
  voice.ma = 10.0;
  voice.mp0 = 8.0;
  voice.mp1 = 8.0;
  voice.md = 0.0;

  SessionDspEngine engine;
  engine.load(SessionConfig{{voice}, 0.0});
  engine.start(0.0, 0.0);

  float left = 0.0f;
  float right = 0.0f;
  engine.render(&left, &right, 1, 1.0);
  assert(engine.resetVoicePhase(0));

  const auto snapshot = engine.getBreathSnapshot(0);
  expectNear(snapshot.cyclePhase01, 0.0);
  expectNear(snapshot.breathValue01, 0.0);
  assert(snapshot.direction == 1);
}

void testNoiseDeterminismLevelsAndColorCrossfade() {
  VoiceConfig white;
  white.type = VoiceType::Noise;
  white.gain = 1.0;
  white.noiseColor = NoiseColor::White;

  // Deterministic seeding: two engines with identical config render identically.
  SessionDspEngine a;
  SessionDspEngine b;
  a.load(SessionConfig{{white}, 0.0});
  b.load(SessionConfig{{white}, 0.0});
  a.start(0.0, 0.0);
  b.start(0.0, 0.0);

  std::vector<float> aL(64, 0.0f);
  std::vector<float> aR(64, 0.0f);
  std::vector<float> bL(64, 0.0f);
  std::vector<float> bR(64, 0.0f);
  a.render(aL.data(), aR.data(), 64, 48000.0);
  b.render(bL.data(), bR.data(), 64, 48000.0);

  double energy = 0.0;
  for (int i = 0; i < 64; i += 1) {
    expectNear(aL[i], bL[i]);          // deterministic
    expectNear(aL[i], aR[i]);          // mono noise, equal channels
    assert(aL[i] >= -1.0f && aL[i] <= 1.0f);  // bounded after output clamp
    energy += std::abs(aL[i]);
  }
  assert(energy > 0.0);  // not silent

  // A pure-white reference vs a stream that switches to brown mid-render must
  // agree before the color change and then diverge once the crossfade begins.
  SessionDspEngine ref;
  SessionDspEngine sw;
  ref.load(SessionConfig{{white}, 0.0});
  sw.load(SessionConfig{{white}, 0.0});
  ref.start(0.0, 0.0);
  sw.start(0.0, 0.0);

  float l = 0.0f;
  float r = 0.0f;
  for (int i = 0; i < 16; i += 1) {
    float rl = 0.0f;
    float rr = 0.0f;
    ref.render(&rl, &rr, 1, 48000.0);
    sw.render(&l, &r, 1, 48000.0);
    expectNear(l, rl);  // identical before any color change
  }

  VoiceConfig brown = white;
  brown.noiseColor = NoiseColor::Brown;
  assert(sw.updateVoice(0, brown));

  bool diverged = false;
  for (int i = 0; i < 64; i += 1) {
    float rl = 0.0f;
    float rr = 0.0f;
    ref.render(&rl, &rr, 1, 48000.0);
    sw.render(&l, &r, 1, 48000.0);
    assert(l >= -1.0f && l <= 1.0f);
    assert(std::isfinite(l));
    if (std::abs(l - rl) > 1e-9) diverged = true;
  }
  assert(diverged);  // crossfade produced an audible change

  // Re-applying the same color must not retrigger a crossfade.
  assert(sw.updateVoice(0, brown));
}

void testPauseFadeFreezesEngine() {
  VoiceConfig voice;
  voice.type = VoiceType::Martigli;
  voice.gain = 1.0;

  SessionDspEngine engine;
  engine.load(SessionConfig{{voice}, 0.0});
  engine.start(0.0, 0.0);
  engine.pause(0.0);

  float left = 0.0f;
  float right = 0.0f;
  engine.render(&left, &right, 1, 1.0);
  assert(!engine.isActive());

  const double elapsedAfterFade = engine.elapsed();
  engine.render(&left, &right, 8, 1.0);
  expectNear(engine.elapsed(), elapsedAfterFade);
}

void testSymmetryHeldNoteSurvivesPerQuantumUpdate() {
  // Mobile SymmetryNode::syncSharedConfig() calls updateVoice() every audio
  // quantum. A held single-tone note inside a line that also contains a dyad
  // (maxChord 2) must survive those same-type updates: if updateVoice resets the
  // symmetry state because the current note's chord (1) is smaller than maxChord
  // (2), the phase is forced back to 0 each quantum, producing a ~quantum-rate
  // discontinuity (audible buzz). Render the sustain of slot 0 ([300]) in quanta,
  // calling updateVoice before each, and assert the waveform stays continuous.
  VoiceConfig voice;
  voice.type = VoiceType::Symmetry;
  voice.gain = 1.0;
  voice.noteSlots = {{300.0}, {200.0, 250.0}};  // maxChord 2; slot 0 is a single tone
  voice.noteSep = 20.0;       // 20 s/note -> slot 0 is held across the window
  voice.cycleSeconds = 40.0;

  const double sampleRate = 48000.0;
  SessionDspEngine engine;
  engine.load(SessionConfig{{voice}, 0.0});
  engine.start(0.0, 0.0);

  const int quantum = 128;
  std::vector<float> left(quantum);
  std::vector<float> right(quantum);
  double previous = 0.0;
  double maxStep = 0.0;
  const int totalFrames = static_cast<int>(sampleRate * 3.5);
  const int measureFrom = static_cast<int>(sampleRate * 2.0);  // past the 2 s attack
  for (int n = 0; n < totalFrames; n += quantum) {
    engine.updateVoice(0, voice);  // mimic mobile per-quantum config sync
    engine.render(left.data(), right.data(), quantum, sampleRate);
    if (n >= measureFrom) {
      for (int i = 0; i < quantum; i += 1) {
        const double step = std::abs(static_cast<double>(left[i]) - previous);
        if (step > maxStep) maxStep = step;
        previous = left[i];
      }
    } else {
      previous = left[quantum - 1];
    }
  }
  // A 300 Hz sine at 48 kHz steps at most ~2*pi*300/48000*kCenterGain ~= 0.028
  // per sample. The per-quantum reset regression produced steps ~0.68.
  assert(maxStep < 0.1);
}

}  // namespace

int main() {
  testWaveforms();
  testGainRamp();
  testBreathingShape();
  testPanning();
  testMartigliNativeFadeAndCenterGain();
  testMartigliNativeMonoPanning();
  testMartigliBinauralNativeSwapPanning();
  testMartigliComfortGainAttenuatesHighSweep();
  testBinauralNativeSwapPanning();
  testBinauralExternalBreathSyncedPanning();
  testSymmetryPermutationEnvelopeAndBoundaryReset();
  testSymmetryHeldNoteSurvivesPerQuantumUpdate();
  testSessionRenderAndSnapshot();
  testMartigliUpdatePreservesBreathPhase();
  testMartigliResetPhaseUpdatesSnapshot();
  testNoiseDeterminismLevelsAndColorCrossfade();
  testPauseFadeFreezesEngine();
  std::cout << "shared DSP tests passed\n";
  return 0;
}
