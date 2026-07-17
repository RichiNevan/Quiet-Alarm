#pragma once

// iOS exposes the generated TurboModule spec under the ReactCodegen framework
// umbrella, while Android's codegen places the same header directly on the
// jni include path. Pick whichever resolves so the native module builds on
// both platforms.
#if __has_include(<ReactCodegen/AudioApiTurboModulesJSI.h>)
#include <ReactCodegen/AudioApiTurboModulesJSI.h>
#else
#include <AudioApiTurboModulesJSI.h>
#endif

#include <jsi/jsi.h>
#include <memory>
#include <string>

namespace facebook::react {

class NativeCustomNodesModule
    : public NativeCustomNodesModuleCxxSpec<NativeCustomNodesModule> {
public:
  NativeCustomNodesModule(std::shared_ptr<CallInvoker> jsInvoker);
  void injectCustomProcessorInstaller(jsi::Runtime &runtime);

private:
  jsi::Function createOscillatorInstaller(jsi::Runtime &runtime);
  jsi::Function createMartigliInstaller(jsi::Runtime &runtime);
  jsi::Function createBinauralInstaller(jsi::Runtime &runtime);
  jsi::Function createSymmetryInstaller(jsi::Runtime &runtime);
  jsi::Function createMartigliBinauralInstaller(jsi::Runtime &runtime);
  jsi::Function createNoiseInstaller(jsi::Runtime &runtime);
};

} // namespace facebook::react
