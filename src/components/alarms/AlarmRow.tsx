import React from "react";
import { Pressable, StyleSheet, Switch, Text, View } from "react-native";

import { formatRepeat, formatTime } from "../../lib/alarms/nextOccurrence";
import { getPreset } from "../../lib/alarms/presets";
import { formatDuration } from "../../lib/alarms/timing";
import type { Alarm } from "../../lib/alarms/types";
import { colors } from "../../theme/colors";

export function AlarmRow({
  alarm,
  onPress,
  onToggle,
}: {
  alarm: Alarm;
  onPress: () => void;
  onToggle: (enabled: boolean) => void;
}) {
  const preset = getPreset(alarm.presetId);
  const dimmed = !alarm.enabled;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
    >
      <View style={styles.textBlock}>
        <Text style={[styles.time, dimmed && styles.dimmed]}>
          {formatTime(alarm.hour, alarm.minute)}
        </Text>
        <Text style={[styles.subtitle, dimmed && styles.dimmedMuted]}>
          {preset.label} · {formatDuration(alarm.durationSeconds)} ·{" "}
          {formatRepeat(alarm.repeatDays)}
          {alarm.label ? ` · ${alarm.label}` : ""}
        </Text>
      </View>
      <Switch
        value={alarm.enabled}
        onValueChange={onToggle}
        trackColor={{ false: colors.surfaceRaised, true: colors.amberFaint }}
        thumbColor={alarm.enabled ? colors.amber : colors.textMuted}
        ios_backgroundColor={colors.surfaceRaised}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 18,
    paddingHorizontal: 20,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowPressed: { backgroundColor: colors.surface },
  textBlock: { flex: 1, marginRight: 12 },
  time: {
    color: colors.textPrimary,
    fontSize: 34,
    fontWeight: "300",
    letterSpacing: 0.5,
  },
  subtitle: {
    color: colors.textSecondary,
    fontSize: 13,
    marginTop: 2,
  },
  dimmed: { color: colors.textMuted },
  dimmedMuted: { color: colors.textMuted },
});
