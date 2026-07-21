package com.richinevan.quietalarm.alarm

import android.content.Context
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Append-only event log that survives process death. Every step of the
 * alarm chain (arm -> receiver -> service -> playback) writes here so a
 * failed night can be diagnosed from the file alone.
 */
object AlarmLog {
  private const val FILE_NAME = "alarm-log.txt"
  private val fmt = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSSZ", Locale.US)

  fun file(context: Context): File = File(context.filesDir, FILE_NAME)

  @Synchronized
  fun log(context: Context, event: String) {
    try {
      file(context).appendText("${fmt.format(Date())}\t$event\n")
    } catch (_: Exception) {
      // logging must never break the alarm chain
    }
  }

  @Synchronized
  fun read(context: Context): String =
    try {
      val f = file(context)
      if (f.exists()) f.readText() else ""
    } catch (e: Exception) {
      "failed to read log: ${e.message}"
    }

  @Synchronized
  fun clear(context: Context) {
    try {
      file(context).delete()
    } catch (_: Exception) {}
  }
}
