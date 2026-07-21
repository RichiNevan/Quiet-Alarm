import {
  BinauralNode,
  ensureCustomNodesInstalled,
} from "@biosyncare/audio-engine";
import { File, Paths } from "expo-file-system";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  PermissionsAndroid,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { AudioContext, AudioManager } from "react-native-audio-api";

import { AlarmScheduler } from "../../modules/alarm-engine";

// Fixed id for this diagnostic screen's single test alarm — always plays
// the bundled fallback tone (audioUri omitted) since this harness tests the
// wake mechanism, not preset content (that's exercised by the real Alarms
// screen instead).
const DIAGNOSTIC_ALARM_ID = "diagnostic-test";

/**
 * Spike harness for docs/feasibility-and-test-protocol.md.
 * Throwaway code — proves/falsifies the platform foundations, nothing more.
 *
 * Android (AND-1..7): exact alarm -> receiver -> FGS plays a WAV natively.
 *   All the interesting code is in android/.../spike/*.kt. This screen only
 *   arms/cancels and shows the persistent log.
 *
 * iOS (IOS-1..2): keep-alive session. The engine starts NOW at volume 0 and
 *   the app must stay alive (lock the phone, do NOT force-quit). At T the
 *   still-running JS ramps the volume up. Heartbeat lines prove liveness.
 */

// ---- iOS log file (same filename the Kotlin side uses on Android) ----
const logFile = () => new File(Paths.document, "spike-log.txt");

function iosAppendLog(line: string) {
  try {
    const f = logFile();
    const prev = f.exists ? f.textSync() : "";
    if (!f.exists) f.create();
    f.write(`${prev}${new Date().toISOString()}\t${line}\n`);
  } catch (e) {
    console.warn("spike log write failed", e);
  }
}

const RAMP_MS = 30_000;
const RAMP_STEP_MS = 500;
const TARGET_VOLUME = 0.35;
const HEARTBEAT_MS = 60_000;
const LEFT_HZ = 200;
const RIGHT_HZ = 206;

type IosStatus = "idle" | "armed" | "ramping" | "playing" | "error";

