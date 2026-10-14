import React, { useEffect, useState } from 'react';
import { Animated, Easing, View } from 'react-native';
import { useTheme } from '../theme/theme';

/**
 * The breathing dot on the live-round card — the prototype's `pressPulse`
 * keyframes, 1.8s, opacity .35 to 1 and back.
 */
export function LivePulse({ size = 7, color }: { size?: number; color?: string }) {
  const { colors, tint } = useTheme();
  const dot = tint(color ?? colors.accent);
  // Lazy useState rather than useRef().current: the value is created once, and
  // React 19 treats reading a ref during render as a bug.
  const [opacity] = useState(() => new Animated.Value(0.35));

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 1,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0.35,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);

  return (
    <View style={{ width: size, height: size }}>
      <Animated.View
        style={{ width: size, height: size, borderRadius: 999, backgroundColor: dot, opacity }}
      />
    </View>
  );
}
