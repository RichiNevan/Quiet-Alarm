import * as Haptics from "expo-haptics";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  Easing,
  runOnJS,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import Svg, { Circle, Defs, Line, LinearGradient, Path, Stop } from "react-native-svg";

import { formatDuration } from "../../lib/alarms/timing";
import { colors } from "../../theme/colors";

// Ported from another BioSynCare app's session-duration wheel. Kept the
// gesture/animation mechanics as-is; changed: theming (was hardcoded
// light-mode colors + that app's brand palette/text component/settings
// context, none of which exist here — this app has no light/dark toggle,
// it's always the black/amber theme) and added a min/max clamp (a 0-second
// or multi-hour-via-repeated-spins session doesn't make sense for an alarm).

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

const STROKE_WIDTH = 18;
const SECONDS_PER_ROTATION = 3600;
// Cap the wheel so it stays hand-sized on iPads and on Mac, where the
// window can be far wider than any phone.
const MAX_WHEEL_SIZE = 360;

// One full rotation = the wheel's natural visual ceiling (60 min); a lower
// floor keeps the ramp-in/fade-out envelope meaningful (see
// src/lib/alarms/timing.ts).
const MIN_SECONDS = 60;
const MAX_SECONDS = SECONDS_PER_ROTATION;
const MIN_ANGLE = (MIN_SECONDS / SECONDS_PER_ROTATION) * Math.PI * 2;
const MAX_ANGLE = (MAX_SECONDS / SECONDS_PER_ROTATION) * Math.PI * 2;

type Props = {
  onChangeSeconds?: (seconds: number) => void;
  value?: number;
};

export default function TimeWheelPicker({ onChangeSeconds, value }: Props) {
  const { width, height } = useWindowDimensions();
  const size = Math.min(Math.min(width, height) * 0.82, MAX_WHEEL_SIZE);
  const radius = (size - STROKE_WIDTH) / 2;
  const center = size / 2;
  const [displayText, setDisplayText] = useState(formatDuration(MIN_SECONDS));
  const totalAngle = useSharedValue(0);
  const previousTouchAngle = useSharedValue(0);
  const arcProgress = useSharedValue(0);
  const lastHapticMinute = useSharedValue(-1);
  const circumference = 2 * Math.PI * radius;

  // Set the wheel's position from the value prop ONCE, on mount only. This
  // is deliberately not a synced-every-change controlled input: every
  // onChangeSeconds call round-trips through the parent and comes back down
  // as a new `value` prop, and re-applying it to the gesture's own
  // in-progress shared values on every one of those commits fought the live
  // drag (visible as the wheel "resetting" mid-gesture) and, combined with
  // high-frequency reporting, blew past React's nested-update limit
  // ("Maximum update depth exceeded"). See onUpdate below for the other
  // half of that fix (report on minute-change only, not every pixel).
  const didInitialize = useRef(false);
  useEffect(() => {
    if (didInitialize.current) return;
    if (typeof value !== "number" || isNaN(value)) return;
    didInitialize.current = true;
    const clamped = Math.min(Math.max(value, MIN_SECONDS), MAX_SECONDS);
    const angle = (clamped / SECONDS_PER_ROTATION) * (Math.PI * 2);
    totalAngle.value = angle;
    arcProgress.value = clamped / SECONDS_PER_ROTATION;
    setDisplayText(formatDuration(clamped));
  }, [value, arcProgress, totalAngle]);

  const triggerHaptic = async () => {
    try {
      await Haptics.selectionAsync();
    } catch {
      // haptics unavailable — not worth surfacing
    }
  };

  const updateDuration = (seconds: number) => {
    onChangeSeconds?.(seconds);
    setDisplayText(formatDuration(seconds));
  };

  const animatedArcProps = useAnimatedProps(() => {
    return {
      strokeDashoffset: circumference * (1 - arcProgress.value),
    };
  });

  const getAngle = (x: number, y: number) => {
    "worklet";
    return Math.atan2(y - center, x - center);
  };

  const gesture = Gesture.Pan()
    .onBegin((e) => {
      previousTouchAngle.value = getAngle(e.x, e.y);
    })
    .onUpdate((e) => {
      const currentAngle = getAngle(e.x, e.y);
      let delta = currentAngle - previousTouchAngle.value;

      if (delta > Math.PI) {
        delta -= Math.PI * 2;
      } else if (delta < -Math.PI) {
        delta += Math.PI * 2;
      }

      // Clamp the accumulator itself (not just a derived copy) so reversing
      // direction at the limit starts decreasing immediately, no dead zone.
      totalAngle.value = Math.min(
        Math.max(totalAngle.value + delta, MIN_ANGLE),
        MAX_ANGLE,
      );
      previousTouchAngle.value = currentAngle;

      const rawSeconds = (totalAngle.value / (Math.PI * 2)) * SECONDS_PER_ROTATION;
      const snappedSeconds = Math.round(rawSeconds / 60) * 60;

      arcProgress.value = totalAngle.value / (Math.PI * 2);

      // Gate reporting to actual minute changes, not every pixel of
      // movement — onUpdate can fire 60+ times/sec during a drag, and
      // reporting on every frame both spams the parent with redundant
      // identical updates and was the trigger for the update-depth error
      // above (see the mount-only effect comment for the other half).
      const minute = snappedSeconds / 60;
      if (minute !== lastHapticMinute.value) {
        lastHapticMinute.value = minute;
        runOnJS(triggerHaptic)();
        runOnJS(updateDuration)(snappedSeconds);
      }
    });

  const ticks = useMemo(() => {
    return Array.from({ length: 60 }).map((_, i) => {
      const angle = (i / 60) * Math.PI * 2;
      const isMajor = i % 5 === 0;
      const outer = radius - 12;
      const inner = outer - (isMajor ? 28 : 16);
      const x1 = center + Math.cos(angle - Math.PI / 2) * inner;
      const y1 = center + Math.sin(angle - Math.PI / 2) * inner;
      const x2 = center + Math.cos(angle - Math.PI / 2) * outer;
      const y2 = center + Math.sin(angle - Math.PI / 2) * outer;

      return (
        <Line
          key={i}
          x1={x1}
          y1={y1}
          x2={x2}
          y2={y2}
          stroke={isMajor ? colors.textSecondary : colors.textMuted}
          strokeWidth={isMajor ? 3 : 1.5}
          strokeLinecap="round"
        />
      );
    });
  }, [radius, center]);

  return (
    <View style={[styles.wrapper, { width: size + 120, maxWidth: width }]}>
      <Text style={styles.label}>{displayText}</Text>

      <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
        <CircularGestureHint size={size} radius={radius * 0.42} />

        <GestureDetector gesture={gesture}>
          <Animated.View style={{ position: "absolute", left: 0, top: 0 }}>
            <Svg width={size} height={size}>
              <Defs>
                <LinearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="0%">
                  <Stop offset="0%" stopColor={colors.amberDim} />
                  <Stop offset="100%" stopColor={colors.amber} />
                </LinearGradient>
              </Defs>
              <Circle
                cx={center}
                cy={center}
                r={radius}
                stroke={colors.surfaceRaised}
                strokeWidth={STROKE_WIDTH}
                fill={colors.surface}
              />
              <AnimatedCircle
                cx={center}
                cy={center}
                r={radius}
                stroke="url(#grad)"
                strokeWidth={STROKE_WIDTH}
                fill="transparent"
                strokeDasharray={circumference}
                animatedProps={animatedArcProps}
                strokeLinecap="round"
                rotation={-90}
                originX={center}
                originY={center}
              />
              {ticks}
            </Svg>
          </Animated.View>
        </GestureDetector>
      </View>
    </View>
  );
}

