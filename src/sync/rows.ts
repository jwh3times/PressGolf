/**
 * Domain objects to database rows, and back.
 *
 * The phone thinks in documents — a Round carries its scores, its junk and its
 * presses inside it. The database thinks in rows, one per thing that can
 * change independently, because that is what lets two phones edit one card
 * without overwriting each other.
 *
 * This module is the whole of the translation, and it is deliberately free of
 * React, of Supabase and of any network: it takes plain data and returns plain
 * data, so the mapping can be tested by round-tripping it rather than by
 * watching a database.
 *
 * Every cell of a scorecard gets a row, including the empty ones. An unplayed
 * hole is not the same as a hole scored zero, and writing the empty rows is
 * what preserves the shape of the card — how many holes it has — when it comes
 * back down.
 */
import {
  FIELD_GAME_KEYS,
  GAME_KEYS,
  type Course,
  type FieldGameConfig,
  type FieldGameKey,
  type GameOptions,
  type GamesConfig,
  type Group,
  type Outing,
  type Round,
  type RoundStatus,
  type TeeFormat,
  type UnclaimedRule,
} from '../domain/types';

// ─── Row shapes, mirroring supabase/migrations ──────────────────────────────

export interface GroupRow {
  id: string;
  name: string;
  you_id: string | null;
  default_course_id: string | null;
  subtitle: string;
  created_at: number;
}

export interface PlayerRow {
  id: string;
  group_id: string;
  name: string;
  initials: string;
  color: string;
  sort_order: number;
}

export interface CourseRow {
  id: string;
  name: string;
  created_at: number;
}

export interface HoleRow {
  course_id: string;
  number: number;
  par: number;
  stroke_index: number;
  yards: number;
}

export interface RoundRow {
  id: string;
  group_id: string;
  course_id: string;
  outing_id: string | null;
  name: string;
  tee_time: string | null;
  status: RoundStatus;
  started_at: number;
  completed_at: number | null;
}

export interface RoundPlayerRow {
  round_id: string;
  player_id: string;
  tee_order: number;
  pops: number;
}

export interface ScoreRow {
  round_id: string;
  player_id: string;
  hole: number;
  strokes: number | null;
}

export interface JunkRow {
  round_id: string;
  hole: number;
  player_id: string;
  kind: string;
}

export interface PressRow {
  id: string;
  round_id: string;
  by_player: string;
  against_player: string;
  start_hole: number;
  end_hole: number;
  stake: number;
}

export interface WolfPickRow {
  round_id: string;
  hole: number;
  wolf: string;
  partner: string | null;
}

export interface RoundGameRow {
  round_id: string;
  key: string;
  enabled: boolean;
  stake: number;
}

export interface RoundOptionsRow {
  round_id: string;
  wolf_lone_multiplier: number;
  vegas_flip_on_birdie: boolean;
  stableford_eagle_or_better: number;
  stableford_birdie: number;
  stableford_par: number;
  stableford_bogey: number;
  stableford_worse: number;
}

export interface SideRow {
  round_id: string;
  slot: number;
  player_a: string;
  player_b: string;
}

export interface OutingRow {
  id: string;
  group_id: string;
  course_id: string;
  name: string;
  date: number;
  tee_format: TeeFormat;
  status: RoundStatus;
  started_at: number;
  completed_at: number | null;
}

export interface OutingFieldRow {
  outing_id: string;
  player_id: string;
  sort_order: number;
}

export interface OutingFieldGameRow {
  outing_id: string;
  key: string;
  enabled: boolean;
  buy_in: number;
  use_net: boolean;
  carry: boolean;
  unclaimed: UnclaimedRule;
}

export interface OutingFieldEntrantRow {
  outing_id: string;
  key: string;
  player_id: string;
}

/** Everything one account owns, as rows. The unit the sync layer moves. */
export interface Snapshot {
  groups: GroupRow[];
  players: PlayerRow[];
  courses: CourseRow[];
  holes: HoleRow[];
  rounds: RoundRow[];
  round_players: RoundPlayerRow[];
  scores: ScoreRow[];
  junk: JunkRow[];
  presses: PressRow[];
  wolf_picks: WolfPickRow[];
  round_games: RoundGameRow[];
  round_options: RoundOptionsRow[];
  round_teams: SideRow[];
  round_pairings: SideRow[];
  outings: OutingRow[];
  outing_field: OutingFieldRow[];
  outing_field_games: OutingFieldGameRow[];
  outing_field_entrants: OutingFieldEntrantRow[];
}

