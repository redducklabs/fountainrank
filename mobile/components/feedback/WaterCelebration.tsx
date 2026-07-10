import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Image, StyleSheet, View } from "react-native";

import { colors } from "../../theme";

export function WaterCelebration({
  triggerKey,
  points,
}: {
  triggerKey: number;
  points?: number | null;
}) {
  const [progress] = useState(() => new Animated.Value(0));
  const [visible, setVisible] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const animationRef = useRef<Animated.CompositeAnimation | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (triggerKey === 0) return;
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((reduce) => {
        if (cancelled) return;
        setReduceMotion(reduce);
        setVisible(true);
        progress.setValue(0);
        if (reduce) {
          timeoutRef.current = setTimeout(() => {
            if (!cancelled) setVisible(false);
          }, 1200);
          return;
        }
        const animation = Animated.timing(progress, {
          toValue: 1,
          duration: 1200,
          useNativeDriver: true,
        });
        animationRef.current = animation;
        animation.start(({ finished }) => {
          animationRef.current = null;
          if (!cancelled && finished) setVisible(false);
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
      animationRef.current?.stop();
      animationRef.current = null;
    };
  }, [progress, triggerKey]);

  if (!visible) return null;
  const droplets = [-126, -84, -42, 0, 42, 84, 126];
  return (
    <View pointerEvents="none" style={styles.celebration}>
      <Animated.View
        style={[
          styles.burst,
          reduceMotion
            ? null
            : {
                opacity: progress.interpolate({
                  inputRange: [0, 0.18, 0.8, 1],
                  outputRange: [0, 1, 1, 0],
                }),
                transform: [
                  {
                    scale: progress.interpolate({
                      inputRange: [0, 0.32, 1],
                      outputRange: [0.7, 1.08, 0.96],
                    }),
                  },
                ],
              },
        ]}
      >
        <Image
          source={require("../../assets/logo-pin.png")}
          style={styles.pin}
          resizeMode="contain"
        />
        {points != null && points > 0 ? (
          <Animated.Text
            accessibilityRole="text"
            style={[
              styles.pointsText,
              reduceMotion
                ? null
                : {
                    opacity: progress.interpolate({
                      inputRange: [0, 0.15, 0.85, 1],
                      outputRange: [0, 1, 1, 0],
                    }),
                  },
            ]}
          >
            {`+${points} points`}
          </Animated.Text>
        ) : null}
      </Animated.View>
      {reduceMotion
        ? null
        : droplets.map((x, index) => (
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
                    {
                      translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [0, x] }),
                    },
                    {
                      translateY: progress.interpolate({
                        inputRange: [0, 1],
                        outputRange: [0, -140 - (index % 3) * 22],
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
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: "center",
    justifyContent: "center",
    // Lighter scrim than before so the moment reads as an overlay, not a page/modal change (#2).
    backgroundColor: "rgba(10, 53, 126, 0.10)",
  },
  burst: {
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 999,
    // White pill + gold ring so the blue FountainRank pin logo (#5) reads clearly against it.
    backgroundColor: colors.onBrand,
    borderColor: colors.brandYellow,
    borderWidth: 3,
    paddingHorizontal: 28,
    paddingVertical: 22,
    minWidth: 190,
  },
  pin: {
    width: 56,
    height: 56,
  },
  pointsText: {
    marginTop: 10,
    color: colors.brandBlue,
    fontSize: 24,
    lineHeight: 28,
    fontWeight: "900",
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
