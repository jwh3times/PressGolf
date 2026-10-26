import React from 'react';
import { act, render, screen, userEvent } from '@testing-library/react-native';
import { Alert, Linking, type AlertButton } from 'react-native';
import * as Location from 'expo-location';
import { yardsBetween } from '../../domain/geo';
import type { Green } from '../../domain/types';
import { LIVE_FOR_MS } from '../../hooks/useLiveLocation';
import { GreenYardage } from '../GreenYardage';

jest.mock('expo-location', () => ({
  Accuracy: { High: 4, Highest: 5 },
  requestForegroundPermissionsAsync: jest.fn(),
  watchPositionAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
}));

const location = jest.mocked(Location);

// Torrey Pines South, 3rd: the tee and the middle of the green.
const TEE = { lat: 32.899236, lng: -117.249958 };
const MIDDLE = { lat: 32.89773, lng: -117.250716 };

const green = (extra: Partial<Green> = {}): Green => ({
  number: 3,
  middle: MIDDLE,
  front: null,
  back: null,
  source: 'marked',
  ...extra,
});

const at = (point: { lat: number; lng: number }, accuracy: number | null = 4) =>
  ({ coords: { latitude: point.lat, longitude: point.lng, accuracy }, timestamp: 0 }) as Location.LocationObject;

let send: (location: Location.LocationObject) => void;
const remove = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  location.requestForegroundPermissionsAsync.mockResolvedValue({ granted: true } as Location.LocationPermissionResponse);
  location.watchPositionAsync.mockImplementation(async (_options, callback) => {
    send = callback;
    return { remove };
  });
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

/** Presses the named button of the alert most recently shown. */
async function choose(button: string) {
  const buttons = jest.mocked(Alert.alert).mock.lastCall?.[2] as AlertButton[];
  await act(async () => buttons.find((b) => b.text === button)?.onPress?.());
}

