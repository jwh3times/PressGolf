/**
 * Core domain model for Press.
 *
 * Money is stored as integer cents everywhere inside the engine. Floating point
 * dollars drift once you start halving team stakes and multiplying Vegas points,
 * and a golf bet that is off by a penny is an argument in the parking lot.
 */

export type PlayerId = string;
export type CourseId = string;
export type GroupId = string;
export type RoundId = string;

/** Integer cents. Always. */
export type Cents = number;

export interface Player {
  id: PlayerId;
  name: string;
  /** 2-3 characters shown in the avatar bubble. Derived from name if left blank. */
  initials: string;
  /** Hex colour used for the avatar ring and money figures. */
  color: string;
}

export interface Group {
  id: GroupId;
  name: string;
  players: Player[];
  /** Whose phone this is. Drives "you" framing, press buttons and the settle headline. */
  youId: PlayerId | null;
  /** Default home course for new rounds. */
  defaultCourseId: CourseId | null;
  /** Free text shown under the group name on Home, e.g. "Pine Hollow · 7:40 tee". */
  subtitle: string;
  createdAt: number;
}

export interface Hole {
  /** 1-based hole number. */
  number: number;
  par: number;
  /** Stroke index, 1 = hardest. Drives where pops land. */
  strokeIndex: number;
  yards: number;
}

export interface Course {
  id: CourseId;
  name: string;
  holes: Hole[];
  createdAt: number;
}

// ─── Games ──────────────────────────────────────────────────────────────────

export type GameKey =
  | 'nassau'
  | 'skins'
  | 'junk'
  | 'stableford'
  | 'bestball'
  | 'wolf'
  | 'vegas'
  | 'match'
  | 'stroke';

export const GAME_KEYS: GameKey[] = [
  'nassau',
  'skins',
  'junk',
  'stableford',
  'bestball',
  'wolf',
  'vegas',
  'match',
  'stroke',
];

/** A two-player side. Four-ball and Vegas both run off these. */
export type Team = [PlayerId, PlayerId];

/** A single 1v1 match play pairing. */
export type Pairing = [PlayerId, PlayerId];

export interface GameConfig {
  on: boolean;
  /** Stake in cents. Meaning is per-game — see FORMATS[key].stakeLabel. */
  stake: Cents;
}

export interface GamesConfig {
  nassau: GameConfig;
  skins: GameConfig;
  junk: GameConfig;
  stableford: GameConfig;
  bestball: GameConfig;
  wolf: GameConfig;
  vegas: GameConfig;
  match: GameConfig;
  stroke: GameConfig;
}

/** Extra settings that only some formats need. */
export interface GameOptions {
  /** Sides for four-ball and Vegas. Empty until the group sets them. */
  teams: Team[];
  /** 1v1 match play pairings. Defaults to every pair (round robin). */
  matchPairings: Pairing[];
  /** What a lone wolf wins or loses per opponent, as a multiple of the stake. */
  wolfLoneMultiplier: number;
  /** Vegas: flip the opposing team's number when someone makes birdie or better. */
  vegasFlipOnBirdie: boolean;
  /** Stableford points by score-to-par, worst to best. */
  stablefordPoints: { eagleOrBetter: number; birdie: number; par: number; bogey: number; worse: number };
}

// ─── Round state ────────────────────────────────────────────────────────────

/** Junk a player can claim on a hole. Birdies and eagles are detected, not tapped. */
export type JunkKind = 'greenie' | 'sandie' | 'chipIn' | 'polie';

export type AutoJunkKind = 'birdie' | 'eagle';

/** Key format: `${holeIndex}:${playerId}:${kind}` */
export type JunkMap = Record<string, true>;

export interface Press {
  id: string;
  /** The player who fired the press. */
  by: PlayerId;
  /** Their opponent. */
  against: PlayerId;
  /** 0-based hole the press starts on. */
  startHole: number;
  /** 0-based hole the press runs through — the end of the nine it started on. */
  endHole: number;
  stake: Cents;
}

/** Who the Wolf took on a given hole. */
export interface WolfPick {
  /** 0-based hole index. */
  hole: number;
  /** The wolf for this hole — derived from tee order, but stored so order changes don't rewrite history. */
  wolf: PlayerId;
  /** null means lone wolf. */
  partner: PlayerId | null;
}

export type RoundStatus = 'active' | 'completed';

export interface Round {
  id: RoundId;
  groupId: GroupId;
  courseId: CourseId;
  /** Snapshot of who actually teed it up, in tee order. Wolf rotates through this. */
  playerIds: PlayerId[];
  /** Pops (strokes received) per player, applied to the lowest stroke indexes first. */
  pops: Record<PlayerId, number>;
  /** `scores[playerId][holeIndex]`, null when not yet entered. */
  scores: Record<PlayerId, (number | null)[]>;
  junk: JunkMap;
  presses: Press[];
  wolfPicks: WolfPick[];
  games: GamesConfig;
  options: GameOptions;
  status: RoundStatus;
  startedAt: number;
  completedAt: number | null;
}

// ─── Engine output ──────────────────────────────────────────────────────────

export interface SettlementLine {
  text: string;
  /** Display amount, already formatted. Empty string renders nothing. */
  amount: string;
  /** 'won' highlights in green, 'pending' greys it out. */
  tone: 'won' | 'pending';
}

export interface GameResult {
  key: GameKey;
  name: string;
  detail: string;
  stakeLabel: string;
  color: string;
  lines: SettlementLine[];
  /** Skins only: how many skins are riding into the next hole. */
  carry?: number;
  /** True when the format is on but cannot settle yet (e.g. Wolf with no picks made). */
  blocked?: boolean;
  blockedReason?: string;
}

export interface Transfer {
  from: PlayerId;
  to: PlayerId;
  amount: Cents;
}

export interface Settlement {
  /** matrix[from][to] = cents owed. */
  matrix: Record<PlayerId, Record<PlayerId, Cents>>;
  /** Positive = up for the round. */
  net: Record<PlayerId, Cents>;
  games: GameResult[];
  transfers: Transfer[];
  /** Holes with a complete set of scores. */
  thru: number;
}

// ─── Season ─────────────────────────────────────────────────────────────────

export interface SeasonEntry {
  playerId: PlayerId;
  net: Cents;
  roundsPlayed: number;
}

export interface AppSettings {
  /** When true the app reads and writes the demo dataset instead of live data. */
  demoMode: boolean;
  activeGroupId: GroupId | null;
  activeRoundId: RoundId | null;
}

export interface AppData {
  groups: Group[];
  courses: Course[];
  rounds: Round[];
  settings: AppSettings;
}
