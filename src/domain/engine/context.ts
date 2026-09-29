import type { Cents, Course, Hole, Player, PlayerId, Round, Tee } from '../types';

/**
 * Everything the format calculators need, resolved once so each of them isn't
 * re-deriving pops and net scores from raw ids.
 */
export class RoundContext {
  readonly round: Round;
  readonly course: Course;
  /** In tee order. Wolf rotation and Vegas pairing both depend on this order. */
  readonly players: Player[];
  readonly ids: PlayerId[];
  /** The round's tee — what the hole header and card show. */
  readonly tee: Tee;
  /** The round tee's holes. Every tee has the same count, so this also gives the hole count. */
  readonly holes: Hole[];

  private readonly netCache = new Map<string, number | null>();

  constructor(round: Round, course: Course, roster: Player[]) {
    this.round = round;
    this.course = course;
    this.tee = course.tees.find((t) => t.id === round.teeId) ?? course.tees[0];
    this.holes = this.tee?.holes ?? [];
    // Only players actually in the round, ordered as the round recorded them.
    const byId = new Map(roster.map((p) => [p.id, p]));
    this.players = round.playerIds
      .map((id) => byId.get(id))
      .filter((p): p is Player => p != null);
    this.ids = this.players.map((p) => p.id);
  }

  get holeCount(): number {
    return this.holes.length;
  }

  player(id: PlayerId): Player | undefined {
    return this.players.find((p) => p.id === id);
  }

  name(id: PlayerId): string {
    return this.player(id)?.name ?? 'Unknown';
  }

  /** First word of the name — "Marcus (you)" reads badly mid-sentence. */
  shortName(id: PlayerId): string {
    return this.name(id).split(' ')[0];
  }

  initials(id: PlayerId): string {
    return this.player(id)?.initials ?? '??';
  }

  /** The score that counts: as written, held to the round's max-score rule. */
  gross(id: PlayerId, hole: number): number | null {
    const row = this.round.scores[id];
    if (!row) return null;
    const v = row[hole];
    const max = this.maxScore(id, hole);
    if (v == null) return this.pickedUp(id, hole) ? max : null;
    return max == null ? v : Math.min(v, max);
  }

  pickedUp(id: PlayerId, hole: number): boolean {
    return this.round.pickups[`${hole}:${id}`] === true;
  }

  /** The most this rule lets anyone take on the hole, or null when uncapped. */
  maxScore(id: PlayerId, hole: number): number | null {
    switch (this.round.options.maxScore) {
      case 'double_bogey':
        return this.par(hole, id) + 2;
      case 'net_double_bogey':
        return this.par(hole, id) + 2 + this.strokes(id, hole);
      default:
        return null;
    }
  }

  /**
   * Strokes this player receives on this hole.
   *
   * Handles handicaps above the hole count: 20 pops on an 18-hole course is one
   * shot everywhere plus a second on stroke index 1 and 2.
   *
   * Negative pops are a plus handicap: strokes given back, from the easiest
   * stroke index up, so -2 on 18 holes is one back on stroke index 18 and 17.
   */
  strokes(id: PlayerId, hole: number): number {
    const spread = popsSpread(this.round.pops[id] ?? 0, this.holeCount);
    if (!spread) return 0;
    const [from, to] = spread.extraOn;
    const si = this.strokeIndex(hole, id);
    const count = spread.each + (si >= from && si <= to ? 1 : 0);
    return spread.back && count > 0 ? -count : count;
  }

  net(id: PlayerId, hole: number): number | null {
    const key = `${id}:${hole}`;
    const hit = this.netCache.get(key);
    if (hit !== undefined) return hit;
    const g = this.gross(id, hole);
    const v = g == null ? null : g - this.strokes(id, hole);
    this.netCache.set(key, v);
    return v;
  }

  /** The tee a player is on: their own, else the round's. */
  teeFor(id: PlayerId): Tee {
    return playerTee(this.round, this.course, id);
  }

  /** Par from the player's own tee, or the round's tee when no player is given. */
  par(hole: number, id?: PlayerId): number {
    const tee = id ? this.teeFor(id) : this.tee;
    return tee?.holes[hole]?.par ?? 4;
  }