/** The document-shaped data the app actually holds. */
export interface Documents {
  groups: Group[];
  courses: Course[];
  rounds: Round[];
  outings: Outing[];
}

export const TABLES: (keyof Snapshot)[] = [
  // Parents first: a child row cannot be inserted before the row it references.
  'groups',
  'players',
  'courses',
  'holes',
  'outings',
  'outing_field',
  'outing_field_games',
  'outing_field_entrants',
  'rounds',
  'round_players',
  'scores',
  'junk',
  'presses',
  'wolf_picks',
  'round_games',
  'round_options',
  'round_teams',
  'round_pairings',
];

export function emptySnapshot(): Snapshot {
  return {
    groups: [],
    players: [],
    courses: [],
    holes: [],
    rounds: [],
    round_players: [],
    scores: [],
    junk: [],
    presses: [],
    wolf_picks: [],
    round_games: [],
    round_options: [],
    round_teams: [],
    round_pairings: [],
    outings: [],
    outing_field: [],
    outing_field_games: [],
    outing_field_entrants: [],
  };
}

// ─── Down: documents to rows ────────────────────────────────────────────────

export function toRows(documents: Documents): Snapshot {
  const out = emptySnapshot();

  for (const group of documents.groups) {
    out.groups.push({
      id: group.id,
      name: group.name,
      you_id: group.youId,
      default_course_id: group.defaultCourseId,
      subtitle: group.subtitle,
      created_at: group.createdAt,
    });
    group.players.forEach((player, index) => {
      out.players.push({
        id: player.id,
        group_id: group.id,
        name: player.name,
        initials: player.initials,
        color: player.color,
        sort_order: index,
      });
    });
  }

  for (const course of documents.courses) {
    out.courses.push({ id: course.id, name: course.name, created_at: course.createdAt });
    for (const hole of course.holes) {
      out.holes.push({
        course_id: course.id,
        number: hole.number,
        par: hole.par,
        stroke_index: hole.strokeIndex,
        yards: hole.yards,
      });
    }
  }

  for (const round of documents.rounds) {
    out.rounds.push({
      id: round.id,
      group_id: round.groupId,
      course_id: round.courseId,
      outing_id: round.outingId,
      name: round.name,
      tee_time: round.teeTime,
      status: round.status,
      started_at: round.startedAt,
      completed_at: round.completedAt,
    });

    round.playerIds.forEach((playerId, index) => {
      out.round_players.push({
        round_id: round.id,
        player_id: playerId,
        tee_order: index,
        pops: round.pops[playerId] ?? 0,
      });
      const card = round.scores[playerId] ?? [];
      card.forEach((strokes, hole) => {
        out.scores.push({ round_id: round.id, player_id: playerId, hole, strokes });
      });
    });

    for (const key of Object.keys(round.junk)) {
      // `${holeIndex}:${playerId}:${kind}`, and a player id may itself contain
      // a colon, so the ends are taken first and the middle is whatever is left.
      const first = key.indexOf(':');
      const last = key.lastIndexOf(':');
      if (first < 1 || last <= first) continue;
      out.junk.push({
        round_id: round.id,
        hole: Number(key.slice(0, first)),
        player_id: key.slice(first + 1, last),
        kind: key.slice(last + 1),
      });
    }

    for (const press of round.presses) {
      out.presses.push({
        id: press.id,
        round_id: round.id,
        by_player: press.by,
        against_player: press.against,
        start_hole: press.startHole,
        end_hole: press.endHole,
        stake: press.stake,
      });
    }

    for (const pick of round.wolfPicks) {
      out.wolf_picks.push({
        round_id: round.id,
        hole: pick.hole,
        wolf: pick.wolf,
        partner: pick.partner,
      });
    }

    for (const key of GAME_KEYS) {
      const game = round.games[key];
      out.round_games.push({
        round_id: round.id,
        key,
        enabled: game.on,
        stake: game.stake,
      });
    }

    const options = round.options;
    out.round_options.push({
      round_id: round.id,
      wolf_lone_multiplier: options.wolfLoneMultiplier,
      vegas_flip_on_birdie: options.vegasFlipOnBirdie,
      stableford_eagle_or_better: options.stablefordPoints.eagleOrBetter,
      stableford_birdie: options.stablefordPoints.birdie,
      stableford_par: options.stablefordPoints.par,
      stableford_bogey: options.stablefordPoints.bogey,
      stableford_worse: options.stablefordPoints.worse,
    });

    options.teams.forEach(([a, b], slot) => {
      out.round_teams.push({ round_id: round.id, slot, player_a: a, player_b: b });
    });
    options.matchPairings.forEach(([a, b], slot) => {
      out.round_pairings.push({ round_id: round.id, slot, player_a: a, player_b: b });
    });
  }

  for (const outing of documents.outings) {
    out.outings.push({
      id: outing.id,
      group_id: outing.groupId,
      course_id: outing.courseId,
      name: outing.name,
      date: outing.date,
      tee_format: outing.teeFormat,
      status: outing.status,
      started_at: outing.startedAt,
      completed_at: outing.completedAt,
    });
    outing.field.forEach((playerId, index) => {
      out.outing_field.push({ outing_id: outing.id, player_id: playerId, sort_order: index });
    });
    for (const key of FIELD_GAME_KEYS) {
      const game = outing.fieldGames[key];
      out.outing_field_games.push({
        outing_id: outing.id,
        key,
        enabled: game.on,
        buy_in: game.buyIn,
        use_net: game.useNet,
        carry: game.carry,
        unclaimed: game.unclaimed,
      });
      for (const playerId of game.entrants) {
        out.outing_field_entrants.push({ outing_id: outing.id, key, player_id: playerId });
      }
    }
  }

  return out;
}

