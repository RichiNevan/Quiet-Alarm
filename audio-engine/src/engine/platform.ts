import { Platform } from 'react-native';

// Local platform flags (mirrors the host app's contexts/platform), so the engine
// doesn't reach into app context just to know the platform.
export const web = Platform.OS === 'web';
export const mobile = ['ios', 'android'].includes(Platform.OS);
export const android = Platform.OS === 'android';
export const ios = Platform.OS === 'ios';
