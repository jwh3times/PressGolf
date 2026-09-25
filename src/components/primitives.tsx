import React from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  type StyleProp,
  type TextProps,
  type TextStyle,
  useWindowDimensions,
  View,
  type ViewStyle,
} from 'react-native';
import { colors, eyebrow, fill, fonts, ink, line, moneyColor, radius } from '../theme/tokens';
import {
  MAX_CONTROL_SCALE,
  scaledTypeMetrics,
  useAccessibilityControlScale,
} from '../hooks/useLargeText';

function ScaledText({
  size,
  baseLineHeight,
  style,
  ...props
}: TextProps & {
  size: number;
  baseLineHeight: number;
  style?: StyleProp<TextStyle>;
}) {
  const { fontScale } = useWindowDimensions();

  return (
    <Text
      {...props}
      allowFontScaling={false}
      style={[style, scaledTypeMetrics(size, baseLineHeight, fontScale)]}
    />
  );
}

/** Section label: 10px mono, wide tracking, uppercase. */
export function Eyebrow({ children, style }: { children: React.ReactNode; style?: TextStyle }) {
  return (
    <ScaledText size={10} baseLineHeight={14} style={[eyebrow, style]}>
      {children}
    </ScaledText>
  );
}

/** The Instrument Serif display face, used for every big number and headline. */
export function Display({
  children,
  size = 32,
  style,
}: {
  children: React.ReactNode;
  size?: number;
  style?: TextStyle;
}) {
  return (
    <Text style={[{ fontFamily: fonts.serif, fontSize: size, lineHeight: size * 1.05, color: ink.full }, style]}>
      {children}
    </Text>
  );
}

export function Body({ children, style, ...rest }: TextProps & { children: React.ReactNode }) {
  return (
    <Text {...rest} style={[{ fontFamily: fonts.sans, fontSize: 13, color: ink.body }, style]}>
      {children}
    </Text>
  );
}

export function Mono({
  children,
  size = 12,
  weight = 'regular',
  style,
}: {
  children: React.ReactNode;
  size?: number;
  weight?: 'regular' | 'medium' | 'bold';
  style?: TextStyle;
}) {
  const family =
    weight === 'bold' ? fonts.monoBold : weight === 'medium' ? fonts.monoMedium : fonts.mono;
  return (
    <ScaledText
      size={size}
      baseLineHeight={size * 1.4}
      style={[{ fontFamily: family, color: ink.body }, style]}
    >
      {children}
    </ScaledText>
  );
}

/** Player bubble. Colour comes from the player, so two people never read alike. */
export function Avatar({
  initials,
  color,
  size = 30,
  style,
}: {
  initials: string;
  color: string;
  size?: number;
  style?: ViewStyle;
}) {
  const controlScale = useAccessibilityControlScale(1.5);
  const scaledSize = size * controlScale;

  return (
    <View
      style={[
        {
          width: scaledSize,
          height: scaledSize,
          borderRadius: 999,
          backgroundColor: `${color}22`,
          borderWidth: 1,
          borderColor: `${color}66`,
          alignItems: 'center',
          justifyContent: 'center',
        },
        style,
      ]}
    >
      <Text
        maxFontSizeMultiplier={1.5}
        style={{
          fontFamily: fonts.monoBold,
          fontSize: size < 28 ? 10 : 10.5,
          color,
          letterSpacing: 0.2,
        }}
      >
        {initials}
      </Text>
    </View>
  );
}

/** Mono money figure, coloured by sign. */
export function Money({
  cents,
  label,
  size = 12.5,
  style,
}: {
  cents: number;
  label: string;
  size?: number;
  style?: TextStyle;
}) {
  return (
    <ScaledText
      size={size}
      baseLineHeight={size * 1.4}
      style={[
        { fontFamily: fonts.monoBold, color: moneyColor(cents) },
        style,
      ]}
    >
      {label}
    </ScaledText>
  );
}

