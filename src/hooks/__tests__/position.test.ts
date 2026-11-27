import * as Location from 'expo-location';
import { positionHere, roughPosition } from '../position';

jest.mock('expo-location', () => ({
  Accuracy: { Balanced: 3, High: 4 },
  requestForegroundPermissionsAsync: jest.fn(),
  getLastKnownPositionAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
}));

const location = jest.mocked(Location);
const at = (latitude: number, longitude: number) => ({ coords: { latitude, longitude } }) as Location.LocationObject;

beforeEach(() => {
  jest.clearAllMocks();
  location.requestForegroundPermissionsAsync.mockResolvedValue({ granted: true } as never);
  location.getLastKnownPositionAsync.mockResolvedValue(null);
  location.getCurrentPositionAsync.mockResolvedValue(at(45.5, -122.6));
});

describe('where the phone is, for courses (#383)', () => {
  it('takes the last known position for a search, or a rough fix when there is none', async () => {
    location.getLastKnownPositionAsync.mockResolvedValueOnce(at(47.6, -122.3));
    await expect(roughPosition()).resolves.toEqual({ lat: 47.6, lng: -122.3 });
    expect(location.getCurrentPositionAsync).not.toHaveBeenCalled();
    await expect(roughPosition()).resolves.toEqual({ lat: 45.5, lng: -122.6 });
    expect(location.getCurrentPositionAsync).toHaveBeenCalledWith({ accuracy: Location.Accuracy.Balanced });
  });

  it('rounds the position a search sends to about a kilometre', async () => {
    location.getLastKnownPositionAsync.mockResolvedValueOnce(at(47.60621, -122.33207));
    await expect(roughPosition()).resolves.toEqual({ lat: 47.61, lng: -122.33 });
  });

  it("keeps a new course's location as the phone gives it", async () => {
    location.getCurrentPositionAsync.mockResolvedValueOnce(at(47.60621, -122.33207));
    await expect(positionHere()).resolves.toEqual({ lat: 47.60621, lng: -122.33207 });
  });

  it('searches by name alone when location is refused or fails', async () => {
    location.requestForegroundPermissionsAsync.mockResolvedValueOnce({ granted: false } as never);
    await expect(roughPosition()).resolves.toBeNull();
    location.getLastKnownPositionAsync.mockRejectedValueOnce(new Error('Location services are off'));
    await expect(roughPosition()).resolves.toBeNull();
  });

  it("takes a close fix for a course's location, and nothing when refused", async () => {
    await expect(positionHere()).resolves.toEqual({ lat: 45.5, lng: -122.6 });
    expect(location.getCurrentPositionAsync).toHaveBeenCalledWith({ accuracy: Location.Accuracy.High });
    location.requestForegroundPermissionsAsync.mockResolvedValueOnce({ granted: false } as never);
    await expect(positionHere()).resolves.toBeNull();
  });
});
