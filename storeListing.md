# Store Listing — English (en-US)

App name: **Quiet Alarm**

---

## Android (Google Play)

### Short description (max 80 characters)

```
Binaural-beat alarm: wake up gradually. No jarring sound, no lit screen.
```
Character count: 72/80

### Full description (max 4000 characters)

```
Wake up without the shock.

Quiet Alarm is a different kind of alarm clock. Instead of a jarring ring and a screen that blasts light into your face at 6 AM, it wakes you with a soft audio session that fades in gently — while your phone screen stays completely dark and silent-switch-friendly settings are respected. No jump-scare wake-ups. No fumbling for a bright phone in the dark.

HOW IT WORKS

Set your alarm time like normal. At the moment you need to wake up, Quiet Alarm quietly starts an audio session and ramps the volume up smoothly over time, easing you out of sleep instead of yanking you out of it. The screen never lights up during the wake sequence — the whole experience is designed to be heard, not seen.

BUILT ON BINAURAL BEATS

Every Quiet Alarm session is built on binaural beats — two slightly different tones, one for each ear, that create a subtle third rhythm your brain perceives when you listen with headphones or stereo speakers. Different sessions use different frequency ranges for different goals:

• Morning Ignition — faster-pulsed tones designed to help you wake up gradually and arrive alert, easing you into an activated state instead of jolting you awake.
• Transcend (Lucid Dreaming) — slow, low (theta-range) binaural tones associated with deeper sleep, designed to support wake-back-to-bed practice and lucid dreaming.

More sessions are on the way, each built from carefully tuned binaural tones and pacing rather than a stock alarm sound.

Binaural-beat research is an evolving field and individual results vary — Quiet Alarm's sessions are designed to help support deeper sleep, dream awareness, and a gradual wake-up; they're not medical devices and don't guarantee a specific outcome.

DESIGNED FOR REAL NIGHTS

• Multiple alarms — set as many as you need, each with its own audio session.
• Repeat on chosen weekdays, or set a one-off alarm.
• Adjustable session length, so the wake-up unfolds at the pace that suits you.
• Reliable timing — alarms are scheduled using your device's native alarm system, so they still fire even if the phone has been idle for hours.
• Alarm-volume audio, so it can still be heard even if your media volume is low — check your device's alarm volume before you rely on it overnight.

A CALMER RELATIONSHIP WITH MORNINGS

Bright screens and abrasive alarm tones spike your heart rate and can leave you groggy. Quiet Alarm's ramping audio and dark screen are built around a simpler idea: waking up doesn't have to feel like an emergency.

POWERED BY THE BIOSYNCARE AUDIO ENGINE

Quiet Alarm's binaural sessions run on the BioSynCare audio engine, the same custom DSP engine that powers the BioSynCare app. Quiet Alarm is part of the BioSynCare ecosystem — if you enjoy these sessions, check out BioSynCare for a wider library of binaural-beat audio journeys.

Quiet Alarm does not record audio. A microphone permission may appear in your device's permission list because it is required by an underlying audio library dependency — Quiet Alarm never accesses your microphone.
```
Character count: 3049/4000

---

## iOS (App Store)

### Promotional text (max 170 characters)

```
New: Transcend, a binaural-beat lucid-dreaming session for wake-back-to-bed practice. Wake gradually with a gentle audio fade — no jarring alarm, no lit screen.
```
Character count: 160/170

### App description (max 4000 characters)

