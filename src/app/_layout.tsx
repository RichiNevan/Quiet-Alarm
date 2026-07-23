import { ensureCustomNodesInstalled } from "@biosyncare/audio-engine";
import { BottomSheetModalProvider } from "@gorhom/bottom-sheet";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";

import { colors } from "../theme/colors";

export default function RootLayout() {
  // Installs the custom C++ node factories (createBinauralNode etc.) as JSI
  // globals — required once before ANY SessionManager/AudioContext use.
  // Idempotent and cheap once installed; the alarm engine also calls this
  // defensively right before each arm/render, per INTEGRATION.md.
  useEffect(() => {
    if (!ensureCustomNodesInstalled()) {
      console.error(
        "Custom audio node factories failed to install — audio playback will not work.",
      );
    }
  }, []);

  return (
    // Required at the app root for any react-native-gesture-handler gesture
    // (TimeWheelPicker's Pan) to receive touches at all — without this the
    // wheel renders but silently never responds to drags.
    <GestureHandlerRootView style={{ flex: 1 }}>
      <BottomSheetModalProvider>
        <View style={{ flex: 1, backgroundColor: colors.background }}>
          <StatusBar style="light" />
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: colors.background },
              animation: "slide_from_bottom",
            }}
          />
        </View>
      </BottomSheetModalProvider>
    </GestureHandlerRootView>
  );
}
