import React, { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { holePlan } from '../domain/hole-map';
import type { Course } from '../domain/types';
import { makeStyles, useTheme } from '../theme/theme';
import { radius } from '../theme/tokens';
import { HoleDiagram } from './HoleDiagram';
import { Mono } from './primitives';

/** Tall enough to read the hole's shape and its trouble; short enough to keep the scores in view. */
export const PREVIEW_HEIGHT = 150;

/**
 * The hole at a glance under the Score screen's yardage (#125): the drawn map,
 * tee on the left, green on the right, with no distances of its own. A tap
 * opens the full hole map, which measures from where you stand. Nothing when
 * the hole isn't mapped.
 */
export function HoleMapPreview({ course, hole, onOpen }: { course: Course; hole: number; onOpen: () => void }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const plan = useMemo(() => holePlan(course, hole), [course, hole]);
  if (!plan.line && !plan.green) return null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Map of hole ${hole}, distances`}
      accessibilityHint="Opens the hole map, with distances to the green and to the hazards"
      onPress={onOpen}
      style={({ pressed }) => [styles.card, pressed && { opacity: 0.85 }]}
    >
      {/* Across the card, tee on the left: a hole is long and the card is wide. */}
      <HoleDiagram plan={plan} from={null} target={null} height={PREVIEW_HEIGHT} across />
      <View style={styles.caption}>
        <Mono size={10.5} style={styles.label}>
          MAP OF HOLE {hole}
        </Mono>
        <Mono size={10.5} style={{ color: colors.accent, letterSpacing: 1.2 }}>
          DISTANCES ›
        </Mono>
      </View>
    </Pressable>
  );
}

const useStyles = makeStyles(({ colors, ink, line }) =>
  StyleSheet.create({
    card: {
      backgroundColor: colors.cardDeep,
      borderWidth: 1,
      borderColor: line.card,
      borderRadius: radius.card,
      overflow: 'hidden',
    },
    caption: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'space-between',
      alignItems: 'center',
      columnGap: 12,
      paddingHorizontal: 14,
      minHeight: 44,
    },
    label: { color: ink.soft, letterSpacing: 1.2 },
  }),
);