```
Wake up without the shock.

Quiet Alarm is a different kind of alarm clock. Instead of a jarring ring and a screen that blasts light into your face first thing in the morning, it wakes you with a soft audio session that fades in gently, while your screen stays completely dark.

HOW IT WORKS

Set your alarm time like normal, lock your phone, and go to sleep. At your chosen time, Quiet Alarm quietly begins an audio session and ramps the volume up smoothly, easing you out of sleep instead of yanking you out of it. The screen never lights up during the wake sequence — the experience is designed to be heard, not seen.

To make this possible, Quiet Alarm keeps a low-level audio session running in the background once an alarm is armed. Please don't force-quit the app after setting an alarm, or it won't be able to wake you.

BUILT ON BINAURAL BEATS

Every Quiet Alarm session is built on binaural beats — two slightly different tones, one for each ear, that create a subtle third rhythm your brain perceives when you listen with headphones or stereo speakers. Different sessions use different frequency ranges for different goals:

• Morning Ignition — faster-pulsed tones designed to help you wake up gradually and arrive alert, easing you into an activated state instead of jolting you awake.
• Transcend (Lucid Dreaming) — slow, low (theta-range) binaural tones associated with deeper sleep, designed to support wake-back-to-bed practice and lucid dreaming.

More sessions are on the way, each built from carefully tuned binaural tones and pacing rather than a stock alarm sound.

Binaural-beat research is an evolving field and individual results vary — Quiet Alarm's sessions are designed to help support deeper sleep, dream awareness, and a gradual wake-up; they're not medical devices and don't guarantee a specific outcome.

DESIGNED FOR REAL NIGHTS

• Multiple alarms — set as many as you need, each with its own audio session.
• Repeat on chosen weekdays, or set a one-off alarm.
• Adjustable session length, so the wake-up unfolds at the pace that suits you.
• Plays through your device's audio output even with the silent switch on or Focus enabled, so it can still wake you.

A CALMER RELATIONSHIP WITH MORNINGS

Bright screens and abrasive alarm tones spike your heart rate and can leave you groggy. Quiet Alarm's ramping audio and dark screen are built around a simpler idea: waking up doesn't have to feel like an emergency.

POWERED BY THE BIOSYNCARE AUDIO ENGINE

Quiet Alarm's binaural sessions run on the BioSynCare audio engine, the same custom DSP engine that powers the BioSynCare app. Quiet Alarm is part of the BioSynCare ecosystem — if you enjoy these sessions, check out BioSynCare for a wider library of binaural-beat audio journeys.

A NOTE ON RELIABILITY

Quiet Alarm needs to keep running in the background to wake you — please don't force-quit it after arming an alarm, and check your device volume before an important wake-up. Quiet Alarm does not record audio; the microphone permission exists only because it is required by an underlying audio library and is never used.
```
Character count: 3109/4000

### Keywords (max 100 characters)

```
alarm,binaural beats,deep sleep,lucid dreaming,gentle wake,soundscape,silent alarm,relax
```
Character count: 88/100

---

## Notes for whoever fills in the store consoles

- **Health/wellness claims:** Per your request, both full descriptions now explicitly name binaural beats and their intended effects (deeper sleep, dream awareness/lucid dreaming, gradual wake-up). I kept the framing as "designed to help support" / "associated with" rather than flat guarantees ("will improve your sleep," "will give you lucid dreams"), and kept one hedge line ("results vary... not medical devices... don't guarantee a specific outcome") — this is still a real risk area: `audioPresets/lucidDreaming.json`'s own `evidenceNotes` field explicitly disclaims lucid-dream induction, dream recall, dream control, or medical benefit, and both Apple (guideline 2.5.4 / health claims scrutiny) and Google (Health Content & Services policy) can reject or demand substantiation for sleep/dream efficacy claims. If either store pushes back, the hedge sentence is the first thing reviewers will want strengthened further, not removed.
- **iOS force-quit caveat:** Called out explicitly in the description because the alarm mechanically depends on the app staying alive in the background (see the alarm-engine-architecture memory / `docs/feasibility-and-test-protocol.md`). This is an honest reliability disclosure, not filler — cutting it risks 1-star reviews from users who force-quit and miss an alarm.
- **Android reliability caveat:** Android's exact-alarm path is more robust (OS-level wake), so no force-quit warning was added there — only a note to check alarm volume, since the alarm-stream volume is what actually plays.
- **Microphone permission line:** Mirrors the existing `NSMicrophoneUsageDescription` in `app.json` — included so users aren't surprised by the permission prompt/App Privacy label.
- **Preset names:** Pulled verbatim from `audioPresets/morningActivation.json` ("Perform - Morning Ignition") and `audioPresets/lucidDreaming.json` ("Transcend - Lucid Dreaming"), simplified for marketing copy. Update this file if presets are renamed or added.
- **BioSynCare mention:** Both full descriptions now credit the BioSynCare audio engine and cross-promote the BioSynCare app, matching the existing in-app messaging in `src/components/BioSynCarePromo.tsx` ("This app is part of the BioSynCare ecosystem, and uses its audio engine") and the engine's own identity as `@biosyncare/audio-engine` (`audio-engine/README.md`). Not added to the short description, promotional text, or keywords — those are too space-constrained and BioSynCare isn't a searched term, so it would waste limited characters there.
- **Binaural beats:** Added to short description, promo text, full descriptions, and iOS keywords, consistent with the actual DSP (`audioPresets/lucidDreaming.json` header describes an explicit binaural layer). Description text notes it requires headphones or stereo speakers to be perceived as intended, since binaural beats rely on each ear receiving a different tone — worth confirming that's still accurate before publishing (e.g. if Android's offline-render/looping path or mono speaker fallback changes how the effect comes through).
- All character counts above were measured directly from the copy (Python `len()`, including internal newlines/bullets) and are all within limit. Re-verify in the actual Play Console / App Store Connect fields before submitting in case their counters handle whitespace differently.
