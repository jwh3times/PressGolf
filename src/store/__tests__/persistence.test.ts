import AsyncStorage from '@react-native-async-storage/async-storage';
import { buildDemoDataset } from '../../demo/seed';
import {
  EMPTY_DATA,
  clearDataset,
  loadDataset,
  loadSettings,
  loadThemeChoice,
  saveDataset,
  saveSettings,
  saveThemeChoice,
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

  it('gives data saved before max scores no max and no pick-ups', async () => {
    const dataset = buildDemoDataset(123);
    const strip = <T extends object>(value: T, key: string) => {
      const copy = { ...value } as Record<string, unknown>;
      delete copy[key];
      return copy;
    };
    const round = strip(dataset.rounds[0], 'pickups');
    round.options = strip(dataset.rounds[0].options, 'maxScore');
    storage.getItem.mockResolvedValueOnce(
      JSON.stringify({
        groups: [strip(dataset.groups[0], 'maxScore')],
        rounds: [round],
        outings: [strip(dataset.outings[0], 'maxScore')],
      }),
    );

    const loaded = await loadDataset(true);

    expect(loaded.groups[0].maxScore).toBe('off');
    expect(loaded.rounds[0].pickups).toEqual({});
    expect(loaded.rounds[0].options.maxScore).toBe('off');
    expect(loaded.outings[0].maxScore).toBe('off');
  });

  it('gives data saved before handicaps the off-the-low-man rule and keeps its pops', async () => {
    const dataset = buildDemoDataset(123);
    const strip = <T extends object>(value: T, ...keys: string[]) => {
      const copy = { ...value } as Record<string, unknown>;
      for (const key of keys) delete copy[key];
      return copy;
    };
    const group = strip(dataset.groups[0], 'strokes', 'allowance');
    group.players = dataset.groups[0].players.map((p) => strip(p, 'handicapIndex', 'handicapUpdatedAt'));
    const round = strip(dataset.rounds[0], 'handicapTees');
    round.options = strip(dataset.rounds[0].options, 'strokes', 'allowance');
    storage.getItem.mockResolvedValueOnce(
      JSON.stringify({ groups: [group], rounds: [round], outings: [strip(dataset.outings[0], 'strokes', 'allowance')] }),
    );

    const loaded = await loadDataset(true);

    expect(loaded.groups[0]).toMatchObject({ strokes: 'off_low', allowance: 100 });
    expect(loaded.groups[0].players.every((p) => p.handicapIndex === null && p.handicapUpdatedAt === null)).toBe(true);
    expect(loaded.rounds[0].options).toMatchObject({ strokes: 'off_low', allowance: 100 });
    expect(loaded.rounds[0].handicapTees).toEqual({});
    expect(loaded.rounds[0].pops).toEqual(dataset.rounds[0].pops);
    expect(loaded.outings[0]).toMatchObject({ strokes: 'off_low', allowance: 100 });
  });

  it('puts courses saved before tees onto a Default tee', async () => {
    const dataset = buildDemoDataset(123);
    const holes = dataset.courses[0].tees[0].holes;
    const oldCourse = { id: 'old', name: 'Old Course', holes, createdAt: 1 };
    const oldRound = { ...dataset.rounds[0] } as Record<string, unknown>;
    delete oldRound.teeId;
    delete oldRound.playerTees;
    storage.getItem.mockResolvedValueOnce(JSON.stringify({ courses: [oldCourse], rounds: [oldRound] }));

    const loaded = await loadDataset(true);

    expect(loaded.courses[0]).toEqual({
      id: 'old',
      name: 'Old Course',
      tees: [{ id: 'old_default', name: 'Default', slope: null, rating: null, holes }],
      greens: [],
      features: [],
      notes: [],
      createdAt: 1,
    });
    expect(loaded.rounds[0]).toMatchObject({ teeId: null, playerTees: {} });
  });

  it('keeps a course\'s greens and map, and gives one saved before them none', async () => {
    const [course] = buildDemoDataset(123).courses;
    const green = { number: 1, middle: { lat: 45.5, lng: -122.6 }, front: null, back: null, source: 'marked' };
    const bunker = { id: 'osm:way/1', kind: 'bunker', hole: null, points: [{ lat: 45.5, lng: -122.6 }], source: 'osm' };
    const { greens: _greens, features: _features, ...before } = course;
    storage.getItem.mockResolvedValueOnce(
      JSON.stringify({ courses: [{ ...course, greens: [green], features: [bunker] }, { ...before, id: 'before' }] }),
    );

    const loaded = await loadDataset(true);

    expect(loaded.courses[0]).toMatchObject({ greens: [green], features: [bunker] });
    expect(loaded.courses[1]).toMatchObject({ greens: [], features: [] });
  });

  it('keeps the bag, and gives data saved before it none', async () => {
    const clubs = [{ id: 'k1', name: 'Driver', carry: 240 }];
    storage.getItem.mockResolvedValueOnce(JSON.stringify({ clubs }));
    expect((await loadDataset(false)).clubs).toEqual(clubs);
    storage.getItem.mockResolvedValueOnce(JSON.stringify({ groups: [] }));
    expect((await loadDataset(false)).clubs).toEqual([]);
  });

  it('keeps practice-round marks, and gives data saved before them none', async () => {
    const practice = { r1: { on: false, ever: true } };
    storage.getItem.mockResolvedValueOnce(JSON.stringify({ practice }));
    expect((await loadDataset(false)).practice).toEqual(practice);
    storage.getItem.mockResolvedValueOnce(JSON.stringify({ groups: [] }));
    expect((await loadDataset(false)).practice).toEqual({});
  });

  it('treats rounds saved before card entry as scored live', async () => {
    const dataset = buildDemoDataset(123);
    const round = { ...dataset.rounds[0] } as Record<string, unknown>;
    delete round.entry;
    storage.getItem.mockResolvedValueOnce(JSON.stringify({ rounds: [round] }));

    expect((await loadDataset(true)).rounds[0].entry).toBe('live');
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

describe('theme choice persistence', () => {
  it('is the default when nothing is saved or the blob is unreadable', async () => {
    storage.getItem.mockResolvedValueOnce(null);
    await expect(loadThemeChoice()).resolves.toEqual({ base: 'dark', accent: 'green' });
    storage.getItem.mockResolvedValueOnce('{not json');
    await expect(loadThemeChoice()).resolves.toEqual({ base: 'dark', accent: 'green' });
    storage.getItem.mockResolvedValueOnce('null');
    await expect(loadThemeChoice()).resolves.toEqual({ base: 'dark', accent: 'green' });
  });

  it('reads a saved choice back, and replaces an unknown part with the default', async () => {
    storage.getItem.mockResolvedValueOnce(JSON.stringify({ base: 'lightContrast', accent: 'violet' }));
    await expect(loadThemeChoice()).resolves.toEqual({ base: 'lightContrast', accent: 'violet' });
    storage.getItem.mockResolvedValueOnce(JSON.stringify({ base: 'sepia', accent: 'gold' }));
    await expect(loadThemeChoice()).resolves.toEqual({ base: 'dark', accent: 'gold' });
    expect(storage.getItem).toHaveBeenCalledWith('press:theme');
  });

  it('writes the choice under its own key', async () => {
    await saveThemeChoice({ base: 'light', accent: 'blue' });
    expect(storage.setItem).toHaveBeenCalledWith('press:theme', JSON.stringify({ base: 'light', accent: 'blue' }));
  });
});
