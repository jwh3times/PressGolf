import { buildDemoDataset } from '../../demo/seed';
import { makeTestCourse, makeTestGroup, makeTestRound } from '../../domain/__tests__/helpers';
import { changesAnything, mergeShared } from '../merge-shared';
import type { Documents } from '../rows';

function local(): Documents {
  const data = buildDemoDataset(1_700_000_000_000);
  return { groups: data.groups, courses: data.courses, rounds: data.rounds, outings: data.outings };
}

const NOTHING: Documents = { groups: [], courses: [], rounds: [], outings: [] };

describe('mergeShared', () => {
  it('leaves everything alone when nothing is shared', () => {
    const mine = local();
    expect(mergeShared(mine, NOTHING)).toBe(mine);
  });

  it('adopts the shared version of a round that both sides have', () => {
    const mine = local();
    const outing = mine.outings[0];
    const roundId = outing.roundIds[0];
    const theirs = {
      ...mine.rounds.find((r) => r.id === roundId)!,
      name: 'Group 1 (from the other phone)',
    };
    const merged = mergeShared(mine, { ...NOTHING, outings: [outing], rounds: [theirs] });
    expect(merged.rounds.find((r) => r.id === roundId)!.name).toBe(
      'Group 1 (from the other phone)',
    );
  });

  it('keeps a round that has nothing to do with the shared day', () => {
    const mine = local();
    const untouched = mine.rounds.find((r) => r.outingId === null)!;
    const merged = mergeShared(mine, { ...NOTHING, outings: [mine.outings[0]], rounds: [] });
    expect(merged.rounds).toContain(untouched);
  });

  it('adds a joined outing this phone has never seen', () => {
    const theirOuting = local().outings[0];
    const merged = mergeShared(NOTHING, { ...NOTHING, outings: [theirOuting] });
    expect(merged.outings).toEqual([theirOuting]);
  });

  it('adds the organiser’s group so the names have somewhere to live', () => {
    const theirs = local();
    const merged = mergeShared(
      { ...NOTHING, outings: [] },
      { ...NOTHING, outings: [theirs.outings[0]], groups: [theirs.groups[1]] },
    );
    expect(merged.groups).toEqual([theirs.groups[1]]);
  });

  it('never renames players in a group this phone already keeps', () => {
    const mine = local();
    const mineGroup = mine.groups[0];
    const renamed = {
      ...mineGroup,
      players: mineGroup.players.map((p) => ({ ...p, name: 'Wrong' })),
    };
    const merged = mergeShared(mine, {
      ...NOTHING,
      outings: [mine.outings[0]],
      groups: [renamed],
    });
    expect(merged.groups.find((g) => g.id === mineGroup.id)).toBe(mineGroup);
  });

  it('does not add a course it already has', () => {
    const mine = local();
    const merged = mergeShared(mine, {
      ...NOTHING,
      outings: [mine.outings[0]],
      courses: [makeTestCourse()],
    });
    expect(merged.courses).toHaveLength(mine.courses.length + 1);
    const again = mergeShared(merged, {
      ...NOTHING,
      outings: [mine.outings[0]],
      courses: [makeTestCourse()],
    });
    expect(again.courses).toHaveLength(merged.courses.length);
  });

  it('is stable: merging the same thing twice changes nothing the second time', () => {
    const mine = local();
    const shared = { ...NOTHING, outings: [mine.outings[0]], rounds: [] };
    const once = mergeShared(mine, shared);
    const twice = mergeShared(once, shared);
    expect(twice).toEqual(once);
  });
});

describe('changesAnything', () => {
  it('is false when the merge was a no-op', () => {
    const mine = local();
    expect(changesAnything(mine, mergeShared(mine, NOTHING))).toBe(false);
  });

  it('is true once a shared round has replaced one of ours', () => {
    const mine = local();
    const roundId = mine.outings[0].roundIds[0];
    const theirs = { ...mine.rounds.find((r) => r.id === roundId)!, name: 'Changed' };
    const merged = mergeShared(mine, {
      ...NOTHING,
      outings: [mine.outings[0]],
      rounds: [theirs],
    });
    expect(changesAnything(mine, merged)).toBe(true);
  });

  it('is true when a new outing arrives', () => {
    const merged = mergeShared(NOTHING, { ...NOTHING, outings: [local().outings[0]] });
    expect(changesAnything(NOTHING, merged)).toBe(true);
  });

  it('is true when a group is added but nothing else moved', () => {
    const theirs = local();
    const base: Documents = { ...NOTHING, outings: [theirs.outings[0]] };
    const merged = mergeShared(base, {
      ...NOTHING,
      outings: [theirs.outings[0]],
      groups: [makeTestGroup(4)],
    });
    expect(changesAnything(base, merged)).toBe(true);
  });

  it('notices a round replaced in place, not just counted', () => {
    const round = makeTestRound({ scores: [], playerCount: 4 });
    const base: Documents = { ...NOTHING, rounds: [round] };
    const merged: Documents = { ...base, rounds: [{ ...round, name: 'Other' }] };
    expect(changesAnything(base, merged)).toBe(true);
  });
});
