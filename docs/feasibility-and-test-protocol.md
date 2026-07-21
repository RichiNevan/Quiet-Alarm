# Quiet Alarm — Native Feasibility & Test Protocol

**Goal:** at a user-chosen time T, the phone starts playing the binaural session
**(a) without the screen lighting up, (b) without any user interaction at T, (c) reliably, hours after arming.**

This document records what the platforms actually allow (researched 2026-07-18, sources at the end),
the candidate architectures, and — most importantly — a **spike-first test protocol** that attacks the
riskiest assumptions with throwaway harness code *before* any product code is written.

---

## 1. The contract (testable requirements)

| ID | Requirement | Notes |
|----|-------------|-------|
| R1 | Audio starts within ±5 s of T | wall-clock, after up to 8 h of screen-off idle |
| R2 | Screen stays completely dark at T | no full-screen intent, no notification peek that wakes screen |
| R3 | Zero interaction after arming | user arms alarm, locks phone, sleeps |
| R4 | Audible at a controlled volume | even if user left media volume at 0 / DND on / silent switch on |
| R5 | Survives: screen lock, Doze/idle, app backgrounded | force-stop / force-quit is explicitly out of scope (impossible on both platforms) |
| R6 | Ramp-in is gentle (no click, fade from silence) | engine already guarantees click-free start |

Open product questions (decide before Phase 2, they change the test matrix):
- **Output route:** speaker only, or also Bluetooth sleep headphones? BT adds overnight-disconnect failure modes and needs its own spikes.
- Is a **loud fallback** acceptable if the quiet path fails (screen lights up but at least the user is woken)?

---

## 2. Platform reality

### 2.1 Android — a sanctioned, documented path exists

The full chain is officially supported for alarm-clock apps:

