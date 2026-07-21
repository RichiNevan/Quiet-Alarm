import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { colors } from "../../theme/colors";

const LABELS = ["S", "M", "T", "W", "T", "F", "S"];

export function WeekdayPicker({
  selected,
  onChange,
}: {
  selected: number[];
  onChange: (days: number[]) => void;
}) {
  const toggle = (day: number) => {
    onChange(
      selected.includes(day)
        ? selected.filter((d) => d !== day)
        : [...selected, day].sort(),
    );
  };

  return (
    <View style={styles.row}>
      {LABELS.map((label, day) => {
        const active = selected.includes(day);
        return (
          <Pressable
            key={day}
            onPress={() => toggle(day)}
            style={[styles.dot, active && styles.dotActive]}
          >
            <Text style={[styles.label, active && styles.labelActive]}>
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", justifyContent: "space-between", gap: 6 },
  dot: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
  },
  dotActive: {
    backgroundColor: colors.amberFaint,
    borderColor: colors.amberDim,
  },
  label: { color: colors.textMuted, fontSize: 13, fontWeight: "600" },
  labelActive: { color: colors.amber },
});
