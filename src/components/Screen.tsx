import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, fonts, ink, line } from '../theme/tokens';
import { TAB_BAR_CLEARANCE } from './TabBar';

/**
 * Standard scrolling screen body.
 *
 * The prototype padded content 62px from the top and 110px from the bottom to
 * clear the status bar and the floating tab bar. Here the top comes from the
 * real safe area instead, so it is right on a notch, a punch-hole and a Pixel
 * alike, and the bottom clearance is only added on tab screens.
 */
export function Screen({
  children,
  style,
  contentStyle,
  floatingTabBar = true,
  scroll = true,
}: {
  children: React.ReactNode;
  style?: ViewStyle;
  contentStyle?: ViewStyle;
  floatingTabBar?: boolean;
  scroll?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const padding = {
    paddingTop: insets.top + 18,
    paddingBottom: (floatingTabBar ? TAB_BAR_CLEARANCE : 24) + insets.bottom,
    paddingHorizontal: 20,
  };

  if (!scroll) {
    return <View style={[styles.root, padding, style]}>{children}</View>;
  }

  return (
    <ScrollView
      style={[styles.root, style]}
      contentContainerStyle={[padding, styles.content, contentStyle]}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      {children}
    </ScrollView>
  );
}

/** Header for the pushed/modal screens, with a back affordance. */
export function ModalHeader({
  eyebrow,
  title,
  onClose,
  closeLabel = 'Done',
  right,
}: {
  eyebrow?: string;
  title: string;
  onClose: () => void;
  closeLabel?: string;
  right?: React.ReactNode;
}) {
  return (
    <View style={styles.header}>
      <View style={{ flex: 1, minWidth: 0 }}>
        {eyebrow ? <Text style={styles.headerEyebrow}>{eyebrow}</Text> : null}
        <Text style={styles.headerTitle}>{title}</Text>
      </View>
      {right}
      <Pressable accessibilityRole="button" onPress={onClose} hitSlop={10} style={styles.close}>
        <Text style={styles.closeLabel}>{closeLabel}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.screen },
  content: { gap: 22 },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  headerEyebrow: {
    fontFamily: fonts.mono,
    fontSize: 10,
    letterSpacing: 2,
    textTransform: 'uppercase',
    color: ink.faint,
  },
  headerTitle: { fontFamily: fonts.serif, fontSize: 32, lineHeight: 34, color: ink.full, marginTop: 3 },
  close: {
    borderWidth: 1,
    borderColor: line.button,
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  closeLabel: { fontFamily: fonts.sansSemi, fontSize: 12.5, color: ink.body },
});
