import React from 'react';
import { act, render, screen, userEvent, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { useAuth } from '../../auth/AuthProvider';
import { SignInScreen } from '../../components/SignInScreen';
import { buildDemoDataset } from '../../demo/seed';
import { settleOuting, settleRound } from '../../domain/engine';
import { useStore, type AppStore } from '../../store/AppStore';
import {
  hostOuting,
  isSupabaseConfigured,
  joinOuting,
  resendConfirmation,
} from '../../sync/supabase';
import { useAccessibilityControlScale, useLargeText } from '../../hooks/useLargeText';
import FormatScreen from '../(tabs)/format';
import HomeScreen from '../(tabs)/index';
import ScoreScreen from '../(tabs)/score';
import SettleScreen from '../(tabs)/settle';
import CourseScreen from '../course/[id]';
import CoursesScreen from '../courses';
import FieldGamesScreen from '../field-games';
import GroupsScreen from '../groups';
import HistoryScreen from '../history';
import JoinScreen from '../join';
import NewOutingScreen from '../new-outing';
import NewRoundScreen from '../new-round';
import OutingScreen from '../outing';
import RosterScreen from '../roster';
import SettingsScreen from '../settings';
import SidesScreen from '../sides';

const mockRouter = {
  back: jest.fn(),
  push: jest.fn(),
  replace: jest.fn(),
};

let mockCourseId = '';

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: mockCourseId }),
  useRouter: () => mockRouter,
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

jest.mock('../../auth/AuthProvider', () => ({
  useAuth: jest.fn(),
}));

jest.mock('../../store/AppStore', () => ({
  useStore: jest.fn(),
}));

jest.mock('../../hooks/useLargeText', () => ({
  ...jest.requireActual('../../hooks/useLargeText'),
  useLargeText: jest.fn(() => false),
  useAccessibilityControlScale: jest.fn(() => 1),
}));

jest.mock('../../sync/supabase', () => ({
  hostOuting: jest.fn(),
  isSupabaseConfigured: jest.fn(() => false),
  joinOuting: jest.fn(),
  resendConfirmation: jest.fn(),
}));

const mockUseAuth = useAuth as jest.MockedFunction<typeof useAuth>;
const mockUseStore = useStore as jest.MockedFunction<typeof useStore>;
const mockUseLargeText = useLargeText as jest.MockedFunction<typeof useLargeText>;
const mockUseAccessibilityControlScale =
  useAccessibilityControlScale as jest.MockedFunction<typeof useAccessibilityControlScale>;
const mockResendConfirmation = resendConfirmation as jest.MockedFunction<typeof resendConfirmation>;
const mockHostOuting = hostOuting as jest.MockedFunction<typeof hostOuting>;
const mockJoinOuting = joinOuting as jest.MockedFunction<typeof joinOuting>;
const mockIsSupabaseConfigured =
  isSupabaseConfigured as jest.MockedFunction<typeof isSupabaseConfigured>;

const actions = {
  startOuting: jest.fn(),
  setActiveOuting: jest.fn(),
  updateOuting: jest.fn(),
  setFieldGame: jest.fn(),
  toggleFieldEntrant: jest.fn(),
  setOutingGroups: jest.fn(),
  completeOuting: jest.fn(),
  setDemoMode: jest.fn(),
  resetDemoData: jest.fn(),
  eraseLiveData: jest.fn(),
  createGroup: jest.fn(),
  updateGroup: jest.fn(),
  deleteGroup: jest.fn(),
  setActiveGroup: jest.fn(),
  addPlayer: jest.fn(),
  updatePlayer: jest.fn(),
  removePlayer: jest.fn(),
  createCourse: jest.fn(),
  updateCourse: jest.fn(),
  updateHole: jest.fn(),
  deleteCourse: jest.fn(),
  startRound: jest.fn(),
  setActiveRound: jest.fn(),
  completeRound: jest.fn(),
  reopenRound: jest.fn(),
  deleteRound: jest.fn(),
  setScore: jest.fn(),
  bumpScore: jest.fn(),
  setPops: jest.fn(),
  toggleJunk: jest.fn(),
  toggleGame: jest.fn(),
  setStake: jest.fn(),
  setOptions: jest.fn(),
  addPress: jest.fn(),
  removePress: jest.fn(),
  setWolfPick: jest.fn(),
  setRoundPlayers: jest.fn(),
};

const dataset = buildDemoDataset(1_750_000_000_000);
const course = dataset.courses[0];
const group = dataset.groups.find((candidate) => candidate.id === dataset.activeGroupId)!;
const round = dataset.rounds.find((candidate) => candidate.id === dataset.activeRoundId)!;
const outing = dataset.outings[0];
const outingGroup = dataset.groups.find((candidate) => candidate.id === outing.groupId)!;
const outingRounds = outing.roundIds.map(
  (id) => dataset.rounds.find((candidate) => candidate.id === id)!,
);

const roundStore = {
  ...dataset,
  ...actions,
  ready: true,
  demoMode: true,
  sync: { status: 'off' as const, at: null, message: null },
  group,
  course,
  round,
  settlement: settleRound(round, course, group.players),
  outing: null,
  outingCourse: null,
  outingGroup: null,
  outingRounds: [],
  outingSettlement: null,
} as unknown as AppStore;

const outingStore = {
  ...roundStore,
  activeGroupId: outing.groupId,
  activeRoundId: outingRounds[0].id,
  activeOutingId: outing.id,
  group: outingGroup,
  course,
  round: outingRounds[0],
  settlement: settleRound(outingRounds[0], course, outingGroup.players),
  outing,
  outingCourse: course,
  outingGroup,
  outingRounds,
  outingSettlement: settleOuting(outing, outingRounds, course, outingGroup.players),
} as AppStore;

type ScreenElement = ReturnType<typeof screen.getByRole>;

