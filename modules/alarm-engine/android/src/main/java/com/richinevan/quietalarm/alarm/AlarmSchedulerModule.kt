package com.richinevan.quietalarm.alarm

import android.app.AlarmManager
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationManagerCompat
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class ArmParams : Record {
  @Field var id: String = ""
  @Field var targetEpochMs: Double = 0.0
  @Field var hour: Int = 0
  @Field var minute: Int = 0
  @Field var repeatDays: List<Int> = emptyList()
  @Field var audioUri: String? = null
  @Field var presetLabel: String = "Quiet Alarm"
  @Field var durationMs: Double = 900_000.0
}

/**
 * JS-facing control surface for scheduling one or more exact alarms.
 * Schedules AlarmManager.setAlarmClock, which fires AlarmReceiver ->
 * AlarmAudioService — see those classes for why this has to be plain
 * Kotlin with no JS involved at fire time.
 *
 * Living under modules/ (not android/) means this survives `expo prebuild`
 * and autolinks with no MainApplication edits — see
 * docs/feasibility-and-test-protocol.md's CNG warning.
 */
class AlarmSchedulerModule : Module() {

  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  private val alarmManager
    get() = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager

  private val prefs
    get() = context.getSharedPreferences("alarm_engine", Context.MODE_PRIVATE)

  override fun definition() = ModuleDefinition {
    Name("AlarmScheduler")

    AsyncFunction("arm") { params: ArmParams ->
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && !alarmManager.canScheduleExactAlarms()) {
        throw CodedException(
          "no_exact_alarm",
          "canScheduleExactAlarms() == false. On Android 12/13 grant 'Alarms & reminders' " +
            "in app settings; on 14+ USE_EXACT_ALARM should make this automatic.",
          null
        )
      }
      val repeatDaysCsv = params.repeatDays.joinToString(",")
      AlarmScheduling.schedule(
        context, params.id, params.targetEpochMs.toLong(), params.hour, params.minute,
        repeatDaysCsv, params.audioUri, params.presetLabel, params.durationMs.toLong()
      )
      rememberId(params.id)
      val iso = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSSZ", Locale.US)
        .format(Date(params.targetEpochMs.toLong()))
      AlarmLog.log(context, "armed\tid=${params.id}\ttarget=$iso\trepeat=$repeatDaysCsv")
      true
    }

    AsyncFunction("cancel") { id: String ->
      AlarmScheduling.cancel(context, id)
      forgetId(id)
      AlarmLog.log(context, "cancelled\tid=$id")
      true
    }

    AsyncFunction("cancelAll") {
      armedIds().forEach { AlarmScheduling.cancel(context, it) }
      prefs.edit().remove(KEY_IDS).apply()
      AlarmLog.log(context, "cancelled_all")
      true
    }

    AsyncFunction("stopPlayback") {
      context.startService(
        Intent(context, AlarmAudioService::class.java).apply { action = AlarmAudioService.ACTION_STOP }
      )
      true
    }

    AsyncFunction("getStatus") {
      mapOf(
        "armedIds" to armedIds(),
        "canScheduleExact" to
          (Build.VERSION.SDK_INT < Build.VERSION_CODES.S || alarmManager.canScheduleExactAlarms()),
        "notificationsEnabled" to NotificationManagerCompat.from(context).areNotificationsEnabled()
      )
    }

    AsyncFunction("readLog") {
      AlarmLog.read(context)
    }

    AsyncFunction("clearLog") {
      AlarmLog.clear(context)
      true
    }
  }

  private fun armedIds(): List<String> =
    prefs.getStringSet(KEY_IDS, emptySet())?.toList() ?: emptyList()

  private fun rememberId(id: String) {
    val current = prefs.getStringSet(KEY_IDS, emptySet())?.toMutableSet() ?: mutableSetOf()
    current.add(id)
    prefs.edit().putStringSet(KEY_IDS, current).apply()
  }

  private fun forgetId(id: String) {
    val current = prefs.getStringSet(KEY_IDS, emptySet())?.toMutableSet() ?: mutableSetOf()
    current.remove(id)
    prefs.edit().putStringSet(KEY_IDS, current).apply()
  }

  companion object {
    private const val KEY_IDS = "armed_ids"
  }
}
