import { makeTestCourse, makeTestPlayers, makeTestRound } from '../../domain/__tests__/helpers';
import { settleRound } from '../../domain/engine';
import type { Mutation, SyncTransport } from '../types';
import { applyAll, applyMutation, collapse, laterWins } from '../merge';
import { deviceId, setDeviceId, SyncEngine } from '../engine';
import { FakeTransport } from '../fake-transport';

let seq = 0;
function mutation(patch: Partial<Mutation> = {}): Mutation {
  seq += 1;
  return {
    id: `m${seq}`,
    kind: 'score',
    roundId: 'round1',
    outingId: 'outing1',
    key: 'score:a:0',
    value: { playerId: 'a', hole: 0, strokes: 4 },
    at: 1000,
    deviceId: 'deviceA',
    authorId: 'a',
    ...patch,
  };
}

const course = makeTestCourse();
const players = makeTestPlayers();
const baseRound = () =>
  makeTestRound({ scores: [[], [], [], []], games: { nassau: { on: true, stake: 500 } } });

describe('conflict resolution', () => {
  it('takes the later edit for the same cell', () => {
    const early = mutation({ at: 1000, value: { playerId: 'a', hole: 0, strokes: 4 } });
    const late = mutation({ at: 2000, value: { playerId: 'a', hole: 0, strokes: 6 } });
    expect(laterWins(early, late)).toBe(late);
    expect(laterWins(late, early)).toBe(late);
  });

  it('breaks exact ties the same way on every device', () => {
    const a = mutation({ at: 1000, deviceId: 'deviceA' });
    const b = mutation({ at: 1000, deviceId: 'deviceB' });
    // Both orderings must agree, or two phones would show different scores.
    expect(laterWins(a, b)).toBe(laterWins(b, a));
    expect(laterWins(a, b).deviceId).toBe('deviceB');
  });

  it('keeps edits to different holes instead of clobbering', () => {
    const hole1 = mutation({ key: 'score:a:0', value: { playerId: 'a', hole: 0, strokes: 4 } });
    const hole2 = mutation({ key: 'score:a:1', at: 1001, value: { playerId: 'a', hole: 1, strokes: 5 } });
    const collapsed = collapse([hole1, hole2]);
    expect(collapsed).toHaveLength(2);

    const round = applyAll(baseRound(), [hole1, hole2]);
    expect(round.scores['a'][0]).toBe(4);
    expect(round.scores['a'][1]).toBe(5);
  });

  it('keeps two players’ edits to the same hole', () => {
    const mine = mutation({ key: 'score:a:0', value: { playerId: 'a', hole: 0, strokes: 4 } });
    const yours = mutation({
      key: 'score:b:0',
      at: 1001,
      deviceId: 'deviceB',
      value: { playerId: 'b', hole: 0, strokes: 5 },
    });
    const round = applyAll(baseRound(), [mine, yours]);
    expect(round.scores['a'][0]).toBe(4);
    expect(round.scores['b'][0]).toBe(5);
  });

  it('collapses a cell edited many times to the last value', () => {
    const edits = [3, 4, 5, 6].map((strokes, i) =>
      mutation({ key: 'score:a:0', at: 1000 + i, value: { playerId: 'a', hole: 0, strokes } }),
    );
    const round = applyAll(baseRound(), edits);
    expect(round.scores['a'][0]).toBe(6);
    expect(collapse(edits)).toHaveLength(1);
  });

  it('applies the same batch in any order to the same result', () => {
    const edits = [
      mutation({ key: 'score:a:0', at: 3000, value: { playerId: 'a', hole: 0, strokes: 6 } }),
      mutation({ key: 'score:a:0', at: 1000, value: { playerId: 'a', hole: 0, strokes: 3 } }),
      mutation({ key: 'score:b:2', at: 2000, value: { playerId: 'b', hole: 2, strokes: 5 } }),
    ];
    const forwards = applyAll(baseRound(), edits);
    const backwards = applyAll(baseRound(), edits.slice().reverse());
    expect(forwards.scores).toEqual(backwards.scores);
    expect(forwards.scores['a'][0]).toBe(6);
  });

  it('ignores a mutation kind it has never heard of', () => {
    const round = baseRound();
    const weird = mutation({ kind: 'somethingNew' as Mutation['kind'] });
    // An older build must not crash on a newer build's traffic.
    expect(applyMutation(round, weird)).toBe(round);
  });

  it('ignores a score for somebody not in the round', () => {
    const round = baseRound();
    const stray = mutation({ value: { playerId: 'zz', hole: 0, strokes: 4 } });
    expect(applyMutation(round, stray)).toBe(round);
  });

  it('ignores a hole off the end of the card', () => {
    const round = baseRound();
    const stray = mutation({ value: { playerId: 'a', hole: 99, strokes: 4 } });
    expect(applyMutation(round, stray)).toBe(round);
  });
});

