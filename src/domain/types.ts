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
  /** WHS Handicap Index; a plus index is negative. Null when the player has none. */
  handicapIndex: number | null;
  /** When the index was last entered, shown beside it. */
  handicapUpdatedAt: number | null;
}

/**
 * The group's house rules. A group sets them as its default, each new round and
 * outing copies them, and an outing locks them for every group in it.
 */
export interface HouseRules {
  maxScore: MaxScoreRule;
  /** How pops are taken from handicaps. */
  strokes: StrokesMode;
  /** Percentage of each course handicap played off, e.g. 100. */
  allowance: number;
}

export interface Group extends HouseRules {
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

export type TeeId = string;

/**
 * One set of tees. Par and stroke index can differ between tees — forward tees
 * often play a par 5 as a par 4 — so each tee carries its own card. Every tee
 * on a course has the same number of holes.
 */
export interface Tee {
  id: TeeId;
  name: string;
  /** Slope rating, 55–155. Null until someone enters it. */
  slope: number | null;
  /** Course rating, e.g. 71.2. Null until someone enters it. */
  rating: number | null;
  holes: Hole[];
}

/** A point on the ground, in WGS84 degrees as GPS reports them. */
export interface LatLng {
  lat: number;
  lng: number;
}

/** Where a green's position came from: marked standing on it, placed on a map, or OpenStreetMap. */
export type GreenSource = 'marked' | 'map' | 'osm';

/**
 * Where one hole's green is. Kept per course rather than per tee: the green is
 * the same whichever tee you play from. Front and back are optional, because a
 * green marked by standing on it has only a middle.
 */
export interface Green {
  /** 1-based hole number, matching `Hole.number`. */
  number: number;
  middle: LatLng;
  front: LatLng | null;
  back: LatLng | null;
  source: GreenSource;
}

/**
 * What a feature on the course map is (#125). Water is a penalty area: `water`
 * is yellow-staked, `lateralWater` red. `courseEdge` is the mapped boundary,
 * outside which is likely out of bounds; `outOfBounds` is a line the course's
 * owner drew where the stakes are. `holeLine` runs tee to green for one hole.
 */
export type FeatureKind =
  | 'bunker'
  | 'water'
  | 'lateralWater'
  | 'fairway'
  | 'green'
  | 'tee'
  | 'courseEdge'
  | 'outOfBounds'
  | 'holeLine';

/** Where a feature came from: OpenStreetMap, or drawn on a map in the app. */
export type FeatureSource = 'osm' | 'map';

/**
 * One thing on the course map. An area's outline is a ring, stored without
 * repeating its first point; a `holeLine` or `outOfBounds` is a line, in order.
 */
export interface CourseFeature {
  /** Stable across imports: `osm:way/123`, or an id made when drawn. */
  id: string;
  kind: FeatureKind;
  /** The hole a `holeLine` belongs to; null for everything else. */
  hole: number | null;
  points: LatLng[];
  source: FeatureSource;
}

export interface Course {
  id: CourseId;
  name: string;
  /** Never empty. The first tee is the fallback for anyone without one. */
  tees: Tee[];
  /** Holes whose green is known, in hole order. Most courses start with none. */
  greens: Green[];
  /** Hazards, fairways and the like, for the hole map. Most courses start with none. */
  features: CourseFeature[];
  /** The course owner's notes on its holes (#136), in hole order. Most courses have none. */
  notes: HoleNote[];
  createdAt: number;
}

/** What the course owner wants players to know about a hole: "Blind tee shot, aim at the steeple." */
export interface HoleNote {
  number: number;
  /** Plain text, 1 to 280 characters. */
  text: string;
}

// ─── The bag ────────────────────────────────────────────────────────────────

/**
 * One club in the bag (#125): how far its owner carries it, as they typed it.
 * The bag belongs to whoever uses this phone, not to a group's player, and it
 * is never shared with an outing. The id is stable, so shots tracked later can
 * say which club hit them.
 */
export interface Club {
  id: string;
  name: string;
  /** Average carry in yards, in the air, on a full swing; null until typed. */
  carry: number | null;
}

/**
 * A round this phone has marked as a practice round (#136), where aiming
 * advice is shown. Kept on the phone only: each phone chooses for itself, and
 * it never syncs.
 */
export interface PracticeMark {
  on: boolean;
  /** Stays true once the switch has been on, so History can say advice was used. */
  ever: boolean;
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

/**
 * The most a player can take on a hole. `double_bogey` is par + 2;
 * `net_double_bogey` is the WHS rule, par + 2 + the strokes received there.
 */
export type MaxScoreRule = 'off' | 'double_bogey' | 'net_double_bogey';

/** Full handicaps, or everyone off the lowest in the round (or the whole field in an outing). */
export type StrokesMode = 'full' | 'off_low';

/** The round's copy of the house rules, plus extra settings that only some formats need. */
export interface GameOptions extends HouseRules {
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

/** Holes a player picked up on. Key format: `${holeIndex}:${playerId}` */
export type PickupMap = Record<string, true>;

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

/** How the scores arrived: hole by hole on the course, or typed from a finished paper card. */
export type RoundEntry = 'live' | 'card';

export type OutingId = string;

export interface Round {
  id: RoundId;
  groupId: GroupId;
  courseId: CourseId;
  /**
   * The outing this foursome belongs to, or null for a standalone round.
   *
   * A Round is one playing group — usually a foursome. On a normal Saturday
   * that is the whole story. For a twenty-man outing, several Rounds share an
   * Outing, which carries the field-wide games on top of them.
   */
  outingId: OutingId | null;
  /** Shown when there is more than one group out, e.g. "Group 3". */
  name: string;
  /** Free text, e.g. "8:10". Display only — ordering comes from the outing. */
  teeTime: string | null;
  /** Snapshot of who actually teed it up, in tee order. Wolf rotates through this. */
  playerIds: PlayerId[];
  /** The round's tee: what the hole header and card show. Null means the course's first tee. */
  teeId: TeeId | null;
  /** Each player's tee when it differs from the round's. */
  playerTees: Record<PlayerId, TeeId>;
  /** Pops (strokes received) per player, applied to the lowest stroke indexes first. */
  pops: Record<PlayerId, number>;
  /** The tee each player's pops were last worked out from, so a tee change can ask for a recalculation. */
  handicapTees: Record<PlayerId, TeeId>;
  /** `scores[playerId][holeIndex]`, null when not yet entered. */
  scores: Record<PlayerId, (number | null)[]>;
  junk: JunkMap;
  /** A pick-up counts as the max score, or sits the player out when there is none. */
  pickups: PickupMap;
  presses: Press[];
  wolfPicks: WolfPick[];
  games: GamesConfig;
  options: GameOptions;
  status: RoundStatus;
  /** A card round has no presses, Wolf or tapped junk — those are called live. */
  entry: RoundEntry;
  startedAt: number;
  completedAt: number | null;
}

// ─── Outings: one field, several foursomes ──────────────────────────────────

/**
 * Games played across the whole field rather than inside one foursome.
 *
 * These are pot games: everyone who opts in puts up the same buy-in, and the
 * pot is shared out among the winners. That is how big fields actually run —
 * the per-man model the foursome games use would have one skin collecting from
 * nineteen people.
 */
export type FieldGameKey = 'fieldSkins' | 'scats';

export const FIELD_GAME_KEYS: FieldGameKey[] = ['fieldSkins', 'scats'];

/** What happens to hole money nobody ever claimed. */
export type UnclaimedRule = 'splitAmongWinners' | 'carry';

export interface FieldGameConfig {
  on: boolean;
  /** What each entrant puts in, in cents. */
  buyIn: Cents;
  /** Who opted in. Not everybody in the field plays every pot. */
  entrants: PlayerId[];
  /**
   * Decide the hole on net scores (pops applied) or raw gross.
   *
   * Scats default to gross — "only one guy made par" is a gross statement, and
   * the group treats it as an extension of junk. Field skins default to net,
   * matching the foursome skins game. Neither is universal, so both are here.
   */
  useNet: boolean;
  /**
   * Ties push the hole's money forward to the next one.
   *
   * This is the "rabbit": five blank holes then a scat on the sixth means that
   * player takes all six holes' worth.
   */
  carry: boolean;
  /** What to do with money still unclaimed when the last card is in. */
  unclaimed: UnclaimedRule;
}

export interface FieldGames {
  fieldSkins: FieldGameConfig;
  scats: FieldGameConfig;
}

export type TeeFormat = 'sequential' | 'shotgun';

/**
 * A day out: one course, one field, several playing groups.
 *
 * A normal foursome round does not need one of these — a Round with a null
 * outingId stands on its own. An Outing exists when field-wide money is in
 * play, or when more than one group is out at once.
 *
 * It has one set of house rules for the whole day, so field pots compare like
 * with like: every round in it inherits them, and off the low man means the
 * lowest in the whole field.
 */
export interface Outing extends HouseRules {
  id: OutingId;
  groupId: GroupId;
  courseId: CourseId;
  name: string;
  date: number;
  teeFormat: TeeFormat;
  /** Everybody playing today, whether or not they are in a pot. */
  field: PlayerId[];
  fieldGames: FieldGames;
  /** The playing groups, in tee order. Each is a Round. */
  roundIds: RoundId[];
  status: RoundStatus;
  startedAt: number;
  completedAt: number | null;
}

/** One hole's worth of a pot game, for display and for the settlement lines. */
export interface FieldHoleResult {
  hole: number;
  /** Null when the hole was tied or is not yet complete. */
  winner: PlayerId | null;
  /** The winning score, gross or net depending on the game. */
  score: number | null;
  /** Every entrant has a score on this hole. */
  complete: boolean;
  /** How many holes' worth of money this one paid, counting the rabbit. */
  holesClaimed: number;
  /** Entrants who have not reached this hole yet. */
  waitingOn: PlayerId[];
}

export interface FieldGameResult {
  key: FieldGameKey;
  name: string;
  detail: string;
  color: string;
  /** Total money in the pot, in cents. */
  pot: Cents;
  buyIn: Cents;
  entrants: PlayerId[];
  /** What each winner actually collects, keyed by player. */
  payouts: Record<PlayerId, Cents>;
  /**
   * Buy-ins handed back, keyed by player: a finished pot nobody won a hole in,
   * when its leftovers are not set to carry. Never counted as winnings.
   */
  refunds: Record<PlayerId, Cents>;
  holes: FieldHoleResult[];
  lines: SettlementLine[];
  /** Holes still unresolved because somebody has not played them. */
  pendingHoles: number;
  /** Money that nobody has claimed yet. */
  unclaimedPot: Cents;
  blocked?: boolean;
  blockedReason?: string;
}

export interface OutingSettlement {
  /** Net across the whole day: foursome games plus field pots. */
  net: Record<PlayerId, Cents>;
  transfers: Transfer[];
  /** One entry per playing group, in tee order. */
  groups: { roundId: RoundId; name: string; games: GameResult[]; thru: number }[];
  fieldGames: FieldGameResult[];
  /** Holes the whole field has finished. */
  fieldThru: number;
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
  /** Set when the active round is one group inside a bigger day. */
  activeOutingId: OutingId | null;
}

export interface AppData {
  groups: Group[];
  courses: Course[];
  rounds: Round[];
  outings: Outing[];
  /** The phone's owner's clubs, longest first as they carry them. */
  clubs: Club[];
  /** This phone's practice-round marks, by round. Never synced. */
  practice: Record<RoundId, PracticeMark>;
  settings: AppSettings;
}
