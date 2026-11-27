import * as fc from 'fast-check';
import { asPlayed, currentVersion, forTee, withScoringChange } from '../course-version';
import { settleOuting, settleRound } from '../engine';
import { playerTee, RoundContext } from '../engine/context';
import { buildSeason } from '../season';
import type { Course, Round } from '../types';
import { flat, makeTestCourse, makeTestGroup, makeTestRound, withTee } from './helpers';
import { flatField, makeTestOuting } from './outing-helpers';

/** The test course with its first tee's card changed by `change`, as an edit would make it. */
function edited(course: Course, change: (holes: Course['tees'][0]['holes']) => Course['tees'][0]['holes']): Course {
  return withScoringChange(course, { ...course, tees: course.tees.map((tee, i) => (i === 0 ? { ...tee, holes: change(tee.holes) } : tee)) });
}

/** Swaps the stroke indexes of the first two holes, which moves a pop from one to the other. */
const swapFirstTwo = (holes: Course['tees'][0]['holes']) =>
  holes.map((h, i) => (i === 0 ? { ...h, strokeIndex: holes[1].strokeIndex } : i === 1 ? { ...h, strokeIndex: holes[0].strokeIndex } : h));

describe('course versions (#377)', () => {
  const course = makeTestCourse();

  it('starts a course on its first version, with nothing archived', () => {
    expect(currentVersion(course)).toBe(1);
    expect(asPlayed(course, makeTestRound({ scores: [] }))).toBe(course);
  });

  it('archives the tees a scoring change replaces, and moves the course to the next version', () => {
    const once = edited(course, (holes) => holes.map((h, i) => (i === 0 ? { ...h, par: 5 } : h)));
    expect(once.version).toBe(2);
    expect(once.versions).toEqual([{ version: 1, tees: course.tees }]);
    expect(once.tees[0].holes[0].par).toBe(5);

    const twice = withScoringChange(once, { ...once, tees: once.tees.map((t) => ({ ...t, slope: 131, rating: 71.2 })) });
    expect(twice.version).toBe(3);
    expect(twice.versions?.map((v) => v.version)).toEqual([1, 2]);
    expect(twice.versions?.[1].tees).toBe(once.tees);
  });

  it('makes a version for an added tee too', () => {
    const added = withScoringChange(course, withTee(course, 'red', () => ({ par: 4 })));
    expect(added.version).toBe(2);
    expect(added.versions?.[0].tees.map((t) => t.id)).toEqual(['white']);
  });

  it('makes a version for a card change made with a rename, in one edit', () => {
    const both = withScoringChange(course, { ...course, name: 'Renamed', tees: [{ ...course.tees[0], slope: 125 }] });
    expect(both.version).toBe(2);
  });

  it("gives every reader of a round the tees at its version: the round's own tee and each player's", () => {
    const later = edited(course, (holes) => holes.map((h) => ({ ...h, par: 3 })));
    const round: Round = { ...makeTestRound({ scores: [flat(4), flat(4)] }), courseVersion: 1 };
    expect(new RoundContext(round, later, makeTestGroup(2).players).par(0)).toBe(course.tees[0].holes[0].par);
    expect(playerTee(round, later, round.playerIds[0])).toBe(course.tees[0]);
  });

  it('changes the name, greens, map and notes in place, with no version', () => {
    const renamed = { ...course, name: 'Renamed', notes: [{ number: 1, text: 'Aim left.' }], location: { lat: 1, lng: 2 } };
    expect(withScoringChange(course, renamed)).toBe(renamed);
  });

  it("reads a round's course at the round's version, and the course as it is when that version isn't here", () => {
    const later = edited(course, swapFirstTwo);
    const onFirst: Round = { ...makeTestRound({ scores: [] }), courseVersion: 1 };
    expect(asPlayed(later, onFirst).tees).toBe(course.tees);
    expect(asPlayed(later, { ...onFirst, courseVersion: 2 })).toBe(later);
    expect(asPlayed({ ...later, versions: [] }, onFirst)).toEqual({ ...later, versions: [] });
    // A round saved before versions plays the course as it is.
    expect(asPlayed(later, makeTestRound({ scores: [] }))).toBe(later);
  });

  it('moves a round onto the current version only for a tee added since it started', () => {
    const added = withScoringChange(course, withTee(course, 'red', () => ({})));
    const round: Round = { ...makeTestRound({ scores: [] }), courseVersion: 1 };
    expect(forTee(round, added, 'red')).toEqual({ ...round, courseVersion: 2 });
    expect(forTee(round, added, 'white')).toBe(round);
    expect(forTee(round, added, 'nowhere')).toBe(round);
    const posted: Round = { ...round, status: 'completed' };
    expect(forTee(posted, added, 'red')).toBe(posted);
  });

  describe('a posted round never changes when its course does', () => {
    const group = makeTestGroup(2);
    // The second player gets one pop, on the hardest hole: the second (stroke index 1).
    const posted: Round = {
      ...makeTestRound({ scores: [flat(4), [5, 5, ...flat(4).slice(2)]], pops: [0, 1], games: { skins: { on: true, stake: 100 } } }),
      courseVersion: 1,
      status: 'completed',
      completedAt: 1,
    };
    // A stroke index swap that moves the pop, and a par change, in one edit.
    const later = edited(course, (holes) => swapFirstTwo(holes).map((h, i) => (i === 2 ? { ...h, par: h.par + 1 } : h)));

    it('settles from the tees it was played on', () => {
      const before = settleRound(posted, course, group.players);
      expect(settleRound(posted, later, group.players)).toEqual(before);
      // The same scores on the new version settle differently: the pop moved to the first hole.
      expect(settleRound({ ...posted, courseVersion: 2 }, later, group.players)).not.toEqual(before);
    });

    it('leaves the season ledger as it was, while a round started after the change plays the new values', () => {
      const next: Round = { ...posted, id: 'next', courseVersion: currentVersion(later) };
      const before = buildSeason(group, [posted], [course]);
      expect(buildSeason(group, [posted], [later])).toEqual(before);
      expect(buildSeason(group, [posted, next], [later])).not.toEqual(buildSeason(group, [posted, { ...next, courseVersion: 1 }], [later]));
    });

    it('keeps a posted outing\'s field pots on the version its groups started on', () => {
      const { outing, rounds, course: field, roster } = makeTestOuting({
        cards: flatField(8, 4).map((card, i) => (i === 1 ? [5, ...card.slice(1)] : card)),
        pops: [0, 1],
        fieldGames: { fieldSkins: { on: true, buyIn: 1000, useNet: true } },
      });
      const onFirst = rounds.map((r) => ({ ...r, courseVersion: 1 }));
      const changed = edited(field, swapFirstTwo);
      expect(settleOuting(outing, onFirst, changed, roster).fieldGames).toEqual(settleOuting(outing, onFirst, field, roster).fieldGames);
    });

    it('holds for any later change to the card, slope or rating', () => {
      const holes = course.tees[0].holes;
      fc.assert(
        fc.property(
          fc.array(fc.integer({ min: 3, max: 6 }), { minLength: holes.length, maxLength: holes.length }),
          fc.shuffledSubarray(holes.map((h) => h.strokeIndex), { minLength: holes.length, maxLength: holes.length }),
          fc.option(fc.integer({ min: 55, max: 155 })),
          fc.option(fc.double({ min: 60, max: 80, noNaN: true })),
          fc.boolean(),
          (pars, indexes, slope, rating, addTee) => {
            const once = withScoringChange(course, {
              ...course,
              tees: [{ ...course.tees[0], slope, rating, holes: holes.map((h, i) => ({ ...h, par: pars[i], strokeIndex: indexes[i] })) }],
            });
            const twice = addTee ? withScoringChange(once, withTee(once, 'red', (h) => ({ par: h.par + 1 }))) : once;
            expect(settleRound(posted, twice, group.players)).toEqual(settleRound(posted, course, group.players));
          },
        ),
      );
    });
  });
});
