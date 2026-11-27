import React from 'react';
import { act, render, screen } from '@testing-library/react-native';
import { PlaceMap } from '../PlaceMap';

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

const coordinate = (lat: number, lng: number) => ({ nativeEvent: { coordinate: { latitude: lat, longitude: lng } } });

beforeEach(() => jest.clearAllMocks());

describe("the map for a new course's location (#383)", () => {
  it('says on the web that the map is in the app', async () => {
    const { PlaceMap: WebMap } = jest.requireActual<typeof import('../PlaceMap.web')>('../PlaceMap.web');
    await render(<WebMap at={null} focus={null} onPlace={jest.fn()} />);
    expect(screen.getByText(/The map works in the app on a phone/)).toBeOnTheScreen();
  });

  it('has no pin until a tap places one, and starts nowhere in particular', async () => {
    const onPlace = jest.fn();
    await render(<PlaceMap at={null} focus={null} onPlace={onPlace} />);
    expect(screen.queryByTestId('pin-course')).toBeNull();
    expect(screen.getByTestId('map').props.initialRegion).toBeUndefined();
    await act(async () => screen.getByTestId('map').props.onPress(coordinate(45.5, -122.6)));
    expect(onPlace).toHaveBeenCalledWith({ lat: 45.5, lng: -122.6 });
    expect(mockAnimateToRegion).not.toHaveBeenCalled();
  });

  it('opens on the pin, which drags, and moves to a course found by name', async () => {
    const onPlace = jest.fn();
    const view = await render(<PlaceMap at={{ lat: 45.5, lng: -122.6 }} focus={null} onPlace={onPlace} />);
    expect(screen.getByTestId('map').props.initialRegion).toMatchObject({ latitude: 45.5, longitude: -122.6 });
    expect(screen.getByTestId('pin-course').props.coordinate).toEqual({ latitude: 45.5, longitude: -122.6 });
    await act(async () => screen.getByTestId('pin-course').props.onDragEnd(coordinate(45.51, -122.61)));
    expect(onPlace).toHaveBeenCalledWith({ lat: 45.51, lng: -122.61 });

    await view.rerender(<PlaceMap at={{ lat: 45.5, lng: -122.6 }} focus={{ lat: 47.6, lng: -122.3 }} onPlace={onPlace} />);
    expect(mockAnimateToRegion).toHaveBeenCalledWith(expect.objectContaining({ latitude: 47.6, longitude: -122.3 }), 400);
  });
});
