import * as fc from 'fast-check';
import { splitIntoGroups } from '../factory';
import { DEFAULT_HOUSE_RULES, defaultGames, defaultOptions } from '../formats';
import { GAME_KEYS } from '../types';
import type { Course, Outing, Player, PlayerId, Round, WolfPick } from '../types';
import { makeTestCourse } from './helpers';

/**
 * Random rounds for the property suite.
 *
 * Every field the engine reads is drawn independently, including combinations
 * no one would set up on purpose (Vegas with six players, a press on a hole
 * nobody has scored). The engine has to settle all of them without minting or
 * losing a cent.
 */

const NAMES = ['Alice', 'Bob', 'Carol', 'Dan', 'Erin', 'Frank', 'Gail', 'Hank', 'Ivy', 'Jack', 'Kate', 'Leo'];

export function makePlayers(count: number): Player[] {
  return NAMES.slice(0, count).map((name, i) => ({
    id: `p${i}`,
    name,
    initials: name.slice(0, 2).toUpperCase(),
    color: '#8BE0AE',
    handicapIndex: null,
    handicapUpdatedAt: null,
  }));
}

export interface Generated {
  round: Round;
  course: Course;
  players: Player[];
}

const score = fc.option(fc.integer({ min: 1, max: 10 }), { freq: 8, nil: null });

/** A round for these players on this course, with any mix of games, options, presses and Wolf picks. */
export function arbRoundFor(ids: PlayerId[], course: Course, roundId = 'round1'): fc.Arbitrary<Round> {
    const holeCount = course.tees[0].holes.length;
    const playerCount = ids.length;
    const player = fc.constantFrom(...ids);
    const hole = fc.integer({ min: 0, max: holeCount - 1 });
    const endOfNine = (start: number) => (holeCount > 9 && start >= 9 ? holeCount - 1 : Math.min(8, holeCount - 1));
    const pair = fc
      .tuple(player, player)
      .filter(([a, b]) => a !== b) as fc.Arbitrary<[PlayerId, PlayerId]>;

    return fc
      .record({
        scores: fc.array(fc.array(score, { minLength: holeCount, maxLength: holeCount }), {
          minLength: playerCount,
          maxLength: playerCount,
        }),
        pops: fc.array(fc.integer({ min: -3, max: 24 }), { minLength: playerCount, maxLength: playerCount }),
        pickups: fc.uniqueArray(fc.tuple(hole, player), { maxLength: 6 }),
        junk: fc.uniqueArray(
          fc.tuple(hole, player, fc.constantFrom('greenie', 'sandie', 'chipIn', 'polie')),
          { maxLength: 6 },
        ),
        games: fc.array(fc.record({ on: fc.boolean(), stake: fc.integer({ min: 0, max: 5000 }) }), {
          minLength: GAME_KEYS.length,
          maxLength: GAME_KEYS.length,
        }),
        maxScore: fc.constantFrom('off', 'double_bogey', 'net_double_bogey' as const),
        strokes: fc.constantFrom('full', 'off_low' as const),
        allowance: fc.integer({ min: 0, max: 100 }),
        teams: fc.shuffledSubarray(ids, { minLength: playerCount, maxLength: playerCount }),
        matchPairings: fc.uniqueArray(pair, { maxLength: 4, selector: ([a, b]) => [a, b].sort().join() }),
        wolfLoneMultiplier: fc.integer({ min: 1, max: 4 }),
        vegasFlipOnBirdie: fc.boolean(),
        presses: fc.array(fc.record({ pair, startHole: hole, stake: fc.integer({ min: 0, max: 2000 }) }), {
          maxLength: 4,
        }),
        wolf: fc.array(fc.option(fc.option(player, { nil: null }), { nil: undefined }), {
          minLength: holeCount,
          maxLength: holeCount,
        }),
      })
      .map((g): Round => {
        const games = defaultGames();
        GAME_KEYS.forEach((key, i) => (games[key] = g.games[i]));
        const wolfPicks: WolfPick[] = [];
        g.wolf.forEach((choice, h) => {
          if (choice === undefined) return;
          const wolf = ids[h % ids.length];
          wolfPicks.push({ hole: h, wolf, partner: choice === wolf ? null : choice });
        });
        // Four-ball and Vegas need two sides of two; anything else plays without teams.
        const teams = playerCount === 4 ? [[g.teams[0], g.teams[1]], [g.teams[2], g.teams[3]]] : [];
        return {
          id: roundId,
          groupId: 'group1',
          courseId: course.id,
          outingId: null,
          name: 'Generated',
          teeTime: null,
          playerIds: ids,
          teeId: null,
          playerTees: {},
          pops: Object.fromEntries(ids.map((id, i) => [id, g.pops[i]])),
          handicapTees: {},
          scores: Object.fromEntries(ids.map((id, i) => [id, g.scores[i]])),
          junk: Object.fromEntries(g.junk.map(([h, id, kind]) => [`${h}:${id}:${kind}`, true as const])),
          pickups: Object.fromEntries(g.pickups.map(([h, id]) => [`${h}:${id}`, true as const])),
          presses: g.presses.map((p, i) => ({
            id: `press${i}`,
            by: p.pair[0],
            against: p.pair[1],
            startHole: p.startHole,
            endHole: endOfNine(p.startHole),
            stake: p.stake,
          })),
          wolfPicks,
          games,
          options: {
            ...defaultOptions(),
            maxScore: g.maxScore,
            strokes: g.strokes,
            allowance: g.allowance,
            teams: teams as Round['options']['teams'],
            matchPairings: g.matchPairings,
            wolfLoneMultiplier: g.wolfLoneMultiplier,
            vegasFlipOnBirdie: g.vegasFlipOnBirdie,
          },
          status: 'active',
          entry: 'live',
          startedAt: 0,
          completedAt: null,
        };
      });
}

