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
import { eyebrowStyle, makeStyles, useTheme } from '../theme/theme';
import { moneyColor, type Theme } from '../theme/themes';
import { fonts, MIN_TAP_TARGET, radius } from '../theme/tokens';
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
  const theme = useTheme();
  return (
    <ScaledText size={10} baseLineHeight={14} style={[eyebrowStyle(theme), style]}>
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
  const { ink } = useTheme();
  return (
    <Text style={[{ fontFamily: fonts.serif, fontSize: size, lineHeight: size * 1.05, color: ink.full }, style]}>
      {children}
    </Text>
  );
}

export function Body({ children, style, ...rest }: TextProps & { children: React.ReactNode }) {
  const { ink } = useTheme();
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
  const { ink } = useTheme();
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
  const theme = useTheme();
  return (
    <ScaledText
      size={size}
      baseLineHeight={size * 1.4}
      style={[
        { fontFamily: fonts.monoBold, color: moneyColor(theme, cents) },
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
  const { colors, line } = useTheme();
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
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      disabled={!!disabled}
      onPress={disabled ? undefined : onPress}
      style={({ pressed }) => [
        {
          backgroundColor: colors.accent,
          borderRadius: radius.panel,
          minHeight: MIN_TAP_TARGET,
          paddingVertical: 16,
          paddingHorizontal: 20,
          alignItems: 'center',
          justifyContent: 'center',
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
  const { ink, line } = useTheme();
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
          minHeight: MIN_TAP_TARGET,
          paddingVertical: 13,
          paddingHorizontal: 16,
          alignItems: 'center',
          justifyContent: 'center',
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
  decrementLabel,
  incrementLabel,
  disabled,
}: {
  value: string;
  onDecrement: () => void;
  onIncrement: () => void;
  size?: number;
  valueStyle?: TextStyle;
  minWidth?: number;
  /** Names for the buttons when "decrease" and "increase" alone would be ambiguous. */
  decrementLabel?: string;
  incrementLabel?: string;
  disabled?: boolean;
}) {
  const { ink } = useTheme();
  const controlScale = useAccessibilityControlScale();

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
      {/* JSX string attributes are not escape-processed, so the minus sign has
          to come through an expression or it renders as literal backslash-u. */}
      <StepperButton
        label={'−'}
        accessibilityLabel={decrementLabel}
        onPress={onDecrement}
        size={size}
        disabled={disabled}
      />
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
      <StepperButton
        label="+"
        accessibilityLabel={incrementLabel}
        onPress={onIncrement}
        size={size}
        disabled={disabled}
      />
    </View>
  );
}

export function StepperButton({
  label,
  accessibilityLabel,
  onPress,
  size = 32,
  disabled,
}: {
  label: string;
  accessibilityLabel?: string;
  onPress: () => void;
  size?: number;
  disabled?: boolean;
}) {
  const { ink, line, fill } = useTheme();
  const controlScale = useAccessibilityControlScale();
  const scaledSize = size * controlScale;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? (label === '+' ? 'increase' : 'decrease')}
      disabled={disabled}
      onPress={onPress}
      // Hit slop keeps these tappable with a glove on in February, and makes
      // up whatever the drawn size is short of the smallest tap target.
      hitSlop={Math.max(6, Math.ceil((MIN_TAP_TARGET - scaledSize) / 2))}
      style={({ pressed }) => ({
        width: scaledSize,
        height: scaledSize,
        borderRadius: scaledSize / 3,
        backgroundColor: fill.control,
        borderWidth: 1,
        borderColor: line.control,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: disabled ? 0.4 : pressed ? 0.6 : 1,
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
  const { colors, ink, line, fill } = useTheme();
  const controlScale = useAccessibilityControlScale();

  return (
    <Pressable
      accessibilityRole="switch"
      // aria-checked rather than accessibilityState: native reads both, and
      // react-native-web only maps the aria prop, so web would announce no state.
      aria-checked={on}
      accessibilityLabel={label}
      // The label repeats a visible title beside the switch; native flows tap
      // the switch by this id so they can't land on the title (.maestro/flows).
      testID={label ? `switch-${label}` : undefined}
      onPress={onToggle}
      hitSlop={{
        top: Math.max(8, Math.ceil((MIN_TAP_TARGET - 27 * controlScale) / 2)),
        bottom: Math.max(8, Math.ceil((MIN_TAP_TARGET - 27 * controlScale) / 2)),
        left: 8,
        right: 8,
      }}
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

/**
 * How far a chip's tap box stands clear of its pill, above and below. The box
 * takes no room for it: chips lay out by their pills and the boxes overlap the
 * space around them.
 */
const CHIP_OVERHANG = 12;
/**
 * The least space between wrapped lines of chips. Any less and the tap box of
 * the chip below would cover the foot of the pill above.
 */
export const CHIP_ROW_GAP = CHIP_OVERHANG;

/** Small tappable mono pill — junk, partner picks, filters. */
export function Chip({
  label,
  accessibilityLabel,
  active,
  color: chosen,
  onPress,
  disabled,
}: {
  label: string;
  /** When the visible label alone is ambiguous, e.g. a tee name repeated for every player. */
  accessibilityLabel?: string;
  active?: boolean;
  color?: string;
  onPress?: () => void;
  disabled?: boolean;
}) {
  const theme = useTheme();
  const color = chosen ?? theme.colors.clay;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected: !!active }}
      disabled={!!disabled}
      onPress={disabled ? undefined : onPress}
      // The pill is drawn small; the box around it is what a finger gets. The
      // margin gives back the height the padding adds, so a row of chips is as
      // tall as its pills.
      style={({ pressed }) => ({
        minWidth: MIN_TAP_TARGET,
        minHeight: MIN_TAP_TARGET,
        paddingVertical: CHIP_OVERHANG,
        marginVertical: -CHIP_OVERHANG,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: pressed && !disabled ? 0.6 : 1,
      })}
    >
      <View testID="chip-pill" style={chipBox(theme, color, active)}>
        <Text style={chipText(theme, color, active)}>{label}</Text>
      </View>
    </Pressable>
  );
}

/** A chip that reports a fact and does nothing, so it is read as text and not as a button. */
export function StatusChip({
  label,
  accessibilityLabel,
  color: chosen,
}: {
  label: string;
  /** When the visible label alone is ambiguous, e.g. a result repeated for every player. */
  accessibilityLabel?: string;
  color?: string;
}) {
  const theme = useTheme();
  const color = chosen ?? theme.colors.clay;
  return (
    <View
      accessible
      accessibilityRole="text"
      accessibilityLabel={accessibilityLabel}
      style={chipBox(theme, color, true)}
    >
      <Text style={chipText(theme, color, true)}>{label}</Text>
    </View>
  );
}

function chipBox({ line }: Theme, color: string, active?: boolean): ViewStyle {
  return {
    backgroundColor: active ? `${color}22` : 'transparent',
    borderWidth: 1,
    borderColor: active ? `${color}88` : line.control,
    borderRadius: 999,
    paddingVertical: 4,
    paddingHorizontal: 9,
  };
}

function chipText({ ink }: Theme, color: string, active?: boolean): TextStyle {
  return {
    fontFamily: fonts.mono,
    fontSize: 10,
    letterSpacing: 0.85,
    color: active ? color : ink.quiet,
  };
}

/** Coloured square used as a legend dot next to a format name. */
export function GameDot({ color, size = 9 }: { color: string; size?: number }) {
  return <View style={{ width: size, height: size, borderRadius: 3, backgroundColor: color }} />;
}

export function Divider({ style }: { style?: ViewStyle }) {
  const { line } = useTheme();
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
  const styles = useStyles();
  const { ink } = useTheme();
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

const useStyles = makeStyles(({ line }) =>
  StyleSheet.create({
    empty: {
      borderWidth: 1,
      borderStyle: 'dashed',
      borderColor: line.dashed,
      borderRadius: radius.format,
      padding: 24,
      gap: 12,
      alignItems: 'center',
    },
  }),
);
