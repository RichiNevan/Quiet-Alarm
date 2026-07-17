// expo-av was removed in Expo SDK 57 (replaced by expo-audio/expo-video).
// @biosyncare/audio-engine lazily imports it only for optional soundscape
// playback (mobileSoundscape/backgroundSessionStopGuard), which this app does
// not use. This shim keeps typechecking green without installing the dead
// native module; if soundscapes are ever needed, port the engine to expo-audio.
declare module 'expo-av';
