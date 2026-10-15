import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import { HoleDiagram } from '../components/HoleDiagram';
import { ModalHeader, Screen } from '../components/Screen';
import { Body, Card, CHIP_ROW_GAP, Chip, Display, Eyebrow, Mono } from '../components/primitives';
import { yardsBetween, yardsToGreen } from '../domain/geo';
import {
  aroundGreen,
  defaultTarget,
  edgesNear,
  hazardsBetween,
  holePlan,
  pointShort,
  vantage,
  type EdgeReading,
  type HazardReading,
} from '../domain/hole-map';
import type { LatLng } from '../domain/types';
import { useLiveLocation } from '../hooks/useLiveLocation';
import { useStore } from '../store/AppStore';
import { makeStyles, useTheme } from '../theme/theme';

const METRES_PER_YARD = 0.9144;
/** Lay-up targets offered as buttons, in yards short of the green. */
const LAY_UPS = [100, 150, 200];

const HAZARD_NAMES: Record<string, string> = {
  bunker: 'Bunker',
  water: 'Water',
  lateralWater: 'Red penalty area',
};

const sideText = (reading: HazardReading) => (reading.side === 'across' ? 'across the line' : reading.side);

function hazardFigures(reading: HazardReading): string {
  if (reading.front === 0) return `IN IT · ${reading.back} PAST`;
  return reading.carry != null ? `${reading.front} FRONT · ${reading.carry} CARRY` : `${reading.front} FRONT · ${reading.back} PAST`;
}

function hazardSpoken(reading: HazardReading): string {
  const name = HAZARD_NAMES[reading.feature.kind];
  if (reading.front === 0) return `You are in a ${name.toLowerCase()}. ${reading.back} yards to get past it.`;
  const clear = reading.carry != null ? `${reading.carry} to carry it` : `${reading.back} to get past it`;
  return `${name}, ${sideText(reading)}: ${reading.front} yards to the front, ${clear}.`;
}

function edgeText(edge: EdgeReading): string {
  const name = edge.kind === 'courseEdge' ? 'Course edge' : 'Out of bounds';
  return edge.yards === 0 ? `${name}: the target is past it` : `${name}, ${edge.yards} yards ${edge.side} of the target`;
}

type Aim = { kind: 'line' } | { kind: 'short'; yards: number } | { kind: 'point'; at: LatLng };

/**
 * One hole of the course map (#125): the drawn hole, and the yards from where
 * you are to the green, to a target, and to and past every hazard between.
 * Distances only, which the Rules allow during a round: no club advice. Away
 * from the course, it measures from the tee, to look a hole over beforehand.
 */
