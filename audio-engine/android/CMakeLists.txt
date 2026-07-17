cmake_minimum_required(VERSION 3.13)
project(AudioEngine)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_VERBOSE_MAKEFILE ON)

# Package root = node_modules/@biosyncare/audio-engine (android/ is one level down)
set(PKG_ROOT ${CMAKE_CURRENT_SOURCE_DIR}/..)

# AUDIO_API_DIR is injected from android/build.gradle (node-resolved path to
# react-native-audio-api). Fail loudly if the wiring is missing.
if(NOT DEFINED AUDIO_API_DIR)
  message(FATAL_ERROR "AUDIO_API_DIR was not provided by build.gradle")
endif()

if(${IS_NEW_ARCHITECTURE_ENABLED})
  add_compile_definitions(RCT_NEW_ARCH_ENABLED)
endif()

# React Native core + fbjni exposed as prefab packages by the RN Android build.
find_package(ReactAndroid REQUIRED CONFIG)
find_package(fbjni REQUIRED CONFIG)

# Same source set as the iOS podspec and the host app's jni/CMakeLists.txt.
# (WASM exports and DSP tests are intentionally excluded from device builds.)
add_library(${CMAKE_PROJECT_NAME} SHARED
  # Android-only JNI_OnLoad that registers the C++ TurboModule with RN's
  # global cxx-module map (the Android counterpart of the iOS modulesProvider).
  ${CMAKE_CURRENT_SOURCE_DIR}/src/main/jni/OnLoad.cpp
  ${PKG_ROOT}/cpp/NativeCustomNodesModule.cpp
  ${PKG_ROOT}/cpp/dsp/shared/DspPrimitives.cpp
  ${PKG_ROOT}/cpp/dsp/shared/SessionDspEngine.cpp
  ${PKG_ROOT}/cpp/MyOscillatorNode.cpp
  ${PKG_ROOT}/cpp/BinauralNode.cpp
  ${PKG_ROOT}/cpp/MartigliNode.cpp
  ${PKG_ROOT}/cpp/MartigliBinauralNode.cpp
  ${PKG_ROOT}/cpp/SymmetryNode.cpp
  ${PKG_ROOT}/cpp/NoiseNode.cpp
)

target_include_directories(${CMAKE_PROJECT_NAME} PUBLIC
  ${PKG_ROOT}/cpp
  ${AUDIO_API_DIR}/common/cpp
  # react-native-audio-api >= 0.8 vendors FFmpeg (StreamerNode); its public
  # BaseAudioContextHostObject.h transitively includes <libavformat/...>.
  ${AUDIO_API_DIR}/common/cpp/audioapi/external/ffmpeg_include
  # Generated JSI spec: cpp/NativeCustomNodesModule.h includes
  # <AudioApiTurboModulesJSI.h> on Android (the __has_include else-branch).
  ${CMAKE_CURRENT_SOURCE_DIR}/build/generated/source/codegen/jni
)

# Import react-native-audio-api's prebuilt .so. Mapping ported from the host
# app's android/app/src/main/jni/CMakeLists.txt (Gradle only emits debug/release
# native-lib folders, so optimized CMake variants map back to release).
add_library(react-native-audio-api SHARED IMPORTED)
string(TOLOWER ${CMAKE_BUILD_TYPE} BUILD_TYPE_LOWER)
set(GRADLE_VARIANT ${CMAKE_BUILD_TYPE})
if(BUILD_TYPE_LOWER STREQUAL "relwithdebinfo" OR BUILD_TYPE_LOWER STREQUAL "release" OR BUILD_TYPE_LOWER STREQUAL "minsizerel")
  set(BUILD_TYPE_LOWER "release")
  set(GRADLE_VARIANT "Release")
else()
  set(BUILD_TYPE_LOWER "debug")
  set(GRADLE_VARIANT "Debug")
endif()
set_target_properties(react-native-audio-api PROPERTIES IMPORTED_LOCATION
  ${AUDIO_API_DIR}/android/build/intermediates/merged_native_libs/${BUILD_TYPE_LOWER}/merge${GRADLE_VARIANT}NativeLibs/out/lib/${CMAKE_ANDROID_ARCH_ABI}/libreact-native-audio-api.so
)

# react_codegen_AudioApiTurboModules sources are produced by the
# `com.facebook.react` gradle plugin from this library's codegenConfig; the
# generated folder ships its own CMakeLists defining the target — pull it in.
# That generated file expects the environment RN's application-level CMake
# normally provides: target_compile_reactnative_options() (from RN's shared
# cmake utils) and bare-name aliases for the prefab targets.
if(NOT DEFINED REACT_NATIVE_DIR)
  message(FATAL_ERROR "REACT_NATIVE_DIR was not provided by build.gradle")
endif()
include(${REACT_NATIVE_DIR}/ReactCommon/cmake-utils/react-native-flags.cmake)
# RN's prefab headers (react/bridging via the generated JSI spec) require the
# folly compile definitions RN normally injects; folly-flags.cmake defines
# ${folly_FLAGS}.
include(${REACT_NATIVE_DIR}/ReactAndroid/cmake-utils/folly-flags.cmake)
add_library(jsi ALIAS ReactAndroid::jsi)
add_library(reactnative ALIAS ReactAndroid::reactnative)
add_library(fbjni ALIAS fbjni::fbjni)
add_subdirectory(${CMAKE_CURRENT_SOURCE_DIR}/build/generated/source/codegen/jni codegen)

target_compile_options(${CMAKE_PROJECT_NAME} PRIVATE ${folly_FLAGS})

target_link_libraries(${CMAKE_PROJECT_NAME}
  ReactAndroid::reactnative
  fbjni::fbjni
  react-native-audio-api
  react_codegen_AudioApiTurboModules
  android
  log
)
