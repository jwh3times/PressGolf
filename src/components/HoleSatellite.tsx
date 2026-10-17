import React, { useRef, useState } from 'react';
import { StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import MapView, { Marker, Polygon, Polyline, type Camera } from 'react-native-maps';
import { yardsBetween } from '../domain/geo';
import type { HolePlan } from '../domain/hole-map';
import type { CourseFeature, LatLng } from '../domain/types';
import { fonts, radius } from '../theme/tokens';
import type { HoleView } from './HoleDiagram';

/**
 * Over imagery the theme's colours mean nothing, so hazards are outlined in
 * colours that read on grass, sand and water photographed from above. The
 * imagery shows the fairway and green; only what a player must avoid is drawn.
 */
const OVERLAY: Partial<Record<CourseFeature['kind'], { stroke: string; fill?: string; dash?: number[] }>> = {
  bunker: { stroke: '#FFF3C4', fill: 'rgba(255,243,196,0.18)' },
  water: { stroke: '#FFD43B', fill: 'rgba(79,159,227,0.25)' },
  lateralWater: { stroke: '#FF5A47', fill: 'rgba(79,159,227,0.25)', dash: [8, 5] },
  courseEdge: { stroke: '#FFFFFF', dash: [2, 6] },
  outOfBounds: { stroke: '#FFFFFF', dash: [10, 5] },
};

type Coordinate = { latitude: number; longitude: number };
const toCoordinate = ({ lat, lng }: LatLng): Coordinate => ({ latitude: lat, longitude: lng });
const toLatLng = ({ latitude, longitude }: Coordinate): LatLng => ({ lat: latitude, lng: longitude });

/** The four corners of the hole's frame, as the map wants them. */
export function corners(view: HoleView): Coordinate[] {
  return (
    [
      [view.minX, view.minY],
      [view.maxX, view.minY],
      [view.maxX, view.maxY],
      [view.minX, view.maxY],
    ] as [number, number][]
  ).map((xy) => toCoordinate(view.frame.toLatLng(xy)));
}

/**
 * The camera that shows the hole turned to play up the screen, from the
 * camera the map chose to fit its corners north-up.
 *
 * The map framed the corners' north-up box; the turned frame is smaller, by a
 * ratio worked out here from the two shapes and the map's size. Apple's
 * altitude and Google's zoom both scale with the ground shown, so one ratio
 * converts either, on any device, with no field-of-view constant to guess.
 */
export function turnedCamera(view: HoleView, fitted: Camera, width: number, height: number): Camera {
  const box = corners(view).map(({ latitude, longitude }) => view.frame.toXY({ lat: latitude, lng: longitude }));
  // The north-up extent of the corners, measured in a north-up frame about the same origin.
  const theta = (view.heading * Math.PI) / 180;
  const north = box.map(([x, y]) => [x * Math.cos(theta) + y * Math.sin(theta), -x * Math.sin(theta) + y * Math.cos(theta)]);
  const spanX = Math.max(...north.map(([x]) => x)) - Math.min(...north.map(([x]) => x));
  const spanY = Math.max(...north.map(([, y]) => y)) - Math.min(...north.map(([, y]) => y));
  const fittedScale = Math.max(spanX / width, spanY / height);
  const turnedScale = Math.max((view.maxX - view.minX) / width, (view.maxY - view.minY) / height);
  const ratio = turnedScale / fittedScale;
  const middle = view.frame.toLatLng([(view.minX + view.maxX) / 2, (view.minY + view.maxY) / 2]);
  return {
    center: toCoordinate(middle),
    heading: view.heading,
    pitch: 0,
    altitude: fitted.altitude != null ? fitted.altitude * ratio : undefined,
    zoom: fitted.zoom != null ? fitted.zoom - Math.log2(ratio) : undefined,
  } as Camera;
}

/**
 * The hole map over satellite imagery (#125): Apple Maps on iOS, Google Maps
 * on Android. The same hazards, target and yards as the drawn map, for when
 * there is signal and a picture helps. Tap to measure to a point.
 */
export interface HoleSatelliteProps {
  plan: HolePlan;
  view: HoleView;
  from: LatLng | null;
  fromTee: boolean;
  target: LatLng | null;
  onTarget: (at: LatLng) => void;
  height?: number;
  /** Where about two in three of a suggested club's shots finish (#146). */
  pattern?: LatLng[] | null;
}

export function HoleSatellite({ plan, view, from, fromTee, target, onTarget, height = 440, pattern = null }: HoleSatelliteProps) {
  const map = useRef<MapView>(null);
  const [width, setWidth] = useState(0);
  // Set while the map is framing the corners north-up, before it is turned.
  const turning = useRef(false);

  const end = plan.green?.middle ?? plan.line?.at(-1) ?? null;
  const legs: [LatLng, LatLng][] = [];
  if (from && target) legs.push([from, target]);
  if (target && end && yardsBetween(target, end) > 0) legs.push([target, end]);

  const frameHole = () => {
    turning.current = true;
    map.current?.fitToCoordinates(corners(view), { edgePadding: { top: 0, right: 0, bottom: 0, left: 0 }, animated: false });
  };

  const turn = async () => {
    if (!turning.current || !map.current || width === 0) return;
    turning.current = false;
    const fitted = await map.current.getCamera();
    map.current.setCamera(turnedCamera(view, fitted, width, height));
  };

  return (
    <View testID="satellite-box" style={[styles.box, { height }]} onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}>
      {width > 0 ? (
        <MapView
          ref={map}
          style={StyleSheet.absoluteFill}
          mapType="satellite"
          showsUserLocation={!fromTee}
          rotateEnabled={false}
          pitchEnabled={false}
          toolbarEnabled={false}
          accessibilityLabel={`Satellite map of hole ${plan.number}. Tap to measure to a point.`}
          onMapReady={frameHole}
          onRegionChangeComplete={() => void turn()}
          onPress={(event) => onTarget(toLatLng(event.nativeEvent.coordinate))}
        >
          {plan.features.map((f) => {
            const style = OVERLAY[f.kind];
            if (!style) return null;
            const coordinates = f.points.map(toCoordinate);
            return f.kind === 'outOfBounds' ? (
              <Polyline key={f.id} coordinates={coordinates} strokeColor={style.stroke} strokeWidth={2.5} lineDashPattern={style.dash} />
            ) : (
              <Polygon
                key={f.id}
                coordinates={coordinates}
                strokeColor={style.stroke}
                fillColor={style.fill ?? 'transparent'}
                strokeWidth={2}
                lineDashPattern={style.dash}
              />
            );
          })}
          {pattern ? (
            <Polygon coordinates={pattern.map(toCoordinate)} strokeColor="#FFFFFF" fillColor="rgba(255,255,255,0.18)" strokeWidth={2} />
          ) : null}
          {legs.map(([a, b], i) => (
            <Polyline key={`leg-${i}`} coordinates={[toCoordinate(a), toCoordinate(b)]} strokeColor="#FFFFFF" strokeWidth={3} />
          ))}
          {legs.map(([a, b], i) => (
            <Marker
              key={`yards-${i}`}
              coordinate={toCoordinate({ lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 })}
              anchor={{ x: -0.15, y: 0.5 }}
              tracksViewChanges={false}
            >
              <Text style={styles.yards}>{yardsBetween(a, b)}</Text>
            </Marker>
          ))}
          {target ? (
            <Marker coordinate={toCoordinate(target)} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false}>
              <View style={styles.target} />
            </Marker>
          ) : null}
          {from && fromTee ? (
            <Marker coordinate={toCoordinate(from)} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false}>
              <View style={styles.tee} />
            </Marker>
          ) : null}
        </MapView>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderRadius: radius.card, overflow: 'hidden' },
  yards: {
    fontFamily: fonts.mono,
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
    textShadowColor: 'rgba(0,0,0,0.85)',
    textShadowRadius: 3,
    textShadowOffset: { width: 0, height: 0 },
  },
  target: { width: 20, height: 20, borderRadius: 10, borderWidth: 3, borderColor: '#FFFFFF' },
  tee: { width: 14, height: 14, borderRadius: 7, backgroundColor: '#FFFFFF', borderWidth: 2, borderColor: '#000000' },
});