describe('mutation kinds', () => {
  it('toggles junk on and off', () => {
    const on = mutation({
      kind: 'junk',
      key: 'junk:a:3:greenie',
      value: { playerId: 'a', hole: 3, kind: 'greenie', on: true },
    });
    const withJunk = applyMutation(baseRound(), on);
    expect(withJunk.junk['3:a:greenie']).toBe(true);

    const off = mutation({ ...on, at: 2000, value: { ...(on.value as object), on: false } });
    expect(applyMutation(withJunk, off).junk['3:a:greenie']).toBeUndefined();
  });

  it('does not add the same press twice', () => {
    const press = mutation({
      kind: 'press',
      key: 'press:p1',
      value: { id: 'p1', by: 'a', against: 'b', startHole: 3, endHole: 8, stake: 500 },
    });
    const once = applyMutation(baseRound(), press);
    const twice = applyMutation(once, press);
    expect(twice.presses).toHaveLength(1);
  });

  it('replaces a wolf pick for the same hole', () => {
    const first = mutation({
      kind: 'wolfPick',
      key: 'wolf:0',
      value: { hole: 0, wolf: 'a', partner: 'b' },
    });
    const second = mutation({
      kind: 'wolfPick',
      key: 'wolf:0',
      at: 2000,
      value: { hole: 0, wolf: 'a', partner: null },
    });
    const round = applyAll(baseRound(), [first, second]);
    expect(round.wolfPicks).toHaveLength(1);
    expect(round.wolfPicks[0].partner).toBeNull();
  });

  it('carries stake and toggle changes', () => {
    const round = applyAll(baseRound(), [
      mutation({ kind: 'gameStake', key: 'stake:nassau', value: { key: 'nassau', stake: 1000 } }),
      mutation({ kind: 'gameToggle', key: 'toggle:skins', at: 1001, value: { key: 'skins', on: true } }),
    ]);
    expect(round.games.nassau.stake).toBe(1000);
    expect(round.games.skins.on).toBe(true);
  });

  it('applies pops, press removal, options, and round-player changes', () => {
    const press = { id: 'p1', by: 'a', against: 'b', startHole: 0, endHole: 8, stake: 500 };
    const starting = { ...baseRound(), presses: [press] };
    const changed = applyAll(starting, [
      mutation({ kind: 'pops', key: 'pops:a', value: { playerId: 'a', pops: 7 } }),
      mutation({ kind: 'pressRemoved', key: 'press:p1', value: { pressId: 'p1' } }),
      mutation({ kind: 'options', key: 'options', value: { wolfLoneMultiplier: 4 } }),
      mutation({ kind: 'roundPlayers', key: 'players', value: { playerIds: ['b', 'a'] } }),
    ]);
    expect(changed.pops.a).toBe(7);
    expect(changed.presses).toEqual([]);
    expect(changed.options.wolfLoneMultiplier).toBe(4);
    expect(changed.playerIds).toEqual(['b', 'a']);
  });

  it('ignores stake and toggle changes for unknown games', () => {
    const round = baseRound();
    expect(
      applyMutation(round, mutation({ kind: 'gameToggle', value: { key: 'future', on: true } })),
    ).toBe(round);
    expect(
      applyMutation(round, mutation({ kind: 'gameStake', value: { key: 'future', stake: 10 } })),
    ).toBe(round);
  });

  it('collapses outing-only and unscoped mutations independently', () => {
    const outingOnly = mutation({ roundId: undefined, outingId: 'outing-a', key: 'name' });
    const unscoped = mutation({ roundId: undefined, outingId: undefined, key: 'name' });
    expect(collapse([outingOnly, unscoped])).toHaveLength(2);
  });
});