export default function SpikeScreen() {
  const [log, setLog] = useState("");
  const [status, setStatus] = useState("");
  const [iosStatus, setIosStatus] = useState<IosStatus>("idle");

  // ---------- shared: log viewer ----------
  const refreshLog = useCallback(async () => {
    try {
      if (Platform.OS === "android" && AlarmScheduler) {
        setLog(await AlarmScheduler.readLog());
      } else {
        const f = logFile();
        setLog(f.exists ? await f.text() : "(empty)");
      }
    } catch (e) {
      setLog(`failed to read log: ${e}`);
    }
  }, []);

  const clearLog = useCallback(async () => {
    try {
      if (Platform.OS === "android" && AlarmScheduler) {
        await AlarmScheduler.clearLog();
      } else {
        const f = logFile();
        if (f.exists) f.delete();
      }
      setLog("");
    } catch (e) {
      setStatus(`clear failed: ${e}`);
    }
  }, []);

  // ---------- Android ----------
  const refreshAndroidStatus = useCallback(async () => {
    if (!AlarmScheduler) {
      setStatus("AlarmScheduler native module missing — rebuild the app");
      return;
    }
    const s = await AlarmScheduler.getStatus();
    const armed = s.armedIds.includes(DIAGNOSTIC_ALARM_ID)
      ? "diagnostic alarm armed"
      : "not armed";
    setStatus(
      `${armed} | exactAlarms=${s.canScheduleExact} | notifications=${s.notificationsEnabled}`,
    );
  }, []);

  useEffect(() => {
    if (Platform.OS === "android") {
      if (Number(Platform.Version) >= 33) {
        PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
        ).catch(() => {});
      }
      refreshAndroidStatus().catch((e) => setStatus(String(e)));
    }
    refreshLog();
  }, [refreshAndroidStatus, refreshLog]);

  const armAndroid = useCallback(
    async (delayMs: number) => {
      if (!AlarmScheduler) return;
      try {
        const target = new Date(Date.now() + delayMs);
        await AlarmScheduler.arm({
          id: DIAGNOSTIC_ALARM_ID,
          targetEpochMs: target.getTime(),
          hour: target.getHours(),
          minute: target.getMinutes(),
          repeatDays: [],
          audioUri: null,
          presetLabel: "Diagnostic test",
          durationMs: 120_000, // 2 min — long enough to see ramp/steady/fade-out
        });
        await refreshAndroidStatus();
      } catch (e) {
        setStatus(`arm failed: ${e}`);
      }
    },
    [refreshAndroidStatus],
  );

  // ---------- iOS keep-alive ----------
  const ctxRef = useRef<AudioContext | null>(null);
  const nodeRef = useRef<BinauralNode | null>(null);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const intervalsRef = useRef<ReturnType<typeof setInterval>[]>([]);
  const interruptionSubRef = useRef<{ remove: () => void } | null>(null);
  const [iosTarget, setIosTarget] = useState<number>(0);

  const clearIosTimers = useCallback(() => {
    timersRef.current.forEach(clearTimeout);
    intervalsRef.current.forEach(clearInterval);
    timersRef.current = [];
    intervalsRef.current = [];
  }, []);

  const releaseIos = useCallback(() => {
    clearIosTimers();
    interruptionSubRef.current?.remove();
    interruptionSubRef.current = null;
    try {
      (nodeRef.current as unknown as { disconnect?: () => void })?.disconnect?.();
    } catch {}
    try {
      (ctxRef.current as unknown as { close?: () => void })?.close?.();
    } catch {}
    nodeRef.current = null;
    ctxRef.current = null;
    try {
      AudioManager.observeAudioInterruptions(false);
      AudioManager.setAudioSessionActivity(false);
    } catch {}
  }, [clearIosTimers]);

  // Click-free stop per the engine contract: stop() arms a 2 s fade; only
  // tear down once node.isPaused flips (or after a 3 s cap).
  const stopIos = useCallback(() => {
    clearIosTimers();
    const node = nodeRef.current;
    iosAppendLog("stopped_by_user");
    if (!node) {
      releaseIos();
      setIosStatus("idle");
      return;
    }
    try {
      node.stop();
    } catch {
      releaseIos();
      setIosStatus("idle");
      return;
    }
    const start = Date.now();
    const poll = setInterval(() => {
      let faded = true;
      try {
        faded = nodeRef.current?.isPaused ?? true;
      } catch {}
      if (faded || Date.now() - start > 3000) {
        clearInterval(poll);
        releaseIos();
        setIosStatus("idle");
      }
    }, 100);
    intervalsRef.current.push(poll);
  }, [clearIosTimers, releaseIos]);

  const armIos = useCallback(
    (delayMs: number) => {
      if (iosStatus !== "idle") return;
      try {
        // Non-mixable playback session: per Apple DTS the "Now Playing"-style
        // session is the most termination-resistant configuration overnight.
        AudioManager.setAudioSessionOptions({
          iosCategory: "playback",
          iosMode: "default",
          iosOptions: [],
        });
        AudioManager.observeAudioInterruptions(true);
        interruptionSubRef.current = AudioManager.addSystemEventListener(
          "interruption",
          (event) => {
            iosAppendLog(
              `interruption_${event.type}\tshouldResume=${event.shouldResume}`,
            );
            if (event.type === "ended") {
              // IOS-3: naive resume attempt; hardened in later iterations.
              try {
                AudioManager.setAudioSessionActivity(true);
                (ctxRef.current as unknown as { resume?: () => void })?.resume?.();
                iosAppendLog("interruption_resume_attempted");
              } catch (e) {
                iosAppendLog(`interruption_resume_FAILED\t${e}`);
              }
            }
          },
        );

        if (!ensureCustomNodesInstalled()) {
          setIosStatus("error");
          iosAppendLog("error\tcustom nodes not installed");
          return;
        }
        const ctx = new AudioContext();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const g = global as any;
        const node = new BinauralNode(
          ctx,
          g.createBinauralNode((ctx as unknown as { context: unknown }).context),
        );
        node.fl = LEFT_HZ;
        node.fr = RIGHT_HZ;
        node.waveformL = 0;
        node.waveformR = 0;
        node.volume = 0; // silent keep-alive: the graph renders zeros all night
        node.connect(ctx.destination);
        (ctx as unknown as { resume?: () => void }).resume?.();
        node.start();
        ctxRef.current = ctx;
        nodeRef.current = node;

        const target = Date.now() + delayMs;
        setIosTarget(target);
        iosAppendLog(
          `armed_ios\ttarget=${new Date(target).toISOString()}\tdelay_ms=${delayMs}`,
        );

        // Liveness heartbeat: a gap in these lines = the app was suspended.
        const hb = setInterval(() => {
          iosAppendLog(
            `hb\tctxState=${(ctxRef.current as unknown as { state?: string })?.state ?? "?"}`,
          );
        }, HEARTBEAT_MS);
        intervalsRef.current.push(hb);

        // The ramp at T. If we are alive, this fires; drift is logged.
        const t = setTimeout(() => {
          const driftMs = Date.now() - target;
          iosAppendLog(`ramp_started\tdrift_ms=${driftMs}`);
          setIosStatus("ramping");
          const steps = Math.ceil(RAMP_MS / RAMP_STEP_MS);
          let step = 0;
          const ramp = setInterval(() => {
            step++;
            const v = Math.min(1, step / steps) * TARGET_VOLUME;
            try {
              if (nodeRef.current) nodeRef.current.volume = v;
            } catch {}
            if (step >= steps) {
              clearInterval(ramp);
              iosAppendLog("ramp_done");
              setIosStatus("playing");
            }
          }, RAMP_STEP_MS);
          intervalsRef.current.push(ramp);
        }, delayMs);
        timersRef.current.push(t);

        setIosStatus("armed");
      } catch (e) {
        iosAppendLog(`arm_FAILED\t${e}`);
        releaseIos();
        setIosStatus("error");
      }
    },
    [iosStatus, releaseIos],
  );

  // Deliberately NO cleanup-on-unmount for the iOS session: navigating away
  // must not kill an armed overnight test. Use the Stop button.

  const delays: [string, number][] = [
    ["+2 min", 2 * 60_000],
    ["+5 min", 5 * 60_000],
    ["+30 min", 30 * 60_000],
    ["+8 h", 8 * 3600_000],
  ];

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Alarm spike harness</Text>
      <Text style={styles.subtitle}>
        Protocol: docs/feasibility-and-test-protocol.md
      </Text>

      {Platform.OS === "android" && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Android — exact alarm → FGS</Text>
          <Text style={styles.hint}>
            Arm, press the power button (screen off), unplug for Doze tests.
            Expect: sound ramps in at T from a dark screen.
          </Text>
          <View style={styles.row}>
            {delays.map(([label, ms]) => (
              <Btn key={label} label={label} onPress={() => armAndroid(ms)} />
            ))}
          </View>
          <View style={styles.row}>
            <Btn
              label="Cancel alarm"
              onPress={async () => {
                await AlarmScheduler?.cancel(DIAGNOSTIC_ALARM_ID);
                refreshAndroidStatus();
              }}
            />
            <Btn label="Stop playback" onPress={() => AlarmScheduler?.stopPlayback()} />
            <Btn label="Status" onPress={refreshAndroidStatus} />
          </View>
          <Text style={styles.status}>{status}</Text>
        </View>
      )}

      {Platform.OS === "ios" && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>iOS — keep-alive session</Text>
          <Text style={styles.hint}>
            Arm, then LOCK the phone (do not force-quit the app). The session
            plays silence until T, then ramps up. Heartbeat gaps in the log =
            the app was suspended (that&apos;s a test FAIL to investigate).
          </Text>
          <View style={styles.row}>
            {delays.map(([label, ms]) => (
              <Btn
                key={label}
                label={label}
                disabled={iosStatus !== "idle"}
                onPress={() => armIos(ms)}
              />
            ))}
          </View>
          <View style={styles.row}>
            <Btn label="Stop" onPress={stopIos} />
          </View>
          <Text style={styles.status}>
            {iosStatus}
            {iosTarget > 0 && iosStatus !== "idle"
              ? ` — target ${new Date(iosTarget).toLocaleTimeString()}`
              : ""}
          </Text>
        </View>
      )}

      <View style={styles.section}>
        <View style={styles.row}>
          <Btn label="Refresh log" onPress={refreshLog} />
          <Btn label="Clear log" onPress={clearLog} />
        </View>
        <Text style={styles.log}>{log || "(log empty)"}</Text>
      </View>
    </ScrollView>
  );
}

function Btn({
  label,
  onPress,
  disabled,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.btn,
        disabled && styles.btnDisabled,
        pressed && styles.btnPressed,
      ]}
    >
      <Text style={styles.btnText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 12 },
  title: { fontSize: 20, fontWeight: "700" },
  subtitle: { fontSize: 12, opacity: 0.6 },
  section: { gap: 8, paddingVertical: 8 },
  sectionTitle: { fontSize: 16, fontWeight: "600" },
  hint: { fontSize: 12, opacity: 0.7 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  btn: {
    backgroundColor: "#3b6ef5",
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
  },
  btnDisabled: { opacity: 0.4 },
  btnPressed: { opacity: 0.85 },
  btnText: { color: "#fff", fontWeight: "600" },
  status: { fontSize: 13, opacity: 0.8 },
  log: {
    fontFamily: Platform.select({ ios: "Menlo", default: "monospace" }),
    fontSize: 10,
    opacity: 0.8,
  },
});
