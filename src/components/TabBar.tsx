import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import symbolFont from 'expo-symbols/androidWeights/regular';
import React from 'react';
import { Platform, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { BottomTabBarProps } from 'expo-router/js-tabs';
import { makeStyles, useTheme } from '../theme/theme';
import { fonts, radius } from '../theme/tokens';
import { MAX_CONTROL_SCALE, accessibilityControlScale } from '../hooks/useLargeText';

export function tabBarHeight(fontScale: number): number {
  return 62 + (accessibilityControlScale(fontScale) - 1) * 30;
}

export function tabBarClearance(fontScale: number): number {
  return tabBarHeight(fontScale) + 48;
}

/**
 * The icon grows with accessibility type, but only to 1.5x: beyond that the
 * icon and its scaled label no longer fit the bar at `tabBarHeight`.
 */
export function tabIconSize(fontScale: number): number {
  return 24 * accessibilityControlScale(fontScale, 1.5);
}

/**
 * Fonts the root layout loads up front. Android and web draw the icons from the
 * Material Symbols font, which SymbolView otherwise loads itself after first
 * render, so the icons pop in late. iOS draws SF Symbols and needs none.
 */
export function tabIconFonts(os: typeof Platform.OS): Record<string, number> {
  return os === 'ios' ? {} : { [symbolFont.name]: symbolFont.font };
}

/**
 * The floating glass pill from the design.
 *
 * It sits 26px above the safe area rather than filling the bottom edge, which
 * is why it is a custom bar and not the stock one — screens pad their own
 * content to clear it.
 */
type SymbolName = SymbolViewProps['name'];

// SF Symbols on iOS; Material Symbols on Android and web.
const ICONS: Record<string, SymbolName> = {
  index: { ios: 'house.fill', android: 'home', web: 'home' },
  format: { ios: 'list.bullet', android: 'format_list_bulleted', web: 'format_list_bulleted' },
  score: { ios: 'square.and.pencil', android: 'edit_note', web: 'edit_note' },
  settle: { ios: 'dollarsign.circle', android: 'paid', web: 'paid' },
};

const FALLBACK_ICON: SymbolName = { ios: 'circle.fill', android: 'circle', web: 'circle' };

const LABELS: Record<string, string> = {
  index: 'Home',
  format: 'Format',
  score: 'Score',
  settle: 'Settle',
};

export function TabBar({ state, navigation }: BottomTabBarProps) {
  const styles = useStyles();
  const { colors, ink, scheme } = useTheme();
  const insets = useSafeAreaInsets();
  const { fontScale } = useWindowDimensions();

  return (
    <View
      pointerEvents="box-none"
      style={[styles.wrap, { bottom: Math.max(insets.bottom, 10) + 16 }]}
    >
      <BlurView
        accessibilityRole="tablist"
        intensity={Platform.OS === 'android' ? 0 : 40}
        tint={scheme}
        style={[styles.bar, { height: tabBarHeight(fontScale) }]}
      >
        {state.routes.map((route, index) => {
          const focused = state.index === index;
          const color = focused ? colors.accent : ink.soft;
          return (
            <Pressable
              key={route.key}
              accessibilityRole="tab"
              // aria-selected rather than accessibilityState: native reads both,
              // and react-native-web only maps the aria prop.
              aria-selected={focused}
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
              {/* The tab's label already names it; the icon is decoration. The
                  wrapper hides it because SymbolView does not forward aria-hidden,
                  and on web it draws a private-use font glyph a reader would announce. */}
              <View aria-hidden>
                <SymbolView
                  name={ICONS[route.name] ?? FALLBACK_ICON}
                  size={tabIconSize(fontScale)}
                  tintColor={color}
                  style={{ opacity: focused ? 1 : 0.75 }}
                />
              </View>
              <Text
                maxFontSizeMultiplier={MAX_CONTROL_SCALE}
                numberOfLines={1}
                style={[styles.label, { color }]}
              >
                {LABELS[route.name] ?? route.name}
              </Text>
            </Pressable>
          );
        })}
      </BlurView>
    </View>
  );
}

const useStyles = makeStyles(({ colors, line }) =>
  StyleSheet.create({
    wrap: { position: 'absolute', left: 14, right: 14 },
    bar: {
      borderRadius: radius.hero,
      // Android has no backdrop filter, so the pill carries its own near-opaque
      // fill; on iOS the blur does the work and this tints it.
      backgroundColor: Platform.OS === 'android' ? colors.glassSolid : colors.glass,
      borderWidth: 1,
      borderColor: line.bright,
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 8,
      overflow: 'hidden',
    },
    tab: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: 8 },
    label: { fontSize: 10, lineHeight: 14, letterSpacing: 0.2, fontFamily: fonts.sans },
  }),
);
