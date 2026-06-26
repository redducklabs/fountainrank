import { useEffect, useState } from "react";
import { AccessibilityInfo, Animated, StyleSheet, View } from "react-native";

import { colors } from "../../theme";

export function WaterCelebration({
  triggerKey,
  bottom = 64,
}: {
  triggerKey: number;
  bottom?: number;
}) {
  const [progress] = useState(() => new Animated.Value(0));
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (triggerKey === 0) return;
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((reduce) => {
        if (cancelled || reduce) return;
        setVisible(true);
        progress.setValue(0);
        Animated.timing(progress, {
          toValue: 1,
          duration: 900,
          useNativeDriver: true,
        }).start(() => setVisible(false));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [progress, triggerKey]);

  if (!visible) return null;
  const droplets = [-36, -18, 0, 18, 36];
  return (
    <View pointerEvents="none" style={[styles.celebration, { bottom }]}>
      {droplets.map((x, index) => (
        <Animated.View
          key={`${triggerKey}-${x}`}
          style={[
            styles.droplet,
            {
              opacity: progress.interpolate({
                inputRange: [0, 0.2, 1],
                outputRange: [0, 1, 0],
              }),
              transform: [
                { translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [0, x] }) },
                {
                  translateY: progress.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0, -72 - index * 8],
                  }),
                },
                {
                  scale: progress.interpolate({
                    inputRange: [0, 0.4, 1],
                    outputRange: [0.4, 1, 0.7],
                  }),
                },
              ],
            },
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  celebration: {
    position: "absolute",
    left: 0,
    right: 0,
    alignItems: "center",
  },
  droplet: {
    position: "absolute",
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: "#5FC5F0",
    borderColor: colors.onBrand,
    borderWidth: 1,
  },
});
