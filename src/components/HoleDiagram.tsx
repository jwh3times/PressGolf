import React, { useMemo, useRef, useState } from 'react';
import { StyleSheet, View, type GestureResponderEvent, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, G, Line, Path, Polygon, Text as SvgText } from 'react-native-svg';
import { yardsBetween } from '../domain/geo';
import { bearing, frame, type Frame, type HolePlan } from '../domain/hole-map';
import type { CourseFeature, LatLng } from '../domain/types';
import { courseColors, type CourseColors } from '../theme/course-colors';
import { useTheme } from '../theme/theme';
import { fonts, radius } from '../theme/tokens';

/** Ground shown either side of the line of play, and past the green, in metres. */
const SIDE_M = 55;
const PAST_GREEN_M = 35;
const BEHIND_TEE_M = 20;
/** A touch that moves further than this, in points, was a scroll, not a tap. */
const TAP_SLOP = 10;

type XY = [number, number];

export interface HoleView {
  frame: Frame;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/**
 * The hole turned so that it plays up the screen, tee at the bottom, green at
 * the top, framed to the line of play, the green, and wherever the player and
 * the target are.
 */
export function holeView(plan: HolePlan, extra: (LatLng | null)[]): HoleView | null {
  const end = plan.green?.middle ?? plan.line?.at(-1) ?? null;
  const start = plan.tee ?? extra.find((p): p is LatLng => p != null) ?? null;
  if (!end) return null;
  const view = frame(start ?? end, start ? bearing(start, end) : 0);
  const points = [...(plan.line ?? []), end, ...(start ? [start] : []), ...extra.filter((p): p is LatLng => p != null)].map(
    view.toXY,
  );
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  return {
    frame: view,
    minX: Math.min(...xs) - SIDE_M,
    maxX: Math.max(...xs) + SIDE_M,
    minY: Math.min(...ys) - BEHIND_TEE_M,
    maxY: Math.max(...ys) + PAST_GREEN_M,
  };
}

/** From the hole's frame to the drawing, and back, for a drawing `width` × `height`. */
export function fit(view: HoleView, width: number, height: number) {
  const scale = Math.min(width / (view.maxX - view.minX), height / (view.maxY - view.minY));
  const left = (width - (view.maxX - view.minX) * scale) / 2;
  const top = (height - (view.maxY - view.minY) * scale) / 2;
  return {
    scale,
    toPx: ([x, y]: XY): XY => [left + (x - view.minX) * scale, top + (view.maxY - y) * scale],
    toXY: ([px, py]: XY): XY => [view.minX + (px - left) / scale, view.maxY - (py - top) / scale],
  };
}

const ORDER: CourseFeature['kind'][] = ['courseEdge', 'fairway', 'tee', 'green', 'bunker', 'water', 'lateralWater', 'outOfBounds'];

function styleFor(feature: CourseFeature, c: CourseColors) {
  switch (feature.kind) {
    case 'fairway':
      return { fill: c.fairway };
    case 'tee':
      return { fill: c.tee };
    case 'green':
      return { fill: c.green };
    case 'bunker':
      return { fill: c.sand };
    case 'water':
      return { fill: c.water, stroke: c.yellowStakes, strokeWidth: 2.5 };
    case 'lateralWater':
      return { fill: c.water, stroke: c.redStakes, strokeWidth: 2.5, strokeDasharray: '7 4' };
    case 'courseEdge':
      return { fill: 'none', stroke: c.boundary, strokeWidth: 2, strokeDasharray: '2 5' };
    case 'outOfBounds':
      return { fill: 'none', stroke: c.boundary, strokeWidth: 2.5, strokeDasharray: '10 5' };
    default:
      return null;
  }
}

/**
 * The drawn hole map (#125): the course map's outlines for one hole, turned
 * to play up the screen, with where you are, where you're aiming, and the
 * yards along the way. Drawn from the saved map, so it works with no signal
 * and on the web. Tap to measure to a point; screen readers get the same
 * distances as text beside it, and targets as buttons.
 */
export function HoleDiagram({
  plan,
  from,
  target,
  onTarget,
  label,
  height = 440,
}: {
  plan: HolePlan;
  from: LatLng | null;
  target: LatLng | null;
  onTarget: (at: LatLng) => void;
  /** What the drawing shows, for a screen reader. */
  label: string;
  height?: number;
}) {
  const theme = useTheme();
  const c = courseColors(theme);
  const [width, setWidth] = useState(0);
  // Where a touch began. A ref, not state: the release can come before a render would.
  const touch = useRef<{ x: number; y: number } | null>(null);
  // The frame follows the hole and the player, not the target: a tap shouldn't move the map under the finger.
  const view = useMemo(() => holeView(plan, [from]), [plan, from]);
  if (!view) return null;
  const { toPx, toXY } = fit(view, width || 1, height);
  const px = (p: LatLng) => toPx(view.frame.toXY(p));
  const path = (points: LatLng[], closed: boolean) =>
    points.map((p, i) => `${i ? 'L' : 'M'}${px(p).map((n) => n.toFixed(1)).join(' ')}`).join(' ') + (closed ? ' Z' : '');

  const end = plan.green?.middle ?? plan.line?.at(-1) ?? null;
  const legs: [LatLng, LatLng][] = [];
  if (from && target) legs.push([from, target]);
  if (target && end && yardsBetween(target, end) > 0) legs.push([target, end]);

  const release = (event: GestureResponderEvent) => {
    const { locationX, locationY } = event.nativeEvent;
    const began = touch.current;
    touch.current = null;
    if (began && Math.hypot(locationX - began.x, locationY - began.y) <= TAP_SLOP) {
      onTarget(view.frame.toLatLng(toXY([locationX, locationY])));
    }
  };

  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={label}
      style={[styles.box, { height, backgroundColor: c.ground }]}
      onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
      onStartShouldSetResponder={() => true}
      onResponderGrant={(e) => {
        touch.current = { x: e.nativeEvent.locationX, y: e.nativeEvent.locationY };
      }}
      onResponderRelease={release}
      onResponderTerminationRequest={() => true}
      onResponderTerminate={() => {
        touch.current = null;
      }}
    >
      {width > 0 ? (
        <Svg width={width} height={height} pointerEvents="none">
          {ORDER.flatMap((kind) =>
            plan.features
              .filter((f) => f.kind === kind)
              .map((f) => {
                const style = styleFor(f, c);
                if (!style) return null;
                return f.kind === 'outOfBounds' ? (
                  <Path key={f.id} d={path(f.points, false)} {...style} />
                ) : (
                  <Polygon key={f.id} points={f.points.map((p) => px(p).join(',')).join(' ')} {...style} />
                );
              }),
          )}
          {plan.line ? <Path d={path(plan.line, false)} fill="none" stroke={c.line} strokeWidth={1.5} strokeDasharray="4 6" /> : null}
          {legs.map(([a, b], i) => {
            const [ax, ay] = px(a);
            const [bx, by] = px(b);
            const [mx, my] = [(ax + bx) / 2, (ay + by) / 2];
            const yards = String(yardsBetween(a, b));
            return (
              <G key={i}>
                <Line x1={ax} y1={ay} x2={bx} y2={by} stroke={theme.ink.full} strokeWidth={2} />
                {/* A halo in the ground's colour keeps the figure readable over sand or water. */}
                <SvgText x={mx + 8} y={my + 5} fontFamily={fonts.mono} fontSize={14} fontWeight="700" stroke={c.ground} strokeWidth={4} fill={c.ground}>
                  {yards}
                </SvgText>
                <SvgText x={mx + 8} y={my + 5} fontFamily={fonts.mono} fontSize={14} fontWeight="700" fill={theme.ink.full}>
                  {yards}
                </SvgText>
              </G>
            );
          })}
          {end ? <Circle cx={px(end)[0]} cy={px(end)[1]} r={4} fill={theme.ink.full} /> : null}
          {target ? <Circle cx={px(target)[0]} cy={px(target)[1]} r={9} fill="none" stroke={theme.colors.accent} strokeWidth={3} /> : null}
          {from ? <Circle cx={px(from)[0]} cy={px(from)[1]} r={7} fill={theme.colors.accent} stroke={c.ground} strokeWidth={2.5} /> : null}
        </Svg>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderRadius: radius.card, overflow: 'hidden' },
});