describe('sync engine', () => {
  const makeEngine = (transport: FakeTransport, onRemote = jest.fn()) =>
    new SyncEngine({ transport, outingId: 'outing1', onRemote, now: () => 5000 });

  it('pushes queued edits and clears the queue', async () => {
    const transport = new FakeTransport();
    const engine = makeEngine(transport);
    await engine.start();

    engine.enqueue(mutation());
    await engine.sync();

    expect(transport.log).toHaveLength(1);
    expect(engine.getState().pending).toBe(0);
    expect(engine.getState().status).toBe('synced');
    engine.stop();
  });

  it('keeps edits queued while there is no signal, and sends them all on reconnect', async () => {
    const transport = new FakeTransport();
    const engine = makeEngine(transport);
    await engine.start();

    transport.online = false;
    engine.enqueue(mutation({ key: 'score:a:0' }));
    engine.enqueue(mutation({ key: 'score:a:1' }));
    engine.enqueue(mutation({ key: 'score:a:2' }));
    await engine.sync();

    // Nothing lost, nothing sent, and the app knows it is offline.
    expect(transport.log).toHaveLength(0);
    expect(engine.getState().status).toBe('offline');
    expect(engine.getState().pending).toBe(3);

    transport.online = true;
    await engine.sync();
    expect(transport.log).toHaveLength(3);
    expect(engine.getState().pending).toBe(0);
    engine.stop();
  });

  it('survives the app being killed with edits still queued', async () => {
    const transport = new FakeTransport();
    let saved: Mutation[] = [];
    const first = new SyncEngine({
      transport,
      outingId: 'outing1',
      onRemote: jest.fn(),
      saveQueue: (q) => {
        saved = q.slice();
      },
      loadQueue: async () => saved,
    });
    await first.start();
    transport.online = false;
    first.enqueue(mutation({ key: 'score:a:5' }));
    await first.sync();
    first.stop();

    expect(saved).toHaveLength(1);

    // Cold start: a new engine picks the queue back up off disk.
    transport.online = true;
    const second = new SyncEngine({
      transport,
      outingId: 'outing1',
      onRemote: jest.fn(),
      saveQueue: (q) => {
        saved = q.slice();
      },
      loadQueue: async () => saved,
    });
    await second.start();
    expect(transport.log).toHaveLength(1);
    expect(saved).toHaveLength(0);
    second.stop();
  });

  it('pulls what other phones did while we were out of range', async () => {
    const transport = new FakeTransport();
    const onRemote = jest.fn();
    const engine = makeEngine(transport, onRemote);

    transport.seed([
      mutation({ id: 'remote1', deviceId: 'deviceB', value: { playerId: 'b', hole: 0, strokes: 5 } }),
      mutation({ id: 'remote2', deviceId: 'deviceB', value: { playerId: 'b', hole: 1, strokes: 4 } }),
    ]);

    await engine.start();
    expect(onRemote).toHaveBeenCalled();
    expect(onRemote.mock.calls[0][0]).toHaveLength(2);
    engine.stop();
  });

  it('does not re-deliver changes it has already seen', async () => {
    const transport = new FakeTransport();
    const onRemote = jest.fn();
    const engine = makeEngine(transport, onRemote);
    transport.seed([mutation({ id: 'remote1', deviceId: 'deviceB' })]);

    await engine.start();
    onRemote.mockClear();
    await engine.sync();

    expect(onRemote).not.toHaveBeenCalled();
    engine.stop();
  });

  it('does not drop edits made during a push', async () => {
    const transport = new FakeTransport();
    const engine = makeEngine(transport);
    await engine.start();

    engine.enqueue(mutation({ key: 'score:a:0' }));
    // Fire a sync and add another edit before it settles.
    const inFlight = engine.sync();
    engine.enqueue(mutation({ key: 'score:a:1' }));
    await inFlight;
    await engine.sync();

    expect(transport.log).toHaveLength(2);
    expect(engine.getState().pending).toBe(0);
    engine.stop();
  });

  it('is safe to send the same mutation twice', async () => {
    const transport = new FakeTransport();
    const engine = makeEngine(transport);
    await engine.start();
    const m = mutation();
    engine.enqueue(m);
    await engine.sync();
    // A retry after a timeout the server actually received.
    await transport.push('outing1', [m]);
    expect(transport.log).toHaveLength(1);
    engine.stop();
  });

  it('loads a cursor, receives subscriptions, persists the next cursor, and unsubscribes', async () => {
    let subscriber: ((changes: { mutations: Mutation[]; cursor: string | null }) => void) | null = null;
    const unsubscribe = jest.fn();
    const onRemote = jest.fn();
    const saveCursor = jest.fn();
    const transport: SyncTransport = {
      name: 'subscription-test',
      push: jest.fn().mockResolvedValue(undefined),
      pull: jest.fn().mockResolvedValue({ mutations: [], cursor: null }),
      subscribe: jest.fn((_outingId: string, callback: (changes: { mutations: Mutation[]; cursor: string | null }) => void) => {
        subscriber = callback;
        return unsubscribe;
      }),
    };
    const engine = new SyncEngine({
      transport,
      outingId: 'outing1',
      onRemote,
      loadQueue: async () => [],
      loadCursor: async () => 'cursor-1',
      saveCursor,
      onState: jest.fn(),
    });
    await engine.start();
    (subscriber as ((changes: { mutations: Mutation[]; cursor: string | null }) => void) | null)?.({
      mutations: [mutation()],
      cursor: 'cursor-2',
    });
    await Promise.resolve();
    expect(onRemote).toHaveBeenCalled();
    expect(saveCursor).toHaveBeenCalledWith('cursor-2');
    engine.stop();
    expect(unsubscribe).toHaveBeenCalled();
    await engine.sync();
  });

  it('reports non-Error transport failures and gives one stable generated device id', async () => {
    const transport: SyncTransport = {
      name: 'failure-test',
      push: jest.fn().mockResolvedValue(undefined),
      pull: jest.fn().mockRejectedValue('radio down'),
    };
    const engine = new SyncEngine({ transport, outingId: 'outing1', onRemote: jest.fn() });
    await engine.start();
    expect(engine.getState().lastError).toBe('radio down');
    engine.stop();

    setDeviceId('fixed');
    expect(deviceId(() => 'other')).toBe('fixed');
    setDeviceId('');
    const generated = deviceId();
    expect(generated).toMatch(/^d_/);
    expect(deviceId(() => 'different')).toBe(generated);
  });
});

