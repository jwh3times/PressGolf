import { FIELD_FORMATS } from '../../formats';
import type {
  Cents,
  FieldGameConfig,
  FieldGameKey,
  FieldGameResult,
  FieldHoleResult,
  PlayerId,
  SettlementLine,
} from '../../types';
import { money, RoundContext } from '../context';
import { Ledger, splitEvenly } from '../ledger';

/**
 * Field-wide pot games.
 *
 * Skins and scats are the same bet wearing different hats: whoever is alone at
 * the low score takes the hole, and a tie means nobody does. What differs is
 * the money.
 *
 *   Field skins — one pot, split evenly across every skin won that day. A skin
 *                 is worth nothing in particular until the last card is in.
 *   Scats       — the pot is cut into equal per-hole shares up front. Ties push
 *                 their share forward (the rabbit), so a scat after five blanks
 *                 pays six holes at once.
 *
 * Both read gross or net per the config: "only one guy made par" is a gross
 * statement, while skins have always been played net here.
 */

/** Score used to decide a hole, honouring the game's gross/net setting. */
function scoreFor(ctx: RoundContext, config: FieldGameConfig, id: PlayerId, hole: number): number | null {
  return config.useNet ? ctx.net(id, hole) : ctx.gross(id, hole);
}

/**
 * Resolves one hole across the entrants.
 *
 * A hole only counts once every entrant has posted a score. With sequential tee
 * times the last group is an hour behind the first, so most of the card is
 * legitimately unresolved for most of the day — that is reported, not guessed at.
 */
export function resolveFieldHole(
  ctx: RoundContext,
  config: FieldGameConfig,
  entrants: PlayerId[],
  hole: number,
): Omit<FieldHoleResult, 'holesClaimed'> {
  const waitingOn = entrants.filter((id) => ctx.gross(id, hole) == null);
  if (waitingOn.length > 0) {
    return { hole, winner: null, score: null, complete: false, waitingOn };
  }

  const scores = entrants
    .map((id) => ({ id, value: scoreFor(ctx, config, id, hole) }))
    .filter((s): s is { id: PlayerId; value: number } => s.value != null);

  if (scores.length === 0) {
    return { hole, winner: null, score: null, complete: false, waitingOn: entrants };
  }

  const low = Math.min(...scores.map((s) => s.value));
  const atLow = scores.filter((s) => s.value === low);
  // Alone at the low score, or it is nobody's hole.
  return {
    hole,
    winner: atLow.length === 1 ? atLow[0].id : null,
    score: low,
    complete: true,
    waitingOn: [],
  };
}

/** Entrants who are actually in this round and could post a score. */
function validEntrants(ctx: RoundContext, config: FieldGameConfig): PlayerId[] {
  return config.entrants.filter((id) => ctx.ids.includes(id));
}

export function settleFieldGame(
  key: FieldGameKey,
  ctx: RoundContext,
  ledger: Ledger,
  config: FieldGameConfig,
): FieldGameResult {
  const meta = FIELD_FORMATS[key];
  const entrants = validEntrants(ctx, config);
  const base: Omit<FieldGameResult, 'lines'> & { lines: SettlementLine[] } = {
    key,
    name: meta.name,
    detail: meta.detail,
    color: meta.color,
    pot: 0,
    buyIn: config.buyIn,
    entrants,
    payouts: {},
    holes: [],
    lines: [],
    pendingHoles: 0,
    unclaimedPot: 0,
  };

  if (entrants.length < 2) {
    return {
      ...base,
      blocked: true,
      blockedReason: 'Needs at least two people bought in.',
      lines: [{ text: 'Nobody has bought into this pot yet.', amount: '—', tone: 'pending' }],
    };
  }

  const pot = config.buyIn * entrants.length;
  // Everyone's buy-in goes in whether or not they ever win a hole.
  for (const id of entrants) ledger.contribute(id, config.buyIn);

  const resolved = Array.from({ length: ctx.holeCount }, (_, h) =>
    resolveFieldHole(ctx, config, entrants, h),
  );
  const pendingHoles = resolved.filter((r) => !r.complete).length;

  const { holes, payouts, unclaimedPot, lines } =
    key === 'scats' || config.carry
      ? allocatePerHole(ctx, config, resolved, pot, entrants.length)
      : allocateEvenly(ctx, resolved, pot);

  for (const [id, amount] of Object.entries(payouts)) ledger.award(id, amount);

  return { ...base, pot, payouts, holes, lines, pendingHoles, unclaimedPot };
}

/**
 * Field skins money: the pot divided by however many skins got won.
 *
 * Nothing pays out until the round is done, because a skin's value depends on
 * how many other skins there turn out to be. Two skins from a $400 pot is $200
 * each; eleven skins is $36.
 */