export default function HoleMapScreen() {
  const styles = useStyles();
  const { colors, ink } = useTheme();
  const params = useLocalSearchParams<{ course: string; hole: string; live?: string }>();
  const store = useStore();
  const router = useRouter();
  const course = store.courses.find((c) => c.id === params.course);
  const holeCount = course?.tees[0].holes.length ?? 0;
  // The hole lives in the URL, not in state: on the web the params arrive after the first render.
  const hole = Math.min(Math.max(1, Number(params.hole) || 1), Math.max(1, holeCount));
  const [aim, setAim] = useState<Aim>({ kind: 'line' });
  const { state, start } = useLiveLocation();

  // Asked for from the Score screen, where you are standing on the hole.
  useEffect(() => {
    if (params.live === '1') void start();
  }, [params.live, start]);

  const plan = useMemo(() => (course ? holePlan(course, hole) : null), [course, hole]);

  if (!course || !plan) {
    return (
      <Screen floatingTabBar={false}>
        <ModalHeader title="Course not found" onClose={() => router.back()} closeLabel="Back" />
      </Screen>
    );
  }

  const position = state.status === 'located' ? state.fix.position : null;
  const seat = vantage(plan, position);
  const from = seat?.from ?? null;
  const card = course.tees[0].holes[hole - 1];
  const go = (n: number) => {
    router.setParams({ hole: String(n) });
    setAim({ kind: 'line' });
  };

  const target = !from
    ? null
    : aim.kind === 'point'
      ? aim.at
      : aim.kind === 'short'
        ? pointShort(plan, from, aim.yards * METRES_PER_YARD)
        : defaultTarget(plan, from);
  const toGreen = from && plan.green ? yardsToGreen(from, plan.green) : null;
  // Read against the whole course, not just what is drawn: a player on the next fairway still has its trouble in play.
  const hazards = from && target ? hazardsBetween(from, target, course.features) : [];
  const edges = from && target ? edgesNear(from, target, course.features) : [];
  const atGreen = target && plan.green ? yardsBetween(target, plan.green.middle) <= 2 : false;
  // Aiming short of the green, what guards it still matters to the next decision.
  const listed = new Set(hazards.map((r) => r.feature.id));
  const guarding = from && !atGreen ? aroundGreen(plan, from).filter((r) => !listed.has(r.feature.id)) : [];
  const fromOsm = plan.features.some((f) => f.source === 'osm') || plan.green?.source === 'osm';
  const mapped = plan.features.length > 0 || plan.green != null;

  const label = [
    `Drawn map of hole ${hole}, tee at the bottom, green at the top.`,
    toGreen ? `${toGreen.middle} yards to the middle of the green.` : null,
    hazards.length ? `${hazards.length} ${hazards.length === 1 ? 'hazard' : 'hazards'} in play, listed below.` : 'No hazards in play.',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <Screen floatingTabBar={false}>
      <ModalHeader eyebrow={course.name} title={`Hole ${hole}`} onClose={() => router.back()} closeLabel="Back" />
      {card ? (
        <Mono size={10.5} style={{ color: ink.soft, letterSpacing: 1.2 }}>
          PAR {card.par}
          {card.yards ? ` · ${card.yards}Y` : ''}
        </Mono>
      ) : null}

      <View style={styles.chips}>
        <Chip label="‹ PREVIOUS" accessibilityLabel="Previous hole" disabled={hole <= 1} onPress={() => go(hole - 1)} />
        <Chip label="NEXT ›" accessibilityLabel="Next hole" disabled={hole >= holeCount} onPress={() => go(hole + 1)} />
      </View>

      {!mapped || !seat ? (
        <Card style={styles.empty}>
          <Body style={styles.copy}>
            {mapped
              ? 'This hole has no line from tee to green on the map, so there is nowhere to measure from until you are on it.'
              : 'This hole isn’t mapped yet. Import the course from OpenStreetMap in the course editor, or place its green on a map.'}
          </Body>
          {mapped ? <Chip label="⌖ MEASURE FROM ME" active color={colors.accent} onPress={() => void start()} /> : null}
        </Card>
      ) : (
        <>
          <HoleDiagram plan={plan} from={from} target={target} onTarget={(at) => setAim({ kind: 'point', at })} label={label} />

          <View style={styles.row}>
            <Mono size={10.5} style={state.status === 'located' && state.live && !seat.fromTee ? styles.live : styles.quiet}>
              {seat.fromTee
                ? position
                  ? 'FROM THE TEE · YOU ARE NOT ON THIS HOLE'
                  : 'FROM THE TEE'
                : state.status === 'located'
                  ? [state.live ? 'FROM YOU · LIVE' : 'FROM YOU', state.fix.accuracy != null ? `±${Math.round(state.fix.accuracy)} M` : null]
                      .filter(Boolean)
                      .join(' · ')
                  : 'FROM YOU'}
            </Mono>
            <Chip
              label={state.status === 'finding' ? 'FINDING YOU…' : '⌖ FROM ME'}
              accessibilityLabel="Measure from where I am"
              disabled={state.status === 'finding'}
              onPress={() => void start()}
            />
          </View>
          {state.status === 'denied' ? (
            <Body style={styles.copy}>Press can’t see your location, so it measures from the tee.</Body>
          ) : null}

          <View style={{ gap: 8 }}>
            <Eyebrow>Measure to</Eyebrow>
            <View style={styles.chips}>
              <Chip
                label={plan.line && plan.line.length > 2 ? 'LINE OF PLAY' : 'THE GREEN'}
                accessibilityLabel={plan.line && plan.line.length > 2 ? 'Measure along the line of play' : 'Measure to the middle of the green'}
                active={aim.kind === 'line'}
                color={colors.accent}
                onPress={() => setAim({ kind: 'line' })}
              />
              {LAY_UPS.filter((yards) => toGreen == null || yards < toGreen.middle - 20).map((yards) => (
                <Chip
                  key={yards}
                  label={`${yards} OUT`}
                  accessibilityLabel={`Measure to ${yards} yards short of the green`}
                  active={aim.kind === 'short' && aim.yards === yards}
                  color={colors.accent}
                  onPress={() => setAim({ kind: 'short', yards })}
                />
              ))}
              {aim.kind === 'point' ? <Chip label="CLEAR TAP" accessibilityLabel="Clear the point you tapped" onPress={() => setAim({ kind: 'line' })} /> : null}
            </View>
            <Body style={styles.copy}>Or tap the map to measure to any point.</Body>
          </View>

          <Card style={styles.readout}>
            {toGreen ? (
              <View accessible accessibilityLabel={`${toGreen.middle} yards to the middle of the green${toGreen.front != null ? `, ${toGreen.front} to the front` : ''}${toGreen.back != null ? `, ${toGreen.back} to the back` : ''}`}>
                <View style={styles.figure}>
                  <Display size={34}>{toGreen.middle}</Display>
                  <Mono size={10.5} style={styles.quiet}>TO THE MIDDLE</Mono>
                </View>
                {toGreen.front != null || toGreen.back != null ? (
                  <Mono size={11} style={{ color: ink.body }}>
                    {[toGreen.front != null ? `${toGreen.front} FRONT` : null, toGreen.back != null ? `${toGreen.back} BACK` : null].filter(Boolean).join(' · ')}
                  </Mono>
                ) : null}
              </View>
            ) : null}
            {target && from && !atGreen ? (
              <Body style={styles.copy}>
                {`${yardsBetween(from, target)} to the target${plan.green ? `, then ${yardsBetween(target, plan.green.middle)} to the green` : ''}.`}
              </Body>
            ) : null}
          </Card>

          <View style={{ gap: 8 }}>
            <Eyebrow>{hazards.length || edges.length ? 'In play' : 'Nothing in play'}</Eyebrow>
            {hazards.map((reading) => (
              <HazardRow key={reading.feature.id} reading={reading} />
            ))}
            {edges.map((edge) => (
              <Body key={`${edge.kind}/${edge.side}`} style={styles.copy}>
                {`${edgeText(edge)}.`}
              </Body>
            ))}
            {edges.some((e) => e.kind === 'courseEdge') ? (
              <Body style={styles.copy}>The course edge is where the map ends; the white stakes are what count.</Body>
            ) : null}
          </View>

          {guarding.length ? (
            <View style={{ gap: 8 }}>
              <Eyebrow>Around the green</Eyebrow>
              {guarding.map((reading) => (
                <HazardRow key={reading.feature.id} reading={reading} />
              ))}
            </View>
          ) : null}
        </>
      )}

      {fromOsm ? (
        <Pressable
          accessibilityRole="link"
          accessibilityLabel="Map data © OpenStreetMap contributors. Opens its copyright and licence page"
          onPress={() => void Linking.openURL('https://www.openstreetmap.org/copyright')}
          style={styles.credit}
        >
          <Mono size={10.5} style={styles.quiet}>
            MAP © OPENSTREETMAP CONTRIBUTORS
          </Mono>
        </Pressable>
      ) : null}
    </Screen>
  );
}

