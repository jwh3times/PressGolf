import React, { useState } from 'react';
import { act, render, screen, userEvent, waitFor } from '@testing-library/react-native';
import { useAuth } from '../../auth/AuthProvider';
import { STORAGE_VERSION } from '../../config/flags';
import { buildDemoDataset } from '../../demo/seed';
import { featuresFromOsm } from '../../osm/features';
import { greensFromOsm, type OsmElement } from '../../osm/greens';
import torrey from '../../osm/__tests__/torrey-south.json';
import { AppStoreProvider, useStore, type AppStore } from '../../store/AppStore';
import { loadDataset, loadSettings } from '../../store/persistence';
import { useDataSync } from '../../sync/useDataSync';
import CourseGuideScreen from '../course-guide';
import HistoryScreen from '../history';
import NewRoundScreen from '../new-round';

/**
 * The tournament round (#410), on the real store: New round, the course guide and
 * History, with storage and the server faked underneath.
 */

type Place = { path: string; params: Record<string, string> };
let mockStack: Place[] = [];
let mockRender = () => {};
const go = (place: Place) => {
  mockStack = [...mockStack, place];
  mockRender();
};
const mockRouter = {
  push: jest.fn((to: string | { pathname: string; params?: Record<string, string> }) =>
    go(typeof to === 'string' ? { path: to, params: {} } : { path: to.pathname, params: to.params ?? {} }),
  ),
  replace: jest.fn((to: string) => {
    mockStack = [...mockStack.slice(0, -1), { path: to, params: {} }];
    mockRender();
  }),
  back: jest.fn(() => {
    mockStack = mockStack.slice(0, -1);
    mockRender();
  }),
};

jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => mockStack.at(-1)?.params ?? {},
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('../../auth/AuthProvider', () => ({ useAuth: jest.fn() }));
jest.mock('../../sync/useDataSync', () => ({ useDataSync: jest.fn() }));
jest.mock('../../sync/supabase', () => ({ deleteAccount: jest.fn(), isSupabaseConfigured: jest.fn(() => true) }));
jest.mock('../../store/persistence', () => ({
  clearDataset: jest.fn(),
  loadDataset: jest.fn(),
  loadSettings: jest.fn(),
  saveDataset: jest.fn(() => Promise.resolve()),
  saveSettings: jest.fn(() => Promise.resolve()),
  loadScanNoticeSeen: jest.fn(() => Promise.resolve(true)),
  saveScanNoticeSeen: jest.fn(() => Promise.resolve()),
}));

let store: AppStore;

function Probe() {
  const value = useStore();
  React.useEffect(() => {
    store = value;
  }, [value]);
  return null;
}

/** The stack's top screen, once the store has loaded, as the app shows none before. */
function Routes() {
  const [, setTick] = useState(0);
  const { ready } = useStore();
  React.useEffect(() => {
    mockRender = () => setTick((tick) => tick + 1);
  }, []);
  if (!ready) return null;
  const here = mockStack.at(-1)?.path;
  if (here === '/course-guide') return <CourseGuideScreen />;
  if (here === '/new-round') return <NewRoundScreen />;
  if (here === '/history') return <HistoryScreen />;
  return null;
}

const dataset = buildDemoDataset(1_750_000_000_000);
const elements = torrey.elements as unknown as OsmElement[];
// The demo course's card, with Torrey Pines South's map: hole 3 has a green and lines to aim by.
const mapped = { ...dataset.courses[0], features: featuresFromOsm(elements, 18), greens: greensFromOsm(elements, 18).greens };
/** Where to aim on hole 3, in its row of the course guide. */
const AIM = /Aim: Aim at the middle of the green\. Short is safer than long\.$/;

/** The app on New round, for a phone whose stored data is `stored` (none by default). */
async function open(stored: Record<string, unknown> = {}) {
  (loadSettings as jest.Mock).mockResolvedValueOnce({ demoMode: false, activeGroupId: null, activeRoundId: null, activeOutingId: null });
  (loadDataset as jest.Mock).mockResolvedValueOnce({
    version: STORAGE_VERSION,
    ...dataset,
    courses: [mapped],
    // No carries in the bag, so no club to suggest: where to aim is the advice to look for.
    clubs: [],
    openRoundIds: [],
    seenCells: null,
    hiddenCourses: [],
    ...stored,
  });
  mockStack = [{ path: '/new-round', params: {} }];
  store = undefined as unknown as AppStore;
  await render(
    <AppStoreProvider>
      <Probe />
      <Routes />
    </AppStoreProvider>,
  );
  await waitFor(() => expect(store?.ready).toBe(true));
}

const user = () => userEvent.setup();

/** Starts the round on New round, then opens its course guide. */
async function startAndOpenGuide() {
  await user().press(screen.getByRole('button', { name: /^Start · / }));
  const roundId = store.activeRoundId!;
  await act(async () => go({ path: '/course-guide', params: { course: mapped.id, round: roundId } }));
  return roundId;
}

const hole3 = () => screen.getByRole('button', { name: /^Hole 3 PAR/ });
const tournamentSwitch = () => screen.getByRole('switch', { name: 'Tournament round' });
const REMINDER = 'Playing under the Rules? Turn on Tournament round: Rule 4.3a doesn’t allow club or aim advice.';

/** Opens New round again, as Home's button would. */
async function openNewRound() {
  await act(async () => go({ path: '/new-round', params: {} }));
}

