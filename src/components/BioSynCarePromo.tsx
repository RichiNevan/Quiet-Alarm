import { BlurView } from "expo-blur";
import { Image } from "expo-image";
import React from "react";
import { Linking, Platform, Pressable, StyleSheet, Text, View } from "react-native";

import { colors } from "../theme/colors";

const STORE_URL = Platform.select({
  ios: "https://apps.apple.com/it/app/biosyncare/id6754856451",
  default: "https://play.google.com/store/apps/details?id=com.biosyncare.app",
});

export function BioSynCarePromo() {
  return (
    <Pressable
      onPress={() => {
        Linking.openURL(STORE_URL).catch((e) =>
          console.warn("[BioSynCarePromo] failed to open store URL", e),
        );
      }}
      style={({ pressed }) => [styles.wrap, pressed && styles.pressed]}
    >
      <BlurView intensity={40} tint="dark" style={styles.blur}>
        <View style={styles.content}>
          <Image
            source={require("../../assets/images/BSCIcon.png")}
            style={styles.icon}
            contentFit="cover"
          />
          <Text style={styles.text}>
            This app is part of the BioSynCare ecosystem, and uses its audio
            engine. Get to know the official BioSynCare app!
          </Text>
        </View>
      </BlurView>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginHorizontal: 20,
    marginBottom: 18,
    borderRadius: 16,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: colors.border,
  },
  pressed: { opacity: 0.8 },
  blur: {
    backgroundColor: "rgba(201, 162, 39, 0.06)",
  },
  content: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  icon: {
    width: 44,
    height: 44,
    borderRadius: 12,
  },
  text: {
    flex: 1,
    color: colors.textSecondary,
    fontSize: 12.5,
    lineHeight: 17,
  },
});
