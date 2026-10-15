import * as Location from 'expo-location';
import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet } from 'react-native';
import MapView, { Marker, type Region } from 'react-native-maps';
import type { GreenPoint } from '../domain/geo';
import type { Green, LatLng } from '../domain/types';
import { useTheme } from '../theme/theme';
import { radius } from '../theme/tokens';

export interface GreenMapProps {
  greens: Green[];
  /** The hole being placed: its pins are coloured and can be dragged. */
  selected: number;
  onTap: (at: LatLng) => void;
  onDrag: (number: number, point: GreenPoint, at: LatLng) => void;
  /** Where to move the map, such as a course found by name. A new object moves it again. */
  focus: LatLng | null;
}

/** How much ground a fresh view of one spot covers: about a golf hole across. */
const SPAN = 0.006;

/** A region around every green, with a margin, or nothing to start from. */
export function regionFor(greens: Green[]): Region | undefined {
  if (greens.length === 0) return undefined;
  const lats = greens.map((g) => g.middle.lat);
  const lngs = greens.map((g) => g.middle.lng);
  const [minLat, maxLat, minLng, maxLng] = [Math.min(...lats), Math.max(...lats), Math.min(...lngs), Math.max(...lngs)];
  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLng + maxLng) / 2,
    latitudeDelta: Math.max(SPAN, (maxLat - minLat) * 1.4),
    longitudeDelta: Math.max(SPAN, (maxLng - minLng) * 1.4),
  };
}

const toLatLng = ({ latitude, longitude }: { latitude: number; longitude: number }): LatLng => ({ lat: latitude, lng: longitude });
const toCoordinate = ({ lat, lng }: LatLng) => ({ latitude: lat, longitude: lng });

/**
 * A satellite map for placing greens (#8): tap to place a point, drag a pin to
 * move it. Apple Maps on iOS; Google Maps on Android, which needs an API key in
 * a store build but not in Expo Go.
 */
export function GreenMap({ greens, selected, onTap, onDrag, focus }: GreenMapProps) {
  const { colors, ink } = useTheme();
  const map = useRef<MapView>(null);
  // Where the map opens, fixed at first render: later greens shouldn't yank the view about.
  const [initial] = useState(() => regionFor(greens));

  useEffect(() => {
    if (focus) map.current?.animateToRegion({ ...toCoordinate(focus), latitudeDelta: SPAN * 2, longitudeDelta: SPAN * 2 }, 400);
  }, [focus]);

  // A course with no greens yet: start where the phone last was, if it may already say.
  useEffect(() => {
    if (initial) return;
    let cancelled = false;
    void (async () => {
      const { granted } = await Location.getForegroundPermissionsAsync();
      const last = granted ? await Location.getLastKnownPositionAsync() : null;
      if (!cancelled && last) {
        map.current?.animateToRegion({ ...last.coords, latitudeDelta: SPAN * 2, longitudeDelta: SPAN * 2 }, 0);
      }
    })().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [initial]);

  const pin = (green: Green, point: GreenPoint, at: LatLng) => {
    const current = green.number === selected;
    return (
      <Marker
        key={`${green.number}-${point}`}
        identifier={`${green.number}-${point}`}
        coordinate={toCoordinate(at)}
        title={point === 'middle' ? `Hole ${green.number}` : `Hole ${green.number}, ${point}`}
        pinColor={current ? (point === 'middle' ? colors.accent : colors.gold) : ink.soft}
        draggable={current}
        onDragEnd={(event) => onDrag(green.number, point, toLatLng(event.nativeEvent.coordinate))}
      />
    );
  };

  return (
    <MapView
      ref={map}
      style={styles.map}
      mapType="satellite"
      initialRegion={initial}
      showsUserLocation
      accessibilityLabel={`Satellite map. Tap where hole ${selected}'s green is.`}
      onPress={(event) => onTap(toLatLng(event.nativeEvent.coordinate))}
    >
      {greens.flatMap((green) => [
        pin(green, 'middle', green.middle),
        ...(green.number === selected && green.front ? [pin(green, 'front', green.front)] : []),
        ...(green.number === selected && green.back ? [pin(green, 'back', green.back)] : []),
      ])}
    </MapView>
  );
}

const styles = StyleSheet.create({
  map: { height: 380, borderRadius: radius.card, overflow: 'hidden' },
});
