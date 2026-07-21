package com.richinevan.quietalarm.alarm

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.PowerManager

/**
 * Fired by AlarmManager.setAlarmClock at T. Runs even if the app process
 * was dead (the OS restarts the process to deliver the broadcast). Starting
 * a foreground service from here is exempt from background-start
 * restrictions because it is triggered by an exact alarm.
 */
class AlarmReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val id = intent.getStringExtra(EXTRA_ID) ?: "unknown"
    val hour = intent.getIntExtra(EXTRA_HOUR, -1)
    val minute = intent.getIntExtra(EXTRA_MINUTE, -1)
    val repeatDaysCsv = intent.getStringExtra(EXTRA_REPEAT_DAYS) ?: ""
    val audioUri = intent.getStringExtra(EXTRA_AUDIO_URI)
    val presetLabel = intent.getStringExtra(EXTRA_PRESET_LABEL) ?: "Quiet Alarm"
    val durationMs = intent.getLongExtra(EXTRA_DURATION_MS, DEFAULT_DURATION_MS)

    val pm = context.getSystemService(Context.POWER_SERVICE) as PowerManager
    AlarmLog.log(
      context,
      "receiver_fired\tid=$id\tscreen_interactive=${pm.isInteractive}"
    )

    try {
      val service = Intent(context, AlarmAudioService::class.java).apply {
        putExtra(EXTRA_ID, id)
        putExtra(EXTRA_AUDIO_URI, audioUri)
        putExtra(EXTRA_PRESET_LABEL, presetLabel)
        putExtra(EXTRA_DURATION_MS, durationMs)
      }
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        context.startForegroundService(service)
      } else {
        context.startService(service)
      }
      AlarmLog.log(context, "receiver_started_service\tid=$id")
    } catch (e: Exception) {
      // ForegroundServiceStartNotAllowedException would land here — that
      // would falsify the exact-alarm exemption on this device/OS.
      AlarmLog.log(context, "receiver_start_service_FAILED\tid=$id\t${e.javaClass.simpleName}: ${e.message}")
    }

    if (repeatDaysCsv.isNotEmpty() && hour in 0..23 && minute in 0..59) {
      val repeatDays = repeatDaysCsv.split(",").mapNotNull { it.trim().toIntOrNull() }
      val next = AlarmScheduling.computeNextOccurrenceMillis(
        hour, minute, repeatDays, System.currentTimeMillis()
      )
      if (next != null) {
        try {
          AlarmScheduling.schedule(
            context, id, next, hour, minute, repeatDaysCsv, audioUri, presetLabel, durationMs
          )
          AlarmLog.log(context, "rescheduled\tid=$id\tnext=$next")
        } catch (e: Exception) {
          AlarmLog.log(context, "reschedule_FAILED\tid=$id\t${e.message}")
        }
      }
    }
  }

  companion object {
    const val EXTRA_ID = "id"
    const val EXTRA_HOUR = "hour"
    const val EXTRA_MINUTE = "minute"
    const val EXTRA_REPEAT_DAYS = "repeat_days"
    const val EXTRA_AUDIO_URI = "audio_uri"
    const val EXTRA_PRESET_LABEL = "preset_label"
    const val EXTRA_DURATION_MS = "duration_ms"
    // Mirrors src/lib/alarms/timing.ts DEFAULT_DURATION_SECONDS (900) — used
    // only if an older-format PendingIntent somehow lacks the extra.
    const val DEFAULT_DURATION_MS = 900_000L
  }
}
