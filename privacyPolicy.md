# Privacy Policy — Quiet Alarm

**Effective date:** 23 July 2026
**Last updated:** 23 July 2026

Quiet Alarm ("the App") is developed and published by **Riccardo Berti** ("we", "us", the "Developer"), an individual developer based in Italy. This policy explains what happens to your information when you use the App.

The short version: **Quiet Alarm has no accounts, no servers, and no analytics. Everything you create in the App stays on your device.** We do not collect, receive, store, or transmit any personal data about you.

---

## 1. Data controller and contact

For the purposes of the EU General Data Protection Regulation (Regulation (EU) 2016/679, "GDPR"), the data controller is:

**Riccardo Berti**
Email: **gor.na.rik@gmail.com**

Because the App does not transmit any data to us, we hold no personal data about you and are unable to identify you from your use of the App. You can still contact us at the address above with any question about this policy.

---

## 2. What the App stores on your device

The App stores the following information locally, in its own private storage area on your phone:

| What | Why | Where |
| --- | --- | --- |
| Your alarms — time (hour and minute), repeat weekdays, chosen audio session, session length, on/off state, optional label, creation timestamp | So your alarms persist between app launches and can be scheduled | `alarms.json` in the App's private documents directory |
| A local diagnostic log of alarm events (timestamps and short technical event names, e.g. that an alarm was scheduled or fired) | To help diagnose alarm reliability problems on your own device | `alarm-log.txt` in the App's private documents directory |
| On Android: pre-rendered audio files generated from the built-in sessions | So the alarm can play reliably at the scheduled time without running the audio engine live | Audio files in the App's private storage |
| Scheduled alarm entries registered with your operating system's alarm/notification system | So the alarm fires at the right time | Managed by Android/iOS on your device |

**None of this leaves your device.** There is no cloud sync, no account, no backup service operated by us, and no server that receives this information.

This data is not used to identify you. It is stored on the device solely to make the App work, and — under the GDPR — it is processed locally by you as the user of your own device rather than transmitted to us for processing.

---

## 3. What we do NOT collect

We want to be specific, because "we don't collect data" is a claim that deserves detail. Quiet Alarm contains:

- **No user accounts, sign-up, login, or email collection.**
- **No analytics or telemetry SDKs** — no Google Analytics, Firebase, Amplitude, Mixpanel, Segment, PostHog or equivalent.
- **No advertising SDKs, ad identifiers, or advertising profiling.**
- **No crash-reporting SDK** operated by us (e.g. no Sentry, Crashlytics, Bugsnag).
- **No location collection** of any kind — the App does not request or use location permissions.
- **No contacts, photos, calendar, or health data access.**
- **No device or advertising identifiers** collected, read, or transmitted by us (no IDFA, no Android Advertising ID).
- **No tracking across apps or websites**, and no data sold or shared with data brokers.
- **No audio recording.** See section 4.

The App does not make network requests to any server operated by us, because no such server exists.

---

## 4. Microphone permission — declared but never used

On iOS you may see a microphone entry associated with the App, and your device may show a microphone-related permission description.

**Quiet Alarm never records, listens to, accesses, or transmits audio from your microphone.** The permission declaration exists only because it is required by a third-party audio library the App depends on (`react-native-audio-api`), which bundles microphone-capable functionality that Quiet Alarm does not use. No recording feature exists anywhere in the App, and no audio input is captured, stored, or sent anywhere.

---

## 5. Network access

The Android version of the App declares the standard `INTERNET` permission, which is included by default by the application framework the App is built on (React Native / Expo). The App itself makes no network requests to send or retrieve your data, and over-the-air updates are disabled.

The only situation in which the App causes network activity is when **you tap the BioSynCare promotional card**, which opens the Apple App Store or Google Play listing for the BioSynCare app in your device's store or browser. That request is made by your store or browser app, not by Quiet Alarm, and is subject to Apple's or Google's own privacy policies. Quiet Alarm sends no information about you along with it.

---

## 6. Third parties

Because the App transmits nothing, there are no third-party recipients of your data from us. However, two independent relationships are worth naming:

**Apple and Google.** You obtain the App from the Apple App Store or Google Play. Those platforms collect their own data about downloads, purchases, and (where you have opted in) crash diagnostics, under their own privacy policies:
- Apple: https://www.apple.com/legal/privacy/
- Google: https://policies.google.com/privacy

Apple and Google may share aggregated, non-identifying statistics with us as the developer (for example, download counts, or anonymised crash logs where you have opted in to sharing diagnostics with developers). We do not receive information that identifies you personally, and we do not attempt to re-identify anyone from this data.

**BioSynCare.** Quiet Alarm uses the BioSynCare audio engine and links to the BioSynCare app. The engine runs entirely on your device and sends nothing anywhere. If you choose to install and use the separate BioSynCare app, that app is covered by its own privacy policy, not this one.

---

## 7. Device backups

If you have enabled iCloud Backup (iOS) or Google backup (Android), your operating system may include the App's local files — including your alarms — in your own device backup. Those backups are held in **your** Apple or Google account, under Apple's or Google's terms, and are not accessible to us. You can control this in your device's backup settings.

---

## 8. Data retention and deletion

Your data lives on your device for as long as you keep it there. You are in full control:

- **Delete individual alarms** inside the App at any time.
- **Clear the App's data** through your device's app settings (Android), which erases its local files.
- **Uninstall the App** — this removes all of its locally stored data, including alarms, the diagnostic log, and any pre-rendered audio files.

Because we never receive your data, there is nothing for us to delete on our side, and no deletion request needs to be sent to us.

---

## 9. Your rights under the GDPR

If you are in the European Economic Area or the United Kingdom, you have rights of access, rectification, erasure, restriction, portability, and objection in relation to personal data a controller holds about you.

In the case of Quiet Alarm, **we hold no personal data about you at all**, so in practice these rights are exercised directly on your own device: you can view, correct, export (the files are plain JSON and text), and delete everything the App stores, at any time, without involving us. We cannot access, retrieve, or delete data on your device on your behalf.

You always retain the right to lodge a complaint with a supervisory authority. In Italy this is the Garante per la protezione dei dati personali (https://www.garanteprivacy.it/). If you are elsewhere in the EEA, you may complain to your local authority.

---

## 10. Children

Quiet Alarm is not directed at children under 13, and the App is intended for users aged 13 and over. We do not knowingly collect personal data from anyone, including children. Since the App collects no data whatsoever, no children's personal data can be collected through it.

---

## 11. Legal basis for processing

To the extent that storing alarm settings on your device constitutes processing for which we are responsible under the GDPR, the legal basis is **performance of a contract** (Article 6(1)(b)) — the data is strictly necessary to provide the alarm functionality you asked for. We do not process any data on the basis of consent for marketing, profiling, or advertising, because we perform none of those activities.

---

## 12. International transfers

None. No data is transferred anywhere, because no data leaves your device.

---

## 13. Security

Your alarm data is stored in the App's private, sandboxed storage area, which the operating system protects from access by other apps. The strongest protection here is structural rather than technical: there is no server to breach, no database to leak, and no account credentials to steal, because none of these exist.

Please note that if your device itself is unlocked, lost, or compromised, data stored on it — including the App's — may be accessible to whoever has the device. Using your device's passcode, biometric lock, and encryption is the most effective protection.

---

## 14. If this ever changes

If we add features in the future that would change any of the above — for example paid sessions, cloud sync, or any form of analytics — we will update this policy, change the "Last updated" date, and describe the change clearly in the App or its store listing before or when the feature ships. We will not silently begin collecting data under an unchanged policy.

Material changes affecting how your personal data is handled will be surfaced to you in the App where feasible.

---

## 15. Contact

Questions about this policy or about privacy in Quiet Alarm:

**Riccardo Berti** — **gor.na.rik@gmail.com**

---

*Quiet Alarm is not a medical device and does not provide medical advice. See the [Terms of Use](termsOfUse.md) for the full disclaimer, including important limitations on alarm reliability.*