1. **`AlarmManager.setAlarmClock()`** — exact, fires even in Doze/idle.
   Requires an exact-alarm permission; since we *are* an alarm app we can use
   **`USE_EXACT_ALARM`** (granted automatically at install; Play policy restricts it to apps whose
   core function is alarms — that's us). Android 16 keeps this model.
2. Alarm fires → **BroadcastReceiver** → **start a foreground service**.
   Starting an FGS from the background is normally forbidden (Android 12+), but **exact alarms are an
   explicit exemption** — confirmed still true through Android 16.
3. FGS declared with **`foregroundServiceType="mediaPlayback"`** + `FOREGROUND_SERVICE_MEDIA_PLAYBACK`
   permission (mandatory since Android 14). `mediaPlayback` has **no runtime timeout** (unlike
   `dataSync`/`mediaProcessing` which got 6 h caps in Android 15).
4. FGS posts its mandatory notification on an **`IMPORTANCE_LOW` channel** → no sound, no heads-up
   peek; the screen should stay dark (OEM "wake screen on notification" settings must be verified — spike AND-7).
5. Service plays audio with **`AudioAttributes.USAGE_ALARM`** → routes to the alarm stream, which is
   audible under DND by default and has its own volume, independent of media volume (R4). Audio
   playback keeps the CPU awake; we additionally hold a `PARTIAL_WAKE_LOCK` during the ramp.

Known hazards (all covered by spikes):
- **OEM battery managers** (Samsung "put to sleep", Xiaomi etc.) can force-stop apps, which *cancels
  alarms*. Swipe-away from recents is fine on Pixel/Samsung, lethal on some OEMs.
- **Reboot clears alarms** → need a `BOOT_COMPLETED` receiver that *reschedules* (note: Android 15+
  forbids starting a `mediaPlayback` FGS from BOOT_COMPLETED — rescheduling the alarm is fine, that's all we need).
- "Restricted" battery state (user-set) can suppress alarms on some OEMs.

**Key architectural fork:** what plays the audio at T?
- **A-native (recommended to test first):** at *arm time*, the RN app pre-renders the binaural session
  to a WAV/AAC file (binaural = deterministic DSP; rnaa 0.8.4 has no native `OfflineAudioContext`, but a
  plain-TS PCM synth of the two detuned tones + WAV header is trivial); at T a ~150-line Kotlin service
  plays the file with `MediaPlayer` + `USAGE_ALARM` + volume ramp. **No JS, no RN runtime, no audio
  engine needed at alarm time.** Smallest possible failure surface.
- **A-js:** boot React Native headlessly (`HeadlessJsTaskService`) from the FGS and start the real
  engine. Much bigger surface (RN cold-start in background, rnaa init without Activity, ~seconds of
  latency, memory). Only pursue if A-native proves insufficient for the product sound.

### 2.2 iOS — no scheduled-wake API exists; only one viable quiet path

Facts, in order of how they kill naive designs:

- **You cannot wake a suspended/killed app at time T and start audio.** Activating an `AVAudioSession`
  from the background fails (error `561015905` / `!pla`); background audio must be **started in the
  foreground and kept alive**. BGTaskScheduler has no exact timing. Silent pushes are throttled and
  can't reliably start audio either.
- **AlarmKit (iOS 26)** finally gives third-party apps real alarms — but it is by design a
  **full-screen alert** on the Lock Screen (screen lights up). Disqualified for the quiet path;
  useful only as an optional *loud fallback*.
- **Local notifications:** ≤30 s sound, ringer-volume-dependent, silenced by Focus/silent switch, and
  delivery lights the screen. Disqualified.
- **The one viable path: keep-alive audio session.** App runs all night with `UIBackgroundModes:
  audio` and an *active, rendering* session (engine output at gain ≈ 0), then at T the still-running
  JS ramps the gain up. Screen stays dark; playback-category audio ignores the silent switch and
  Focus. This is what sleep-tracking/white-noise apps do.

Why past attempts likely failed — Apple DTS (Kevin Elliott) enumerates the exact suspension causes
for keep-alive audio apps:
1. **Interruption not resumed** (call, Siri, another app takes audio) → session dies silently.
2. **Session stops rendering "for too long"** → system interrupts and suspends the app. (Rendering
   zeros is fine — it's session inactivity, not literal silence, that kills you.)
3. **Memory pressure: keep background footprint < ~100 MB** — a real risk for an RN app; must be measured.
4. Overnight system maintenance / reboot.
5. **Mixable sessions are less protected than non-mixable "Now Playing" sessions** → prefer
   non-mixable `playback` category.

rnaa 0.8.4 ships what we need: `AudioManager.setAudioSessionOptions({ iosCategory: 'playback', … })`,
`setAudioSessionActivity()`, `observeAudioInterruptions()` + an `interruption` system event.

Unavoidable iOS caveats to surface in the product:
- **Force-quit = dead.** No mitigation; UX must tell the user to just lock the phone.
- **System volume cannot be set programmatically** at T (the `MPVolumeView` trick is unreliable from
  the background) → check volume at arm time and refuse/warn if it's too low.
- **App Review risk (guideline 2.5.4):** pure digital silence as keep-alive can be rejected.
  Mitigation that is also a product feature: the night-long session plays a real, very quiet
  **soundscape bed** (user-optional pink noise at low gain) so the background audio is genuinely
  audible content. Decide before submission, irrelevant for spikes.

### 2.3 Consequence

The two platforms need **opposite architectures**:

| | Android | iOS |
|---|---|---|
| Mechanism | OS wakes *us* at T (exact alarm → FGS) | We never sleep (keep-alive audio session) |
| App state at T | Process may be dead — fine | Process must be alive — mandatory |
| Audio at T | Native file playback (A-native) | Running engine ramps gain |
| Main risk | OEM battery killers, screen-wake-on-notification | Overnight suspension (interruptions, memory), battery |

---

## 3. Test protocol

**Prime directive: throwaway harness, not product code.** One hidden dev screen in the existing app +
one small native module per platform. Nothing merges into product architecture until its gate passes.

### 3.0 Instrumentation (build once, both platforms)

- Persistent **on-device log file** (survives process death), one line per event:
  `armed`, `receiver_fired`, `fgs_started`, `playback_started`, `ramp_done`, `interruption_began/ended`,
  plus a **60 s heartbeat** (timestamp + RSS memory on iOS). Timestamps = wall clock, ms.
- Android: `adb logcat` + `adb shell dumpsys alarm | grep quietalarm` to inspect scheduled alarms.
- iOS: Console.app streaming; if a night fails, capture a **sysdiagnose** covering the failure window
  (that's what DTS uses to distinguish suspension vs termination).
- Every run records: device, OS version, battery settings, plugged/unplugged, DND state.

### 3.1 Device matrix

| Device | Why |
|---|---|
| Galaxy S21 Ultra (available, Android build verified) | Samsung One UI battery manager — the realistic hostile case |
| Pixel emulator (API 34/35/36) | Stock behavior, Doze scripting, fast iteration |
| A physical Pixel if obtainable | Emulator can't prove screen-wake/OEM behavior |
| Your iPhone (record model + iOS version) | The keep-alive tests are hardware-only — simulator proves nothing here |

### 3.2 Android spikes — cheapest lethal test first

Harness: Kotlin `AlarmSpikeModule` (`arm(epochMs)` → `setAlarmClock`), `AlarmReceiver`,
`SpikeAudioService` (FGS, `mediaPlayback`, IMPORTANCE_LOW channel, plays a bundled 60 s test WAV via
`MediaPlayer` with `USAGE_ALARM`, 10 s volume ramp). Manifest: `USE_EXACT_ALARM`,
`FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_MEDIA_PLAYBACK`, `RECEIVE_BOOT_COMPLETED`, `WAKE_LOCK`.

| # | Test | Procedure | PASS | If FAIL |
|---|------|-----------|------|---------|
| AND-1 | Cold wake, screen off | Arm T+5 min → power button → phone face-up on desk | Audio ≤5 s of T, screen never lit | Foundation broken — stop, re-research |
| AND-2 | Doze | Arm T+10 min, unplug, screen off, `adb shell dumpsys deviceidle force-idle` (verify with `deviceidle get deep`) | Same as AND-1 | `setAlarmClock` claim false on this OEM → try full-screen-intent-less `setExactAndAllowWhileIdle`, re-test |
| AND-3 | Real overnight | Arm T+7 h, unplugged, normal night | Fires on time; log shows receiver→fgs→playback chain | Inspect which link died via log + `dumpsys alarm` |
| AND-4 | Swipe-away | Arm T+5 min → swipe app from recents → screen off | Alarm still fires (receiver restarts process) | Document; on OEMs where swipe = force-stop, need "don't swipe" UX + dontkillmyapp guidance |
| AND-5 | Restricted battery | Settings → Battery → Restricted for the app; repeat AND-1 | Fires | Detect setting via `ActivityManager.isBackgroundRestricted`, prompt user at arm time |
| AND-6 | Volume/DND matrix | Repeat AND-1 with: media vol 0; DND on; silent mode; alarm vol low → service sets alarm-stream volume to configured level before ramp | Audible in all four | If `setStreamVolume(STREAM_ALARM)` blocked anywhere, fall back to warn-at-arm-time |
| AND-7 | Screen-wake check (Samsung) | AND-1 on S21U with default notification settings; watch screen for *any* lighting at receiver/FGS/notification post | Screen dark throughout | Try: post notification before ramp with `setSilent(true)`; check One UI "screen on for notifications" interactions |
| AND-8 | Reboot | Arm T+30 min → reboot at T-20 → leave locked | With BOOT_COMPLETED rescheduler: fires | Expected to fail *without* the rescheduler — this test validates the rescheduler |

Run AND-1/2/4 on the Pixel emulator too (`adb emu` makes Doze scripting trivial).

**Gate G-A:** AND-1…AND-7 pass on S21U (AND-8 with rescheduler) → Android foundation proven, A-native
architecture confirmed. Estimated effort: 1 day harness + 2 nights of runs.

### 3.3 iOS spikes — existential ones are the overnight runs

Harness: dev screen button "arm spike" → engine starts with master gain 0 (session: non-mixable
`playback`), JS `setTimeout`-till-T + audio-clock cross-check, heartbeat logger with `task_info`
RSS memory. `UIBackgroundModes: audio` added to Info.plist.

| # | Test | Procedure | PASS | If FAIL |
|---|------|-----------|------|---------|
| IOS-1 | Lock survival, 30 min | Arm T+30 min → lock phone → desk | Ramp audible at T, screen dark, timer drift <2 s | Session config wrong — fix before anything else |
| IOS-2 | Overnight ×3 nights | Arm T+7 h, unplugged, normal night. Record heartbeat gaps + peak RSS | 3/3 nights fire; no heartbeat gap >90 s; RSS < 100 MB all night | Read the log: gap after `interruption_began` → IOS-3 work; OOM/jetsam → memory diet or product pivot; silent suspension → sysdiagnose → DTS-style analysis |
| IOS-3 | Interruption gauntlet | While armed+locked: receive a phone call (decline + let ring out), trigger Siri, play 10 s of Spotify from watch/other device, Clock-app timer fires | After each: `interruption ended` handled, session reactivated, heartbeats resume, final ramp still fires | Build explicit resume logic on rnaa `interruption` event (retry loop on `setAudioSessionActivity(true)`); re-run |
| IOS-4 | Battery cost | Compare overnight % drain: harness night vs control night, same conditions | Drain delta acceptable (target <10 %/8 h) | Reduce render load (smaller graph while idling), or require charging overnight (product decision) |
| IOS-5 | Volume preconditions | At arm time read `AVAudioSession.outputVolume`; lock; verify ramp loudness matches expectation; try volume change from bg via MPVolumeView once, expect flaky | Warn-at-arm-time flow is sufficient | Accept: iOS volume is a UX guardrail, not a runtime control |
| IOS-6 | Now Playing vs mixable | Repeat IOS-2 once with mixable option set | Confirms DTS claim that non-mixable survives better | Informs final session config |
| IOS-7 | (optional) AlarmKit fallback | Schedule AlarmKit alarm as backup; observe: screen lights, full-screen UI | Documents fallback UX honestly | — |

**Gate G-I:** IOS-1 + 3/3 IOS-2 nights + IOS-3 pass → iOS quiet path proven. If IOS-2 cannot be made
to pass after interruption-handling + memory work, the honest outcomes are: (a) iOS ships with
AlarmKit loud-fallback only, (b) "plugged-in + don't force-quit" requirements, or (c) iOS drops to
best-effort. **That decision is made on spike data, not after building the product.**
Estimated effort: 1 day harness + ~4–5 nights of runs (calendar time, not work time).

### 3.4 Order of execution

1. Instrumentation + Android harness → AND-1 (this alone falsifies/validates the core Android claim in ~1 hour).
2. iOS harness → IOS-1 same day.
3. Nightly: alternate AND-3 / IOS-2 runs (both phones can run in parallel if available).
4. Daytime while nights accumulate: AND-2/4/5/6/7, IOS-3/5.
5. Gates G-A / G-I → architecture write-up → only then product build.

---

## 4. Harness — how to run (built 2026-07-18)

> **⚠️ This project uses CNG: `android/` and `ios/` are gitignored and regenerated by
> `expo prebuild` (which the Makefile's `ioss`/`iosss`/`prebuild*` targets run). Never put code or
> config there — it will be silently deleted.** Native code lives in `modules/alarm-engine/`
> (a local Expo module, autolinked, survives prebuild — renamed from `modules/spike-alarm/` once
> it became the production alarm engine, see §5); Info.plist keys live in `app.json`
> (`ios.infoPlist`); Android permissions/components live in the module's own AndroidManifest.xml
> (merged into the app manifest at build time).

The harness lives behind the **"Open alarm spike harness →"** link on the app's home screen
(route `src/app/spike.tsx`). All events land in a persistent `spike-log.txt` (app documents/files
dir) viewable in-app via **Refresh log**, or via
`adb shell run-as com.richinevan.quietalarm cat files/spike-log.txt`.

**Android** (`modules/alarm-engine/` — Expo module class, receiver, FGS, bundled WAV):
- Build/install: `npx expo run:android` (Metro on 8082 if 8081 busy: `npx expo start --port 8082`
  + `adb reverse tcp:8081 tcp:8082`).
- The spike plays a bundled 30 s loop-clean 200/206 Hz WAV (`res/raw/spike_alarm.wav`) on the
  **alarm stream** with a 10 s ramp, auto-stops after 2 min. No JS runs at alarm time.
- AND-1: arm **+2 min** → power button → wait. Log must show
  `armed → receiver_fired (delta_ms small, screen_interactive=false) → fgs_started → playback_started → ramp_done`.
- AND-2 (Doze): arm **+10 min**, unplug, screen off, then:
  `adb shell dumpsys deviceidle force-idle` (confirm: `adb shell dumpsys deviceidle get deep` → IDLE).
- AND-4: arm, swipe app from recents, screen off.
- Grant notifications when prompted (or `adb shell pm grant com.richinevan.quietalarm android.permission.POST_NOTIFICATIONS`).

**iOS** (all in `spike.tsx`; `UIBackgroundModes: audio` added to Info.plist):
- Build/install: `npx expo run:ios --device` (arm64 device only — simulator invalid for these tests).
- Arm (+30 min for IOS-1, +8 h for IOS-2) → **lock the phone**, do not force-quit. The engine idles
  at volume 0 with a non-mixable `playback` session; at T the JS ramps to 0.35 over 30 s.
- A `hb` log line is written every 60 s. **A gap > 90 s = suspension** — that's the data we're after.
  `interruption_began/ended` lines mark calls/Siri/other-audio events (IOS-3).
- Memory (DTS: stay < 100 MB): Xcode → Debug Navigator while attached, or Instruments; record the
  overnight peak alongside the log.

## 5. Production build (2026-07-20): real presets, multi-alarm UI

The spike harness proved the wake mechanism; this phase wires in the real audio (the
`audioPresets/*.json` catalog) and the actual user-facing Alarms screen (black/amber theme, time
picker, weekday repeat, one or more alarms). `modules/spike-alarm/` was renamed to
`modules/alarm-engine/` and generalized to multi-alarm; `src/app/spike.tsx` stays as a
"Diagnostics" link on the home screen for re-running AND-1..7/IOS-1..3 against a single throwaway
test alarm.

**The two platforms still diverge in the same way as §2 predicted**, which shapes the whole design:

- **Android** keeps every enabled alarm armed simultaneously via `AlarmManager.setAlarmClock`
  (`src/lib/alarms/androidScheduler.ts` reconciles the full list against native state on every
  change). Repeating alarms reschedule themselves natively — `AlarmReceiver.kt` recomputes the next
  matching weekday and re-arms itself in Kotlin, with **no JS involved**, exactly as required by
  R3/R5. `AlarmAudioService.kt` now takes an optional `audioUri` extra and falls back to the bundled
  tone if it's null, missing, or fails to load — a broken render must never mean a silent alarm.
- **iOS** still has no quiet system-alarm API, so `src/lib/alarms/iosEngine.ts` generalizes the
  keep-alive trick: it arms only the single *soonest* enabled alarm (loads the real preset via
  `SessionManager`, starts it at `masterVolume 0` immediately), and re-arms the next one the moment
  the current one finishes. **This means only one alarm can be "live" at a time, and the app must
  stay running (foregrounded or locked, never force-quit) for any of it to work** — inherent to the
  platform, not a bug.

**New engineering that has NOT been verified on a device yet** (the spike rigor should carry over
to these before trusting them for a real night's sleep):

- **AND-8 — offline preset render.** Android has no JS at alarm-fire time, so real preset audio has
  to be pre-rendered while the app is foregrounded and cached, then played by the same native
  MediaPlayer path as the spike. `src/lib/alarms/renderPresetAndroid.ts` does this via
  `react-native-audio-api`'s `OfflineAudioContext` + a new `SessionManager.renderOffline()`
  (`audio-engine/src/engine/SessionManager.js` — constructor now accepts `{ context }` so an offline
  context can stand in for the live one). **Untested: whether the custom JSI nodes (BinauralNode
  etc.), only ever validated against a live `AudioContext`, render correctly through an
  `OfflineAudioContext`.** The render is wrapped in try/catch and any failure falls back to the
  bundled tone (never a crash, never silence) — but "doesn't crash" isn't "sounds right"; the first
  real-preset test should include *listening to the rendered file*, not just checking that a WAV
  landed on disk. Trigger it manually: set an alarm, then `adb shell run-as
  com.richinevan.quietalarm ls -la files_dir_wrong` — actually simplest is pulling
  `alarm-render-<presetId>.wav` from `Paths.document` via a file-browser/dev tool, or temporarily
  logging its byte size (already logged) and eyeballing it's non-trivially small (silence would
  still produce a full-size file, so size alone doesn't prove audio content — actually listen to it).
- **AND-9 — repeat rescheduling.** `AlarmScheduling.computeNextOccurrenceMillis` in Kotlin needs to
  independently produce the same answer as `computeNextOccurrence` in
  `src/lib/alarms/nextOccurrence.ts` (both use the JS `Date#getDay()` weekday convention, 0=Sunday).
  Verify by arming a repeating alarm and confirming it fires again on the next matching day without
  the app having been opened in between.
- **IOS-4 — live real-preset playback.** The keep-alive mechanism itself was validated (IOS-1/2),
  but always with the raw `BinauralNode` smoke-test tone. Confirm the same holds with a full
  `SessionManager.loadPreset()` graph (more voices, more CPU per callback) running silently for
  hours, and that `setMasterVolume()` ramps smoothly rather than zippering/clicking.
- **Reboot persistence is explicitly out of scope for this pass.** Android's exact alarms are
  cleared on device reboot; nothing currently re-arms them until the app is opened again. Fine for
  the common case (phone rarely reboots between "set the alarm" and "it fires") but a real gap —
  flagging it rather than silently leaving it unhandled.

### 5.1 Session duration (2026-07-21)

Each alarm now has a configurable `durationSeconds` (60s–1h, picked via a wheel — see
`src/components/alarms/TimeWheelPicker.tsx`). **Android does not re-render at the chosen
length** — the offline render stays a fixed 30s loop-clean clip, and the native `MediaPlayer`
(already looping) just plays it for however long was configured. Rendering the full duration would
mean multi-hundred-MB cached WAVs for long sessions. Trade-off: a preset with slow modulation may
have an audible seam every 30s when looped for a long session — untested, add to the AND-8 listen
check above. iOS has no such seam (the live engine just runs for the real duration, no looping).

## 6. Sources

- Android exact alarms: https://developer.android.com/develop/background-work/services/alarms and Android 14 default-denial changes: https://developer.android.com/about/versions/14/changes/schedule-exact-alarms
- FGS background-start exemptions (exact-alarm exemption): https://developer.android.com/develop/background-work/services/fgs/restrictions-bg-start
- FGS types & Android 14 requirements: https://developer.android.com/develop/background-work/services/fgs/service-types , https://developer.android.com/about/versions/14/changes/fgs-types-required
- Android 15/16 behavior changes (BOOT_COMPLETED FGS limits, SAW exemption narrowing): https://developer.android.com/about/versions/15/behavior-changes-15 , https://developer.android.com/about/versions/16/behavior-changes-all
- AlarmKit (iOS 26): https://developer.apple.com/documentation/AlarmKit , WWDC25 session: https://developer.apple.com/videos/play/wwdc2025/230/ , https://www.macrumors.com/2025/06/11/ios-26-third-party-alarm-apps/
- Apple DTS on keep-alive audio suspension causes (memory <100 MB, interruptions, Now-Playing resilience): https://developer.apple.com/forums/thread/764096
- Background AVAudioSession activation failures (`561015905`): https://developer.apple.com/forums/thread/134082
- react-native-audio-api system/session APIs: https://docs.swmansion.com/react-native-audio-api/docs/system/audio-manager/ (API surface verified against installed 0.8.4 sources)
