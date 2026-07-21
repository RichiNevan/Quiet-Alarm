package com.richinevan.quietalarm.alarm

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import java.util.Calendar

/**
 * Shared PendingIntent/AlarmManager plumbing used by both the JS-facing
 * module (initial arm) and AlarmReceiver (rescheduling a repeating alarm
 * right after it fires — that reschedule has to happen here, in plain
 * Kotlin, because no JS runtime exists at fire time on Android).
 */
object AlarmScheduling {
  private const val SHOW_REQUEST_CODE = 999_999

  fun requestCode(id: String): Int = id.hashCode()

  private fun buildPendingIntent(
    context: Context,
    id: String,
    hour: Int,
    minute: Int,
    repeatDaysCsv: String,
    audioUri: String?,
    presetLabel: String,
    durationMs: Long,
  ): PendingIntent {
    val intent = Intent(context, AlarmReceiver::class.java).apply {
      putExtra(AlarmReceiver.EXTRA_ID, id)
      putExtra(AlarmReceiver.EXTRA_HOUR, hour)
      putExtra(AlarmReceiver.EXTRA_MINUTE, minute)
      putExtra(AlarmReceiver.EXTRA_REPEAT_DAYS, repeatDaysCsv)
      putExtra(AlarmReceiver.EXTRA_AUDIO_URI, audioUri)
      putExtra(AlarmReceiver.EXTRA_PRESET_LABEL, presetLabel)
      putExtra(AlarmReceiver.EXTRA_DURATION_MS, durationMs)
    }
    return PendingIntent.getBroadcast(
      context, requestCode(id), intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
  }

  fun schedule(
    context: Context,
    id: String,
    targetEpochMs: Long,
    hour: Int,
    minute: Int,
    repeatDaysCsv: String,
    audioUri: String?,
    presetLabel: String,
    durationMs: Long,
  ) {
    val am = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    val pending =
      buildPendingIntent(context, id, hour, minute, repeatDaysCsv, audioUri, presetLabel, durationMs)
    // showIntent: what opens when the user taps the status-bar alarm icon.
    // One shared request code for all alarms is fine — it always just opens
    // MainActivity, no per-alarm payload needed.
    val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)
    val showIntent = launch?.let {
      PendingIntent.getActivity(
        context, SHOW_REQUEST_CODE, it,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
      )
    }
    am.setAlarmClock(AlarmManager.AlarmClockInfo(targetEpochMs, showIntent), pending)
  }

  fun cancel(context: Context, id: String) {
    val am = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    val intent = Intent(context, AlarmReceiver::class.java)
    val pending = PendingIntent.getBroadcast(
      context, requestCode(id), intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
    am.cancel(pending)
    pending.cancel()
  }

  /**
   * Next epoch-ms strictly after [fromMillis] matching one of [repeatDays]
   * (0=Sunday..6=Saturday, matching JS Date#getDay()), at [hour]:[minute].
   * Mirrors src/lib/alarms/nextOccurrence.ts — keep both in sync.
   */
  fun computeNextOccurrenceMillis(
    hour: Int,
    minute: Int,
    repeatDays: List<Int>,
    fromMillis: Long,
  ): Long? {
    if (repeatDays.isEmpty()) return null
    val base = Calendar.getInstance().apply {
      timeInMillis = fromMillis
      set(Calendar.HOUR_OF_DAY, hour)
      set(Calendar.MINUTE, minute)
      set(Calendar.SECOND, 0)
      set(Calendar.MILLISECOND, 0)
    }
    for (offset in 0..7) {
      val day = Calendar.getInstance().apply {
        timeInMillis = base.timeInMillis
        add(Calendar.DAY_OF_YEAR, offset)
      }
      val jsWeekday = day.get(Calendar.DAY_OF_WEEK) - 1 // Calendar SUNDAY=1 -> JS 0
      if (repeatDays.contains(jsWeekday) && day.timeInMillis > fromMillis) {
        return day.timeInMillis
      }
    }
    return null
  }
}
