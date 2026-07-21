import type { Alarm } from "./types";

/**
 * Next epoch-ms this alarm should fire, or null if it never will (disabled,
 * or a one-shot whose time has already passed today with no repeat days).
 */
export function computeNextOccurrence(
  alarm: Alarm,
  from: Date = new Date(),
): number | null {
  if (!alarm.enabled) return null;

  const candidate = new Date(from);
  candidate.setHours(alarm.hour, alarm.minute, 0, 0);

  if (alarm.repeatDays.length === 0) {
    // One-shot: today if still in the future, otherwise tomorrow.
    if (candidate.getTime() <= from.getTime()) {
      candidate.setDate(candidate.getDate() + 1);
    }
    return candidate.getTime();
  }

  // Repeating: walk forward up to 7 days to find the next matching weekday
  // (today counts if the time hasn't passed yet).
  for (let offset = 0; offset < 7; offset++) {
    const day = new Date(candidate);
    day.setDate(candidate.getDate() + offset);
    const isToday = offset === 0;
    if (
      alarm.repeatDays.includes(day.getDay()) &&
      (!isToday || day.getTime() > from.getTime())
    ) {
      return day.getTime();
    }
  }
  return null;
}

export function formatTime(hour: number, minute: number): string {
  const h = hour % 12 === 0 ? 12 : hour % 12;
  const ampm = hour < 12 ? "AM" : "PM";
  return `${h}:${String(minute).padStart(2, "0")} ${ampm}`;
}

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function formatRepeat(repeatDays: number[]): string {
  if (repeatDays.length === 0) return "Once";
  if (repeatDays.length === 7) return "Every day";
  const sorted = [...repeatDays].sort();
  const weekdays = [1, 2, 3, 4, 5];
  const weekend = [0, 6];
  if (
    sorted.length === 5 &&
    weekdays.every((d) => sorted.includes(d))
  ) {
    return "Weekdays";
  }
  if (sorted.length === 2 && weekend.every((d) => sorted.includes(d))) {
    return "Weekends";
  }
  return sorted.map((d) => DAY_LABELS[d]).join(", ");
}