export function Card({
  children,
  style,
  deep,
}: {
  children: React.ReactNode;
  style?: ViewStyle;
  deep?: boolean;
}) {
  return (
    <View
      style={[
        {
          backgroundColor: deep ? colors.cardDeep : colors.card,
          borderWidth: 1,
          borderColor: line.card,
          borderRadius: radius.panel,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

/** The green primary action. */
export function PrimaryButton({
  label,
  onPress,
  disabled,
  style,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  style?: ViewStyle;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      onPress={disabled ? undefined : onPress}
      style={({ pressed }) => [
        {
          backgroundColor: colors.accent,
          borderRadius: radius.panel,
          paddingVertical: 16,
          paddingHorizontal: 20,
          alignItems: 'center',
          opacity: disabled ? 0.35 : pressed ? 0.85 : 1,
        },
        style,
      ]}
    >
      <ScaledText
        size={15}
        baseLineHeight={20}
        style={{
          alignSelf: 'stretch',
          fontFamily: fonts.sansBold,
          color: colors.screen,
          textAlign: 'center',
        }}
      >
        {label}
      </ScaledText>
    </Pressable>
  );
}

/** Outlined secondary action. */
export function GhostButton({
  label,
  onPress,
  dashed,
  style,
}: {
  label: string;
  onPress: () => void;
  dashed?: boolean;
  style?: ViewStyle;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        {
          borderWidth: 1,
          borderStyle: dashed ? 'dashed' : 'solid',
          borderColor: dashed ? line.dashed : line.button,
          borderRadius: radius.card,
          paddingVertical: 13,
          paddingHorizontal: 16,
          alignItems: 'center',
          opacity: pressed ? 0.6 : 1,
        },
        style,
      ]}
    >
      <ScaledText
        size={13.5}
        baseLineHeight={18}
        style={{
          alignSelf: 'stretch',
          fontFamily: fonts.sans,
          color: dashed ? ink.muted : ink.body,
          textAlign: 'center',
        }}
      >
        {label}
      </ScaledText>
    </Pressable>
  );
}

/** −/+ control used for scores, pops and stakes. */
export function Stepper({
  value,
  onDecrement,
  onIncrement,
  size = 32,
  valueStyle,
  minWidth = 44,
}: {
  value: string;
  onDecrement: () => void;
  onIncrement: () => void;
  size?: number;
  valueStyle?: TextStyle;
  minWidth?: number;
}) {
  const controlScale = useAccessibilityControlScale();

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
      {/* JSX string attributes are not escape-processed, so the minus sign has
          to come through an expression or it renders as literal backslash-u. */}
      <StepperButton label={'−'} onPress={onDecrement} size={size} />
      <Text
        maxFontSizeMultiplier={MAX_CONTROL_SCALE}
        style={[
          {
            fontFamily: fonts.monoBold,
            fontSize: 15,
            lineHeight: 20,
            color: ink.full,
            minWidth: minWidth * controlScale,
            textAlign: 'center',
          },
          valueStyle,
        ]}
      >
        {value}
      </Text>
      <StepperButton label="+" onPress={onIncrement} size={size} />
    </View>
  );
}

export function StepperButton({
  label,
  accessibilityLabel,
  onPress,
  size = 32,
}: {
  label: string;
  accessibilityLabel?: string;
  onPress: () => void;
  size?: number;
}) {
  const controlScale = useAccessibilityControlScale();
  const scaledSize = size * controlScale;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? (label === '+' ? 'increase' : 'decrease')}
      onPress={onPress}
      // Hit slop keeps these tappable with a glove on in February.
      hitSlop={6}
      style={({ pressed }) => ({
        width: scaledSize,
        height: scaledSize,
        borderRadius: scaledSize / 3,
        backgroundColor: fill.control,
        borderWidth: 1,
        borderColor: line.control,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <Text
        maxFontSizeMultiplier={MAX_CONTROL_SCALE}
        style={{ fontFamily: fonts.sans, fontSize: size / 2, color: ink.full, lineHeight: size / 2 + 2 }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/** The pill switch on format cards. */
export function Switch({ on, onToggle, label }: { on: boolean; onToggle: () => void; label?: string }) {
  const controlScale = useAccessibilityControlScale();

  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: on }}
      accessibilityLabel={label}
      onPress={onToggle}
      hitSlop={8}
      style={{
        width: 46 * controlScale,
        height: 27 * controlScale,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: on ? colors.accent : line.avatar,
        backgroundColor: on ? colors.accent : fill.control,
        padding: 2 * controlScale,
        justifyContent: 'center',
        alignItems: on ? 'flex-end' : 'flex-start',
      }}
    >
      <View
        style={{
          width: 21 * controlScale,
          height: 21 * controlScale,
          borderRadius: 999,
          backgroundColor: on ? colors.screen : ink.muted,
        }}
      />
    </Pressable>
  );
}

/** Small tappable mono pill — junk, partner picks, filters. */
export function Chip({
  label,
  active,
  color = colors.clay,
  onPress,
  disabled,
}: {
  label: string;
  active?: boolean;
  color?: string;
  onPress?: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: !!active, disabled: !!disabled }}
      onPress={disabled ? undefined : onPress}
      hitSlop={6}
      style={({ pressed }) => ({
        backgroundColor: active ? `${color}22` : 'transparent',
        borderWidth: 1,
        borderColor: active ? `${color}88` : line.control,
        borderRadius: 999,
        paddingVertical: 4,
        paddingHorizontal: 9,
        opacity: pressed && !disabled ? 0.6 : 1,
      })}
    >
      <Text
        style={{
          fontFamily: fonts.mono,
          fontSize: 10,
          letterSpacing: 0.85,
          color: active ? color : ink.quiet,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/** Coloured square used as a legend dot next to a format name. */
export function GameDot({ color, size = 9 }: { color: string; size?: number }) {
  return <View style={{ width: size, height: size, borderRadius: 3, backgroundColor: color }} />;
}

export function Divider({ style }: { style?: ViewStyle }) {
  return <View style={[{ height: 1, backgroundColor: line.bright }, style]} />;
}

/** Centred placeholder for "nothing here yet" states. */
export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <View style={styles.empty}>
      <Display size={24} style={{ textAlign: 'center' }}>
        {title}
      </Display>
      <Body style={{ textAlign: 'center', color: ink.soft, lineHeight: 19 }}>{body}</Body>
      {action}
    </View>
  );
}

const styles = StyleSheet.create({
  empty: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: line.dashed,
    borderRadius: radius.format,
    padding: 24,
    gap: 12,
    alignItems: 'center',
  },
});
