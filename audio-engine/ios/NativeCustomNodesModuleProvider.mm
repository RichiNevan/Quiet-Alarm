#import "NativeCustomNodesModuleProvider.h"
#import <ReactCommon/CallInvoker.h>
#import <ReactCommon/TurboModule.h>
#import "NativeCustomNodesModule.h"
#import "AnimationValueRegistry.h"
#import <worklets/apple/WorkletsModule.h>
#import <React/RCTConstants.h>

@implementation NativeCustomNodesModuleProvider {
  // Captured when WorkletsModule posts RCTDidInitializeModuleNotification.
  // Held weakly so we don't extend its lifetime past RN teardown.
  __weak WorkletsModule *_workletsModule;
}

- (instancetype)init
{
  self = [super init];
  if (self) {
    // Listen for the standard RN module-initialized notification so we can
    // capture the WorkletsModule instance the moment it becomes available.
    // This fires before injectCustomProcessorInstaller is called from JS,
    // so getWorkletRuntime() will succeed at first session start.
    [[NSNotificationCenter defaultCenter]
        addObserver:self
           selector:@selector(_moduleDidInitialize:)
               name:RCTDidInitializeModuleNotification
             object:nil];
  }
  return self;
}

- (void)dealloc
{
  [[NSNotificationCenter defaultCenter] removeObserver:self];
}

- (void)_moduleDidInitialize:(NSNotification *)notification
{
  id module = notification.userInfo[@"module"];
  if ([module isKindOfClass:[WorkletsModule class]]) {
    _workletsModule = (WorkletsModule *)module;
    [[NSNotificationCenter defaultCenter] removeObserver:self
                                                    name:RCTDidInitializeModuleNotification
                                                  object:nil];

    // Wire the worklet runtime provider now that we have the module.
    __weak WorkletsModule *weakWorklets = _workletsModule;
    audioapi::AnimationValueRegistry::getInstance().setWorkletRuntimeProvider(
        [weakWorklets]() -> facebook::jsi::Runtime* {
      WorkletsModule *wm = weakWorklets;
      if (!wm) return nullptr;
      auto proxy = [wm getWorkletsModuleProxy];
      if (!proxy) return nullptr;
      return &proxy->getUIWorkletRuntime()->getJSIRuntime();
    });
  }
}

- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:
    (const facebook::react::ObjCTurboModule::InitParams &)params
{
  return std::make_shared<facebook::react::NativeCustomNodesModule>(params.jsInvoker);
}

@end