type HintProps = {
  size: number;
  radius: number;
  duration?: number;
  arrowColor?: string;
};

function CircularGestureHint({
  size,
  radius,
  duration = 5400,
  arrowColor = colors.textMuted,
}: HintProps) {
  const progress = useSharedValue(0);
  const center = size / 2;

  useEffect(() => {
    progress.value = withRepeat(withTiming(1, { duration, easing: Easing.linear }), -1, false);
  }, [duration, progress]);

  const arrow1Style = useAnimatedStyle(() => {
    const angle = progress.value * Math.PI * 2;
    const x = center + radius * Math.cos(angle);
    const y = center + radius * Math.sin(angle);
    return {
      position: "absolute",
      left: x - 16,
      top: y - 16,
      transform: [{ rotate: `${angle + Math.PI / 2}rad` }],
    };
  });

  const arrow2Style = useAnimatedStyle(() => {
    const angle = (progress.value + 0.5) * Math.PI * 2;
    const x = center + radius * Math.cos(angle);
    const y = center + radius * Math.sin(angle);
    return {
      position: "absolute",
      left: x - 16,
      top: y - 16,
      transform: [{ rotate: `${angle + Math.PI / 2}rad` }],
    };
  });

  return (
    <View
      pointerEvents="none"
      style={[styles.rotationHintsContainer, { width: size, height: size }]}
    >
      <Animated.View style={arrow1Style}>
        <Arrow color={arrowColor} />
      </Animated.View>
      <Animated.View style={arrow2Style}>
        <Arrow color={arrowColor} />
      </Animated.View>
    </View>
  );
}

function Arrow({ color }: { color: string }) {
  return (
    <Svg width={32} height={32} viewBox="0 0 24 24">
      <Path
        d="M8 5 L16 12 L8 19"
        stroke={color}
        strokeWidth={2.8}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 10,
    paddingBottom: 20,
    alignSelf: "center",
  },
  label: {
    fontSize: 32,
    marginBottom: 22,
    lineHeight: 38,
    color: colors.textPrimary,
    fontWeight: "300",
  },
  rotationHintsContainer: {
    position: "absolute",
    left: 0,
    top: 0,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 999,
  },
});
