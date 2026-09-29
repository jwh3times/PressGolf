import React from 'react';
import { act, render, waitFor } from '@testing-library/react-native';
import { useAuth } from '../../auth/AuthProvider';
import { buildDemoDataset } from '../../demo/seed';
import { makeCourse, makeOuting, makePlayer, makeRound } from '../../domain/factory';
import type { Round } from '../../domain/types';
import { useDataSync } from '../../sync/useDataSync';
import {
  clearDataset,
  loadDataset,
  loadSettings,
  saveDataset,
  saveSettings,
} from '../persistence';
import { AppStoreProvider, useStore, type AppStore } from '../AppStore';
import { teesChanged } from '../../domain/handicap';

jest.mock('../../auth/AuthProvider', () => ({ useAuth: jest.fn() }));
jest.mock('../../sync/useDataSync', () => ({ useDataSync: jest.fn() }));
jest.mock('../persistence', () => ({
  clearDataset: jest.fn(),
  loadDataset: jest.fn(),
  loadSettings: jest.fn(),
  saveDataset: jest.fn(),
  saveSettings: jest.fn(),
}));

const mockUseAuth = useAuth as jest.MockedFunction<typeof useAuth>;
const mockUseDataSync = useDataSync as jest.MockedFunction<typeof useDataSync>;
const mockLoadDataset = loadDataset as jest.MockedFunction<typeof loadDataset>;
const mockLoadSettings = loadSettings as jest.MockedFunction<typeof loadSettings>;
const mockSaveDataset = saveDataset as jest.MockedFunction<typeof saveDataset>;
const mockSaveSettings = saveSettings as jest.MockedFunction<typeof saveSettings>;
const mockClearDataset = clearDataset as jest.MockedFunction<typeof clearDataset>;

let store: AppStore;

function Probe() {
  const value = useStore();
  React.useEffect(() => {
    store = value;
  }, [value]);
  return null;
}

type SeededDataset = ReturnType<typeof buildDemoDataset>;
type Dataset = Omit<SeededDataset, 'activeGroupId' | 'activeRoundId' | 'activeOutingId'> & {
  activeGroupId: string | null;
  activeRoundId: string | null;
  activeOutingId: string | null;
};

function stored(data: Dataset) {
  return {
    version: 2,
    groups: data.groups,
    courses: data.courses,
    rounds: data.rounds,
    outings: data.outings,
    activeGroupId: data.activeGroupId,
    activeRoundId: data.activeRoundId,
    activeOutingId: data.activeOutingId,
    cardRoundId: data.cardRoundId,
  };
}

async function mount(data: Dataset = buildDemoDataset(1_750_000_000_000), demoMode = true) {
  mockLoadSettings.mockResolvedValueOnce({
    demoMode,
    activeGroupId: data.activeGroupId,
    activeRoundId: data.activeRoundId,
    activeOutingId: data.activeOutingId,
  });
  mockLoadDataset.mockResolvedValueOnce(stored(data));
  const view = await render(
    <AppStoreProvider>
      <Probe />
    </AppStoreProvider>,
  );
  await waitFor(() => expect(store.ready).toBe(true));
  return view;
}

async function change(run: () => void) {
  await act(async () => run());
}

/**
 * Starts a round on a par-72 course rated 72.0 / 113, so each course handicap is
 * the index itself: Ann 10.0, Bob 4.0, Cal no index. Returns their ids.
 */
async function startIndexedRound(): Promise<string[]> {
  await mount();
  const course = makeCourse('Handicap Links');
  await change(() => store.createCourse(course));
  await change(() => store.updateTee(course.id, course.tees[0].id, { slope: 113, rating: 72 }));
  let group!: ReturnType<AppStore['createGroup']>;
  await change(() => {
    group = store.createGroup('Index men');
  });
  const players = [
    makePlayer('Ann', 0, { handicapIndex: 10.0 }),
    makePlayer('Bob', 1, { handicapIndex: 4.0 }),
    makePlayer('Cal', 2, { handicapIndex: null }),
  ];
  for (const p of players) await change(() => store.addPlayer(group.id, p));
  const withPlayers = store.groups.find((g) => g.id === group.id)!;
  const saved = store.courses.find((c) => c.id === course.id)!;
  await change(() => store.startRound(makeRound(withPlayers, saved)));
  return players.map((p) => p.id);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUseAuth.mockReturnValue({
    status: 'signed-in',
    email: 'golfer@example.com',
    userId: 'user-1',
    unverified: false,
    signIn: jest.fn(),
    signUp: jest.fn(),
    signOut: jest.fn(),
  });
  mockUseDataSync.mockReturnValue({ status: 'off', at: null, message: null });
  mockSaveDataset.mockResolvedValue();
  mockSaveSettings.mockResolvedValue();
  mockClearDataset.mockResolvedValue();
});

