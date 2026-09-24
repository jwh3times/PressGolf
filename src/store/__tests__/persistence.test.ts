import AsyncStorage from '@react-native-async-storage/async-storage';
import { buildDemoDataset } from '../../demo/seed';
import {
  EMPTY_DATA,
  clearDataset,
  loadDataset,
  loadSettings,
  saveDataset,
  saveSettings,
} from '../persistence';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));

const storage = AsyncStorage as jest.Mocked<typeof AsyncStorage>;
const fallback = {
  demoMode: false,
  activeGroupId: 'fallback-group',
  activeRoundId: 'fallback-round',
  activeOutingId: 'fallback-outing',
};

beforeEach(() => jest.clearAllMocks());

describe('dataset persistence', () => {
  it.each([true, false])('returns an empty %s dataset when storage has nothing', async (demoMode) => {
    storage.getItem.mockResolvedValueOnce(null);
    await expect(loadDataset(demoMode)).resolves.toEqual(expect.objectContaining(EMPTY_DATA));
    expect(storage.getItem).toHaveBeenCalledWith(demoMode ? 'press:demo:data' : 'press:live:data');
  });

  it('migrates older and partial datasets into the current shape', async () => {
    const dataset = buildDemoDataset(123);
    const oldRound = { ...dataset.rounds[0] } as Record<string, unknown>;
    delete oldRound.outingId;
    delete oldRound.name;
    delete oldRound.teeTime;
    storage.getItem.mockResolvedValueOnce(
      JSON.stringify({ groups: dataset.groups, rounds: [oldRound], activeGroupId: undefined }),
    );

    const loaded = await loadDataset(true);

    expect(loaded.rounds[0]).toMatchObject({ outingId: null, name: 'Our group', teeTime: null });
    expect(loaded).toMatchObject({ courses: [], outings: [], activeGroupId: null, activeRoundId: null, activeOutingId: null });
  });

  it.each(['null', '42', '{broken'])('treats corrupt payload %s as empty', async (raw) => {
    storage.getItem.mockResolvedValueOnce(raw);
    await expect(loadDataset(false)).resolves.toEqual(expect.objectContaining(EMPTY_DATA));
  });

  it('writes and clears the selected dataset namespace', async () => {
    const data = buildDemoDataset(123);
    await saveDataset(true, data);
    const saved = JSON.parse(storage.setItem.mock.calls[0][1]);
    expect(storage.setItem.mock.calls[0][0]).toBe('press:demo:data');
    expect(saved).toMatchObject({ version: expect.any(Number), groups: data.groups });

    await clearDataset(false);
    expect(storage.removeItem).toHaveBeenCalledWith('press:live:data');
  });
});

describe('settings persistence', () => {
  it('uses the fallback for missing, invalid, and unreadable settings', async () => {
    storage.getItem.mockResolvedValueOnce(null);
    await expect(loadSettings(fallback)).resolves.toBe(fallback);
    storage.getItem.mockResolvedValueOnce('{broken');
    await expect(loadSettings(fallback)).resolves.toBe(fallback);
    storage.getItem.mockRejectedValueOnce(new Error('disk'));
    await expect(loadSettings(fallback)).resolves.toBe(fallback);
  });

  it('validates the mode and defaults absent pointers', async () => {
    storage.getItem.mockResolvedValueOnce(
      JSON.stringify({ demoMode: 'yes', activeGroupId: 'g', activeRoundId: undefined, activeOutingId: 'o' }),
    );
    await expect(loadSettings(fallback)).resolves.toEqual({
      demoMode: false,
      activeGroupId: 'g',
      activeRoundId: null,
      activeOutingId: 'o',
    });

    storage.getItem.mockResolvedValueOnce(JSON.stringify({ demoMode: true }));
    await expect(loadSettings(fallback)).resolves.toEqual({
      demoMode: true,
      activeGroupId: null,
      activeRoundId: null,
      activeOutingId: null,
    });
  });

  it('writes settings', async () => {
    await saveSettings(fallback);
    expect(storage.setItem).toHaveBeenCalledWith('press:settings', JSON.stringify(fallback));
  });
});
