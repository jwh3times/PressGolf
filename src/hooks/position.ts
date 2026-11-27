import * as Location from 'expo-location';
import type { LatLng } from '../domain/types';

const toLatLng = (location: Location.LocationObject): LatLng => ({ lat: location.coords.latitude, lng: location.coords.longitude });

/**
 * Where the phone is, to a few hundred metres, for listing the nearest courses first
 * (#383). Asks for location the first time; null when it's refused or can't be had,
 * and the search goes by name alone.
 */
export async function roughPosition(): Promise<LatLng | null> {
  try {
    const { granted } = await Location.requestForegroundPermissionsAsync();
    if (!granted) return null;
    const last = await Location.getLastKnownPositionAsync();
    return toLatLng(last ?? (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })));
  } catch {
    return null;
  }
}

/** Where the phone is now, for a new course's location when the golfer is there. Null when refused. */
export async function positionHere(): Promise<LatLng | null> {
  const { granted } = await Location.requestForegroundPermissionsAsync();
  if (!granted) return null;
  return toLatLng(await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }));
}
