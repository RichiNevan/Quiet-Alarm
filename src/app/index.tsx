import { Href, Link, useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import { FlatList, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AlarmRow } from "../components/alarms/AlarmRow";
import { BioSynCarePromo } from "../components/BioSynCarePromo";
import {
  getIosEngineStatus,
  subscribeIosEngine,
  type IosEngineStatus,
} from "../lib/alarms/iosEngine";
import { useAlarms } from "../lib/alarms/useAlarms";
import { colors } from "../theme/colors";

function IosStatusBanner() {
  const [status, setStatus] = useState<IosEngineStatus>(getIosEngineStatus());
  useEffect(() => subscribeIosEngine(setStatus), []);

  if (status.phase === "idle") return null;
  const text =
    status.phase === "armed"
      ? `Armed for ${new Date(status.targetEpochMs).toLocaleString()} — keep the app open (locking is fine)`
      : status.phase === "ramping"
        ? "Waking…"
        : "Playing…";
  return (
    <View style={styles.banner}>
      <Text style={styles.bannerText}>{text}</Text>
    </View>
  );
}

export default function AlarmListScreen() {
  const { alarms, loaded, toggleAlarm } = useAlarms();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <Text style={styles.title}>Quiet Alarms</Text>
        <Pressable
          onPress={() => router.push("/alarm-edit" as Href)}
          style={styles.addButton}
          accessibilityLabel="Add alarm"
        >
          <Text style={styles.addButtonText}>+</Text>
        </Pressable>
      </View>

      {Platform.OS === "ios" && <IosStatusBanner />}

      {loaded && alarms.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>No alarms yet.</Text>
          <Text style={styles.emptySubtext}>Tap + to set one.</Text>
        </View>
      ) : (
        <FlatList
          style={styles.list}
          data={[...alarms].sort((a, b) => a.hour * 60 + a.minute - (b.hour * 60 + b.minute))}
          keyExtractor={(a) => a.id}
          renderItem={({ item }) => (
            <AlarmRow
              alarm={item}
              onPress={() => router.push(`/alarm-edit?id=${item.id}` as Href)}
              onToggle={(enabled) => toggleAlarm(item.id, enabled)}
            />
          )}
          contentContainerStyle={{ paddingBottom: 40 }}
        />
      )}

      <View style={{ paddingBottom: insets.bottom }}>
        <BioSynCarePromo />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  title: { color: colors.textPrimary, fontSize: 32, fontWeight: "700" },
  addButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.amberFaint,
    borderWidth: 1,
    borderColor: colors.amberDim,
    alignItems: "center",
    justifyContent: "center",
  },
  addButtonText: { color: colors.amber, fontSize: 24, lineHeight: 26, fontWeight: "400" },
  list: { flex: 1 },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: 6 },
  emptyText: { color: colors.textSecondary, fontSize: 16 },
  emptySubtext: { color: colors.textMuted, fontSize: 13 },
  banner: {
    marginHorizontal: 20,
    marginBottom: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.amberFaint,
  },
  bannerText: { color: colors.amber, fontSize: 12 },
  diagnosticsLink: {
    textAlign: "center",
    color: colors.textMuted,
    fontSize: 11,
    paddingVertical: 14,
  },
});
