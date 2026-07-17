package com.biosyncare.audioengine

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager
import com.facebook.soloader.SoLoader

/**
 * Autolinking entry point for the library on Android.
 *
 * The actual TurboModule (NativeCustomNodesModule) is C++-only: it registers
 * itself with React Native's global cxx-module map from JNI_OnLoad in
 * libAudioEngine.so (see android/src/main/jni/OnLoad.cpp). This package
 * therefore exposes no Java modules — its job is to load the native library
 * and to satisfy RN/Expo autolinking, which require a ReactPackage class to
 * put into the generated PackageList.
 */
class AudioEnginePackage : ReactPackage {
  init {
    SoLoader.loadLibrary("AudioEngine")
  }

  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
    emptyList()

  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> =
    emptyList()
}