describe('sync feeding the settlement', () => {
  it('two phones scoring the same round agree on the money', () => {
    // Phone A scores its own player, phone B scores another, out of order.
    const fromA = [0, 1, 2].map((hole) =>
      mutation({
        key: `score:a:${hole}`,
        at: 1000 + hole,
        deviceId: 'deviceA',
        value: { playerId: 'a', hole, strokes: 4 },
      }),
    );
    const fromB = [0, 1, 2].map((hole) =>
      mutation({
        key: `score:b:${hole}`,
        at: 1500 + hole,
        deviceId: 'deviceB',
        value: { playerId: 'b', hole, strokes: 5 },
      }),
    );
    const rest = ['c', 'd'].flatMap((playerId) =>
      [0, 1, 2].map((hole) =>
        mutation({
          key: `score:${playerId}:${hole}`,
          at: 1800 + hole,
          deviceId: 'deviceC',
          value: { playerId, hole, strokes: 5 },
        }),
      ),
    );

    const phoneA = applyAll(baseRound(), [...fromA, ...fromB, ...rest]);
    const phoneB = applyAll(baseRound(), [...rest, ...fromB, ...fromA]);

    const moneyA = settleRound(phoneA, course, players).net;
    const moneyB = settleRound(phoneB, course, players).net;
    expect(moneyA).toEqual(moneyB);
    // a beat everyone on three holes, so a is up on all three matches.
    expect(moneyA['a']).toBeGreaterThan(0);
  });
});
