import { requireNativeModule } from "expo";
import { Platform } from "react-native";

export interface ArmParams {
  id: string;
  targetEpochMs: number;
  hour: number;
  minute: number;
  repeatDays: number[]; // 0=Sun..6=Sat, matches Date#getDay()
  audioUri?: string | null;
  presetLabel: string;
  durationMs: number; // total session length once the alarm fires
}

export interface AlarmSchedulerStatus {
  armedIds: string[];
  canScheduleExact: boolean;
  notificationsEnabled: boolean;
}

export interface AlarmSchedulerModule {
  arm(params: ArmParams): Promise<boolean>;
  cancel(id: string): Promise<boolean>;
  cancelAll(): Promise<boolean>;
  stopPlayback(): Promise<boolean>;
  getStatus(): Promise<AlarmSchedulerStatus>;
  readLog(): Promise<string>;
  clearLog(): Promise<boolean>;
}

// Android-only native module (see expo-module.config.json). On iOS the app
// never dies, so alarms are armed as live in-process timers instead — see
// src/lib/alarms/iosEngine.ts.
export const AlarmScheduler: AlarmSchedulerModule | undefined =
  Platform.OS === "android"
    ? requireNativeModule<AlarmSchedulerModule>("AlarmScheduler")
    : undefined;