beforeEach(() => {
  jest.clearAllMocks();
  (loadSettings as jest.Mock).mockReset();
  (loadDataset as jest.Mock).mockReset();
  (useAuth as jest.Mock).mockReturnValue({ status: 'signed-in', email: 'golfer@example.com', userId: 'user-1', signOut: jest.fn(), stopDemo: jest.fn() });
  (useDataSync as jest.Mock).mockReturnValue({ status: 'synced', at: null, message: null, settle: jest.fn() });
});

describe('a tournament round (#410)', () => {
  it("shows advice in a phone's first round, with Tournament round off", async () => {
    await open();
    expect(screen.getByRole('switch', { name: 'Tournament round' })).not.toBeChecked();
    await startAndOpenGuide();
    expect(hole3()).toHaveAccessibleName(AIM);
    expect(screen.getByRole('switch', { name: 'Tournament round' })).not.toBeChecked();
    // The reminder is New round's, before the round starts: not in the round itself.
    expect(screen.queryByText(REMINDER)).toBeNull();
  });

  it('starts the next round as this phone last left the switch, on New round or in a round', async () => {
    await open();
    await user().press(tournamentSwitch());
    // Turning it on needs no asking.
    expect(tournamentSwitch()).toBeChecked();
    expect(screen.queryByText(/Rule 4\.3a\)\. The first time/)).toBeNull();
    await startAndOpenGuide();
    expect(hole3()).not.toHaveAccessibleName(AIM);
    expect(tournamentSwitch()).toBeChecked();

    await openNewRound();
    expect(tournamentSwitch()).toBeChecked();
    const second = await startAndOpenGuide();
    // Turned off in the round, so the next one starts off.
    await user().press(tournamentSwitch());
    await user().press(screen.getByRole('button', { name: 'Show advice in this round' }));
    expect(hole3()).toHaveAccessibleName(AIM);
    expect(store.tournament[second]).toEqual({ on: false, fromStart: false });

    await openNewRound();
    expect(tournamentSwitch()).not.toBeChecked();
  });

  it('starts a round as New round showed it, and leaves the remembered choice alone when the switch was not touched', async () => {
    await open({ tournamentNext: true });
    expect(tournamentSwitch()).toBeChecked();
    // Changed in another round while New round is open.
    await act(async () => store.setTournament('elsewhere', false));
    const roundId = await startAndOpenGuide();
    expect(store.tournament[roundId]).toEqual({ on: true, fromStart: true });
    expect(store.tournamentNext).toBe(false);
  });

  it('leaves the remembered choice alone when New round is left without starting', async () => {
    await open();
    await user().press(tournamentSwitch());
    await act(async () => mockRouter.back());
    await openNewRound();
    expect(tournamentSwitch()).not.toBeChecked();
    expect(store.tournamentNext).toBe(false);
  });

  it('explains the Rule before showing advice in a tournament round, and keeps it one on a change of mind', async () => {
    await open({ tournamentNext: true });
    const roundId = await startAndOpenGuide();
    await user().press(tournamentSwitch());
    expect(screen.getByText(/Rule 4\.3a\)\. The first time costs two strokes, or the hole in match play; the second is disqualification\./)).toBeOnTheScreen();
    await user().press(screen.getByRole('button', { name: 'Keep it a tournament round' }));
    expect(screen.queryByText(/Rule 4\.3a\)\. The first time/)).toBeNull();
    expect(tournamentSwitch()).toBeChecked();
    expect(hole3()).not.toHaveAccessibleName(AIM);
    expect(store.tournament[roundId]).toEqual({ on: true, fromStart: true });
  });

  it('reminds on New round, while the switch is off, that a round under the Rules needs it', async () => {
    await open();
    expect(screen.getByText(REMINDER)).toBeOnTheScreen();
    await user().press(tournamentSwitch());
    expect(screen.queryByText(REMINDER)).toBeNull();
    // Off again before the round starts: at once, with no Rule to read.
    await user().press(tournamentSwitch());
    expect(tournamentSwitch()).not.toBeChecked();
    expect(screen.getByText(REMINDER)).toBeOnTheScreen();
  });

  it('tags in History only a round that was a tournament round from start to finish', async () => {
    await open({ tournamentNext: true });
    const whole = await startAndOpenGuide();
    await act(async () => store.completeRound(whole));

    await openNewRound();
    const part = await startAndOpenGuide();
    await user().press(tournamentSwitch());
    await user().press(screen.getByRole('button', { name: 'Show advice in this round' }));
    await user().press(tournamentSwitch());
    expect(tournamentSwitch()).toBeChecked();
    await act(async () => store.completeRound(part));

    await act(async () => go({ path: '/history', params: {} }));
    expect(screen.getAllByText('TOURNAMENT')).toHaveLength(1);
    expect(screen.queryByText('PRACTICE')).toBeNull();
  });

  it('offers no switch for a finished card, which leaves the remembered choice alone', async () => {
    await open({ tournamentNext: true });
    mockStack = [{ path: '/new-round', params: { mode: 'card' } }];
    await act(async () => mockRender());
    expect(screen.queryByRole('switch', { name: 'Tournament round' })).toBeNull();
    await user().press(screen.getByRole('button', { name: /^Enter the card · / }));
    expect(store.tournamentNext).toBe(true);
    expect(store.tournament).toEqual({});
  });

  it('always says where to aim when looking a course over, with no switch', async () => {
    await open({ tournamentNext: true });
    await act(async () => go({ path: '/course-guide', params: { course: mapped.id } }));
    expect(hole3()).toHaveAccessibleName(AIM);
    expect(screen.queryByRole('switch', { name: 'Tournament round' })).toBeNull();
  });
});
