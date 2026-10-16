import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import {
  aimSentence,
  facingZone,
  gradeName,
  holeStrategy,
  zoneSummary,
  sideCauses,
  sideSentence,
  zoneName,
  SECOND_SHOT_YARDS,
  TEE_SHOT_YARDS,
  type Grade,
  type HoleStrategy,
  type Zone,
  type ZoneReading,
} from '../domain/hole-strategy';
import type { Course, LatLng, TeeId } from '../domain/types';
import { makeStyles, useTheme } from '../theme/theme';
import type { Theme } from '../theme/themes';
import { fonts, radius } from '../theme/tokens';
import { Body, Card, Eyebrow, Mono } from './primitives';

/** Colour backs up the grade's name, never stands in for it. */
export function gradeColor(theme: Theme, grade: Grade): string {
  switch (grade) {
    case 'worst':
      return theme.colors.clay;
    case 'bad':
      return theme.colors.blue;
    case 'someTrouble':
      return theme.colors.gold;
    case 'clear':
      return theme.colors.up;
    default:
      return theme.ink.soft;
  }
}

const BANDS: Record<ZoneReading['zone'], string | null> = {
  teeShot: `${TEE_SHOT_YARDS[0]}–${TEE_SHOT_YARDS[1]} OFF THE TEE`,
  secondShot: `${SECOND_SHOT_YARDS[0]}–${SECOND_SHOT_YARDS[1]} TO THE GREEN`,
  green: null,
};

/**
 * How the hole plays (#136), zone by zone: each side's grade and what makes
 * it, from the course map alone. Read before the round, so it is allowed in a
 * counted one.
 */
export function HoleStrategyView({ strategy }: { strategy: HoleStrategy }) {
  const styles = useStyles();
  return (
    <View style={{ gap: 8 }}>
      <Eyebrow>How the hole plays</Eyebrow>
      {strategy.zones.map((zone) => (
        <Card key={zone.zone} style={styles.zone}>
          <View style={styles.heading}>
            <Text style={styles.name}>{zoneName(zone.zone)}</Text>
            {BANDS[zone.zone] ? (
              <Mono size={10.5} style={styles.quiet}>
                {BANDS[zone.zone]}
              </Mono>
            ) : null}
          </View>
          {zone.sides.map((reading) => (
            <SideRow key={reading.side} zone={zone} reading={reading} />
          ))}
          {zone.aim ? (
            <View accessible accessibilityLabel={`Aim: ${aimSentence(zone.zone, zone.aim)}`} style={styles.aim}>
              <Mono size={10.5} style={styles.quiet}>
                AIM
              </Mono>
              <Body style={{ flex: 1, minWidth: 160 }}>{aimSentence(zone.zone, zone.aim)}</Body>
            </View>
          ) : null}
        </Card>
      ))}
      <Body style={styles.copy}>
        Read from the course map, the same for everyone, so it’s allowed in a counted round. Only what’s mapped is
        counted.
      </Body>
    </View>
  );
}

function SideRow({ zone, reading }: { zone: ZoneReading; reading: ZoneReading['sides'][number] }) {
  const styles = useStyles();
  const theme = useTheme();
  const color = gradeColor(theme, reading.grade);
  const causes = sideCauses(zone.zone, reading);
  return (
    <View accessible accessibilityLabel={sideSentence(zone.zone, reading)} style={styles.side}>
      <Text style={styles.sideName}>{reading.side.charAt(0).toUpperCase() + reading.side.slice(1)}</Text>
      <View style={{ flex: 1, minWidth: 160, gap: 2 }}>
        <View style={styles.grade}>
          <View style={[styles.dot, { backgroundColor: color }]} />
          <Mono size={10.5} style={{ color, letterSpacing: 1.2 }}>
            {gradeName(reading.grade).toUpperCase()}
          </Mono>
        </View>
        {causes ? <Body style={styles.copy}>{causes}</Body> : null}
      </View>
    </View>
  );
}

/**
 * The Score screen's one line on how the hole plays: the reading for the shot
 * you face, which moves on from the tee shot as you do and never back. Keyed
 * by hole, so each hole starts again at its tee.
 */
export function HoleStrategyLine({
  course,
  hole,
  teeId,
  position,
}: {
  course: Course;
  hole: number;
  teeId: TeeId | null;
  position: LatLng | null;
}) {
  const styles = useStyles();
  const strategy = useMemo(() => holeStrategy(course, hole, { teeId }), [course, hole, teeId]);
  const [zone, setZone] = useState<Zone | null>(() => facingZone(course, hole, position, null, { teeId }));
  // Moved on with each new fix, from the zone before it: never back towards the tee.
  const [readFrom, setReadFrom] = useState({ position, course, teeId });
  if (readFrom.position !== position || readFrom.course !== course || readFrom.teeId !== teeId) {
    setReadFrom({ position, course, teeId });
    setZone(facingZone(course, hole, position, zone, { teeId }));
  }
  const reading = strategy?.zones.find((z) => z.zone === zone);
  if (!reading) return null;
  return <Body style={styles.copy}>{zoneSummary(reading)}</Body>;
}

const useStyles = makeStyles(({ ink, line }) =>
  StyleSheet.create({
    zone: { padding: 14, gap: 4 },
    heading: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', columnGap: 12, marginBottom: 4 },
    name: { fontFamily: fonts.sansSemi, fontSize: 14, color: ink.full },
    side: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      columnGap: 12,
      rowGap: 2,
      paddingVertical: 8,
      borderTopWidth: 1,
      borderTopColor: line.hair,
    },
    sideName: { fontFamily: fonts.sansSemi, fontSize: 13, color: ink.body, width: 56 },
    grade: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    aim: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'baseline',
      columnGap: 12,
      rowGap: 2,
      paddingTop: 8,
      borderTopWidth: 1,
      borderTopColor: line.hair,
    },
    dot: { width: 8, height: 8, borderRadius: radius.chip },
    copy: { color: ink.soft, lineHeight: 19 },
    quiet: { color: ink.soft, letterSpacing: 1.2 },
  }),
);