describe('GreenYardage', () => {
  it('runs no GPS until asked, then gives a minute of live yardage and keeps the last reading', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    await render(<GreenYardage holeNumber={3} green={green()} onMark={jest.fn()} />);
    expect(location.watchPositionAsync).not.toHaveBeenCalled();

    await user.press(screen.getByRole('button', { name: '⌖ YARDS TO GREEN' }));
    await act(async () => send(at(TEE)));
    const yards = yardsBetween(TEE, MIDDLE);
    expect(screen.getByText(String(yards))).toBeOnTheScreen();
    expect(screen.getByText('LIVE · ±4 M')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: `${yards} yards to the middle of the green, GPS good to 4 metres` })).toBeOnTheScreen();

    await act(async () => jest.advanceTimersByTime(LIVE_FOR_MS));
    expect(remove).toHaveBeenCalledTimes(1);
    expect(screen.getByText('±4 M · TAP TO UPDATE')).toBeOnTheScreen();

    // Another tap restarts the minute from the reading already on screen.
    await user.press(screen.getByRole('button', { name: /yards to the middle/ }));
    expect(location.watchPositionAsync).toHaveBeenCalledTimes(2);
    expect(screen.getByText('LIVE · ±4 M')).toBeOnTheScreen();
  });

  it('gives front and back when the green has them', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    const front = { lat: 32.897828, lng: -117.250667 };
    const back = { lat: 32.897632, lng: -117.250765 };
    await render(<GreenYardage holeNumber={3} green={green({ front, back, source: 'osm' })} onMark={jest.fn()} />);
    await user.press(screen.getByRole('button', { name: '⌖ YARDS TO GREEN' }));
    await act(async () => send(at(TEE, null)));

    expect(screen.getByText(`${yardsBetween(TEE, front)} FRONT · ${yardsBetween(TEE, back)} BACK`)).toBeOnTheScreen();
    // A browser may not say how accurate it is; nothing is made up in its place.
    expect(screen.getByText('LIVE')).toBeOnTheScreen();
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    await user.press(screen.getByRole('link', { name: /Green from OpenStreetMap/ }));
    expect(openURL).toHaveBeenCalledWith('https://www.openstreetmap.org/copyright');
  });

  it('stops the GPS when it goes, such as on a change of hole', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    const view = await render(<GreenYardage holeNumber={3} green={green()} onMark={jest.fn()} />);
    await user.press(screen.getByRole('button', { name: '⌖ YARDS TO GREEN' }));
    await view.unmount();
    expect(remove).toHaveBeenCalled();
  });

  it('says how to allow location when it is refused, and opens Settings', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    location.requestForegroundPermissionsAsync.mockResolvedValue({ granted: false } as Location.LocationPermissionResponse);
    const openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
    await render(<GreenYardage holeNumber={3} green={green()} onMark={jest.fn()} />);

    await user.press(screen.getByRole('button', { name: '⌖ YARDS TO GREEN' }));
    expect(screen.getByText(/Allow it in Settings/)).toBeOnTheScreen();
    expect(location.watchPositionAsync).not.toHaveBeenCalled();
    await user.press(screen.getByRole('button', { name: 'OPEN SETTINGS' }));
    expect(openSettings).toHaveBeenCalled();
  });

  it('shows what went wrong when location fails, and tries again', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    location.watchPositionAsync.mockRejectedValueOnce(new Error('Location services are off.'));
    await render(<GreenYardage holeNumber={3} green={green()} onMark={jest.fn()} />);

    await user.press(screen.getByRole('button', { name: '⌖ YARDS TO GREEN' }));
    expect(screen.getByText('Location services are off.')).toBeOnTheScreen();
    await user.press(screen.getByRole('button', { name: 'TRY AGAIN' }));
    expect(location.watchPositionAsync).toHaveBeenCalledTimes(2);
  });

  it('marks a green with one careful fix, after asking, and then shows the yardage', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    jest.spyOn(Alert, 'alert');
    location.getCurrentPositionAsync.mockResolvedValue(at(MIDDLE, 3));
    const onMark = jest.fn();
    await render(<GreenYardage holeNumber={3} green={null} onMark={onMark} />);

    expect(screen.getByText(/No green saved for this hole/)).toBeOnTheScreen();
    await user.press(screen.getByRole('button', { name: 'Mark this green, hole 3' }));
    expect(Alert.alert).toHaveBeenLastCalledWith('Mark hole 3’s green?', 'Stand in the middle of the green, then tap Mark.', expect.any(Array));
    await choose('Mark');

    expect(location.getCurrentPositionAsync).toHaveBeenCalledWith({ accuracy: Location.Accuracy.Highest });
    expect(onMark).toHaveBeenCalledWith({ number: 3, middle: MIDDLE, front: null, back: null, source: 'marked' });
    expect(location.watchPositionAsync).toHaveBeenCalled();
  });

  it('refuses a fix too rough to mark a green with, and says why', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    jest.spyOn(Alert, 'alert');
    const onMark = jest.fn();
    await render(<GreenYardage holeNumber={3} green={null} onMark={onMark} />);

    location.getCurrentPositionAsync.mockResolvedValueOnce(at(MIDDLE, 32.4));
    await user.press(screen.getByRole('button', { name: 'Mark this green, hole 3' }));
    await choose('Mark');
    expect(Alert.alert).toHaveBeenLastCalledWith('GPS isn’t sure enough yet', expect.stringContaining('only good to 32 m'));

    location.getCurrentPositionAsync.mockResolvedValueOnce(at(MIDDLE, null));
    await user.press(screen.getByRole('button', { name: 'Mark this green, hole 3' }));
    await choose('Mark');
    expect(Alert.alert).toHaveBeenLastCalledWith('GPS isn’t sure enough yet', expect.stringContaining('didn’t say how accurate'));
    expect(onMark).not.toHaveBeenCalled();
  });

  it('says so when a mark can’t get a fix at all', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    jest.spyOn(Alert, 'alert');
    location.getCurrentPositionAsync.mockRejectedValueOnce(new Error('Timed out.'));
    const onMark = jest.fn();
    await render(<GreenYardage holeNumber={3} green={null} onMark={onMark} />);

    await user.press(screen.getByRole('button', { name: 'Mark this green, hole 3' }));
    await choose('Mark');
    expect(Alert.alert).toHaveBeenLastCalledWith('Couldn’t get your location', 'Timed out.');
    expect(onMark).not.toHaveBeenCalled();
  });

  it('warns that marking again keeps only the middle', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    jest.spyOn(Alert, 'alert');
    await render(<GreenYardage holeNumber={3} green={green({ front: MIDDLE, back: MIDDLE, source: 'osm' })} onMark={jest.fn()} />);

    await user.press(screen.getByRole('button', { name: 'Re-mark hole 3’s green' }));
    expect(Alert.alert).toHaveBeenLastCalledWith(
      'Mark hole 3’s green again?',
      expect.stringContaining('the front and back are cleared'),
      expect.any(Array),
    );
  });

  it('marks nothing when location is refused', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    jest.spyOn(Alert, 'alert');
    location.requestForegroundPermissionsAsync.mockResolvedValue({ granted: false } as Location.LocationPermissionResponse);
    const onMark = jest.fn();
    await render(<GreenYardage holeNumber={3} green={null} onMark={onMark} />);

    await user.press(screen.getByRole('button', { name: 'Mark this green, hole 3' }));
    await choose('Mark');
    expect(location.getCurrentPositionAsync).not.toHaveBeenCalled();
    expect(onMark).not.toHaveBeenCalled();
  });
});