function HazardRow({ reading }: { reading: HazardReading }) {
  const styles = useStyles();
  const { ink } = useTheme();
  return (
    <View accessible accessibilityLabel={hazardSpoken(reading)} style={styles.hazard}>
      <Body style={{ flex: 1, minWidth: 140 }}>{`${HAZARD_NAMES[reading.feature.kind]}, ${sideText(reading)}`}</Body>
      <Mono size={11} style={{ color: ink.body }}>
        {hazardFigures(reading)}
      </Mono>
    </View>
  );
}

const useStyles = makeStyles(({ colors, ink, line }) =>
  StyleSheet.create({
    chips: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 8, rowGap: CHIP_ROW_GAP },
    row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', columnGap: 12, rowGap: CHIP_ROW_GAP },
    copy: { color: ink.soft, lineHeight: 19 },
    empty: { padding: 16, gap: 12 },
    readout: { padding: 16, gap: 8 },
    figure: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
    hazard: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      justifyContent: 'space-between',
      columnGap: 12,
      rowGap: 4,
      paddingVertical: 10,
      borderBottomWidth: 1,
      borderBottomColor: line.hair,
    },
    live: { color: colors.accent, letterSpacing: 1.2 },
    quiet: { color: ink.soft, letterSpacing: 1.2 },
    credit: { minHeight: 48, justifyContent: 'center' },
  }),
);
