package com.richinevan.quietalarm.alarm

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.MediaPlayer
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import kotlin.math.max
import kotlin.math.roundToInt

/**
 * Foreground service (mediaPlayback) that plays a preset's audio on the
 * ALARM stream with a volume ramp in and out, then stops itself.
 *
 * Deliberately dumb: no React Native, no JS, no live audio engine — this is
 * the "A-native" architecture validated by the spike harness
 * (docs/feasibility-and-test-protocol.md AND-1..7). What plays is a WAV:
 * either a per-alarm file pre-rendered from the real preset via
 * OfflineAudioContext while the app was foregrounded (audioUri extra), or —
 * if that render is missing/unreadable for any reason — the bundled
 * fallback tone, so a broken render can never mean a silent alarm.
 */
class AlarmAudioService : Service() {

  private var player: MediaPlayer? = null
  private var wakeLock: PowerManager.WakeLock? = null
  private var originalAlarmVolume = -1
  private val handler by lazy { Handler(mainLooper) }
  private var rampStep = 0
  private var stopped = false
  private var usingFallback = false

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == ACTION_STOP) {
      AlarmLog.log(this, "stop_requested")
      stopPlaybackAndSelf()
      return START_NOT_STICKY
    }

    val id = intent?.getStringExtra(AlarmReceiver.EXTRA_ID) ?: "unknown"
    val audioUri = intent?.getStringExtra(AlarmReceiver.EXTRA_AUDIO_URI)
    val presetLabel = intent?.getStringExtra(AlarmReceiver.EXTRA_PRESET_LABEL) ?: "Quiet Alarm"
    val playMs = intent?.getLongExtra(AlarmReceiver.EXTRA_DURATION_MS, AlarmReceiver.DEFAULT_DURATION_MS)
      ?: AlarmReceiver.DEFAULT_DURATION_MS

    AlarmLog.log(this, "fgs_starting\tid=$id\tplay_ms=$playMs")
    startInForeground(presetLabel)
    acquireWakeLock(playMs)
    raiseAlarmVolume()
    // The rendered/fallback content is a short loop-clean clip (see
    // renderPresetAndroid.ts) looped (isLooping=true, set in startPlayback)
    // for however long the user configured — the render is NOT re-done at
    // the user's chosen length, that would mean multi-hundred-MB WAVs for
    // long sessions. A preset with very slow (multi-second) modulation may
    // have an audible seam at each loop boundary; flagged as a known
    // trade-off, not fixed here.
    startPlayback(audioUri)
    handler.postDelayed({ startFadeOut() }, (playMs - FADE_OUT_MS).coerceAtLeast(0))
    handler.postDelayed({ stopPlaybackAndSelf() }, playMs)
    return START_NOT_STICKY
  }

  private fun startInForeground(presetLabel: String) {
    val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      // IMPORTANCE_LOW: no sound, no heads-up peek — must not wake the screen.
      val channel = NotificationChannel(
        CHANNEL_ID, "Quiet Alarm", NotificationManager.IMPORTANCE_LOW
      ).apply { setShowBadge(false) }
      nm.createNotificationChannel(channel)
    }

    val stopIntent = Intent(this, AlarmAudioService::class.java).apply { action = ACTION_STOP }
    val stopPending = PendingIntent.getService(
      this, 2, stopIntent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
    val notification = NotificationCompat.Builder(this, CHANNEL_ID)
      .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
      .setContentTitle("Quiet Alarm")
      .setContentText(presetLabel)
      .setOngoing(true)
      .setSilent(true)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .addAction(0, "Stop", stopPending)
      .build()

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      startForeground(NOTIF_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)
    } else {
      startForeground(NOTIF_ID, notification)
    }
    val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
    AlarmLog.log(this, "fgs_started\tscreen_interactive=${pm.isInteractive}")
  }

  // Must outlast the configured session (up to MAX_DURATION_SECONDS in
  // src/lib/alarms/timing.ts, 60 min) — a fixed 5 min timeout here would
  // release mid-playback for anything longer than that.
  private fun acquireWakeLock(playMs: Long) {
    try {
      val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
      wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "quietalarm:alarm").apply {
        acquire(playMs + WAKELOCK_SAFETY_MARGIN_MS)
      }
      AlarmLog.log(this, "wakelock_acquired")
    } catch (e: Exception) {
      AlarmLog.log(this, "wakelock_FAILED\t${e.message}")
    }
  }

  /** The alarm stream has its own volume; set it so a muted media volume or
   *  a quiet alarm volume cannot silence the alarm. */
  private fun raiseAlarmVolume() {
    try {
      val am = getSystemService(Context.AUDIO_SERVICE) as AudioManager
      originalAlarmVolume = am.getStreamVolume(AudioManager.STREAM_ALARM)
      val target = max(1, (am.getStreamMaxVolume(AudioManager.STREAM_ALARM) * 0.7).roundToInt())
      am.setStreamVolume(AudioManager.STREAM_ALARM, target, 0)
      AlarmLog.log(this, "alarm_volume_set\tfrom=$originalAlarmVolume\tto=$target")
    } catch (e: Exception) {
      // SecurityException possible under some DND configurations.
      AlarmLog.log(this, "alarm_volume_FAILED\t${e.javaClass.simpleName}: ${e.message}")
    }
  }

  /** Builds a MediaPlayer for the given content, either the per-alarm
   *  pre-rendered preset or the bundled fallback tone if that's missing,
   *  unreadable, or fails to prepare. A broken render must never mean a
   *  silent alarm. */
  private fun buildPlayer(attrs: AudioAttributes, audioUri: String?): MediaPlayer? {
    if (audioUri != null) {
      try {
        val mp = MediaPlayer()
        mp.setAudioAttributes(attrs)
        mp.setDataSource(this, Uri.parse(audioUri))
        mp.prepare()
        AlarmLog.log(this, "playback_source\trendered_preset")
        return mp
      } catch (e: Exception) {
        AlarmLog.log(this, "rendered_preset_FAILED\t${e.javaClass.simpleName}: ${e.message}\tfalling_back")
      }
    }
    return try {
      val mp = MediaPlayer()
      mp.setAudioAttributes(attrs)
      val afd = resources.openRawResourceFd(R.raw.fallback_alarm)
      mp.setDataSource(afd.fileDescriptor, afd.startOffset, afd.length)
      afd.close()
      mp.prepare()
      usingFallback = true
      AlarmLog.log(this, "playback_source\tbundled_fallback")
      mp
    } catch (e: Exception) {
      AlarmLog.log(this, "fallback_FAILED\t${e.javaClass.simpleName}: ${e.message}")
      null
    }
  }

  private fun startPlayback(audioUri: String?) {
    try {
      val attrs = AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_ALARM)
        .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
        .build()
      val mp = buildPlayer(attrs, audioUri)
      if (mp == null) {
        AlarmLog.log(this, "playback_FAILED\tno usable source")
        stopPlaybackAndSelf()
        return
      }
      player = mp
      mp.isLooping = true // safety net: exact stop timing is enforced by our own handlers
      mp.setVolume(0f, 0f)
      mp.setOnErrorListener { _, what, extra ->
        AlarmLog.log(this, "playback_ERROR\twhat=$what extra=$extra")
        false
      }
      mp.start()
      AlarmLog.log(this, "playback_started\tfallback=$usingFallback")
      rampStep = 0
      handler.post(rampInRunnable)
    } catch (e: Exception) {
      AlarmLog.log(this, "playback_FAILED\t${e.javaClass.simpleName}: ${e.message}")
      stopPlaybackAndSelf()
    }
  }

  // Gentle fade-in: 0 -> 1 over RAMP_IN_MS, so the sleeper is not startled.
  private val rampInRunnable = object : Runnable {
    override fun run() {
      val mp = player ?: return
      rampStep++
      val v = (rampStep.toFloat() / RAMP_STEPS).coerceAtMost(1f)
      try {
        mp.setVolume(v, v)
      } catch (_: Exception) {
        return
      }
      if (rampStep < RAMP_STEPS) {
        handler.postDelayed(this, RAMP_IN_MS / RAMP_STEPS)
      } else {
        AlarmLog.log(this@AlarmAudioService, "ramp_in_done")
      }
    }
  }

  // Symmetric fade-out before the hard stop at playMs, so playback never
  // clicks off — mirrors the engine's own click-free stop contract (see
  // audio-engine INTEGRATION.md "Stopping without clicks").
  private var fadeOutStep = 0
  private fun startFadeOut() {
    val mp = player ?: return
    handler.removeCallbacks(rampInRunnable)
    fadeOutStep = 0
    val startVolume = 1f
    val fadeRunnable = object : Runnable {
      override fun run() {
        val p = player ?: return
        fadeOutStep++
        val v = (startVolume * (1f - fadeOutStep.toFloat() / RAMP_STEPS)).coerceAtLeast(0f)
        try {
          p.setVolume(v, v)
        } catch (_: Exception) {
          return
        }
        if (fadeOutStep < RAMP_STEPS) {
          handler.postDelayed(this, FADE_OUT_MS / RAMP_STEPS)
        }
      }
    }
    handler.post(fadeRunnable)
    AlarmLog.log(this, "fade_out_started")
  }

  private fun stopPlaybackAndSelf() {
    if (stopped) return
    stopped = true
    handler.removeCallbacksAndMessages(null)
    try {
      player?.stop()
      player?.release()
    } catch (_: Exception) {}
    player = null
    try {
      if (originalAlarmVolume >= 0) {
        val am = getSystemService(Context.AUDIO_SERVICE) as AudioManager
        am.setStreamVolume(AudioManager.STREAM_ALARM, originalAlarmVolume, 0)
      }
    } catch (_: Exception) {}
    try {
      wakeLock?.takeIf { it.isHeld }?.release()
    } catch (_: Exception) {}
    AlarmLog.log(this, "playback_stopped")
    stopForeground(STOP_FOREGROUND_REMOVE)
    stopSelf()
  }

  override fun onDestroy() {
    stopPlaybackAndSelf()
    super.onDestroy()
  }

  companion object {
    const val ACTION_STOP = "com.richinevan.quietalarm.alarm.STOP"
    private const val CHANNEL_ID = "quiet_alarm"
    private const val NOTIF_ID = 42001
    private const val RAMP_IN_MS = 10_000L
    private const val FADE_OUT_MS = 2_000L
    private const val RAMP_STEPS = 100
    private const val WAKELOCK_SAFETY_MARGIN_MS = 60_000L
  }
}
