# Integrating `@biosyncare/audio-engine` into an app

This guide takes a React Native app from zero to a **working, audible binaural tone**
using this library. Follow it top to bottom; the last step is a drop-in button that
proves the whole native chain is wired correctly.

The library is a **New-Architecture C++ Turbo Module** (`NativeCustomNodesModule`)
that adds custom DSP nodes on top of [`react-native-audio-api`](https://github.com/software-mansion/react-native-audio-api),
plus a JS engine layer (`SessionManager`, web AudioWorklet engine) and a shared DSP
core that also runs in the browser via WASM.

> **The fast path to "is it working?"** → do steps 1–4, drop
> `<BinauralSmokeTestButton />` (step 6) on a screen, run a **dev/device build**,
> tap it with headphones on. 5 seconds of a 300/306 Hz beat followed by a smooth
> 2-second fade-out = success.

Validated end-to-end (native build + audible playback on device) on:
**Expo SDK 57 / React Native 0.86 / Gradle 9 / Xcode 26.2**, iOS + Android,
with `react-native-audio-api@0.8.4`.

---

## 0. Requirements

Your app must be:

- **React Native 0.81+** with the **New Architecture ON**
  (`newArchEnabled=true` in `android/gradle.properties`; iOS default). This library
  is a Cxx Turbo Module — it will not register under the old architecture.
- **Expo SDK 54+** (managed/CNG with `npx expo prebuild`, or committed
  `ios/`+`android/`), or **bare React Native**. The library autolinks via a podspec +
  `android/build.gradle` on every prebuild.
- Using **Hermes** (default) is fine.

---

## 1. Install the library + its peer dependencies

```bash
# the library itself — local folder, git URL, or npm
npm install file:../audio-engine

# peers (the actual engine + worklet/animation runtimes)
npm install \
  react-native-audio-api@^0.8.4 \
  react-native-worklets \
  react-native-reanimated
```

> ⚠️ **`react-native-audio-api` MUST be 0.8.x — do not install `latest`.**
> The custom nodes subclass `audioapi::AudioNode` in C++ and override
> `void processNode(const std::shared_ptr<AudioBus>&, int)`. That virtual's
> signature changed in **0.9.0** (returns `std::shared_ptr<AudioBus>`) and again in
> 0.13 (const members, `DSPAudioBuffer`), so anything ≥ 0.9 **fails to compile**.
> The peer dependency range (`>=0.7.0 <0.9.0`) enforces this; 0.8.4 is the
> validated version. If you ever bump past 0.9, the C++ nodes in `cpp/` must be
> ported first.

`react-native-audio-api` is the underlying audio engine this library extends —
**it is required**. `react-native-worklets` powers the breathing/animation bridge;
`react-native-reanimated` is its companion.

---

## 2. Apply the bundled patches (`patches/` ships with this library)

This library ships ready-made [`patch-package`](https://github.com/ds300/patch-package)
patches in its own `patches/` folder. Copy what you need into your **app's**
`patches/` folder and wire up `patch-package`:

```bash
mkdir -p patches
cp node_modules/@biosyncare/audio-engine/patches/react-native-audio-api+0.8.4.patch patches/
# Only if you hit the Expo SDK 57 + Xcode 26.2 Swift error (see Troubleshooting):
cp node_modules/@biosyncare/audio-engine/patches/expo-modules-jsi+57.0.3.patch patches/

npm install --save-dev patch-package
```

Add to your app's `package.json`:

```jsonc
"scripts": { "postinstall": "patch-package" }
```

Then `npm install` again so the patches apply.

- **`react-native-audio-api+0.8.4.patch` — required on RN 0.86+.** Removes two
  stale `#include <react/jni/CxxModuleWrapper.h>` lines; that header was deleted
  from React Native along with the legacy architecture. **Skipping this breaks the
  Android build of `react-native-audio-api`.**
- **`expo-modules-jsi+57.0.3.patch` — only for Expo SDK 57 built with Xcode 26.2+**
  (a bare `abs()` in `JavaScriptCodable+Date.swift` becomes ambiguous under Swift
  C++ interop). Unrelated to this library, but it blocks `expo run:ios` entirely.

---

## 3. TypeScript setup (TS 5.9+/6.x apps)

Two small app-side additions keep `tsc --noEmit` green when the engine's sources
are typechecked through the `file:` install:

1. The engine uses Node-style `global` and the `events` package. TypeScript 6 no
   longer auto-includes `@types/*`, so install and declare it:

   ```bash
   npm install --save-dev @types/node
   ```

   ```jsonc
   // tsconfig.json → compilerOptions
   "types": ["node"]
   ```

2. **Expo SDK 57+ removed `expo-av`** (replaced by `expo-audio`/`expo-video`). The
   engine lazy-imports `expo-av` only for its optional soundscape backend — do NOT
   install the dead package; shim the type instead. Create `src/types/expo-av.d.ts`:

   ```ts
   // expo-av was removed in Expo SDK 57. @biosyncare/audio-engine lazily imports
   // it only for optional soundscape playback; shim it for typechecking. Port the
   // engine's mobileSoundscape to expo-audio if soundscapes are ever needed.
   declare module 'expo-av';
   ```

   (On SDK ≤ 56 you can install `expo-av` instead if you use soundscapes.)

---

## 4. iOS

Nothing to hand-edit — autolinking does it. Just install pods:

```bash
cd ios && pod install && cd ..
# or, on Expo: npx expo prebuild -p ios && npx pod-install
```

What happens automatically (all from the library's `AudioEngine.podspec` +
`codegenConfig`):

- The provider `NativeCustomNodesModuleProvider` and the whole `cpp/` tree compile
  into the library's pod.
- Codegen generates `AudioApiTurboModulesJSI.h` and registers the module in the app's
  generated `RCTModuleProviders.mm` — **no Xcode project edits, no Podfile hook.**
- The podspec already carries the header paths for `react-native-audio-api`'s
  vendored **FFmpeg** (0.8.x's `StreamerNode`) and the provider already prefers the
  canonical `<ReactCommon/RCTTurboModule.h>` include, which keeps it compatible with
  **Expo's prebuilt React Native** (SDK 57+) — no action needed on either.

> ⚠️ Simulator builds: `react-native-audio-api@0.8.4`'s vendored FFmpeg xcframework
> has no usable **x86_64 simulator** slice. Build for arm64 (Apple Silicon default);
> Intel-Mac simulator builds will fail inside FFmpeg headers.

---

## 5. Android

Confirm New Arch is on:

```properties
# android/gradle.properties
newArchEnabled=true
```

Then build:

```bash
npm run android      # expo run:android, or npx react-native run-android
```

**Everything autolinks — no app-side wiring.** For the curious, the library ships
the complete Android chain (all validated on a real device):

- `android/src/main/AndroidManifest.xml` + `AudioEnginePackage.kt` — satisfies
  RN/Expo autolinking (which requires a `ReactPackage` class) and `SoLoader`-loads
  `libAudioEngine.so`. The package intentionally exposes no Java modules.
- `android/src/main/jni/OnLoad.cpp` — `JNI_OnLoad` registers the C++ Turbo Module
  via `registerCxxModuleToGlobalModuleMap()` (`ReactCommon/CxxTurboModuleUtils.h`),
  the Android counterpart of the iOS codegen `modulesProvider`.
- `android/CMakeLists.txt` — pulls in the RNGP-generated codegen target
  (`react_codegen_AudioApiTurboModules`), RN's `react-native-flags.cmake` +
  `folly-flags.cmake`, prefab target aliases, FFmpeg include path, and the
  cross-link against `react-native-audio-api`'s prebuilt `.so`.
- `android/build.gradle` has **no `buildscript` block** — the consuming app's root
  project provides AGP/Kotlin (required for Gradle 9; a versionless local
  classpath breaks configuration).

> Requires the `react-native-audio-api` patch from step 2 on RN 0.86+, or its
> Android build fails before this library even compiles.

---

## 6. Wire the integration seams (recommended)

The engine was decoupled from any specific app via injection points, each with a
safe default. Call these **once at startup** (e.g. in your root layout / app entry).
All are optional — the engine runs without them, you just lose the corresponding
integration:

```ts
import {
  setEngineErrorReporter,
  setEngineControlBuses,
  setForegroundServiceController,
} from '@biosyncare/audio-engine';

// (a) Route non-fatal errors to your crash reporter (default: swallowed)
import crashlytics from '@react-native-firebase/crashlytics';
setEngineErrorReporter({ recordError: (e) => crashlytics().recordError(e as Error) });

// (b) Let the WEB engine emit voice/session events onto YOUR event buses
//     (default: internal buses nothing is subscribed to). Node's EventEmitter.
import { volumeBus, stopSessionBus } from '@/contexts/eventBuses';
setEngineControlBuses({ volumeBus, stopSessionBus });

// (c) Android only: keep the process alive during backgrounded playback
//     (default: no-op). Provide your foreground-service lease.
import {
  acquireAudioForegroundService,
  releaseAudioForegroundService,
} from '@/audio/audioForegroundServiceLease';
setForegroundServiceController({
  acquire: acquireAudioForegroundService,
  release: releaseAudioForegroundService,
});
```

> Seams (a) and (b) are only needed if you use the higher-level `SessionManager` /
> web engine. The smoke-test button in step 7 needs **none** of them.

---

## 7. Verify — the smoke-test button

Render the bundled button anywhere and tap it on a **real device or dev-client build**
(not the JS-only web preview) with **headphones on**:

```tsx
import { BinauralSmokeTestButton } from '@biosyncare/audio-engine';

export default function DebugScreen() {
  return <BinauralSmokeTestButton />;
}
```

Tapping it:

1. calls `ensureCustomNodesInstalled()` — installs the native JSI node factories,
2. builds a `BinauralNode` at **300 Hz (left) / 306 Hz (right)**,
3. connects it to the speakers and plays for **5 seconds**,
4. **fades out over 2 seconds** (the engine's stop gate), then releases the context.

**Pass:** you hear a steady tone with a ~6 Hz pulsing beat for 5 seconds that ends
in a smooth fade — **no click** — and the button returns to idle with "Done ✓".
**Fail with "factories not installed":** the native module isn't linked — revisit
steps 4/5 and the [Troubleshooting](#troubleshooting) table.

Source: [`src/demo/BinauralSmokeTestButton.tsx`](src/demo/BinauralSmokeTestButton.tsx) —
copy it into your app if you want to customize it. It is also the reference
implementation of the click-free stop pattern below.

---

## Basic usage (beyond the button)

The button is just the minimal version of the standard pattern:

```ts
import { ensureCustomNodesInstalled, BinauralNode } from '@biosyncare/audio-engine';
import { AudioContext } from 'react-native-audio-api';

ensureCustomNodesInstalled();               // once, before creating nodes

const ctx = new AudioContext();
const node = new BinauralNode(
  ctx,
  (global as any).createBinauralNode(ctx.context), // native JSI factory
);
node.fl = 300;          // left frequency (Hz)
node.fr = 306;          // right frequency (Hz)
node.waveformL = 0;     // 0=sine 1=triangle 2=square 3=saw
node.waveformR = 0;
node.volume = 0.4;      // linear 0..1
node.connect(ctx.destination);
node.start();
```

### Stopping without clicks (IMPORTANT)

`node.stop()` does **not** silence the node instantly — it arms the engine's stop
gate, which fades every voice to zero over **2 seconds** (see
`SessionDspEngine::stop`). The node flips `node.isPaused` to `true` once the fade
has reached silence. **Never disconnect the node or close the `AudioContext` in the
same tick as `stop()`** — that cuts the waveform at full amplitude and produces an
audible click on every platform. Do this instead:

```ts
node.stop();                       // begins the 2 s fade on the audio thread

const poll = setInterval(() => {
  if (node.isPaused) {             // fade reached silence — teardown is now safe
    clearInterval(poll);
    node.disconnect();
    ctx.close();
  }
}, 100);
// (add a ~3 s hard timeout around the poll if you want a safety net)
```

The same applies to `pause()` (0.5 s fade). `start()`/`resume()` fade in, so there
is no click on the way in.

For full multi-voice sessions (breathing/Martigli/soundscape) use the `SessionManager`
export instead of driving nodes by hand — it manages these lifecycles for you.

Available node factories (installed as JSI globals by `ensureCustomNodesInstalled`):
`createBinauralNode`, `createMartigliNode`, `createSymmetryNode`,
`createMartigliBinauralNode`, `createNoiseNode`, `createMyOscillatorNode`.

---

## Web / WASM

The shared DSP core is compiled to WASM and shipped prebuilt (base64) in
`src/engine/workletWasm/`. On web, Metro resolves the no-op native stub
(`NativeCustomNodesModule.web.ts`) automatically, and the web engine (`AVSWeb` /
`WebSoundscapePlayer`) runs the same DSP in an AudioWorklet. To rebuild the WASM you
need Emscripten (`em++`): `npm run wasm:build` then `npm run wasm:check`.

Web audio requires a **user gesture** to start (the button's `onPress` satisfies this).

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Button shows "factories not installed" | Native module not linked / not New Arch | Confirm `newArchEnabled=true`; re-run `pod install` / Android build; check the lib appears under `npx expo-modules-autolinking react-native-config --json` (or `npx react-native config`) for BOTH platforms |
| C++ errors in `cpp/*Node.cpp` about `processNode` / const members | `react-native-audio-api` ≥ 0.9 installed | Install `react-native-audio-api@^0.8.4` (see step 1 — the API this library extends changed in 0.9) |
| Android: `react-native-audio-api` fails with `'react/jni/CxxModuleWrapper.h' file not found` | RN 0.86+ deleted that header; rnaa 0.8.4 still includes it | Apply `patches/react-native-audio-api+0.8.4.patch` (step 2) |
| iOS: `expo run:ios` fails in `expo-modules-jsi` — `JavaScriptCodable+Date.swift: type of expression is ambiguous` | Expo SDK 57 + Xcode 26.2 Swift/C++-interop regression (not this library) | Apply `patches/expo-modules-jsi+57.0.3.patch` (step 2) |
| iOS: `'libavformat/avformat.h' file not found` compiling this lib | FFmpeg header path missing (rnaa ≥ 0.8 vendors FFmpeg) | Already handled in `AudioEngine.podspec` / `android/CMakeLists.txt` — if you see it, you're on a stale copy of this library |
| iOS: redefinition errors around `RCTTurboModule.h` | Prebuilt React (Expo SDK 57) duplicates the header | Already handled — the provider imports canonical `<ReactCommon/RCTTurboModule.h>`; stale copy of this library otherwise |
| iOS simulator on Intel / `x86_64`: FFmpeg header errors | rnaa 0.8.4's FFmpeg xcframework has no usable x86_64 sim slice | Build arm64 only (Apple Silicon default) |
| iOS: `'AudioApiTurboModulesJSI.h' file not found` | Codegen didn't run for the lib | Clean `ios/build`, `pod install` again; ensure the app is New-Arch |
| iOS: `worklets/apple/WorkletsModule.h not found` | `react-native-worklets` not installed | Install the peer dep, `pod install` |
| Android: `Could not find com.android.tools.build:gradle:` | A library declares a versionless AGP classpath (Gradle 9 rejects it) | Already handled — this library has no `buildscript` block; check other libs |
| Android config: unresolved `react_codegen_AudioApiTurboModules` | Codegen target not generated / not included | Already handled via `add_subdirectory` in `android/CMakeLists.txt`; ensure New Arch is on and clean `android/.cxx` + `android/build` |
| Android link: `cannot find -lreact-native-audio-api` / missing `.so` | rnaa native libs not built before this lib links | The lib's `build.gradle` sets `evaluationDependsOn(":react-native-audio-api")` + `mergeNativeLibs` ordering; do a clean build (`cd android && ./gradlew clean`) |
| TS: `Cannot find name 'global'` / untyped `events` / `Cannot find module 'expo-av'` | TS 6 auto-include change; expo-av removed in SDK 57 | Step 3 (`@types/node` + `"types": ["node"]` + `expo-av` shim) |
| **Click/pop when the sound ends** | Node disconnected / context closed immediately after `stop()` | `stop()` starts a 2 s fade — wait for `node.isPaused` before `disconnect()`/`close()` (see "Stopping without clicks") |
| No sound but no error | Context suspended / no headphones / volume 0 | Ensure a user gesture triggered playback; the beat needs stereo (headphones); check device volume |

---

## What intentionally stays in your app (not shipped by this library)

- **`audioForegroundServiceLease` + the Android foreground-service native module** —
  app-specific (notification strings/i18n, its own Expo module). Inject it via
  `setForegroundServiceController` (step 6c) if you want backgrounded Android playback.
- **UI label lists** (waveform/noise dropdown options) — presentation, app-side.
- **Your event buses / crash reporter / platform context** — injected via the seams.

## Known gap

- The **worklets/animation bridge** (breath-synced Martigli features,
  `AnimationValueRegistry` fed by the worklets UI runtime) is wired **on iOS only**
  (via `NativeCustomNodesModuleProvider`). Plain binaural/noise/oscillator/symmetry
  nodes are fully functional on Android; breath-synced pan (`panOsc = 3`) degrades
  gracefully there until an Android equivalent of the provider hook is added.

---

## Architecture reference (for maintainers)

- Turbo Module name: `NativeCustomNodesModule` — kept identical to BioSynCare so the
  C++ `#include`s and the generated JSI class need no changes.
- Codegen library: `AudioApiTurboModules` (→ `AudioApiTurboModulesJSI.h`,
  `NativeCustomNodesModuleCxxSpec`).
- iOS provider: `NativeCustomNodesModuleProvider` (mapped in `codegenConfig.ios.modulesProvider`).
- Android registration: `android/src/main/jni/OnLoad.cpp` →
  `registerCxxModuleToGlobalModuleMap` (consulted by `TurboModuleManager`).
- Shared C++ DSP core: `cpp/dsp/shared/` (namespace `bsc::dsp`), also compiled to WASM.
- See [`README.md`](README.md) for the platform-wiring table and current status.