function expectNamedControls(controls: ScreenElement[]) {
  expect(controls.length).toBeGreaterThan(0);
  controls.forEach((control) => expect(control).toHaveAccessibleName());
}

function expectEveryControlToHaveAName() {
  expectNamedControls(screen.getAllByRole('button'));
  screen.queryAllByRole('switch').forEach((control) => expect(control).toHaveAccessibleName());
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCourseId = course.id;
  mockUseStore.mockReturnValue(roundStore);
  mockUseLargeText.mockReturnValue(false);
  mockUseAccessibilityControlScale.mockReturnValue(1);
  mockIsSupabaseConfigured.mockReturnValue(false);
  mockHostOuting.mockResolvedValue({ outingId: outing.id, joinCode: 'ABC123' });
  mockJoinOuting.mockResolvedValue({ outingId: outing.id });
  mockUseAuth.mockReturnValue({
    status: 'signed-in',
    userId: 'golfer-1',
    email: 'golfer@example.com',
    unverified: false,
    signIn: jest.fn(),
    signUp: jest.fn(),
    signOut: jest.fn(),
  });
});

function useStoreValue(overrides: Partial<AppStore>) {
  mockUseStore.mockReturnValue({ ...roundStore, ...overrides } as AppStore);
}

describe('screen accessibility', () => {
  it.each([
    ['Home', HomeScreen],
    ['Score', ScoreScreen],
    ['Settle', SettleScreen],
    ['Format', FormatScreen],
    ['Settings', SettingsScreen],
    ['Roster', RosterScreen],
    ['Courses', CoursesScreen],
    ['Course', CourseScreen],
    ['New round', NewRoundScreen],
    ['Sides', SidesScreen],
    ['History', HistoryScreen],
    ['Join', JoinScreen],
  ])('%s gives every button an accessible name', async (_name, ScreenComponent) => {
    expect.hasAssertions();
    await render(<ScreenComponent />);
    expectEveryControlToHaveAName();
  });

  it.each([
    ['New outing', NewOutingScreen],
    ['Outing', OutingScreen],
    ['Field games', FieldGamesScreen],
    ['Groups', GroupsScreen],
  ])('%s gives every button an accessible name', async (_name, ScreenComponent) => {
    expect.hasAssertions();
    mockUseStore.mockReturnValue(outingStore);
    await render(<ScreenComponent />);
    expectEveryControlToHaveAName();
  });

  it('Sign in gives every button an accessible name', async () => {
    expect.hasAssertions();
    await render(<SignInScreen />);
    expectEveryControlToHaveAName();
  });
});

describe('home screen states', () => {
  it('shows loading and the no-group setup path', async () => {
    const view = await render(<HomeScreen />);
    useStoreValue({ ready: false });
    await view.rerender(<HomeScreen />);
    expect(screen.getByText('Loading…')).toBeOnTheScreen();

    useStoreValue({ group: null, activeGroupId: null });
    await view.rerender(<HomeScreen />);
    await userEvent.setup().press(screen.getByRole('button', { name: 'Create a group' }));
    expect(mockRouter.push).toHaveBeenCalledWith('/roster');
    await userEvent.setup().press(screen.getByRole('button', { name: 'Settings' }));
    expect(mockRouter.push).toHaveBeenCalledWith('/settings');
  });

  it('offers the correct empty-round actions for short and complete rosters', async () => {
    const onePlayer = { ...group, players: group.players.slice(0, 1) };
    useStoreValue({ group: onePlayer, round: null, course: null, settlement: null });
    const view = await render(<HomeScreen />);
    await userEvent.setup().press(screen.getByRole('button', { name: 'Add players' }));
    expect(mockRouter.push).toHaveBeenLastCalledWith('/roster');

    useStoreValue({ round: null, course: null, settlement: null });
    await view.rerender(<HomeScreen />);
    await userEvent.setup().press(screen.getByRole('button', { name: 'Start a round' }));
    expect(mockRouter.push).toHaveBeenLastCalledWith('/new-round');
    await userEvent.setup().press(
      screen.getByRole('button', { name: 'More than one group? Set up an outing' }),
    );
    expect(mockRouter.push).toHaveBeenLastCalledWith('/new-outing');
  });

  it('opens an active outing and the round, format, settings, and ledger paths', async () => {
    mockUseStore.mockReturnValue(outingStore);
    const user = userEvent.setup();
    await render(<HomeScreen />);

    await user.press(screen.getByRole('button', { name: /outing on/i }));
    expect(actions.setActiveOuting).toHaveBeenCalledWith(outing.id);
    expect(mockRouter.push).toHaveBeenLastCalledWith('/outing');
    await user.press(screen.getByRole('button', { name: 'Enter scores' }));
    await user.press(screen.getByRole('button', { name: 'Edit the format' }));
    await user.press(screen.getByRole('button', { name: 'Settings' }));
    await user.press(screen.getByRole('button', { name: /rounds? ›/i }));
    expect(mockRouter.push).toHaveBeenCalledWith('/score');
    expect(mockRouter.push).toHaveBeenCalledWith('/format');
    expect(mockRouter.push).toHaveBeenCalledWith('/settings');
    expect(mockRouter.push).toHaveBeenCalledWith('/history');
  });

  it('renders large text, singular games, no games, blocked games, and an empty season', async () => {
    mockUseLargeText.mockReturnValue(true);
    mockUseAccessibilityControlScale.mockReturnValue(2.25);
    const singleGameSettlement = {
      ...roundStore.settlement!,
      games: [
        {
          ...roundStore.settlement!.games[0],
          blocked: true,
          blockedReason: 'Pick teams first',
        },
      ],
    };
    useStoreValue({ settlement: singleGameSettlement });
    const view = await render(<HomeScreen />);
    expect(screen.getByText('swinging across 1 game')).toBeOnTheScreen();
    expect(screen.getByText('Pick teams first')).toBeOnTheScreen();

    const emptySettlement = { ...singleGameSettlement, games: [] };
    useStoreValue({ settlement: emptySettlement, rounds: [] });
    await view.rerender(<HomeScreen />);
    expect(screen.getByText('Nothing switched on. Every hole is just golf.')).toBeOnTheScreen();
    expect(screen.getByText(/Nothing settled yet/)).toBeOnTheScreen();
  });
});

