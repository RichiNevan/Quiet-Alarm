import { File, Paths } from "expo-file-system";

// Same filename + line shape as the Android Kotlin side (see
// modules/alarm-engine's AlarmLog.kt) — two separate files (different
// storage dirs, different processes), kept in the same format purely so the
// diagnostics screen renders both consistently. On iOS plain JS logging is
// enough because the app process never dies; Android's log has to be
// written from Kotlin because JS isn't running when the alarm fires there.
const LOG_FILE_NAME = "alarm-log.txt";

const logFile = () => new File(Paths.document, LOG_FILE_NAME);

export function appendAlarmLog(event: string) {
  try {
    const f = logFile();
    if (!f.exists) f.create();
    f.write(`${new Date().toISOString()}\t${event}\n`, { append: true });
  } catch (e) {
    console.warn("appendAlarmLog failed", e);
  }
}

export async function readAlarmLog(): Promise<string> {
  const f = logFile();
  return f.exists ? f.text() : "";
}

export function clearAlarmLog() {
  const f = logFile();
  if (f.exists) f.delete();
}