// ─── Up: rows to documents ──────────────────────────────────────────────────

function groupBy<T, K extends string>(rows: T[], key: (row: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const row of rows) {
    const k = key(row);
    const list = map.get(k);
    if (list) list.push(row);
    else map.set(k, [row]);
  }
  return map;
}

const byOrder = <T extends { sort_order: number }>(a: T, b: T) => a.sort_order - b.sort_order;

export function fromRows(snapshot: Snapshot): Documents {
  const playersByGroup = groupBy(snapshot.players, (r) => r.group_id);
  const holesByCourse = groupBy(snapshot.holes, (r) => r.course_id);
  const roundPlayers = groupBy(snapshot.round_players, (r) => r.round_id);
  const scores = groupBy(snapshot.scores, (r) => r.round_id);
  const junk = groupBy(snapshot.junk, (r) => r.round_id);
  const presses = groupBy(snapshot.presses, (r) => r.round_id);
  const picks = groupBy(snapshot.wolf_picks, (r) => r.round_id);
  const games = groupBy(snapshot.round_games, (r) => r.round_id);
  const teams = groupBy(snapshot.round_teams, (r) => r.round_id);
  const pairings = groupBy(snapshot.round_pairings, (r) => r.round_id);
  const optionsByRound = new Map(snapshot.round_options.map((r) => [r.round_id, r]));
  const field = groupBy(snapshot.outing_field, (r) => r.outing_id);
  const fieldGames = groupBy(snapshot.outing_field_games, (r) => r.outing_id);
  const entrants = groupBy(snapshot.outing_field_entrants, (r) => r.outing_id);

  const groups: Group[] = snapshot.groups.map((row) => ({
    id: row.id,
    name: row.name,
    players: (playersByGroup.get(row.id) ?? []).slice().sort(byOrder).map((p) => ({
      id: p.id,
      name: p.name,
      initials: p.initials,
      color: p.color,
    })),
    youId: row.you_id,
    defaultCourseId: row.default_course_id,
    subtitle: row.subtitle,
    createdAt: row.created_at,
  }));

  const courses: Course[] = snapshot.courses.map((row) => ({
    id: row.id,
    name: row.name,
    holes: (holesByCourse.get(row.id) ?? [])
      .slice()
      .sort((a, b) => a.number - b.number)
      .map((h) => ({ number: h.number, par: h.par, strokeIndex: h.stroke_index, yards: h.yards })),
    createdAt: row.created_at,
  }));

  const rounds: Round[] = snapshot.rounds.map((row) => {
    const entries = (roundPlayers.get(row.id) ?? []).slice().sort((a, b) => a.tee_order - b.tee_order);
    const playerIds = entries.map((e) => e.player_id);

    const pops: Record<string, number> = {};
    for (const entry of entries) pops[entry.player_id] = entry.pops;

    // Rebuild each card at the length the rows imply, so an all-empty card
    // still comes back eighteen boxes wide rather than as an empty array.
    const card: Record<string, (number | null)[]> = {};
    for (const playerId of playerIds) card[playerId] = [];
    for (const score of scores.get(row.id) ?? []) {
      const list = (card[score.player_id] ??= []);
      while (list.length <= score.hole) list.push(null);
      list[score.hole] = score.strokes;
    }

    const junkMap: Record<string, true> = {};
    for (const j of junk.get(row.id) ?? []) {
      junkMap[`${j.hole}:${j.player_id}:${j.kind}`] = true;
    }

    const gameRows = new Map((games.get(row.id) ?? []).map((g) => [g.key, g]));
    const gamesConfig = Object.fromEntries(
      GAME_KEYS.map((key) => {
        const g = gameRows.get(key);
        return [key, { on: g?.enabled ?? false, stake: g?.stake ?? 0 }];
      }),
    ) as unknown as GamesConfig;

    const opt = optionsByRound.get(row.id);
    const options: GameOptions = {
      teams: (teams.get(row.id) ?? [])
        .slice()
        .sort((a, b) => a.slot - b.slot)
        .map((t) => [t.player_a, t.player_b] as [string, string]),
      matchPairings: (pairings.get(row.id) ?? [])
        .slice()
        .sort((a, b) => a.slot - b.slot)
        .map((t) => [t.player_a, t.player_b] as [string, string]),
      wolfLoneMultiplier: opt?.wolf_lone_multiplier ?? 1,
      vegasFlipOnBirdie: opt?.vegas_flip_on_birdie ?? true,
      stablefordPoints: {
        eagleOrBetter: opt?.stableford_eagle_or_better ?? 4,
        birdie: opt?.stableford_birdie ?? 3,
        par: opt?.stableford_par ?? 2,
        bogey: opt?.stableford_bogey ?? 1,
        worse: opt?.stableford_worse ?? 0,
      },
    };

    return {
      id: row.id,
      groupId: row.group_id,
      courseId: row.course_id,
      outingId: row.outing_id,
      name: row.name,
      teeTime: row.tee_time,
      playerIds,
      pops,
      scores: card,
      junk: junkMap,
      presses: (presses.get(row.id) ?? []).map((p) => ({
        id: p.id,
        by: p.by_player,
        against: p.against_player,
        startHole: p.start_hole,
        endHole: p.end_hole,
        stake: p.stake,
      })),
      wolfPicks: (picks.get(row.id) ?? [])
        .slice()
        .sort((a, b) => a.hole - b.hole)
        .map((p) => ({ hole: p.hole, wolf: p.wolf, partner: p.partner })),
      games: gamesConfig,
      options,
      status: row.status,
      startedAt: row.started_at,
      completedAt: row.completed_at,
    };
  });

  const outings: Outing[] = snapshot.outings.map((row) => {
    const gameRows = new Map((fieldGames.get(row.id) ?? []).map((g) => [g.key, g]));
    const entrantRows = groupBy(entrants.get(row.id) ?? [], (r) => r.key);
    const config = (key: FieldGameKey): FieldGameConfig => {
      const g = gameRows.get(key);
      return {
        on: g?.enabled ?? false,
        buyIn: g?.buy_in ?? 0,
        entrants: (entrantRows.get(key) ?? []).map((e) => e.player_id),
        useNet: g?.use_net ?? key === 'fieldSkins',
        carry: g?.carry ?? true,
        unclaimed: g?.unclaimed ?? 'splitAmongWinners',
      };
    };
    return {
      id: row.id,
      groupId: row.group_id,
      courseId: row.course_id,
      name: row.name,
      date: row.date,
      teeFormat: row.tee_format,
      field: (field.get(row.id) ?? []).slice().sort(byOrder).map((f) => f.player_id),
      fieldGames: { fieldSkins: config('fieldSkins'), scats: config('scats') },
      roundIds: [],
      status: row.status,
      startedAt: row.started_at,
      completedAt: row.completed_at,
    };
  });

  // An outing's groups are the rounds that point at it, in tee order. Derived
  // rather than stored, so the two can never disagree about who is out.
  const orderOf = new Map(rounds.map((round, index) => [round.id, index]));
  for (const outing of outings) {
    outing.roundIds = rounds
      .filter((round) => round.outingId === outing.id)
      .sort((a, b) => (orderOf.get(a.id) ?? 0) - (orderOf.get(b.id) ?? 0))
      .map((round) => round.id);
  }

  return { groups, courses, rounds, outings };
}

/** Rows in a snapshot, for logs and for deciding whether a push is worth making. */
export function countRows(snapshot: Snapshot): number {
  return TABLES.reduce((total, table) => total + snapshot[table].length, 0);
}