describe('AppStoreProvider', () => {
  it('requires consumers to be inside the provider', async () => {
    await expect(render(<Probe />)).rejects.toThrow('useStore must be used inside AppStoreProvider');
  });

  it('hydrates demo data, derives active documents, persists edits, and adopts sync updates', async () => {
    const data = buildDemoDataset(1_750_000_000_000);
    await mount(data);

    expect(store).toMatchObject({
      ready: true,
      demoMode: true,
      group: expect.objectContaining({ id: data.activeGroupId }),
      round: expect.objectContaining({ id: data.activeRoundId }),
      course: expect.any(Object),
      settlement: expect.any(Object),
      outing: expect.any(Object),
      outingSettlement: expect.any(Object),
    });
    expect(store.outingRounds).toEqual(expect.any(Array));
    expect(mockUseDataSync).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }));

    const syncOptions = mockUseDataSync.mock.calls.at(-1)?.[0];
    const replacement = { groups: [], courses: [], rounds: [], outings: [] };
    await change(() => syncOptions?.onAdoptRemote(replacement));
    expect(store.groups).toEqual([]);
    await change(() => syncOptions?.onSharedData({ ...replacement, groups: data.groups }));
    expect(store.groups).toEqual(data.groups);

    await change(() => store.createCourse(makeCourse('Persist me', 9)));
    await new Promise((resolve) => setTimeout(resolve, 275));
    expect(mockSaveDataset).toHaveBeenCalled();
    expect(mockSaveSettings).toHaveBeenCalled();
  });

  it('seeds an empty demo dataset but leaves an empty live dataset empty', async () => {
    const empty: Dataset = {
      groups: [],
      courses: [],
      rounds: [],
      outings: [],
      activeGroupId: null,
      activeRoundId: null,
      activeOutingId: null,
      cardRoundId: null,
    };
    await mount(empty, true);
    expect(store.groups.length).toBeGreaterThan(0);
    expect(mockSaveDataset).toHaveBeenCalledWith(true, expect.objectContaining({ groups: expect.any(Array) }));

    await mount(empty, false);
    expect(store).toMatchObject({ groups: [], group: null, round: null, course: null, outing: null });
    expect(mockUseDataSync).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: true }));
  });

  it('switches datasets, resets demo data, and erases live data only in the matching mode', async () => {
    const data = buildDemoDataset(1_750_000_000_000);
    await mount(data);

    mockLoadDataset.mockResolvedValueOnce(stored(data));
    await change(() => store.setDemoMode(false));
    await waitFor(() => expect(store.demoMode).toBe(false));
    expect(mockSaveSettings).toHaveBeenCalledWith(expect.objectContaining({ demoMode: false }));

    mockLoadDataset.mockResolvedValueOnce(stored(data));
    await change(() => store.resetDemoData());
    await waitFor(() => expect(mockClearDataset).toHaveBeenCalledWith(true));
    expect(mockLoadDataset).toHaveBeenCalledTimes(2);

    await change(() => store.eraseLiveData());
    await waitFor(() => expect(store.groups).toEqual([]));
    expect(mockClearDataset).toHaveBeenCalledWith(false);

    mockLoadDataset.mockResolvedValueOnce(stored(data));
    await change(() => store.setDemoMode(true));
    await waitFor(() => expect(store.demoMode).toBe(true));
    const groups = store.groups;
    await change(() => store.eraseLiveData());
    await waitFor(() => expect(mockClearDataset).toHaveBeenLastCalledWith(false));
    expect(store.groups).toBe(groups);

    mockLoadDataset.mockResolvedValueOnce(stored(data));
    await change(() => store.resetDemoData());
    await waitFor(() => expect(mockClearDataset).toHaveBeenLastCalledWith(true));
    expect(store.groups.length).toBeGreaterThan(0);
  });

  it('covers group, player, course, and round lifecycle branches', async () => {
    const data = buildDemoDataset(1_750_000_000_000);
    await mount(data);
    const originalGroup = store.group!;
    const originalCourse = store.course!;
    const originalRound = store.round!;

    let createdGroup = null as ReturnType<AppStore['createGroup']> | null;
    await change(() => {
      createdGroup = store.createGroup('New group');
    });
    expect(createdGroup?.players).toEqual([]);
    await change(() => store.updateGroup(createdGroup!.id, { subtitle: 'Updated' }));
    await change(() => store.updateGroup('missing', { subtitle: 'Ignored' }));
    await change(() => store.setActiveGroup(originalGroup.id));

    const added = makePlayer('Added Player', 5);
    await change(() => store.addPlayer(createdGroup!.id, added));
    expect(store.groups.find((g) => g.id === createdGroup!.id)?.youId).toBe(added.id);
    await change(() => store.addPlayer(createdGroup!.id, makePlayer('Second', 6)));
    await change(() => store.addPlayer('missing', makePlayer('Ignored', 7)));
    await change(() => store.updatePlayer(createdGroup!.id, added.id, { name: 'Renamed' }));
    await change(() => store.updatePlayer(createdGroup!.id, 'missing', { name: 'Ignored' }));
    await change(() => store.updatePlayer('missing', added.id, { name: 'Ignored' }));
    await change(() => store.removePlayer(createdGroup!.id, added.id));
    await change(() => store.removePlayer('missing', added.id));

    const createdCourse = makeCourse('Created', 9);
    await change(() => store.createCourse(createdCourse));
    await change(() => store.updateCourse(createdCourse.id, { name: 'Renamed course' }));
    await change(() => store.updateCourse('missing', { name: 'Ignored' }));
    await change(() => store.updateHole(createdCourse.id, createdCourse.tees[0].id, 0, { par: 5 }));
    await change(() => store.updateHole('missing', 'missing', 0, { par: 3 }));
    await change(() => store.deleteCourse(createdCourse.id));
    await change(() => store.deleteCourse('missing'));

    const createdRound = makeRound(originalGroup, originalCourse);
    await change(() => store.startRound(createdRound));
    await change(() => store.completeRound('missing'));
    await change(() => store.completeRound(createdRound.id));
    expect(store.activeRoundId).toBeNull();
    await change(() => store.reopenRound(createdRound.id));
    await change(() => store.deleteRound('missing'));
    await change(() => store.deleteRound(createdRound.id));
    expect(store.activeRoundId).toBeNull();
    await change(() => store.setActiveRound(originalRound.id));

    await change(() => store.deleteGroup(createdGroup!.id));
    await change(() => store.deleteGroup(originalGroup.id));
    expect(store.groups.every((group) => group.id !== originalGroup.id)).toBe(true);
  });

  it('edits scores and every game option, including no-op and boundary branches', async () => {
    const data = buildDemoDataset(1_750_000_000_000);
    await mount(data);
    const round = store.round!;
    const playerId = round.playerIds[0];

    await change(() => store.setActiveRound(null));
    await change(() => store.setScore(playerId, 0, 4));
    await change(() => store.setActiveRound('missing'));
    await change(() => store.setScore(playerId, 0, 4));
    await change(() => store.setActiveRound(round.id));

    await change(() => store.setScore('new-player', 0, 4));
    await change(() => store.setScore(playerId, 0, null));
    await change(() => store.bumpScore(playerId, 0, 1));
    await change(() => store.bumpScore(playerId, 0, -10));
    await change(() => store.bumpScore(playerId, 0, 100));
    await change(() => store.setPops(playerId, -2));
    await change(() => store.setPops(playerId, 99.7));

    await change(() => store.toggleJunk(0, playerId, 'greenie'));
    await change(() => store.toggleJunk(0, playerId, 'greenie'));
    await change(() => store.toggleGame('skins'));
    await change(() => store.setOptions({ teams: [] }));
    await change(() => store.toggleGame('bestball'));
    await change(() => store.toggleGame('bestball'));
    await change(() => store.toggleGame('vegas'));
    await change(() => store.setStake('skins', -4.2));
    await change(() => store.setOptions({ vegasFlipOnBirdie: true }));
    await change(() => store.addPress(playerId, round.playerIds[1], 0, 8, 500));
    const pressId = store.round!.presses[0].id;
    await change(() => store.removePress('missing'));
    await change(() => store.removePress(pressId));
    await change(() => store.setWolfPick(2, playerId, null));
    await change(() => store.setWolfPick(1, playerId, round.playerIds[1]));
    await change(() => store.setWolfPick(2, playerId, round.playerIds[1]));
    await change(() => store.setRoundPlayers([playerId]));

    expect(store.round).toMatchObject({ playerIds: [playerId] });
  });

  it('manages outings, field entrants, playing groups, and completion branches', async () => {
    const data = buildDemoDataset(1_750_000_000_000);
    await mount(data);
    const group = store.group!;
    const course = store.course!;

    await change(() => store.setActiveOuting(null));
    await change(() => store.updateOuting({ name: 'Ignored' }));
    await change(() => store.setActiveOuting('missing'));
    await change(() => store.updateOuting({ name: 'Ignored' }));

    const outing = makeOuting(group, course, { name: 'New outing' });
    const includesYou = makeRound(group, course, [group.youId!], { outingId: outing.id, name: 'You' });
    const other = makeRound(group, course, [group.players[1].id], { outingId: outing.id, name: 'Other' });
    outing.roundIds = [other.id, includesYou.id];
    await change(() => store.startOuting(outing, [other, includesYou]));
    expect(store.activeRoundId).toBe(includesYou.id);
    await change(() => store.updateOuting({ name: 'Renamed outing' }));
    await change(() => store.setFieldGame('fieldSkins', { on: true, buyIn: 200 }));
    await change(() => store.toggleFieldEntrant('fieldSkins', group.players[0].id));
    await change(() => store.toggleFieldEntrant('fieldSkins', group.players[0].id));

    await change(() =>
      store.setOutingGroups([
        { roundId: other.id, name: 'First', teeTime: '08:00', playerIds: [group.players[1].id] },
        { roundId: includesYou.id, name: 'Second', teeTime: null, playerIds: [group.players[0].id] },
      ]),
    );
    await change(() =>
      store.setOutingGroups([{ roundId: 'missing', name: 'Missing', teeTime: null, playerIds: [] }]),
    );
    await change(() => store.completeOuting('missing'));
    await change(() => store.completeOuting(outing.id));
    expect(store.activeOutingId).toBeNull();

    const noYou = makeOuting(group, course);
    const onlyOther = makeRound(group, course, [group.players[1].id], { outingId: noYou.id });
    await change(() => store.startOuting(noYou, [onlyOther]));
    expect(store.activeRoundId).toBe(onlyOther.id);
    const empty = makeOuting(group, course);
    await change(() => store.startOuting(empty, []));
    expect(store.activeRoundId).toBeNull();
  });

  it('reconciles a removed player only from active rounds and supports course fallbacks', async () => {
    const data = buildDemoDataset(1_750_000_000_000);
    const group = data.groups.find((candidate) => candidate.id === data.activeGroupId)!;
    const player = group.players[0];
    const active = data.rounds.find((round) => round.id === data.activeRoundId)!;
    const completed: Round = { ...active, id: 'completed', status: 'completed', completedAt: 1 };
    const otherGroup = { ...active, id: 'other-group', groupId: 'elsewhere' };
    const absent = { ...active, id: 'absent', playerIds: active.playerIds.filter((id) => id !== player.id) };
    await mount(data);

    await change(() => store.startRound(completed));
    await change(() => store.startRound(otherGroup));
    await change(() => store.startRound(absent));
    await change(() => store.setActiveRound(active.id));

    await change(() => store.removePlayer(group.id, player.id));
    expect(store.rounds.find((round) => round.id === active.id)?.playerIds).not.toContain(player.id);
    expect(store.rounds.find((round) => round.id === completed.id)?.playerIds).toContain(player.id);

    const noCourse = { ...store.rounds[0], id: 'no-course', courseId: 'missing' };
    await change(() => store.startRound(noCourse));
    await change(() => store.bumpScore(noCourse.playerIds[0], 0, 1));
    await change(() => store.setRoundPlayers(noCourse.playerIds));
    expect(store.course).toBeNull();
  });

  it('holds the stepper at the max, records pick-ups, and keeps an outing on one rule', async () => {
    await mount();
    const round = store.round!;
    const playerId = round.playerIds[0];
    const par = store.course!.tees[0].holes[0].par;

    await change(() => store.setOptions({ maxScore: 'double_bogey' }));
    await change(() => store.setScore(playerId, 0, par + 1));
    await change(() => store.bumpScore(playerId, 0, 1));
    await change(() => store.bumpScore(playerId, 0, 1));
    expect(store.round!.scores[playerId][0]).toBe(par + 2);

    await change(() => store.setPickedUp(playerId, 0, true));
    expect(store.round!.pickups[`0:${playerId}`]).toBe(true);
    expect(store.round!.scores[playerId][0]).toBeNull();
    await change(() => store.setScore(playerId, 0, par));
    expect(store.round!.pickups[`0:${playerId}`]).toBeUndefined();
    await change(() => store.setPickedUp(playerId, 0, true));
    // A tap on the stepper from a pick-up starts from par again, like a blank box.
    await change(() => store.bumpScore(playerId, 0, -1));
    expect(store.round!.pickups[`0:${playerId}`]).toBeUndefined();
    expect(store.round!.scores[playerId][0]).toBe(par);
    await change(() => store.setPickedUp(playerId, 0, false));
    expect(store.round!.scores[playerId][0]).toBe(par);

    await change(() => store.setActiveOuting(store.outings[0].id));
    const outing = store.outing!;
    await change(() => store.updateOuting({ maxScore: 'net_double_bogey' }));
    const inOuting = store.rounds.filter((r) => r.outingId === outing.id);
    expect(inOuting.length).toBeGreaterThan(0);
    expect(inOuting.every((r) => r.options.maxScore === 'net_double_bogey')).toBe(true);
  });

  it('enters a finished card beside the live round, then saves or discards it', async () => {
    await mount();
    const liveId = store.activeRoundId!;
    const group = store.group!;
    const course = store.courses[0];
    const saturday = new Date(2026, 8, 19, 12).getTime();
    const ids = group.players.slice(0, 2).map((p) => p.id);
    const card = makeRound(group, course, ids, { entry: 'card', playedOn: saturday });

    await change(() => store.startCard(card));
    expect(store.round!.id).toBe(card.id);
    expect(store.activeRoundId).toBe(liveId);

    await change(() => store.setScore(ids[0], 0, 5));
    await change(() => store.addPress(ids[0], ids[1], 0, 8, 500));
    await change(() => store.setWolfPick(0, ids[0], null));
    expect(store.round!.presses).toEqual([]);
    expect(store.round!.wolfPicks).toEqual([]);
    expect(store.rounds.find((r) => r.id === liveId)!.scores[ids[0]]?.[0]).not.toBe(5);

    await change(() => store.saveCard(true));
    const saved = store.rounds.find((r) => r.id === card.id)!;
    expect(saved).toMatchObject({ status: 'completed', completedAt: saturday });
    expect(saved.pickups[`0:${ids[1]}`]).toBe(true);
    expect(saved.pickups[`0:${ids[0]}`]).toBeUndefined();
    expect(Object.keys(saved.pickups)).toHaveLength(course.tees[0].holes.length * 2 - 1);
    expect(store.cardRoundId).toBeNull();
    expect(store.round!.id).toBe(liveId);

    const second = makeRound(group, course, ids, { entry: 'card', playedOn: saturday });
    await change(() => store.startCard(second));
    await change(() => store.setActiveRound(liveId));
    await change(() => store.setActiveRound(second.id));
    expect(store.cardRoundId).toBe(second.id);
    expect(store.activeRoundId).toBe(liveId);
    await change(() => store.saveCard(false));
    expect(store.rounds.find((r) => r.id === second.id)!.pickups).toEqual({});

    const third = makeRound(group, course, ids, { entry: 'card', playedOn: saturday });
    await change(() => store.startCard(third));
    await change(() => store.completeRound(third.id));
    expect(store.rounds.find((r) => r.id === third.id)!.completedAt).toBe(saturday);
    expect(store.cardRoundId).toBeNull();

    const fourth = makeRound(group, course, ids, { entry: 'card', playedOn: saturday });
    await change(() => store.startCard(fourth));
    await change(() => store.discardCard());
    expect(store.rounds.some((r) => r.id === fourth.id)).toBe(false);
    expect(store.round!.id).toBe(liveId);
    await change(() => store.saveCard(true));
    await change(() => store.discardCard());
    await waitFor(() =>
      expect(mockSaveDataset).toHaveBeenLastCalledWith(true, expect.objectContaining({ cardRoundId: null })),
    );
  });

  it('calculates pops from handicap indexes when a round starts', async () => {
    const [ann, bob, cal] = await startIndexedRound();
    // Off the low man: Ann 10 − 4, Bob is the low man, Cal has no index and keeps 0.
    expect(store.round!.pops).toEqual({ [ann]: 6, [bob]: 0, [cal]: 0 });
  });

  it('calculates pops for a finished card as well', async () => {
    const [ann, bob, cal] = await startIndexedRound();
    const card = makeRound(store.group!, store.course!, undefined, { entry: 'card', playedOn: 1_700_000_000_000 });
    await change(() => store.startCard(card));
    const saved = store.rounds.find((r) => r.id === card.id)!;
    expect(saved.pops).toEqual({ [ann]: 6, [bob]: 0, [cal]: 0 });
  });

  it('keeps typed pops until the round is recalculated from handicaps', async () => {
    const [ann, bob, cal] = await startIndexedRound();
    await change(() => store.setPops(ann, 9));
    await change(() => store.setPops(cal, 3));
    await change(() => store.setOptions({ strokes: 'full' }));
    expect(store.round!.pops).toEqual({ [ann]: 9, [bob]: 0, [cal]: 3 });

    await change(() => store.recalculatePops());
    // Full handicaps; Cal has no index and keeps the 3 typed in.
    expect(store.round!.pops).toEqual({ [ann]: 10, [bob]: 4, [cal]: 3 });
  });

  it('lets typed pops go below zero only on full handicaps', async () => {
    const [ann] = await startIndexedRound();
    await change(() => store.setPops(ann, -2));
    expect(store.round!.pops[ann]).toBe(0);
    await change(() => store.setOptions({ strokes: 'full' }));
    await change(() => store.setPops(ann, -2));
    expect(store.round!.pops[ann]).toBe(-2);
  });

  it('gives the demo players indexes that recalculate to the pops the demo round already has', async () => {
    await mount();
    expect(store.group!.players.every((p) => p.handicapIndex != null)).toBe(true);
    const before = { ...store.round!.pops };
    await change(() => store.recalculatePops());
    expect(store.round!.pops).toEqual(before);
  });

  it('flags a tee change instead of recalculating, until recalculated', async () => {
    const [ann, bob] = await startIndexedRound();
    const course = store.course!;
    let red!: ReturnType<AppStore['addTee']>;
    await change(() => {
      red = store.addTee(course.id, course.tees[0].id, 'Red');
    });
    await change(() => store.updateTee(course.id, red!.id, { slope: 113, rating: 70 }));
    expect(teesChanged(store.round!, store.course!)).toEqual([]);

    await change(() => store.setPlayerTee(ann, red!.id));
    expect(store.round!.pops[ann]).toBe(6);
    expect(teesChanged(store.round!, store.course!)).toEqual([ann]);

    await change(() => store.recalculatePops());
    // Red plays two shots easier: Ann 10 − 2 = 8, less Bob's 4.
    expect(store.round!.pops).toMatchObject({ [ann]: 4, [bob]: 0 });
    expect(teesChanged(store.round!, store.course!)).toEqual([]);
  });

  it('takes an outing off the low man in the whole field, and locks its handicap rules', async () => {
    await mount();
    const course = makeCourse('Handicap Links');
    await change(() => store.createCourse(course));
    await change(() => store.updateTee(course.id, course.tees[0].id, { slope: 113, rating: 72 }));
    let group!: ReturnType<AppStore['createGroup']>;
    await change(() => {
      group = store.createGroup('Society');
    });
    const players = [
      makePlayer('Ann', 0, { handicapIndex: 10.0 }),
      makePlayer('Bob', 1, { handicapIndex: 4.0 }),
      makePlayer('Cal', 2, { handicapIndex: null }),
      makePlayer('Dee', 3, { handicapIndex: 2.0 }),
    ];
    for (const p of players) await change(() => store.addPlayer(group.id, p));
    const [ann, bob, cal, dee] = players.map((p) => p.id);
    const withPlayers = store.groups.find((g) => g.id === group.id)!;
    const saved = store.courses.find((c) => c.id === course.id)!;
    const outing = makeOuting(withPlayers, saved);
    const first = makeRound(withPlayers, saved, [ann, cal], { outingId: outing.id });
    const second = makeRound(withPlayers, saved, [bob, dee], { outingId: outing.id });
    outing.roundIds = [first.id, second.id];

    await change(() => store.startOuting(outing, [first, second]));
    // Dee's 2 is the lowest in the field, so Ann gets 8 even though she is the low man in her own group.
    const pops = () => Object.assign({}, ...store.rounds.filter((r) => r.outingId === outing.id).map((r) => r.pops));
    expect(pops()).toEqual({ [ann]: 8, [cal]: 0, [bob]: 2, [dee]: 0 });

    await change(() => store.setActiveOuting(outing.id));
    await change(() => store.updateOuting({ allowance: 90 }));
    const inOuting = store.rounds.filter((r) => r.outingId === outing.id);
    expect(inOuting.every((r) => r.options.allowance === 90)).toBe(true);
    // Changing the rule never recalculates by itself.
    expect(pops()[ann]).toBe(8);

    // Ann's group recalculates against the field: 90% of 10 is 9, less Dee's 90% of 2 (1.8 → 2).
    expect(store.round!.id).toBe(first.id);
    await change(() => store.recalculatePops());
    expect(store.round!.pops).toEqual({ [ann]: 7, [cal]: 0 });
  });

  it('adds, edits and deletes tees, and puts the round and a player on one', async () => {
    await mount();
    const course = store.course!;
    const blue = course.tees[0];
    const red = course.tees[1];

    let copy: ReturnType<AppStore['addTee']> = null;
    await change(() => {
      copy = store.addTee(course.id, blue.id, 'Gold');
    });
    const gold = store.courses.find((c) => c.id === course.id)!.tees.find((t) => t.name === 'Gold')!;
    expect(copy).toEqual(gold);
    expect(gold.id).not.toBe(blue.id);
    expect(gold.holes).toEqual(blue.holes);
    expect(store.addTee('missing', blue.id, 'X')).toBeNull();

    await change(() => store.updateTee(course.id, gold.id, { slope: 140, rating: 73.4 }));
    await change(() => store.updateHole(course.id, gold.id, 0, { par: 5 }));
    const edited = store.courses.find((c) => c.id === course.id)!.tees.find((t) => t.id === gold.id)!;
    expect(edited).toMatchObject({ slope: 140, rating: 73.4 });
    expect(edited.holes[0].par).toBe(5);
    expect(store.courses.find((c) => c.id === course.id)!.tees[0].holes[0].par).toBe(blue.holes[0].par);

    const playerId = store.round!.playerIds[0];
    await change(() => store.setRoundTee(red.id));
    await change(() => store.setPlayerTee(playerId, gold.id));
    expect(store.round).toMatchObject({ teeId: red.id, playerTees: { [playerId]: gold.id } });
    await change(() => store.setPlayerTee(playerId, red.id));
    expect(store.round!.playerTees).toEqual({});

    // A tee a saved round plays from cannot go; neither can a course's last tee.
    expect(store.deleteTee(course.id, red.id)).toBe(false);
    let deleted = false;
    await change(() => {
      deleted = store.deleteTee(course.id, gold.id);
    });
    expect(deleted).toBe(true);
    expect(store.courses.find((c) => c.id === course.id)!.tees.map((t) => t.id)).toEqual([blue.id, red.id]);
    const solo = makeCourse('Solo');
    await change(() => store.createCourse(solo));
    expect(store.deleteTee(solo.id, solo.tees[0].id)).toBe(false);
  });
});

