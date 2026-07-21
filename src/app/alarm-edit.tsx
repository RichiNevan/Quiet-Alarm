import DateTimePicker, {
  type DateTimePickerEvent,
} from "@react-native-community/datetimepicker";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useMemo, useState } from "react";
import {
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { DurationPickerSheet } from "../components/alarms/DurationPickerSheet";
import { PresetPickerSheet } from "../components/alarms/PresetPickerSheet";
import { WeekdayPicker } from "../components/alarms/WeekdayPicker";
import { getPreset } from "../lib/alarms/presets";
import { DEFAULT_DURATION_SECONDS, formatDuration } from "../lib/alarms/timing";
import { useAlarms } from "../lib/alarms/useAlarms";
import { colors } from "../theme/colors";

function defaultTime(): { hour: number; minute: number } {
  const now = new Date();
  now.setMinutes(now.getMinutes() + 5);
  return { hour: now.getHours(), minute: now.getMinutes() };
}

export default function AlarmEditScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { alarms, addAlarm, updateAlarm, removeAlarm } = useAlarms();

  const existing = useMemo(() => alarms.find((a) => a.id === id), [alarms, id]);
  const isNew = !existing;

  const [time, setTime] = useState(() =>
    existing ? { hour: existing.hour, minute: existing.minute } : defaultTime(),
  );
  const [presetId, setPresetId] = useState(existing?.presetId ?? "morningActivation");
  const [durationSeconds, setDurationSeconds] = useState(
    existing?.durationSeconds ?? DEFAULT_DURATION_SECONDS,
  );
  const [repeatDays, setRepeatDays] = useState<number[]>(existing?.repeatDays ?? []);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [durationPickerOpen, setDurationPickerOpen] = useState(false);

  const pickerDate = useMemo(() => {
    const d = new Date();
    d.setHours(time.hour, time.minute, 0, 0);
    return d;
  }, [time]);

  const onTimeChange = (_event: DateTimePickerEvent, selected?: Date) => {
    if (selected) setTime({ hour: selected.getHours(), minute: selected.getMinutes() });
  };

  const save = async () => {
    const draft = {
      hour: time.hour,
      minute: time.minute,
      presetId,
      durationSeconds,
      repeatDays,
      enabled: true,
    };
    if (existing) {
      await updateAlarm(existing.id, draft);
    } else {
      await addAlarm(draft);
    }
    router.back();
  };

  const confirmDelete = () => {
    Alert.alert("Delete alarm?", undefined, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          if (existing) await removeAlarm(existing.id);
          router.back();
        },
      },
    ]);
  };

  return (
    <View style={styles.container}>
      <View style={styles.topBar}>
        <Pressable onPress={() => router.back()}>
          <Text style={styles.topBarAction}>Cancel</Text>
        </Pressable>
        <Text style={styles.topBarTitle}>{isNew ? "New Alarm" : "Edit Alarm"}</Text>
        <Pressable onPress={save}>
          <Text style={[styles.topBarAction, styles.saveAction]}>Save</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.pickerWrap}>
          <DateTimePicker
            value={pickerDate}
            mode="time"
            display={Platform.OS === "ios" ? "spinner" : "default"}
            themeVariant="dark"
            onChange={onTimeChange}
          />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Repeat</Text>
          <WeekdayPicker selected={repeatDays} onChange={setRepeatDays} />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Sound</Text>
          <Pressable style={styles.row} onPress={() => setPickerOpen(true)}>
            <Text style={styles.rowValue}>{getPreset(presetId).label}</Text>
            <Text style={styles.chevron}>›</Text>
          </Pressable>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Session length</Text>
          <Pressable style={styles.row} onPress={() => setDurationPickerOpen(true)}>
            <Text style={styles.rowValue}>{formatDuration(durationSeconds)}</Text>
            <Text style={styles.chevron}>›</Text>
          </Pressable>
        </View>

        {!isNew && (
          <Pressable style={styles.deleteRow} onPress={confirmDelete}>
            <Text style={styles.deleteText}>Delete Alarm</Text>
          </Pressable>
        )}
      </ScrollView>

      <PresetPickerSheet
        visible={pickerOpen}
        selectedId={presetId}
        onSelect={setPresetId}
        onClose={() => setPickerOpen(false)}
      />

      <DurationPickerSheet
        visible={durationPickerOpen}
        seconds={durationSeconds}
        onChange={setDurationSeconds}
        onClose={() => setDurationPickerOpen(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: 60,
    paddingHorizontal: 20,
    paddingBottom: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  topBarTitle: { color: colors.textPrimary, fontSize: 16, fontWeight: "600" },
  topBarAction: { color: colors.textSecondary, fontSize: 16 },
  saveAction: { color: colors.amber, fontWeight: "700" },
  content: { padding: 20, gap: 28 },
  pickerWrap: { alignItems: "center" },
  section: { gap: 12 },
  sectionLabel: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.surface,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  rowValue: { color: colors.textPrimary, fontSize: 16 },
  chevron: { color: colors.textMuted, fontSize: 18 },
  deleteRow: { alignItems: "center", paddingVertical: 16 },
  deleteText: { color: colors.danger, fontSize: 16, fontWeight: "600" },
});
