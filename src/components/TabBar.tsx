import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import React from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { BottomTabBarProps } from 'expo-router/js-tabs';
import { colors, fonts, ink, line, radius } from '../theme/tokens';

/**
 * The floating glass pill from the design.
 *
 * It sits 26px above the safe area rather than filling the bottom edge, which
 * is why it is a custom bar and not the stock one — screens pad their own
 * content to clear it.
 */
const GLYPHS: Record<string, string> = {
  index: '◆',
  format: '≡',
  score: '●',
  settle: '$',
};

const LABELS: Record<string, string> = {
  index: 'Home',
  format: 'Format',
  score: 'Score',
  settle: 'Settle',
};

export function TabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();

  return (
    <View
      pointerEvents="box-none"
      style={[styles.wrap, { bottom: Math.max(insets.bottom, 10) + 16 }]}
    >
      <BlurView
        intensity={Platform.OS === 'android' ? 0 : 40}
        tint="dark"
        style={styles.bar}
      >
        {state.routes.map((route, index) => {
          const focused = state.index === index;
          const color = focused ? colors.accent : ink.soft;
          return (
            <Pressable
              key={route.key}
              accessibilityRole="tab"
              accessibilityState={{ selected: focused }}
              accessibilityLabel={LABELS[route.name] ?? route.name}
              onPress={() => {
                if (!focused) {
                  // A light tick makes the bar feel physical when you are not
                  // looking at the phone, which is most of a round.
                  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
                  navigation.navigate(route.name);
                }
              }}
              style={styles.tab}
            >
              <Text style={[styles.glyph, { color, opacity: focused ? 1 : 0.75 }]}>
                {GLYPHS[route.name] ?? '●'}
              </Text>
              <Text style={[styles.label, { color }]}>{LABELS[route.name] ?? route.name}</Text>
            </Pressable>
          );
        })}
      </BlurView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 14, right: 14 },
  bar: {
    height: 62,
    borderRadius: radius.hero,
    // Android has no backdrop filter, so the pill carries its own near-opaque
    // fill; on iOS the blur does the work and this tints it.
    backgroundColor: Platform.OS === 'android' ? 'rgba(18,25,20,.97)' : colors.glass,
    borderWidth: 1,
    borderColor: line.bright,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    overflow: 'hidden',
  },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: 8 },
  glyph: { fontSize: 13, lineHeight: 15, fontFamily: fonts.sans },
  label: { fontSize: 10, letterSpacing: 0.38, fontFamily: fonts.sans },
});

/** How much bottom padding a screen needs so content clears the floating bar. */
export const TAB_BAR_CLEARANCE = 110;
