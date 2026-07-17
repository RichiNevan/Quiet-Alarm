#import <Foundation/Foundation.h>
// Prefer the canonical <ReactCommon/...> form (React-NativeModulesApple sets
// header_dir "ReactCommon"; codegen headers like rnworklets.h use it). The
// framework-style path is only a fallback — with Expo's prebuilt React Native
// (SDK 57) it resolves to React-Core-prebuilt's duplicate copy of this header,
// which collides with the canonical one inside the same translation unit.
#if __has_include(<ReactCommon/RCTTurboModule.h>)
#import <ReactCommon/RCTTurboModule.h>
#else
#import <React_NativeModulesApple/ReactCommon/RCTTurboModule.h>
#endif

NS_ASSUME_NONNULL_BEGIN

@interface NativeCustomNodesModuleProvider : NSObject <RCTModuleProvider>

@end

NS_ASSUME_NONNULL_END
