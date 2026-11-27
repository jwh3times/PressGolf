import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet } from 'react-native';
import MapView, { Marker, type Region } from 'react-native-maps';
import type { LatLng } from '../domain/types';
import { useTheme } from '../theme/theme';
import { radius } from '../theme/tokens';

export interface PlaceMapProps {
  /** Where the pin is; none until the golfer taps. */
  at: LatLng | null;
  onPlace: (at: LatLng) => void;
  /** Where to move the map, such as the course found by name. A new object moves it again. */
  focus: LatLng | null;
}

/** About a course across. */
const SPAN = 0.02;

const toLatLng = ({ latitude, longitude }: { latitude: number; longitude: number }): LatLng => ({ lat: latitude, lng: longitude });
const regionAt = ({ lat, lng }: LatLng): Region => ({ latitude: lat, longitude: lng, latitudeDelta: SPAN, longitudeDelta: SPAN });

/**
 * A map for saying where a new course is (#383), for a golfer setting it up from home:
 * tap the course to drop the pin, drag the pin to move it. Hybrid, so the names of
 * roads and towns help find it.
 */
export function PlaceMap({ at, onPlace, focus }: PlaceMapProps) {
  const { colors } = useTheme();
  const map = useRef<MapView>(null);
  // Where the map opens, fixed at first render: a moved pin shouldn't yank the view about.
  const [initial] = useState(() => (at ? regionAt(at) : undefined));

  useEffect(() => {
    if (focus) map.current?.animateToRegion(regionAt(focus), 400);
  }, [focus]);

  return (
    <MapView
      ref={map}
      style={styles.map}
      mapType="hybrid"
      initialRegion={initial}
      showsUserLocation
      accessibilityLabel="Map. Tap where the course is."
      onPress={(event) => onPlace(toLatLng(event.nativeEvent.coordinate))}
    >
      {at ? (
        <Marker
          identifier="course"
          coordinate={{ latitude: at.lat, longitude: at.lng }}
          title="The course"
          pinColor={colors.accent}
          draggable
          onDragEnd={(event) => onPlace(toLatLng(event.nativeEvent.coordinate))}
        />
      ) : null}
    </MapView>
  );
}

const styles = StyleSheet.create({
  map: { height: 380, borderRadius: radius.card, overflow: 'hidden' },
});