/** A round of 2–6 players on 9 or 18 holes. */
export const arbRound: fc.Arbitrary<Generated> = fc
  .record({ holeCount: fc.constantFrom(9, 18), playerCount: fc.integer({ min: 2, max: 6 }) })
  .chain(({ holeCount, playerCount }) => {
    const players = makePlayers(playerCount);
    const course = makeTestCourse(holeCount);
    return arbRoundFor(players.map((p) => p.id), course).map((round) => ({ round, course, players }));
  });

export interface GeneratedOuting {
  outing: Outing;
  rounds: Round[];
  course: Course;
  players: Player[];
}

const arbFieldGame = (field: PlayerId[]) =>
  fc.record({
    on: fc.boolean(),
    buyIn: fc.integer({ min: 0, max: 5000 }),
    entrants: fc.subarray(field),
    useNet: fc.boolean(),
    carry: fc.boolean(),
    unclaimed: fc.constantFrom('splitAmongWinners', 'carry' as const),
  });

/** A field of 4–12 split into groups of up to four, each its own random round, plus random field pots. */
export const arbOuting: fc.Arbitrary<GeneratedOuting> = fc
  .record({ holeCount: fc.constantFrom(9, 18), fieldSize: fc.integer({ min: 4, max: 12 }) })
  .chain(({ holeCount, fieldSize }) => {
    const players = makePlayers(fieldSize);
    const field = players.map((p) => p.id);
    const course = makeTestCourse(holeCount);
    const groups = splitIntoGroups(field);
    return fc
      .record({
        rounds: fc.tuple(...groups.map((ids, i) => arbRoundFor(ids, course, `round${i}`))),
        fieldSkins: arbFieldGame(field),
        scats: arbFieldGame(field),
      })
      .map(({ rounds, fieldSkins, scats }): GeneratedOuting => {
        const outing: Outing = {
          id: 'outing1',
          groupId: 'group1',
          courseId: course.id,
          name: 'Generated outing',
          date: 0,
          teeFormat: 'sequential',
          ...DEFAULT_HOUSE_RULES,
          field,
          fieldGames: { fieldSkins, scats },
          roundIds: rounds.map((r) => r.id),
          status: 'active',
          startedAt: 0,
          completedAt: null,
        };
        return { outing, rounds: rounds.map((r) => ({ ...r, outingId: outing.id })), course, players };
      });
  });

/** Fixed seed so a CI failure reproduces locally; fast-check prints the shrunk case. */
export const PROPERTY_RUNS = { seed: 20261002, numRuns: 300 };
