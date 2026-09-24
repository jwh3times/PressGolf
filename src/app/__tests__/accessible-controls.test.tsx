import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { useAuth } from '../../auth/AuthProvider';
import { SignInScreen } from '../../components/SignInScreen';
import { buildDemoDataset } from '../../demo/seed';
import { settleOuting, settleRound } from '../../domain/engine';
import { useStore, type AppStore } from '../../store/AppStore';
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

jest.mock('../../sync/supabase', () => ({
  hostOuting: jest.fn(),
  isSupabaseConfigured: () => false,
  joinOuting: jest.fn(),
  resendConfirmation: jest.fn(),
}));

const mockUseAuth = useAuth as jest.MockedFunction<typeof useAuth>;
const mockUseStore = useStore as jest.MockedFunction<typeof useStore>;

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
