import {
  BottomSheetBackdrop,
  type BottomSheetBackdropProps,
  BottomSheetModal,
  BottomSheetView,
} from "@gorhom/bottom-sheet";
import React, { useCallback, useEffect, useRef, type ComponentRef } from "react";
import { StyleSheet, Text } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { PRESETS } from "../../lib/alarms/presets";
import type { PresetId } from "../../lib/alarms/types";
import { colors } from "../../theme/colors";
import { PresetCard } from "./PresetCard";

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
  const sheetRef = useRef<ComponentRef<typeof BottomSheetModal>>(null);
  const hasPresentedRef = useRef(false);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (visible) {
      hasPresentedRef.current = true;
      sheetRef.current?.present();
    } else if (hasPresentedRef.current) {
      // Only dismiss once the sheet has actually been presented — calling
      // dismiss() before the first present() trips up BottomSheetModal's
      // internal status tracking and silently blocks future present() calls.
      sheetRef.current?.dismiss();
    }
  }, [visible]);

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        appearsOnIndex={0}
        disappearsOnIndex={-1}
        opacity={0.6}
        pressBehavior="close"
      />
    ),
    [],
  );

  return (
    <BottomSheetModal
      ref={sheetRef}
      enableDynamicSizing
      onDismiss={onClose}
      backdropComponent={renderBackdrop}
      backgroundStyle={styles.sheetBackground}
      handleIndicatorStyle={styles.handleIndicator}
    >
      <BottomSheetView style={[styles.content, { paddingBottom: 20 + insets.bottom }]}>
        <Text style={styles.title}>Sound</Text>
        {PRESETS.map((preset) => (
          <PresetCard
            key={preset.id}
            icon={preset.icon}
            title={preset.label}
            description={preset.description}
            active={preset.id === selectedId}
            onPress={() => {
              onSelect(preset.id);
              onClose();
            }}
          />
        ))}
      </BottomSheetView>
    </BottomSheetModal>
  );
}

const styles = StyleSheet.create({
  sheetBackground: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  handleIndicator: { backgroundColor: colors.border, width: 40 },
  content: { paddingHorizontal: 20, paddingTop: 4, gap: 12 },
  title: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 4,
  },
});