function allocateEvenly(
  ctx: RoundContext,
  resolved: Omit<FieldHoleResult, 'holesClaimed'>[],
  pot: Cents,
): { holes: FieldHoleResult[]; payouts: Record<PlayerId, Cents>; unclaimedPot: Cents; lines: SettlementLine[] } {
  const holes: FieldHoleResult[] = resolved.map((r) => ({ ...r, holesClaimed: r.winner ? 1 : 0 }));
  const winners = holes.filter((h) => h.winner);
  const everythingIn = resolved.every((r) => r.complete);
  const payouts: Record<PlayerId, Cents> = {};
  const lines: SettlementLine[] = [];

  if (!everythingIn) {
    const pending = resolved.filter((r) => !r.complete).length;
    lines.push({
      text: `${winners.length} skin${winners.length === 1 ? '' : 's'} so far · ${pending} hole${
        pending === 1 ? '' : 's'
      } still out`,
      amount: money(pot),
      tone: 'pending',
    });
    lines.push({
      text: 'A skin is worth the pot divided by the day’s total — it settles when the last card is in.',
      amount: '',
      tone: 'pending',
    });
    return { holes, payouts, unclaimedPot: pot, lines };
  }

  if (winners.length === 0) {
    lines.push({ text: 'No skins won all day — the pot carries.', amount: money(pot), tone: 'pending' });
    return { holes, payouts, unclaimedPot: pot, lines };
  }

  // Whole cents, and the remainder goes to the earliest skins rather than vanishing.
  const shares = splitEvenly(pot, winners.length);
  winners.forEach((hole, i) => {
    const id = hole.winner!;
    payouts[id] = (payouts[id] ?? 0) + shares[i];
    lines.push({
      text: `Hole ${hole.hole + 1} — ${ctx.initials(id)} alone at ${hole.score}`,
      amount: money(shares[i]),
      tone: 'won',
    });
  });

  return { holes, payouts, unclaimedPot: 0, lines };
}

/**
 * Scats money: the pot cut into equal per-hole shares, with ties carrying.
 *
 * The rabbit is the whole point — blank holes stack their share onto the next
 * hole somebody wins outright.
 */
function allocatePerHole(
  ctx: RoundContext,
  config: FieldGameConfig,
  resolved: Omit<FieldHoleResult, 'holesClaimed'>[],
  pot: Cents,
  entrantCount: number,
): { holes: FieldHoleResult[]; payouts: Record<PlayerId, Cents>; unclaimedPot: Cents; lines: SettlementLine[] } {
  const holeCount = resolved.length || 1;
  // Per-hole shares are whole cents that add back to the pot exactly.
  const perHole = splitEvenly(pot, holeCount);
  const payouts: Record<PlayerId, Cents> = {};
  const lines: SettlementLine[] = [];
  const holes: FieldHoleResult[] = [];

  let carried: Cents = 0;
  let carriedHoles = 0;
  let stalled = false; // an unfinished hole freezes everything behind it

  for (let h = 0; h < resolved.length; h++) {
    const r = resolved[h];
    const share = perHole[h];

    if (!r.complete || stalled) {
      // Money for holes the field has not finished cannot be handed out, and
      // neither can anything riding behind them — the rabbit has to pass
      // through this hole before it can reach a later one.
      stalled = true;
      holes.push({ ...r, holesClaimed: 0 });
      continue;
    }

    if (!r.winner) {
      carried += share;
      carriedHoles += 1;
      holes.push({ ...r, holesClaimed: 0 });
      continue;
    }

    const amount = share + carried;
    const claimed = carriedHoles + 1;
    payouts[r.winner] = (payouts[r.winner] ?? 0) + amount;
    holes.push({ ...r, holesClaimed: claimed });
    lines.push({
      text:
        claimed > 1
          ? `Hole ${h + 1} — ${ctx.initials(r.winner)} alone at ${r.score}, takes ${claimed} holes`
          : `Hole ${h + 1} — ${ctx.initials(r.winner)} alone at ${r.score}`,
      amount: money(amount),
      tone: 'won',
    });
    carried = 0;
    carriedHoles = 0;
  }

  // Whatever did not get handed out is still in the pot, whether it is riding
  // on the rabbit or frozen behind a hole the field has not finished. Deriving
  // it by subtraction rather than re-tallying the shares means it cannot
  // disagree with the payouts.
  const pendingCount = resolved.filter((r) => !r.complete).length;
  let unclaimedPot = pot - Object.values(payouts).reduce((a, b) => a + b, 0);

  if (pendingCount > 0) {
    lines.push({
      text: `${pendingCount} hole${pendingCount === 1 ? '' : 's'} still out — ${money(
        unclaimedPot,
      )} of the pot is riding`,
      amount: '',
      tone: 'pending',
    });
  } else if (unclaimedPot > 0) {
    const winners = Object.keys(payouts);
    if (config.unclaimed === 'splitAmongWinners' && winners.length > 0) {
      const shares = splitEvenly(unclaimedPot, winners.length);
      winners.forEach((id, i) => {
        payouts[id] += shares[i];
      });
      lines.push({
        text: `${money(unclaimedPot)} never claimed — split among the ${winners.length} who won a hole`,
        amount: money(unclaimedPot),
        tone: 'won',
      });
      unclaimedPot = 0;
    } else {
      lines.push({
        text:
          winners.length === 0
            ? 'Nobody won a hole all day — the whole pot carries.'
            : `${money(unclaimedPot)} still on the rabbit at the last hole — carries.`,
        amount: money(unclaimedPot),
        tone: 'pending',
      });
    }
  }

  if (lines.length === 0) {
    lines.push({
      text: `${entrantCount} in at ${money(config.buyIn)} — nothing decided yet.`,
      amount: money(pot),
      tone: 'pending',
    });
  }

  return { holes, payouts, unclaimedPot, lines };
}
