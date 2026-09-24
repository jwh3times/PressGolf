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
    await change(() => store.updateHole(createdCourse.id, 0, { par: 5 }));
    await change(() => store.updateHole('missing', 0, { par: 3 }));
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
});
