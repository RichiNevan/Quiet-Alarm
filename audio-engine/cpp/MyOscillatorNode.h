#pragma once
#include <audioapi/core/AudioNode.h>

namespace audioapi {
class AudioBus;
class BaseAudioContext; // Forward declare

class MyOscillatorNode : public AudioNode {
private:
  BaseAudioContext* _context;
public:
  explicit MyOscillatorNode(BaseAudioContext *context);
  float _phase = 0.0;
  float frequency = 440.0;
  float volume = 1.0;

protected:
  void processNode(const std::shared_ptr<AudioBus> &bus,
                   int framesToProcess) override;

};
} // namespace audioapi
