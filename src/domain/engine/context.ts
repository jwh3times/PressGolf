import type { Cents, Course, Hole, Player, PlayerId, Round } from '../types';

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
  readonly holes: Hole[];

  private readonly netCache = new Map<string, number | null>();

  constructor(round: Round, course: Course, roster: Player[]) {
    this.round = round;
    this.course = course;
    this.holes = course.holes;
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

  gross(id: PlayerId, hole: number): number | null {
    const row = this.round.scores[id];
    if (!row) return null;
    const v = row[hole];
    return v == null ? null : v;
  }

  /**
   * Strokes this player receives on this hole.
   *
   * Handles handicaps above the hole count: 20 pops on an 18-hole course is one
   * shot everywhere plus a second on stroke index 1 and 2.
   */
  strokes(id: PlayerId, hole: number): number {
    const pops = this.round.pops[id] ?? 0;
    if (pops <= 0) return 0;
    const n = this.holeCount;
    if (n === 0) return 0;
    const base = Math.floor(pops / n);
    const remainder = pops % n;
    const si = this.holes[hole]?.strokeIndex ?? n;
    return base + (si <= remainder ? 1 : 0);
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

  par(hole: number): number {
    return this.holes[hole]?.par ?? 4;
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
      diff += g - this.par(h);
    }
    return diff;
  }
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
