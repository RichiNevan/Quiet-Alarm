import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { colors } from "../../theme/colors";
import BSIcon, { type BSIconName } from "../BSIcon";

export function PresetCard({
  icon,
  title,
  description,
  active,
  onPress,
}: {
  icon: BSIconName;
  title: string;
  description: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        active && styles.cardActive,
        pressed && styles.cardPressed,
      ]}
    >
      <View style={[styles.iconWrap, active && styles.iconWrapActive]}>
        <BSIcon name={icon} size={43} color={active ? colors.amber : colors.textSecondary} />
      </View>
      <View style={styles.textBlock}>
        <Text style={[styles.title, active && styles.titleActive]}>{title}</Text>
        <Text style={styles.description} numberOfLines={2}>
          {description}
        </Text>
      </View>
      {active && <Text style={styles.check}>✓</Text>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardActive: {
    borderColor: colors.amberDim,
    backgroundColor: colors.surfaceRaised,
  },
  cardPressed: { opacity: 0.8 },
  iconWrap: {
    width: 48,
    height: 48,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
  },
  iconWrapActive: {
    backgroundColor: colors.amberFaint,
    borderColor: colors.amberDim,
  },
  textBlock: { flex: 1, gap: 3 },
  title: { color: colors.textPrimary, fontSize: 16, fontWeight: "600" },
  titleActive: { color: colors.amber },
  description: { color: colors.textSecondary, fontSize: 12.5, lineHeight: 17 },
  check: { color: colors.amber, fontSize: 17, fontWeight: "700" },
});
