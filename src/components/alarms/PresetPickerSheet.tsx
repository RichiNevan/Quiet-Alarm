import React from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";

import { PRESETS } from "../../lib/alarms/presets";
import type { PresetId } from "../../lib/alarms/types";
import { colors } from "../../theme/colors";

export function PresetPickerSheet({
  visible,
  selectedId,
  onSelect,
  onClose,
}: {
  visible: boolean;
  selectedId: PresetId;
  onSelect: (id: PresetId) => void;
  onClose: () => void;
}) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <Text style={styles.title}>Sound</Text>
          {PRESETS.map((preset) => {
            const active = preset.id === selectedId;
            return (
              <Pressable
                key={preset.id}
                onPress={() => {
                  onSelect(preset.id);
                  onClose();
                }}
                style={({ pressed }) => [
                  styles.option,
                  active && styles.optionActive,
                  pressed && styles.optionPressed,
                ]}
              >
                <Text style={[styles.optionText, active && styles.optionTextActive]}>
                  {preset.label}
                </Text>
                {active && <Text style={styles.check}>✓</Text>}
              </Pressable>
            );
          })}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 16,
    paddingBottom: 32,
    paddingHorizontal: 20,
    borderTopWidth: 1,
    borderColor: colors.border,
  },
  title: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 12,
  },
  option: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  optionActive: {},
  optionPressed: { opacity: 0.7 },
  optionText: { color: colors.textPrimary, fontSize: 17 },
  optionTextActive: { color: colors.amber, fontWeight: "600" },
  check: { color: colors.amber, fontSize: 17, fontWeight: "700" },
});
