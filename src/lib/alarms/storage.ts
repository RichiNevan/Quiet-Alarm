import { File, Paths } from "expo-file-system";
import { DEFAULT_DURATION_SECONDS } from "./timing";
import type { Alarm } from "./types";

const alarmsFile = () => new File(Paths.document, "alarms.json");

// Alarms saved before durationSeconds existed (pre-2026-07-21 dev builds)
// won't have it — backfill so old test data doesn't play a NaN-length
// session.
function migrate(alarm: Alarm): Alarm {
  return typeof alarm.durationSeconds === "number"
    ? alarm
    : { ...alarm, durationSeconds: DEFAULT_DURATION_SECONDS };
}

export async function loadAlarms(): Promise<Alarm[]> {
  try {
    const f = alarmsFile();
    if (!f.exists) return [];
    const text = await f.text();
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed.map(migrate) : [];
  } catch (e) {
    console.warn("loadAlarms failed, starting empty", e);
    return [];
  }
}

export async function saveAlarms(alarms: Alarm[]): Promise<void> {
  const f = alarmsFile();
  if (!f.exists) f.create();
  f.write(JSON.stringify(alarms, null, 2));
}
