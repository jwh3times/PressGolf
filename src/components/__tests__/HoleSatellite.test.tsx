import React from 'react';
import { act, render, screen } from '@testing-library/react-native';
import { frame, holePlan } from '../../domain/hole-map';
import type { Course, CourseFeature, FeatureKind, LatLng } from '../../domain/types';
import { makeTestCourse } from '../../domain/__tests__/helpers';
import { holeView } from '../HoleDiagram';
import { corners, HoleSatellite, turnedCamera } from '../HoleSatellite';

const mockFitToCoordinates = jest.fn();
const mockGetCamera = jest.fn();
const mockSetCamera = jest.fn();

jest.mock('react-native-maps', () => {
  const { forwardRef, useImperativeHandle } = jest.requireActual<typeof import('react')>('react');
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  const MapView = forwardRef((props: Record<string, unknown>, ref) => {
    useImperativeHandle(ref, () => ({
      fitToCoordinates: (...args: unknown[]) => mockFitToCoordinates(...args),
      getCamera: () => mockGetCamera(),
      setCamera: (...args: unknown[]) => mockSetCamera(...args),
    }));
    return <View testID="map" {...props} />;
  });
  const shape = (name: string) => (props: Record<string, unknown>) => <View testID={name} {...props} />;
  return { __esModule: true, default: MapView, Marker: shape('marker'), Polygon: shape('polygon'), Polyline: shape('polyline') };
});

const ORIGIN: LatLng = { lat: 32.9, lng: -117.25 };
const flat = frame(ORIGIN, 0);
const at = (north: number, east = 0) => flat.toLatLng([east, north]);
const box = (south: number, north: number, west: number, east: number) => [at(south, west), at(south, east), at(north, east), at(north, west)];
const feature = (id: string, kind: FeatureKind, points: LatLng[], hole: number | null = null): CourseFeature => ({ id, kind, hole, points, source: 'osm' });

/** A hole running north-east, 400 m, with trouble on it. */
const course: Course = {
  ...makeTestCourse(),
  greens: [{ number: 1, middle: frame(ORIGIN, 45).toLatLng([0, 400]), front: null, back: null, source: 'osm' }],
  features: [
    feature('line', 'holeLine', [ORIGIN, frame(ORIGIN, 45).toLatLng([0, 400])], 1),
    feature('bunker', 'bunker', box(150, 160, 140, 150)),
    feature('water', 'lateralWater', box(200, 230, 120, 200)),
    feature('ob', 'outOfBounds', [at(0, 60), at(300, 360)]),
    feature('fairway', 'fairway', box(0, 280, 0, 280)),
  ],
};
const plan = holePlan(course, 1);
const view = holeView(plan, [])!;

beforeEach(() => jest.clearAllMocks());

describe('turnedCamera', () => {
  it('keeps the fitted camera for a hole that already runs north', () => {
    const north = holeView(holePlan({ ...course, features: [feature('line', 'holeLine', [at(0), at(400)], 1)], greens: [] }, 1), [])!;
    const turned = turnedCamera(north, { center: { latitude: 0, longitude: 0 }, heading: 0, pitch: 0, altitude: 1000, zoom: 16 }, 360, 440);
    expect(turned.heading).toBeCloseTo(0, 6);
    expect(turned.altitude).toBeCloseTo(1000, 6);
    expect(turned.zoom).toBeCloseTo(16, 6);
  });

  it('turns a diagonal hole up the screen and comes in closer, by the same ratio for altitude and zoom', () => {
    const turned = turnedCamera(view, { center: { latitude: 0, longitude: 0 }, heading: 0, pitch: 0, altitude: 1000, zoom: 16 }, 360, 440);
    expect(turned.heading).toBeCloseTo(45, 3);
    expect(turned.pitch).toBe(0);
    const ratio = turned.altitude! / 1000;
    expect(ratio).toBeLessThan(1);
    expect(turned.zoom).toBeCloseTo(16 - Math.log2(ratio), 6);
    const middle = view.frame.toLatLng([(view.minX + view.maxX) / 2, (view.minY + view.maxY) / 2]);
    expect(turned.center).toEqual({ latitude: middle.lat, longitude: middle.lng });
  });

  it('leaves out what the platform doesn\'t use', () => {
    const apple = turnedCamera(view, { center: { latitude: 0, longitude: 0 }, heading: 0, pitch: 0, altitude: 1000 } as never, 360, 440);
    expect(apple.zoom).toBeUndefined();
    const google = turnedCamera(view, { center: { latitude: 0, longitude: 0 }, heading: 0, pitch: 0, zoom: 16 } as never, 360, 440);
    expect(google.altitude).toBeUndefined();
  });
});

describe('HoleSatellite', () => {
  const layOut = async () => {
    const root = screen.getByTestId('satellite-box');
    await act(async () => root.props.onLayout({ nativeEvent: { layout: { width: 360, height: 440 } } }));
  };

  it('frames the hole north-up, then turns it to play up the screen, once', async () => {
    await render(<HoleSatellite plan={plan} view={view} from={null} fromTee target={null} onTarget={jest.fn()} />);
    await layOut();
    const map = screen.getByTestId('map');
    expect(map).toHaveProp('mapType', 'satellite');
    expect(map).toHaveProp('rotateEnabled', false);
    await act(async () => map.props.onMapReady());
    expect(mockFitToCoordinates).toHaveBeenCalledWith(corners(view), expect.objectContaining({ animated: false }));

    const fitted = { center: { latitude: 0, longitude: 0 }, heading: 0, pitch: 0, altitude: 1000 };
    mockGetCamera.mockResolvedValue(fitted);
    await act(async () => map.props.onRegionChangeComplete());
    expect(mockSetCamera).toHaveBeenCalledWith(turnedCamera(view, fitted, 360, 440));
    // The player panning afterwards is left alone.
    await act(async () => map.props.onRegionChangeComplete());
    expect(mockSetCamera).toHaveBeenCalledTimes(1);
  });

  it('outlines only the trouble, draws the legs and their yards, and reports a tap', async () => {
    const onTarget = jest.fn();
    const target = frame(ORIGIN, 45).toLatLng([0, 250]);
    await render(<HoleSatellite plan={plan} view={view} from={ORIGIN} fromTee target={target} onTarget={onTarget} />);
    await layOut();
    // The bunker and the water; the fairway is in the picture already.
    expect(screen.getAllByTestId('polygon')).toHaveLength(2);
    // Out of bounds, and the two legs: tee to target, target to green.
    expect(screen.getAllByTestId('polyline')).toHaveLength(3);
    expect(screen.getByText('273')).toBeOnTheScreen();
    expect(screen.getByText('164')).toBeOnTheScreen();
    // Two yardages, the target, and the tee.
    expect(screen.getAllByTestId('marker')).toHaveLength(4);

    await act(async () => screen.getByTestId('map').props.onPress({ nativeEvent: { coordinate: { latitude: 32.901, longitude: -117.249 } } }));
    expect(onTarget).toHaveBeenCalledWith({ lat: 32.901, lng: -117.249 });
  });

  it('shows the phone\'s own dot, not a marker, when measuring from you', async () => {
    await render(<HoleSatellite plan={plan} view={view} from={ORIGIN} fromTee={false} target={null} onTarget={jest.fn()} />);
    await layOut();
    expect(screen.getByTestId('map')).toHaveProp('showsUserLocation', true);
    expect(screen.queryAllByTestId('marker')).toHaveLength(0);
  });
});
