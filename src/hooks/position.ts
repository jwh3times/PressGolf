import * as Location from 'expo-location';
import type { LatLng } from '../domain/types';

const toLatLng = (location: Location.LocationObject): LatLng => ({ lat: location.coords.latitude, lng: location.coords.longitude });

/** Two decimal places: about a kilometre, plenty to put the nearest course first. */
const ROUGHLY = 100;
const rounded = ({ lat, lng }: LatLng): LatLng => ({ lat: Math.round(lat * ROUGHLY) / ROUGHLY, lng: Math.round(lng * ROUGHLY) / ROUGHLY });

/**
 * Where the phone is, to about a kilometre, for listing the nearest courses first
 * (#383). It's sent with the search, so it's rounded first: the server needs no
 * closer position than that, and the privacy policy says so. Asks for location the
 * first time; null when it's refused or can't be had, and the search goes by name.
 */
export async function roughPosition(): Promise<LatLng | null> {
  try {
    const { granted } = await Location.requestForegroundPermissionsAsync();
    if (!granted) return null;
    const last = await Location.getLastKnownPositionAsync();
    return rounded(toLatLng(last ?? (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }))));
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
