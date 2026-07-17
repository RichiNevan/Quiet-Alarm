# @biosyncare/audio-engine

The BioSynCare custom audio DSP engine, extracted from the app into a standalone
**React Native New-Architecture C++ Turbo Module** so any app can install it as a
dependency and let autolinking + codegen do the native wiring.

> **Integrating this into an app? Follow [INTEGRATION.md](INTEGRATION.md).** It ends
> with a drop-in `<BinauralSmokeTestButton />` that plays 300/306 Hz for 5 seconds
> (then fades out click-free) to prove the native chain is wired end-to-end.

- **Native module:** `NativeCustomNodesModule` (codegen library `AudioApiTurboModules`).
  Its single JS method `injectCustomProcessorInstaller()` installs JSI global
  factories — `createMartigliNode`, `createBinauralNode`, `createSymmetryNode`,
  `createMartigliBinauralNode`, `createNoiseNode`, `createMyOscillatorNode` — plus
  breathing/animation accessors, on top of `react-native-audio-api`.
- **Shared DSP core** (`cpp/dsp/shared/`) is platform-agnostic and also compiles
  to WASM for the web AudioWorklet.

## Requirements (the consuming app must have)

- Expo SDK 54+ (CNG/prebuild or committed `ios/` + `android/`), or bare React
  Native 0.81+. Validated on Expo SDK 57 / RN 0.86.
- **New Architecture ON** (`newArchEnabled=true` on Android; iOS default).
- Peer deps installed: `react-native-audio-api` **0.8.x only** (the engine this
  extends — 0.9+ changed the C++ `processNode` API and will not compile; enforced
  via the peer range `>=0.7.0 <0.9.0`), `react-native-worklets`,
  `react-native-reanimated`.
- The bundled `react-native-audio-api` build patch applied via `patch-package`
  (**ships in this package's [`patches/`](patches/)** — required on RN 0.86+; see
  INTEGRATION.md step 2).

## Install

```jsonc
// package.json
"dependencies": {
  "@biosyncare/audio-engine": "file:../audio-engine",   // or a git URL
  "react-native-audio-api": "^0.8.4",   // MUST stay < 0.9 (C++ API break)
  "react-native-worklets": "^0.5.0",
  "react-native-reanimated": "^4.0.0"
}
```

```bash
npm install
npx pod-install          # iOS
npm run ios / npm run android
```

Autolinking picks up `AudioEngine.podspec` (iOS) and `android/build.gradle`
(Android); codegen reads this package's `codegenConfig`. **No app-side changes to
the Xcode project, Podfile, `OnLoad.cpp`, or the app's `codegenConfig` are needed** —
that hand-wiring lived in BioSynCare and is fully replaced by this package.

## Usage

```ts
import { injectCustomProcessorInstaller } from '@biosyncare/audio-engine';
import { AudioContext } from 'react-native-audio-api';

injectCustomProcessorInstaller();          // once, at session start
const ctx = new AudioContext();
const node = (global as any).createBinauralNode(ctx, /* ...config */);
```

## How each platform is wired (vs. the old in-app approach)

| Concern | Old (in BioSynCare) | Now (this package) |
| --- | --- | --- |
| iOS provider + C++ compile | `plugins/withNativeCustomNodesIos.js` patched the Xcode project | `AudioEngine.podspec` compiles `ios/` + `cpp/` |
| iOS header paths / c++20 | Podfile `post_install` hook | podspec `pod_target_xcconfig` |
| iOS module registration | app `codegenConfig.ios.modulesProvider` | this package's `codegenConfig` (aggregated by RN) |
| Android build + `.so` link | app `jni/CMakeLists.txt` + `build.gradle` task-ordering | `android/CMakeLists.txt` + `android/build.gradle` |
| Android registration | hand-edited `jni/OnLoad.cpp` | this package's `android/src/main/jni/OnLoad.cpp` → `registerCxxModuleToGlobalModuleMap` (+ `AudioEnginePackage.kt` loads the `.so` and satisfies autolinking) |

## Web / WASM

The shared DSP core compiles to WASM (`cpp/dsp/wasm/WorkletWasmExports.cpp`) and
is shipped prebuilt as base64 in `src/web/workletWasm/`. Rebuild with
`npm run wasm:build` and verify with `npm run wasm:check`. Metro resolves
`src/specs/NativeCustomNodesModule.web.ts` (a no-op stub) on web automatically.

## Development / verification

- `npm run test:dsp` — compiles + runs the shared DSP C++ unit tests standalone (no RN needed). **Verified passing.**
- `npm run wasm:check` — verifies the embedded WASM matches the C++ source.
- iOS/Android device builds — validated by installing into a host app (see below).

## Integration seams (host app wires these once at startup)

The JS engine was decoupled from BioSynCare via four injection points with safe
no-op/standalone defaults. In the host app, call these once (e.g. at session init):

```ts
import {
  setEngineErrorReporter,
  setEngineControlBuses,
  setForegroundServiceController,
} from '@biosyncare/audio-engine';
import { crashlytics } from '@/firebase/firebaseConfig';
import { volumeBus, stopSessionBus } from '@/contexts/eventBuses';
import {
  acquireAudioForegroundService,
  releaseAudioForegroundService,
} from '@/audio/audioForegroundServiceLease';

setEngineErrorReporter(crashlytics);                       // else errors are swallowed
setEngineControlBuses({ volumeBus, stopSessionBus });      // web engine -> app events
setForegroundServiceController({                           // Android background playback
  acquire: acquireAudioForegroundService,
  release: releaseAudioForegroundService,
});
```

Platform detection uses a local `Platform.OS` shim (no app dependency).
`audioForegroundServiceLease.ts` (i18n + the Android FGS native module) and
`auxData.js` (UI dropdown labels) intentionally **stay app-side**.

## Status

- [x] `cpp/` tree, iOS provider, JS spec, WASM assets, build scripts moved in.
- [x] `codegenConfig`, podspec, Android gradle/CMake, `react-native.config.js` authored.
- [x] Shared DSP core compiles + passes from this package.
- [x] **Phase B done** — JS engine layer moved into `src/engine/` (18 files):
  `ensureCustomNodesInstalled`, node wrappers (`types.ts`), `SessionManager`, and the
  full web AudioWorklet engine (`webAVS` / `webAudioShared` / `webSoundscape` / …).
  All app imports untangled to relative paths + the 4 injection seams above; verified
  every relative import resolves and no `@/` alias imports remain.
- [x] **Android device build + runtime** — validated end-to-end on a physical
  device (Galaxy S21 Ultra, RN 0.86/Gradle 9): autolinking detection
  (`AudioEnginePackage.kt` + manifest), C++ module registration
  (`android/src/main/jni/OnLoad.cpp` → `registerCxxModuleToGlobalModuleMap`),
  codegen target inclusion + RN cmake flags/aliases (`android/CMakeLists.txt`),
  the rnaa `.so` cross-link, and audible binaural playback with fade-out.
- [ ] **Phase C** — migrate BioSynCare to consume this package and verify full parity,
  then delete the now-dead in-app wiring (the config plugin, Podfile hook,
  `OnLoad.cpp` edit, app `codegenConfig`, and the moved `cpp/`/`specs/`/provider) and
  repoint app imports (`@/audio/*`, `@/specs/*`) to `@biosyncare/audio-engine`.
