import AsyncStorage from '@react-native-async-storage/async-storage';
import { STORAGE_VERSION, storageNamespace } from '../config/flags';
import type { AppData, AppSettings, Course, Hole } from '../domain/types';

/** Where the demo/live preference lives — outside both datasets, so it survives switching. */
const SETTINGS_KEY = 'press:settings';

interface StoredPayload {
  version: number;
  groups: AppData['groups'];
  courses: AppData['courses'];
  rounds: AppData['rounds'];
  outings: AppData['outings'];
  activeGroupId: string | null;
  activeRoundId: string | null;
  activeOutingId: string | null;
  cardRoundId: string | null;
}

export const EMPTY_DATA: Omit<AppData, 'settings'> & {
  activeGroupId: null;
  activeRoundId: null;
  activeOutingId: null;
  cardRoundId: null;
} = {
  groups: [],
  courses: [],
  rounds: [],
  outings: [],
  activeGroupId: null,
  activeRoundId: null,
  activeOutingId: null,
  cardRoundId: null,
};

function dataKey(demoMode: boolean): string {
  return `${storageNamespace(demoMode)}:data`;
}

/**
 * Brings a stored blob up to the current shape.
 *
 * Version 1 had no outings, and every Round was implicitly a standalone group.
 * Those rounds are still perfectly good — they just need the fields that came
 * with outings, defaulted to "this was its own thing". Data saved before max
 * scores gets no max and no pick-ups, and data saved before handicaps plays off
 * the low man at 100% with its pops as typed, so nothing it already settled moves.
 */
function migrate(parsed: Partial<StoredPayload>): StoredPayload {
  const rounds = (parsed.rounds ?? []).map((round) => ({
    ...round,
    outingId: round.outingId ?? null,
    name: round.name ?? 'Our group',
    teeTime: round.teeTime ?? null,
    pickups: round.pickups ?? {},
    entry: round.entry ?? 'live',
    teeId: round.teeId ?? null,
    playerTees: round.playerTees ?? {},
    handicapTees: round.handicapTees ?? {},
    options: {
      ...round.options,
      maxScore: round.options?.maxScore ?? 'off',
      strokes: round.options?.strokes ?? 'off_low',
      allowance: round.options?.allowance ?? 100,
    },
  }));
  return {
    version: STORAGE_VERSION,
    groups: (parsed.groups ?? []).map((group) => ({
      ...group,
      maxScore: group.maxScore ?? 'off',
      strokes: group.strokes ?? 'off_low',
      allowance: group.allowance ?? 100,
      players: (group.players ?? []).map((p) => ({ ...p, handicapIndex: p.handicapIndex ?? null })),
    })),
    courses: (parsed.courses ?? []).map(withTees),
    rounds,
    outings: (parsed.outings ?? []).map((outing) => ({
      ...outing,
      maxScore: outing.maxScore ?? 'off',
      strokes: outing.strokes ?? 'off_low',
      allowance: outing.allowance ?? 100,
    })),
    activeGroupId: parsed.activeGroupId ?? null,
    activeRoundId: parsed.activeRoundId ?? null,
    activeOutingId: parsed.activeOutingId ?? null,
    cardRoundId: parsed.cardRoundId ?? null,
  };
}

/** A course saved before tees had one card; it becomes the course's Default tee. */
function withTees(course: Course & { holes?: Hole[] }): Course {
  if (course.tees?.length) return course;
  const { holes = [], ...rest } = course;
  return { ...rest, tees: [{ id: `${course.id}_default`, name: 'Default', slope: null, rating: null, holes }] };
}

/** Reads the dataset for the given mode. A corrupt blob is treated as empty, not fatal. */
export async function loadDataset(demoMode: boolean): Promise<StoredPayload> {
  try {
    const raw = await AsyncStorage.getItem(dataKey(demoMode));
    if (!raw) return { version: STORAGE_VERSION, ...EMPTY_DATA };
    const parsed = JSON.parse(raw) as Partial<StoredPayload>;
    if (typeof parsed !== 'object' || parsed == null) throw new Error('not an object');
    return migrate(parsed);
  } catch {
    // Losing a round hurts, but refusing to open at all hurts more.
    return { version: STORAGE_VERSION, ...EMPTY_DATA };
  }
}

export async function saveDataset(demoMode: boolean, data: Omit<StoredPayload, 'version'>): Promise<void> {
  const payload: StoredPayload = { version: STORAGE_VERSION, ...data };
  await AsyncStorage.setItem(dataKey(demoMode), JSON.stringify(payload));
}

export async function loadSettings(fallback: AppSettings): Promise<AppSettings> {
  try {
    const raw = await AsyncStorage.getItem(SETTINGS_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return {
      demoMode: typeof parsed.demoMode === 'boolean' ? parsed.demoMode : fallback.demoMode,
      activeGroupId: parsed.activeGroupId ?? null,
      activeRoundId: parsed.activeRoundId ?? null,
      activeOutingId: parsed.activeOutingId ?? null,
    };
  } catch {
    return fallback;
  }
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

/** Wipes one dataset. Used by "reset demo data" and "erase everything". */
export async function clearDataset(demoMode: boolean): Promise<void> {
  await AsyncStorage.removeItem(dataKey(demoMode));
}
