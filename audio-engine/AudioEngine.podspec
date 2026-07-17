require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.name         = "AudioEngine"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.homepage     = "https://github.com/biosyncare/audio-engine"
  s.license      = "UNLICENSED"
  s.authors      = "BioSynCare"

  s.platforms    = { :ios => "15.1" }
  s.source       = { :git => "https://github.com/biosyncare/audio-engine.git", :tag => "#{s.version}" }

  # Compile the provider (.mm/.h) and the entire shared C++ node tree.
  # Exclude web-only WASM exports and the standalone DSP unit-test harness.
  s.source_files  = "ios/**/*.{h,m,mm}", "cpp/**/*.{h,hpp,cpp}"
  s.exclude_files = "cpp/dsp/wasm/**/*", "cpp/dsp/tests/**/*"
  s.requires_arc  = true

  # c++20 + libc++, and header roots for our cpp tree, react-native-audio-api's
  # public C++ headers, and react-native-worklets' Apple headers
  # (the provider imports <worklets/apple/WorkletsModule.h>).
  # This replaces what plugins/withNativeCustomNodesIos.js + the Podfile
  # post_install header hook did in the host app.
  s.pod_target_xcconfig = {
    "CLANG_CXX_LANGUAGE_STANDARD" => "c++20",
    "CLANG_CXX_LIBRARY" => "libc++",
    "HEADER_SEARCH_PATHS" => [
      '"$(PODS_TARGET_SRCROOT)/cpp"',
      '"$(PODS_ROOT)/../../node_modules/react-native-audio-api/common/cpp"',
      # react-native-audio-api >= 0.8 vendors FFmpeg (StreamerNode); its public
      # BaseAudioContextHostObject.h transitively includes <libavformat/...>.
      '"$(PODS_ROOT)/../../node_modules/react-native-audio-api/common/cpp/audioapi/external/ffmpeg_include"',
      '"$(PODS_ROOT)/../../node_modules/react-native-worklets/apple"'
    ].join(" ")
  }

  # The custom nodes extend react-native-audio-api node types, and the provider
  # talks to react-native-worklets' UI runtime.
  s.dependency "RNAudioAPI"
  s.dependency "RNWorklets"

  # Pulls in React-Core, ReactCodegen (generates AudioApiTurboModulesJSI.h under
  # the ReactCodegen umbrella), React_NativeModulesApple, RCT-Folly, and the
  # New-Arch folly/fabric compiler flags. Requires RN >= 0.71.
  install_modules_dependencies(s)
end