  /** Stroke index from the player's own tee, or the round's tee when no player is given. */
  strokeIndex(hole: number, id?: PlayerId): number {
    const tee = id ? this.teeFor(id) : this.tee;
    return tee?.holes[hole]?.strokeIndex ?? this.holeCount;
  }

  /** A hole only settles once every player in the round has a score on it. */
  played(hole: number): boolean {
    if (this.ids.length === 0) return false;
    return this.ids.every((id) => this.gross(id, hole) != null);
  }

  thru(): number {
    let n = 0;
    for (let h = 0; h < this.holeCount; h++) if (this.played(h)) n++;
    return n;
  }

  /** Inclusive range of hole indexes that have been fully played. */
  playedHolesIn(from: number, to: number): number[] {
    const out: number[] = [];
    for (let h = from; h <= to && h < this.holeCount; h++) if (this.played(h)) out.push(h);
    return out;
  }

  /** The front/back split. A 9-hole course has no back nine. */
  get frontRange(): [number, number] {
    return [0, Math.min(8, this.holeCount - 1)];
  }

  get backRange(): [number, number] | null {
    if (this.holeCount <= 9) return null;
    return [9, this.holeCount - 1];
  }

  /** Which nine a hole belongs to, as an inclusive range. */
  nineFor(hole: number): [number, number] {
    const back = this.backRange;
    if (back && hole >= back[0]) return back;
    return this.frontRange;
  }

  hasJunk(hole: number, id: PlayerId, kind: string): boolean {
    return this.round.junk[`${hole}:${id}:${kind}`] === true;
  }

  /** Net total against par across completed holes, e.g. -2 or +5. */
  netToPar(id: PlayerId): number {
    let diff = 0;
    for (let h = 0; h < this.holeCount; h++) {
      const g = this.gross(id, h);
      if (g == null) continue;
      diff += g - this.par(h, id);
    }
    return diff;
  }
}

/** The tee a player is on: their own, else the round's, else the course's first. */
export function playerTee(round: Round, course: Course, id: PlayerId): Tee {
  const own = round.playerTees?.[id];
  const roundTee = course.tees.find((t) => t.id === round.teeId) ?? course.tees[0];
  return (own && course.tees.find((t) => t.id === own)) || roundTee;
}

/**
 * Where a player's pops land on a card of `holeCount` holes: `each` on every
 * hole, and one more on the stroke indexes in `extraOn` (inclusive). Pops are
 * received from stroke index 1; negative pops, a plus handicap, are given
 * `back` from the easiest hole. Null for no pops.
 */
export function popsSpread(
  pops: number,
  holeCount: number,
): { each: number; extraOn: [number, number]; back: boolean } | null {
  if (pops === 0 || holeCount === 0) return null;
  const count = Math.abs(pops);
  const extra = count % holeCount;
  const back = pops < 0;
  return {
    each: Math.floor(count / holeCount),
    extraOn: back ? [holeCount - extra + 1, holeCount] : [1, extra],
    back,
  };
}

/** Formats cents for display. Negative renders with a true minus sign, not a hyphen. */
export function money(cents: Cents): string {
  const abs = Math.abs(cents);
  const dollars = abs / 100;
  const body = dollars % 1 === 0 ? dollars.toFixed(0) : dollars.toFixed(2);
  return (cents < 0 ? '−$' : '$') + body;
}

/** Same as money() but zero reads "even" and positives carry a plus. */
export function signedMoney(cents: Cents): string {
  if (cents === 0) return 'even';
  const abs = Math.abs(cents);
  const dollars = abs / 100;
  const body = dollars % 1 === 0 ? dollars.toFixed(0) : dollars.toFixed(2);
  return (cents > 0 ? '+$' : '−$') + body;
}

/** Parses "12", "12.50", "$12.50" into cents. Returns null on junk input. */
export function parseMoney(input: string): Cents | null {
  const cleaned = input.replace(/[^0-9.]/g, '');
  if (cleaned === '' || cleaned === '.') return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 100);
}
