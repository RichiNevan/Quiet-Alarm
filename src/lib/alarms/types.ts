export type PresetId = "morningActivation" | "lucidDreaming";

// 0 = Sunday .. 6 = Saturday (JS Date#getDay convention). Empty array means
// "ring once, then disable" — the default for a freshly created alarm.
export type RepeatDays = number[];

export interface Alarm {
  id: string;
  hour: number; // 0-23
  minute: number; // 0-59
  presetId: PresetId;
  durationSeconds: number; // total session length once the alarm fires
  repeatDays: RepeatDays;
  enabled: boolean;
  label?: string;
  createdAt: number;
}

export type AlarmDraft = Omit<Alarm, "id" | "createdAt">;
