import React from 'react';
import { act, render, screen } from '@testing-library/react-native';
import * as Location from 'expo-location';
import type { Green } from '../../domain/types';
import { GreenMap, regionFor } from '../GreenMap';

const mockAnimateToRegion = jest.fn();

jest.mock('react-native-maps', () => {
  const { forwardRef, useImperativeHandle } = jest.requireActual<typeof import('react')>('react');
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  const MapView = forwardRef((props: Record<string, unknown>, ref) => {
    useImperativeHandle(ref, () => ({ animateToRegion: (...args: unknown[]) => mockAnimateToRegion(...args) }));
    return <View testID="map" {...props} />;
  });
  const Marker = (props: Record<string, unknown>) => <View testID={`pin-${String(props.identifier)}`} {...props} />;
  return { __esModule: true, default: MapView, Marker };
});

jest.mock('expo-location', () => ({
  getForegroundPermissionsAsync: jest.fn(async () => ({ granted: false })),
  getLastKnownPositionAsync: jest.fn(async () => null),
}));

const location = jest.mocked(Location);

const green = (number: number, extra: Partial<Green> = {}): Green => ({
  number,
  middle: { lat: 45.5 + number / 1000, lng: -122.6 },
  front: null,
  back: null,
  source: 'map',
  ...extra,
});

const coordinate = (lat: number, lng: number) => ({ nativeEvent: { coordinate: { latitude: lat, longitude: lng } } });

beforeEach(() => jest.clearAllMocks());

describe('regionFor', () => {
  it('has nothing to start from without greens', () => {
    expect(regionFor([])).toBeUndefined();
  });

  it('covers every green, with a margin, and never closer in than about a hole', () => {
    const region = regionFor([green(1), green(9)])!;
    expect(region.latitude).toBeCloseTo(45.505, 6);
    expect(region.latitudeDelta).toBeCloseTo(0.008 * 1.4, 6);
    expect(regionFor([green(1)])!.latitudeDelta).toBe(0.006);
  });
});

describe('GreenMap', () => {
  it('is satellite, opens over the greens, and reports a tap where it lands', async () => {
    const onTap = jest.fn();
    await render(<GreenMap greens={[green(1)]} selected={1} onTap={onTap} onDrag={jest.fn()} focus={null} />);
    const map = screen.getByTestId('map');
    expect(map).toHaveProp('mapType', 'satellite');
    expect(map).toHaveProp('initialRegion', regionFor([green(1)]));
    await act(async () => map.props.onPress(coordinate(45.6, -122.7)));
    expect(onTap).toHaveBeenCalledWith({ lat: 45.6, lng: -122.7 });
    expect(location.getForegroundPermissionsAsync).not.toHaveBeenCalled();
  });

  it('lets only the chosen hole\'s pins move, and shows its front and back', async () => {
    const onDrag = jest.fn();
    const withEdges = green(2, { front: { lat: 1, lng: 1 }, back: { lat: 2, lng: 2 } });
    await render(<GreenMap greens={[green(1, { front: { lat: 3, lng: 3 } }), withEdges]} selected={2} onTap={jest.fn()} onDrag={onDrag} focus={null} />);

    expect(screen.getByTestId('pin-1-middle')).toHaveProp('draggable', false);
    expect(screen.queryByTestId('pin-1-front')).toBeNull();
    expect(screen.getByTestId('pin-2-middle')).toHaveProp('draggable', true);
    expect(screen.getByTestId('pin-2-back')).toHaveProp('title', 'Hole 2, back');
    await act(async () => screen.getByTestId('pin-2-front').props.onDragEnd(coordinate(4, 5)));
    expect(onDrag).toHaveBeenCalledWith(2, 'front', { lat: 4, lng: 5 });
  });

  it('moves to a course found by name', async () => {
    const view = await render(<GreenMap greens={[]} selected={1} onTap={jest.fn()} onDrag={jest.fn()} focus={null} />);
    await view.rerender(<GreenMap greens={[]} selected={1} onTap={jest.fn()} onDrag={jest.fn()} focus={{ lat: 47.2, lng: -122.57 }} />);
    expect(mockAnimateToRegion).toHaveBeenLastCalledWith(expect.objectContaining({ latitude: 47.2, longitude: -122.57 }), 400);
  });

  it('starts a course with no greens where the phone last was, but only if it may already say', async () => {
    location.getForegroundPermissionsAsync.mockResolvedValueOnce({ granted: true } as Location.LocationPermissionResponse);
    location.getLastKnownPositionAsync.mockResolvedValueOnce({ coords: { latitude: 47.2, longitude: -122.57 } } as Location.LocationObject);
    await render(<GreenMap greens={[]} selected={1} onTap={jest.fn()} onDrag={jest.fn()} focus={null} />);
    await act(async () => {});
    expect(mockAnimateToRegion).toHaveBeenCalledWith(expect.objectContaining({ latitude: 47.2, longitude: -122.57 }), 0);

    mockAnimateToRegion.mockClear();
    await render(<GreenMap greens={[]} selected={1} onTap={jest.fn()} onDrag={jest.fn()} focus={null} />);
    await act(async () => {});
    expect(location.getLastKnownPositionAsync).toHaveBeenCalledTimes(1);
    expect(mockAnimateToRegion).not.toHaveBeenCalled();
  });
});
