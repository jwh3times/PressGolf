import AsyncStorage from '@react-native-async-storage/async-storage';
import { STORAGE_VERSION, storageNamespace } from '../config/flags';
import type { AppData, AppSettings } from '../domain/types';

/** Where the demo/live preference lives — outside both datasets, so it survives switching. */
const SETTINGS_KEY = 'press:settings';

interface StoredPayload {
  version: number;
  groups: AppData['groups'];
  courses: AppData['courses'];
  rounds: AppData['rounds'];
  activeGroupId: string | null;
  activeRoundId: string | null;
}

export const EMPTY_DATA: Omit<AppData, 'settings'> & { activeGroupId: null; activeRoundId: null } = {
  groups: [],
  courses: [],
  rounds: [],
  activeGroupId: null,
  activeRoundId: null,
};

function dataKey(demoMode: boolean): string {
  return `${storageNamespace(demoMode)}:data`;
}

/** Reads the dataset for the given mode. A corrupt blob is treated as empty, not fatal. */
export async function loadDataset(demoMode: boolean): Promise<StoredPayload> {
  try {
    const raw = await AsyncStorage.getItem(dataKey(demoMode));
    if (!raw) return { version: STORAGE_VERSION, ...EMPTY_DATA };
    const parsed = JSON.parse(raw) as StoredPayload;
    if (typeof parsed !== 'object' || parsed == null) throw new Error('not an object');
    return {
      version: parsed.version ?? STORAGE_VERSION,
      groups: parsed.groups ?? [],
      courses: parsed.courses ?? [],
      rounds: parsed.rounds ?? [],
      activeGroupId: parsed.activeGroupId ?? null,
      activeRoundId: parsed.activeRoundId ?? null,
    };
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