describe('sign-in interactions', () => {
  function credentials() {
    const inputs = screen.getAllByDisplayValue('');
    return { email: inputs[0], password: inputs[1] };
  }

  it('validates credentials before contacting the server', async () => {
    const user = userEvent.setup();
    await render(<SignInScreen />);
    await user.press(screen.getByRole('button', { name: 'Sign in' }));
    expect(screen.getByText('Enter your email address.')).toBeOnTheScreen();
    expect(mockUseAuth().signIn).not.toHaveBeenCalled();
  });

  it('signs in and surfaces server and non-error failures', async () => {
    const signIn = jest.fn().mockRejectedValueOnce(new Error('Email not confirmed'));
    mockUseAuth.mockReturnValue({ ...mockUseAuth(), signIn });
    const user = userEvent.setup();
    await render(<SignInScreen />);
    const fields = credentials();
    await user.type(fields.email, 'golfer@example.com');
    await user.type(fields.password, 'password1');
    await user.press(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('That account still needs its email confirmed.')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Send the confirmation email again' })).toBeOnTheScreen();

    signIn.mockRejectedValueOnce('offline');
    await user.press(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Something went wrong. Try again.')).toBeOnTheScreen();
  });

  it('creates a confirmed account and can switch modes both ways', async () => {
    const signUp = jest.fn().mockResolvedValue({ needsConfirmation: false });
    mockUseAuth.mockReturnValue({ ...mockUseAuth(), signUp });
    const user = userEvent.setup();
    await render(<SignInScreen />);
    await user.press(screen.getByRole('button', { name: 'No account yet? Create one' }));
    expect(screen.getByText('Create an account')).toBeOnTheScreen();
    const fields = credentials();
    await user.type(fields.email, 'NEW@EXAMPLE.COM');
    await user.type(fields.password, 'password1');
    await user.press(screen.getByRole('button', { name: 'Create account' }));
    await waitFor(() => expect(signUp).toHaveBeenCalledWith('NEW@EXAMPLE.COM', 'password1'));
    await user.press(screen.getByRole('button', { name: 'Already have an account? Sign in' }));
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeOnTheScreen();
  });

  it('creates an unconfirmed account and handles both resend outcomes', async () => {
    const signUp = jest.fn().mockResolvedValue({ needsConfirmation: true });
    mockUseAuth.mockReturnValue({ ...mockUseAuth(), signUp });
    mockResendConfirmation
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('Failed to fetch'));
    const user = userEvent.setup();
    await render(<SignInScreen />);
    await user.press(screen.getByRole('button', { name: 'No account yet? Create one' }));
    const fields = credentials();
    await user.type(fields.email, 'new@example.com');
    await user.type(fields.password, 'password1');
    await user.press(screen.getByRole('button', { name: 'Create account' }));
    const resend = await screen.findByRole('button', {
      name: 'Send the confirmation email again',
    });
    await user.press(resend);
    expect(await screen.findByText('Sent again. It can take a minute to arrive.')).toBeOnTheScreen();
    await user.press(screen.getByRole('button', { name: 'Send the confirmation email again' }));
    expect(await screen.findByText('Could not reach the server. Check your signal and try again.')).toBeOnTheScreen();
  });
});

describe('high-branch screen state matrices', () => {
  it('covers empty and configured format states', async () => {
    useStoreValue({ round: null, course: null, group: null });
    let view = await render(<FormatScreen />);
    expect(screen.getByText('No round to configure')).toBeOnTheScreen();
    await view.unmount();

    mockUseLargeText.mockReturnValue(true);
    const ids = group.players.map((player) => player.id);
    const games = Object.fromEntries(
      Object.entries(round.games).map(([key, config], index) => [
        key,
        { ...config, on: true, stake: index % 3 === 0 ? 100 : index % 3 === 1 ? 2000 : 5000 },
      ]),
    );
    const configured = {
      ...round,
      games,
      pops: { [ids[0]]: 0, [ids[1]]: 18, [ids[2]]: 20, [ids[3]]: 3 },
      wolfPicks: [],
      options: { ...round.options, teams: [], matchPairings: [] },
    };
    useStoreValue({ round: configured as unknown as typeof round });
    view = await render(<FormatScreen />);
    expect(screen.getByText('scratch in this group')).toBeOnTheScreen();
    expect(screen.getByText('a stroke on every hole')).toBeOnTheScreen();
    expect(screen.getByText('a stroke everywhere, two on SI 1–2')).toBeOnTheScreen();
    expect(screen.getByText('strokes on SI 1–3')).toBeOnTheScreen();
    expect(screen.getByText(/Pick the Wolf/)).toBeOnTheScreen();
    expect(screen.getByText(/Everyone against everyone/)).toBeOnTheScreen();
    await view.unmount();

    useStoreValue({
      round: {
        ...configured,
        wolfPicks: [
          { hole: 0, wolf: ids[0], partner: ids[1] },
          { hole: 1, wolf: ids[1], partner: null },
        ],
        options: {
          ...configured.options,
          teams: [[ids[0], ids[1]], [ids[2], 'missing-player']],
          matchPairings: [[ids[0], ids[1]]],
        },
      } as unknown as typeof round,
    });
    view = await render(<FormatScreen />);
    expect(screen.getByText(/2 holes picked/)).toBeOnTheScreen();
    expect(screen.getAllByText(/\?\?/).length).toBeGreaterThan(0);
    await view.unmount();

    useStoreValue({
      round: {
        ...configured,
        wolfPicks: [{ hole: 0, wolf: ids[0], partner: ids[1] }],
      } as unknown as typeof round,
    });
    view = await render(<FormatScreen />);
    expect(screen.getByText(/1 hole picked/)).toBeOnTheScreen();
  });

  it('covers settlement headlines, empty sections, transfers, and line tones', async () => {
    useStoreValue({ round: null, course: null, group: null, settlement: null });
    let view = await render(<SettleScreen />);
    expect(screen.getByText('Nothing to settle')).toBeOnTheScreen();
    await view.unmount();

    const ids = group.players.map((player) => player.id);
    const base = roundStore.settlement!;
    const empty = { ...base, transfers: [], games: [], net: { [ids[0]]: 0 } };
    useStoreValue({ settlement: empty });
    view = await render(<SettleScreen />);
    expect(screen.getByText('You’re dead even')).toBeOnTheScreen();
    expect(screen.getByText(/Nobody owes anybody/)).toBeOnTheScreen();
    expect(screen.getByText(/No games switched on/)).toBeOnTheScreen();
    await view.unmount();

    mockUseLargeText.mockReturnValue(true);
    const game = base.games[0];
    const rich = {
      ...base,
      net: { ...base.net, [ids[0]]: 500, [ids[1]]: -500 },
      transfers: [
        { from: ids[1], to: ids[0], amount: 500 },
        { from: 'missing', to: ids[0], amount: 100 },
      ],
      games: [
        { ...game, lines: [] },
        {
          ...game,
          key: 'junk',
          lines: [
            { text: 'Won line', amount: '$5', tone: 'won' },
            { text: 'Pending line', amount: '—', tone: 'pending' },
          ],
        },
      ],
    };
    useStoreValue({ settlement: rich as typeof base });
    view = await render(<SettleScreen />);
    expect(screen.getByText('You’re up $5')).toBeOnTheScreen();
    expect(screen.getByText('Nothing banked yet.')).toBeOnTheScreen();
    expect(screen.getByText('Won line')).toBeOnTheScreen();
    await view.unmount();

    useStoreValue({ settlement: { ...rich, net: { ...rich.net, [ids[0]]: -300 } } as typeof base });
    view = await render(<SettleScreen />);
    expect(screen.getByText('You’re down $3')).toBeOnTheScreen();
    await view.unmount();

    useStoreValue({
      group: { ...group, youId: null },
      settlement: { ...rich, transfers: [rich.transfers[0]] } as typeof base,
    });
    view = await render(<SettleScreen />);
    expect(screen.getByText('1 hand-off')).toBeOnTheScreen();
  });

  it('covers score empty, large-text, played-hole, Wolf, press, and result branches', async () => {
    useStoreValue({ round: null, course: null, group: null, settlement: null });
    let view = await render(<ScoreScreen />);
    expect(screen.getByText('Nothing to score')).toBeOnTheScreen();
    await view.unmount();

    mockUseLargeText.mockReturnValue(true);
    mockUseAccessibilityControlScale.mockReturnValue(2.25);
    const ids = group.players.map((player) => player.id);
    const scores = Object.fromEntries(
      ids.map((id, index) => [id, [index + 1, ...Array(course.holes.length - 1).fill(null)]]),
    );
    const games = Object.fromEntries(
      Object.entries(round.games).map(([key, config]) => [key, { ...config, on: true }]),
    );
    const playedRound = {
      ...round,
      scores,
      games,
      pops: { ...round.pops, [ids[0]]: 0, [ids[1]]: 1, [ids[2]]: 20 },
      wolfPicks: [{ hole: 0, wolf: ids[0], partner: ids[1] }],
      presses: [
        { id: 'press-1', by: ids[0], against: ids[1], startHole: 0, endHole: 8, stake: 500 },
        { id: 'press-2', by: ids[1], against: ids[0], startHole: 0, endHole: 8, stake: 500 },
      ],
    };
    const scoreSettlement = {
      ...roundStore.settlement!,
      games: roundStore.settlement!.games.map((game) =>
        game.key === 'skins' ? { ...game, carry: 3 } : game,
      ),
    };
    useStoreValue({ round: playedRound as unknown as typeof round, settlement: scoreSettlement });
    view = await render(<ScoreScreen />);
    await userEvent.setup().press(screen.getByRole('button', { name: 'Go to hole 1' }));
    expect(screen.getByText(/takes the skin|Skin halved/)).toBeOnTheScreen();
    expect(screen.getByText(/albatross/)).toBeOnTheScreen();
    expect(screen.getByText(/eagle/)).toBeOnTheScreen();
    expect(screen.getByText(/birdie/)).toBeOnTheScreen();
    expect(screen.getAllByText(/against the rest/).length).toBeGreaterThan(0);
    await view.unmount();

    const tiedScores = Object.fromEntries(
      ids.map((id) => [id, [4, ...Array(course.holes.length - 1).fill(null)]]),
    );
    useStoreValue({
      round: {
        ...playedRound,
        scores: tiedScores,
        wolfPicks: [{ hole: 0, wolf: ids[0], partner: null }],
      } as unknown as typeof round,
      settlement: {
        ...scoreSettlement,
        games: scoreSettlement.games.map((game) =>
          game.key === 'skins' ? { ...game, carry: 2 } : game,
        ),
      },
    });
    view = await render(<ScoreScreen />);
    await userEvent.setup().press(screen.getByRole('button', { name: 'Go to hole 1' }));
    expect(screen.getByText(/Skin halved/)).toBeOnTheScreen();
    expect(screen.getByText(/went alone/)).toBeOnTheScreen();
    await view.unmount();

    useStoreValue({
      round: { ...playedRound, scores: tiedScores, wolfPicks: [] } as unknown as typeof round,
      settlement: scoreSettlement,
    });
    view = await render(<ScoreScreen />);
    await userEvent.setup().press(screen.getByRole('button', { name: 'Go to hole 1' }));
    expect(screen.getByText(/no pick recorded/)).toBeOnTheScreen();
  });

  it('covers sides without a round and with selected, unselected, and missing players', async () => {
    useStoreValue({ round: null, course: null, group: null });
    let view = await render(<SidesScreen />);
    expect(screen.getByText('No round')).toBeOnTheScreen();
    await view.unmount();

    const ids = group.players.map((player) => player.id);
    useStoreValue({
      round: {
        ...round,
        playerIds: [...ids, 'missing-player'],
        options: {
          ...round.options,
          teams: [[ids[0], ids[1]], [ids[2]]],
          matchPairings: [[ids[1], ids[0]]],
          wolfLoneMultiplier: 1,
          vegasFlipOnBirdie: false,
        },
      } as unknown as typeof round,
    });
    view = await render(<SidesScreen />);
    expect(screen.getAllByText('2/2').length).toBeGreaterThan(0);
    expect(screen.getAllByText('✓').length).toBeGreaterThan(0);
    expect(screen.getByText(/not on a side/)).toBeOnTheScreen();
  });
});

describe('setup and outing state matrices', () => {
  it('covers new-round empty states, selections, and starting', async () => {
    useStoreValue({ group: null });
    let view = await render(<NewRoundScreen />);
    expect(screen.getByText('No group yet')).toBeOnTheScreen();
    await view.unmount();

    useStoreValue({ courses: [], course: null });
    view = await render(<NewRoundScreen />);
    expect(screen.getByText('No courses saved. You need one with a real par and stroke index per hole before pops mean anything.')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Pick a course' })).toBeDisabled();
    await view.unmount();

    mockUseStore.mockReturnValue(roundStore);
    const user = userEvent.setup();
    view = await render(<NewRoundScreen />);
    expect(screen.getByText(/already a round going/)).toBeOnTheScreen();
    for (const player of group.players.slice(0, 3)) {
      await user.press(screen.getByRole('button', { name: new RegExp(player.name) }));
    }
    expect(screen.getByRole('button', { name: 'Pick at least two players' })).toBeDisabled();
    await user.press(screen.getByRole('button', { name: new RegExp(group.players[0].name) }));
    await user.press(screen.getByRole('button', { name: /Start · 2 players/ }));
    expect(actions.startRound).toHaveBeenCalled();
    expect(mockRouter.replace).toHaveBeenCalledWith('/format');
  });

  it('covers outing sharing, group summaries, pots, standings, and closing', async () => {
    useStoreValue({ outing: null, outingCourse: null, outingGroup: null, outingSettlement: null });
    let view = await render(<OutingScreen />);
    expect(screen.getByText('No outing on')).toBeOnTheScreen();
    await view.unmount();

    mockUseLargeText.mockReturnValue(true);
    mockIsSupabaseConfigured.mockReturnValue(true);
    const base = outingStore.outingSettlement!;
    const ids = outing.field;
    const firstGame = base.fieldGames[0];
    const secondGame = base.fieldGames[1] ?? { ...firstGame, key: 'scats', name: 'Scats' };
    const settlement = {
      ...base,
      net: { ...base.net, [ids[0]]: 500, [ids[1]]: -300 },
      fieldGames: [
        {
          ...firstGame,
          entrants: ids.slice(0, 2),
          payouts: {},
          unclaimedPot: 400,
          blocked: true,
          blockedReason: 'Waiting for cards',
          pendingHoles: 1,
          holes: [{ hole: 0, complete: true }],
        },
        {
          ...secondGame,
          entrants: ids.slice(0, 3),
          payouts: { [ids[0]]: 500, missing: 200 },
          unclaimedPot: 0,
          blocked: false,
          pendingHoles: 2,
          holes: [{ hole: 0, complete: false }],
        },
      ],
      groups: base.groups.slice(0, 1).map((summary) => ({ ...summary, games: [{}] })),
    };
    const rounds = outingRounds.map((candidate, index) => ({
      ...candidate,
      teeTime: index === 0 ? '8:00' : null,
      playerIds: index === 0 ? [...candidate.playerIds, 'missing'] : candidate.playerIds,
    }));
    mockUseStore.mockReturnValue({
      ...outingStore,
      outing: { ...outing, field: [...outing.field, 'missing'] },
      outingRounds: rounds,
      outingSettlement: settlement,
    } as AppStore);
    mockHostOuting.mockResolvedValueOnce({ outingId: outing.id, joinCode: 'TEE123' });
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(jest.fn());
    const user = userEvent.setup();
    view = await render(<OutingScreen />);
    expect(screen.getByText('Waiting for cards')).toBeOnTheScreen();
    expect(screen.getByText('Nothing won yet.')).toBeOnTheScreen();
    expect(screen.getByText(/1 hole waiting/)).toBeOnTheScreen();
    expect(screen.getByText(/2 holes waiting/)).toBeOnTheScreen();
    await user.press(screen.getByRole('button', { name: 'Share this outing' }));
    expect(await screen.findByText('TEE123')).toBeOnTheScreen();
    await user.press(screen.getByRole('button', { name: 'Close the outing' }));
    const buttons = alert.mock.calls.at(-1)?.[2];
    buttons?.[1]?.onPress?.();
    expect(actions.completeOuting).toHaveBeenCalledWith(outing.id);
    await view.unmount();

    mockHostOuting.mockRejectedValueOnce(new Error('No signal'));
    mockUseStore.mockReturnValue(outingStore);
    view = await render(<OutingScreen />);
    await user.press(screen.getByRole('button', { name: 'Share this outing' }));
    await waitFor(() => expect(alert).toHaveBeenCalledWith('Could not share this outing', 'No signal'));
    await view.unmount();

    mockHostOuting.mockRejectedValueOnce('offline');
    view = await render(<OutingScreen />);
    await user.press(screen.getByRole('button', { name: 'Share this outing' }));
    await waitFor(() =>
      expect(alert).toHaveBeenCalledWith('Could not share this outing', 'Try again in a moment.'),
    );
    alert.mockRestore();
  });

  it('covers new-outing empty states, field sizes, tee formats, and both start modes', async () => {
    useStoreValue({ group: null });
    let view = await render(<NewOutingScreen />);
    expect(screen.getByText('No group yet')).toBeOnTheScreen();
    await view.unmount();

    useStoreValue({ courses: [], course: null });
    view = await render(<NewOutingScreen />);
    expect(screen.getByText('No courses saved yet.')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Pick a course' })).toBeDisabled();
    await view.unmount();

    const fifth = { ...group.players[0], id: 'fifth-player', name: 'Fifth Player', initials: 'FP' };
    const sixth = { ...group.players[1], id: 'sixth-player', name: 'Sixth Player', initials: 'SP' };
    const largeGroup = { ...group, players: [...group.players, fifth, sixth] };
    useStoreValue({ group: largeGroup });
    const user = userEvent.setup();
    view = await render(<NewOutingScreen />);
    expect(screen.getByText('6 in · 2 groups')).toBeOnTheScreen();
    await user.press(screen.getByRole('button', { name: 'Nobody' }));
    expect(screen.getByRole('button', { name: 'Pick at least two players' })).toBeDisabled();
    await user.press(screen.getByRole('button', { name: 'Everyone' }));
    await user.press(screen.getByRole('button', { name: /Shotgun/ }));
    await user.press(screen.getByRole('button', { name: /Start · 6 out in 2 groups/ }));
    expect(actions.startOuting).toHaveBeenCalled();
    expect(mockRouter.replace).toHaveBeenCalledWith('/outing');
    await view.unmount();

    useStoreValue({ group: largeGroup });
    view = await render(<NewOutingScreen />);
    await user.press(screen.getByRole('button', { name: /Start · 6 out in 2 groups/ }));
    expect(actions.startOuting).toHaveBeenCalledTimes(2);
  });

  it('covers field-pot configuration combinations', async () => {
    useStoreValue({ outing: null, outingGroup: null });
    let view = await render(<FieldGamesScreen />);
    expect(screen.getByText('No outing on')).toBeOnTheScreen();
    await view.unmount();

    const ids = outing.field;
    const configuredOuting = {
      ...outing,
      field: [...ids, 'missing-player'],
      fieldGames: {
        fieldSkins: {
          ...outing.fieldGames.fieldSkins,
          on: true,
          buyIn: 100,
          entrants: [ids[0]],
          useNet: true,
          carry: false,
          unclaimed: 'splitAmongWinners',
        },
        scats: {
          ...outing.fieldGames.scats,
          on: true,
          buyIn: 5000,
          entrants: ids.slice(0, 3),
          useNet: false,
          carry: true,
          unclaimed: 'carry',
        },
      },
    };
    mockUseStore.mockReturnValue({ ...outingStore, outing: configuredOuting } as AppStore);
    view = await render(<FieldGamesScreen />);
    expect(screen.getByText('Decided on net')).toBeOnTheScreen();
    expect(screen.getByText('Decided on gross')).toBeOnTheScreen();
    expect(screen.getByText('Ties just push')).toBeOnTheScreen();
    expect(screen.getByText('Ties carry (rabbit)')).toBeOnTheScreen();
    expect(screen.getByText('Leftovers split among winners')).toBeOnTheScreen();
    expect(screen.getByText('Leftovers carry to next time')).toBeOnTheScreen();
    expect(screen.getByText(/Needs at least two/)).toBeOnTheScreen();
  });

  it('covers group assignment states and edits', async () => {
    useStoreValue({ outing: null, outingGroup: null, outingRounds: [] });
    let view = await render(<GroupsScreen />);
    expect(screen.getByText('No outing on')).toBeOnTheScreen();
    await view.unmount();

    const ids = outingGroup.players.map((player) => player.id);
    const rounds = [
      { ...outingRounds[0], teeTime: '8:10', playerIds: ids.slice(0, 1) },
      { ...outingRounds[1], teeTime: null, playerIds: [] },
      { ...outingRounds[0], id: 'crowded-round', name: 'Crowded', playerIds: ids.slice(0, 5) },
    ];
    mockUseStore.mockReturnValue({ ...outingStore, outingRounds: rounds } as AppStore);
    const user = userEvent.setup();
    view = await render(<GroupsScreen />);
    expect(screen.getByText('Empty — it will be dropped when you save.')).toBeOnTheScreen();
    expect(screen.getByText(/Five or more in a group/)).toBeOnTheScreen();
    const assigned = new Set(rounds.flatMap((candidate) => candidate.playerIds));
    const unassigned = outingGroup.players.find((player) => !assigned.has(player.id))!;
    await user.press(screen.getByRole('button', { name: unassigned.name }));
    expect(screen.getByText(/tap a group below/)).toBeOnTheScreen();
    await user.press(screen.getByRole('button', { name: `Move into ${rounds[1].name}` }));
    expect(screen.getByRole('button', { name: 'Save the groups' })).toBeEnabled();
    await user.press(screen.getByRole('button', { name: 'Add another group' }));
    expect(screen.getByText('Group 4')).toBeOnTheScreen();
    await user.press(screen.getByRole('button', { name: 'Save the groups' }));
    expect(actions.setOutingGroups).toHaveBeenCalled();
  });

  it('covers joining success and both error shapes', async () => {
    mockIsSupabaseConfigured.mockReturnValue(true);
    mockJoinOuting
      .mockResolvedValueOnce({ outingId: 'outing-joined' } as never)
      .mockRejectedValueOnce(new Error('Code expired'))
      .mockRejectedValueOnce('offline');
    const user = userEvent.setup();

    let view = await render(<JoinScreen />);
    await user.type(screen.getByPlaceholderText('ABC123'), 'abc1237');
    await user.press(screen.getByRole('button', { name: 'Join' }));
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/outing?joined=outing-joined'));
    await view.unmount();

    view = await render(<JoinScreen />);
    await user.type(screen.getByPlaceholderText('ABC123'), 'bad111');
    await user.press(screen.getByRole('button', { name: 'Join' }));
    expect(await screen.findByText('Code expired')).toBeOnTheScreen();
    await view.unmount();

    view = await render(<JoinScreen />);
    await user.type(screen.getByPlaceholderText('ABC123'), 'bad222');
    await user.press(screen.getByRole('button', { name: 'Join' }));
    expect(await screen.findByText('Could not join that outing.')).toBeOnTheScreen();
  });
});

describe('management screen state matrices', () => {
  it('covers roster onboarding, an empty roster, editing, adding, and removing', async () => {
    useStoreValue({ group: null });
    const user = userEvent.setup();
    let view = await render(<RosterScreen />);
    await user.type(screen.getByPlaceholderText('Saturday Dogs'), 'New Group');
    await user.press(screen.getByRole('button', { name: 'Create group' }));
    expect(actions.createGroup).toHaveBeenCalledWith('New Group');
    await view.unmount();

    useStoreValue({ group: { ...group, players: [], youId: null } });
    view = await render(<RosterScreen />);
    expect(screen.getByText(/Nobody yet/)).toBeOnTheScreen();
    await view.unmount();

    mockUseStore.mockReturnValue(roundStore);
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(jest.fn());
    view = await render(<RosterScreen />);
    const me = group.players.find((player) => player.id === group.youId)!;
    const other = group.players.find((player) => player.id !== group.youId)!;
    await user.press(screen.getByRole('button', { name: new RegExp(me.name) }));
    expect(screen.getByText('tap to close')).toBeOnTheScreen();
    await user.press(screen.getByRole('button', { name: new RegExp(me.name) }));
    await user.press(screen.getByRole('button', { name: new RegExp(other.name) }));
    await user.press(screen.getByRole('button', { name: 'This is me' }));
    await user.press(screen.getByRole('button', { name: 'Remove' }));
    alert.mock.calls.at(-1)?.[2]?.[1]?.onPress?.();
    expect(actions.removePlayer).toHaveBeenCalledWith(group.id, other.id);
    await user.type(screen.getByPlaceholderText('Name'), 'New Golfer');
    await user.press(screen.getByRole('button', { name: 'Add' }));
    expect(actions.addPlayer).toHaveBeenCalled();
    alert.mockRestore();
  });

  it('covers history without a group, without rounds, and active/completed actions', async () => {
    useStoreValue({ group: null });
    let view = await render(<HistoryScreen />);
    expect(screen.getByText('History')).toBeOnTheScreen();
    await view.unmount();

    useStoreValue({ rounds: [] });
    view = await render(<HistoryScreen />);
    expect(screen.getByText('Nothing played yet.')).toBeOnTheScreen();
    await view.unmount();

    mockUseStore.mockReturnValue(roundStore);
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(jest.fn());
    const user = userEvent.setup();
    view = await render(<HistoryScreen />);
    const roundButtons = screen.getAllByRole('button').filter((button) =>
      button.props.accessibilityState == null,
    );
    const live = roundButtons.find((button) => /LIVE/.test(button.props.accessibilityLabel ?? ''));
    if (live) await user.press(live);
    else {
      const liveText = screen.getByText('LIVE');
      await user.press(liveText);
    }
    expect(actions.setActiveRound).toHaveBeenCalled();

    await view.unmount();
    useStoreValue({
      rounds: [{ ...round, status: 'completed', completedAt: round.startedAt + 1 }],
      courses: [course],
    });
    view = await render(<HistoryScreen />);
    await user.press(screen.getByRole('button', { name: new RegExp(course.name) }));
    const firstDialog = alert.mock.calls.at(-1)?.[2];
    firstDialog?.[2]?.onPress?.();
    expect(actions.reopenRound).toHaveBeenCalled();
    firstDialog?.[1]?.onPress?.();
    alert.mock.calls.at(-1)?.[2]?.[1]?.onPress?.();
    expect(actions.deleteRound).toHaveBeenCalled();
    alert.mockRestore();
  });

  it('keeps a history row usable when its course and local player identity are gone', async () => {
    useStoreValue({
      group: { ...group, youId: null },
      rounds: [{ ...round, courseId: 'deleted-course', status: 'active' }],
      courses: [],
    });
    const user = userEvent.setup();
    await render(<HistoryScreen />);
    expect(screen.getByText('Unknown course')).toBeOnTheScreen();
    expect(screen.getByText(/thru 0/)).toBeOnTheScreen();
    await user.press(screen.getByRole('button', { name: /Unknown course/ }));
    expect(actions.setActiveRound).toHaveBeenCalledWith(round.id);
  });

  it('covers live settings, demo settings, group switching, sync errors, and auth variants', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(jest.fn());
    const user = userEvent.setup();
    const extraGroup = { ...group, id: 'extra-group', name: 'Solo Group', players: group.players.slice(0, 1) };
    mockUseStore.mockReturnValue({
      ...roundStore,
      groups: [group, extraGroup],
      outings: [{ ...outing, groupId: extraGroup.id, name: 'Live Day' }],
      sync: { status: 'error', at: null, message: null },
    } as AppStore);
    mockUseAuth.mockReturnValue({ ...mockUseAuth(), unverified: true, email: null });
    let view = await render(<SettingsScreen />);
    expect(screen.getByText('Signed in')).toBeOnTheScreen();
    expect(screen.getByText(/Could not reach the server/)).toBeOnTheScreen();
    expect(screen.getByText(/1 player · Live Day on now/)).toBeOnTheScreen();
    await user.press(screen.getByRole('button', { name: extraGroup.name }));
    expect(actions.setActiveGroup).toHaveBeenCalledWith(extraGroup.id);
    await user.press(screen.getByRole('switch', { name: 'Demo data' }));
    alert.mock.calls.at(-1)?.[2]?.[1]?.onPress?.();
    expect(actions.setDemoMode).toHaveBeenCalledWith(false);
    await user.press(screen.getByRole('button', { name: 'Reset demo data' }));
    alert.mock.calls.at(-1)?.[2]?.[1]?.onPress?.();
    expect(actions.resetDemoData).toHaveBeenCalled();
    await user.press(screen.getByRole('button', { name: 'Sign out' }));
    alert.mock.calls.at(-1)?.[2]?.[1]?.onPress?.();
    expect(mockUseAuth().signOut).toHaveBeenCalled();
    await view.unmount();

    mockUseStore.mockReturnValue({ ...roundStore, demoMode: false, groups: [group] } as AppStore);
    mockUseAuth.mockReturnValue({ ...mockUseAuth(), status: 'signed-out' });
    view = await render(<SettingsScreen />);
    await user.press(screen.getByRole('switch', { name: 'Demo data' }));
    expect(actions.setDemoMode).toHaveBeenCalledWith(true);
    await user.press(screen.getByRole('button', { name: 'Erase my data' }));
    alert.mock.calls.at(-1)?.[2]?.[1]?.onPress?.();
    expect(actions.eraseLiveData).toHaveBeenCalled();
    expect(screen.queryByText('Account')).not.toBeOnTheScreen();
    alert.mockRestore();
  });

  it('covers missing and duplicate-index course editor states', async () => {
    mockCourseId = 'missing';
    let view = await render(<CourseScreen />);
    expect(screen.getByText('Course not found')).toBeOnTheScreen();
    await view.unmount();

    const duplicate = {
      ...course,
      holes: course.holes.map((hole, index) => ({
        ...hole,
        strokeIndex: index < 2 ? 1 : hole.strokeIndex,
        yards: index === 0 ? 0 : hole.yards,
      })),
    };
    mockCourseId = duplicate.id;
    useStoreValue({ courses: [duplicate] });
    view = await render(<CourseScreen />);
    expect(screen.getByText(/Two holes share a stroke index/)).toBeOnTheScreen();
    const user = userEvent.setup();
    await user.clear(screen.getByDisplayValue(duplicate.name));
    await user.type(screen.getByDisplayValue(''), 'Renamed');
    await user.clear(screen.getByLabelText('Stroke index for hole 1'));
    await user.type(screen.getByLabelText('Stroke index for hole 1'), '999');
    await user.type(screen.getByLabelText('Yards for hole 1'), '350');
    await act(async () => {
      screen.getByLabelText('Stroke index for hole 2').props.onChangeText?.('9'.repeat(400));
      screen.getByLabelText('Yards for hole 2').props.onChangeText?.('9'.repeat(400));
    });
    expect(actions.updateCourse).toHaveBeenCalled();
    expect(actions.updateHole).toHaveBeenCalled();
  });

  it('covers course-list empty, index warning, hole choices, and creation', async () => {
    useStoreValue({ courses: [] });
    const user = userEvent.setup();
    let view = await render(<CoursesScreen />);
    expect(screen.getByText(/None yet/)).toBeOnTheScreen();
    await user.type(screen.getByPlaceholderText('Pine Hollow'), 'Nine Hole');
    await user.press(screen.getByRole('button', { name: '9 holes' }));
    await user.press(screen.getByRole('button', { name: 'Create course' }));
    expect(actions.createCourse).toHaveBeenCalled();
    await view.unmount();

    const defaultIndexes = {
      ...course,
      id: 'default-indexes',
      name: 'Default Index Course',
      holes: course.holes.map((hole, index) => ({ ...hole, strokeIndex: index + 1 })),
    };
    const realIndexes = {
      ...course,
      name: 'Real Index Course',
      holes: course.holes.map((hole) => ({ ...hole, strokeIndex: 19 - hole.number })),
    };
    useStoreValue({ courses: [defaultIndexes, realIndexes] });
    view = await render(<CoursesScreen />);
    expect(screen.getByText(/stroke index not set/)).toBeOnTheScreen();
    expect(screen.getAllByRole('button').length).toBeGreaterThan(3);

    const alert = jest.spyOn(Alert, 'alert').mockImplementation(jest.fn());
    const courseButtons = [
      screen.getByRole('button', { name: /Default Index Course/ }),
      screen.getByRole('button', { name: /Real Index Course/ }),
    ];
    for (const button of courseButtons) {
      await act(async () => {
        button.props.onLongPress?.();
      });
    }
    alert.mockRestore();
  });

  it('exercises team assignment and both pairing toggle directions', async () => {
    const ids = group.players.map((player) => player.id);
    useStoreValue({ round: { ...round, options: { ...round.options, teams: [], matchPairings: [] } } });
    const user = userEvent.setup();
    let view = await render(<SidesScreen />);
    const playerButtons = screen.getAllByRole('button').filter((button) =>
      new RegExp(group.players[0].name).test(button.props.accessibilityLabel ?? ''),
    );
    if (playerButtons[0]) await user.press(playerButtons[0]);
    const pairing = screen.getByRole('button', { name: new RegExp(`${group.players[0].name} v ${group.players[1].name}`) });
    await user.press(pairing);
    expect(actions.setOptions).toHaveBeenCalled();
    await view.unmount();

    useStoreValue({
      round: {
        ...round,
        options: { ...round.options, teams: [[ids[0], ids[1]], [ids[2], ids[3]]], matchPairings: [[ids[1], ids[0]]] },
      },
    });
    view = await render(<SidesScreen />);
    await user.press(screen.getByRole('button', { name: new RegExp(`${group.players[0].name} v ${group.players[1].name}`) }));
    await user.press(screen.getByRole('button', { name: 'Pair by tee order' }));
    await user.press(screen.getByRole('button', { name: 'Clear' }));
    await user.press(screen.getByRole('switch', { name: 'Flip on a birdie' }));
    expect(actions.setOptions).toHaveBeenCalled();
  });
});
