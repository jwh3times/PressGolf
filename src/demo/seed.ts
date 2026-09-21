import { defaultGames, defaultOptions } from '../domain/formats';
import type { Course, Group, Hole, Player, PlayerId, Round } from '../domain/types';

/**
 * The Saturday Dogs at Pine Hollow — the data the design prototype was built on.
 *
 * Prior rounds are generated from a fixed seed rather than written out, so the
 * season ledger is a genuine sum of settled rounds instead of four numbers
 * somebody typed in. Same seed, same season, every launch.
 */

const PINE_HOLLOW_PAR = [4, 5, 4, 3, 4, 4, 5, 3, 4, 4, 4, 3, 5, 4, 4, 3, 4, 5];
const PINE_HOLLOW_SI = [7, 1, 11, 17, 3, 13, 5, 15, 9, 8, 2, 12, 18, 4, 14, 16, 6, 10];
const PINE_HOLLOW_YDS = [398, 540, 421, 168, 447, 382, 515, 192, 404, 410, 436, 205, 552, 398, 425, 176, 441, 528];

export const DEMO_GROUP_ID = 'demo_group';
export const DEMO_COURSE_ID = 'demo_course';
export const DEMO_ROUND_ID = 'demo_round_live';

const DEMO_PLAYERS: Player[] = [
  { id: 'demo_p1', name: 'Marcus', initials: 'MB', color: '#8BE0AE' },
  { id: 'demo_p2', name: 'Dev', initials: 'DP', color: '#E8C46A' },
  { id: 'demo_p3', name: 'T.J.', initials: 'TJ', color: '#7FB6E8' },
  { id: 'demo_p4', name: 'Big Ray', initials: 'BR', color: '#E89A7F' },
];

const DEMO_POPS: Record<PlayerId, number> = {
  demo_p1: 0,
  demo_p2: 3,
  demo_p3: 6,
  demo_p4: 11,
};

/** The live round's card, exactly as the prototype had it: through eleven holes. */
const LIVE_SCORES: Record<PlayerId, (number | null)[]> = {
  demo_p1: [4, 6, 4, 3, 5, 4, 5, 4, 4, 5, 4, null, null, null, null, null, null, null],
  demo_p2: [5, 5, 5, 4, 4, 5, 6, 3, 5, 4, 5, null, null, null, null, null, null, null],
  demo_p3: [6, 6, 4, 4, 5, 6, 5, 4, 6, 5, 6, null, null, null, null, null, null, null],
  demo_p4: [5, 7, 6, 5, 6, 5, 7, 4, 5, 6, 5, null, null, null, null, null, null, null],
};

function pineHollowHoles(): Hole[] {
  return PINE_HOLLOW_PAR.map((par, i) => ({
    number: i + 1,
    par,
    strokeIndex: PINE_HOLLOW_SI[i],
    yards: PINE_HOLLOW_YDS[i],
  }));
}

export function demoCourse(): Course {
  return { id: DEMO_COURSE_ID, name: 'Pine Hollow', holes: pineHollowHoles(), createdAt: 0 };
}

export function demoGroup(): Group {
  return {
    id: DEMO_GROUP_ID,
    name: 'Saturday Dogs',
    players: DEMO_PLAYERS.map((p) => ({ ...p })),
    youId: 'demo_p1',
    defaultCourseId: DEMO_COURSE_ID,
    subtitle: 'Pine Hollow · 7:40 tee',
    createdAt: 0,
  };
}

/** mulberry32 — small, fast, and identical on every platform. */
function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Rough scoring ability per player — lower plays better, before pops. */
const SKILL: Record<PlayerId, number> = {
  demo_p1: 0.9,
  demo_p2: 1.15,
  demo_p3: 1.35,
  demo_p4: 1.7,
};

function generateCard(rng: () => number, playerId: PlayerId): number[] {
  const skill = SKILL[playerId] ?? 1.2;
  return PINE_HOLLOW_PAR.map((par) => {
    const roll = rng();
    // Most holes land near par plus the player's usual damage; the tail gives
    // the occasional birdie and the occasional blow-up.
    let over = Math.round(skill - 0.6 + (roll - 0.5) * 2.4);
    if (roll > 0.94) over += 1;
    if (roll < 0.06) over -= 1;
    return Math.max(2, par + Math.max(-2, Math.min(4, over)));
  });
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** Eighteen settled Saturdays leading up to the live round. */
export function demoHistory(now: number): Round[] {
  const rounds: Round[] = [];
  const ids = DEMO_PLAYERS.map((p) => p.id);

  for (let week = 0; week < 18; week++) {
    const rng = seededRandom(1337 + week * 977);
    const scores: Record<PlayerId, (number | null)[]> = {};
    for (const id of ids) scores[id] = generateCard(rng, id);

    const junk: Record<string, true> = {};
    // A couple of greenies and sandies a week, deterministically placed.
    for (let i = 0; i < 3; i++) {
      const hole = Math.floor(rng() * 18);
      const player = ids[Math.floor(rng() * ids.length)];
      const kind = rng() > 0.5 ? 'greenie' : 'sandie';
      junk[`${hole}:${player}:${kind}`] = true;
    }

    const games = defaultGames();
    // The group rotates a fourth game in most weeks so the ledger has texture.
    if (week % 3 === 0) games.stableford = { on: true, stake: 500 };
    if (week % 4 === 1) games.bestball = { on: true, stake: 1000 };

    const options = defaultOptions();
    options.teams = [
      [ids[0], ids[2]],
      [ids[1], ids[3]],
    ];

    const startedAt = now - (18 - week) * WEEK_MS;
    rounds.push({
      id: `demo_round_${week}`,
      groupId: DEMO_GROUP_ID,
      courseId: DEMO_COURSE_ID,
      playerIds: ids,
      pops: { ...DEMO_POPS },
      scores,
      junk,
      presses: [],
      wolfPicks: [],
      games,
      options,
      status: 'completed',
      startedAt,
      completedAt: startedAt + 4 * 60 * 60 * 1000,
    });
  }

  return rounds;
}

/** The round in progress — week 19, through eleven. */
export function demoLiveRound(now: number): Round {
  const games = defaultGames();
  const options = defaultOptions();
  options.teams = [
    ['demo_p1', 'demo_p3'],
    ['demo_p2', 'demo_p4'],
  ];
  return {
    id: DEMO_ROUND_ID,
    groupId: DEMO_GROUP_ID,
    courseId: DEMO_COURSE_ID,
    playerIds: DEMO_PLAYERS.map((p) => p.id),
    pops: { ...DEMO_POPS },
    scores: Object.fromEntries(Object.entries(LIVE_SCORES).map(([k, v]) => [k, v.slice()])),
    junk: {},
    presses: [],
    wolfPicks: [],
    games,
    options,
    status: 'active',
    startedAt: now - 3 * 60 * 60 * 1000,
    completedAt: null,
  };
}

export function buildDemoDataset(now = Date.now()): {
  groups: Group[];
  courses: Course[];
  rounds: Round[];
  activeGroupId: string;
  activeRoundId: string;
} {
  return {
    groups: [demoGroup()],
    courses: [demoCourse()],
    rounds: [...demoHistory(now), demoLiveRound(now)],
    activeGroupId: DEMO_GROUP_ID,
    activeRoundId: DEMO_ROUND_ID,
  };
}
