#include "MyOscillatorNode.h"
#include <audioapi/core/BaseAudioContext.h>
#include <audioapi/utils/AudioBus.h>
#include <audioapi/utils/AudioArray.h>
#include <cmath>
#include <cstdio>

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

namespace audioapi {
MyOscillatorNode::MyOscillatorNode(BaseAudioContext *context)
    : AudioNode(context), _context(context) {
    isInitialized_ = true;
}

void MyOscillatorNode::processNode(const std::shared_ptr<AudioBus> &bus,
                                  int framesToProcess) {
    printf("MyOscillatorNode: processNode called\n");

    auto sampleRate = _context->getSampleRate();

    for (int i = 0; i < framesToProcess; ++i) {
        float value = sinf(_phase) * volume;
        for (int j = 0; j < bus->getNumberOfChannels(); ++j) {
            bus->getChannel(j)->getData()[i] = value;
        }

        _phase += 2.0f * M_PI * frequency / sampleRate;
        if (_phase >= 2.0f * M_PI) {
            _phase -= 2.0f * M_PI;
        }
    }
}
} // namespace audioapi
