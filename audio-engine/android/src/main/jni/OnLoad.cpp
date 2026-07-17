#include <jni.h>

#include <memory>
#include <string>
#include <utility>

#include <ReactCommon/CxxTurboModuleUtils.h>

#include "NativeCustomNodesModule.h"

// Android counterpart of the iOS codegen modulesProvider: registers the
// C++-only TurboModule with React Native's global cxx-module map when
// libAudioEngine.so is loaded (AudioEnginePackage loads it via SoLoader,
// which happens when PackageList is constructed — before any JS require).
// TurboModuleManager consults this map when JS requests the module by name.
JNIEXPORT jint JNI_OnLoad(JavaVM * /*vm*/, void * /*reserved*/) {
  facebook::react::registerCxxModuleToGlobalModuleMap(
      "NativeCustomNodesModule",
      [](std::shared_ptr<facebook::react::CallInvoker> jsInvoker) {
        return std::make_shared<facebook::react::NativeCustomNodesModule>(
            std::move(jsInvoker));
      });
  return JNI_VERSION_1_6;
}
