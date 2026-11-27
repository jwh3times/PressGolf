// What `read-scorecard` takes and gives back, and the checks between the model and the
// phone (#384). Plain TypeScript with no imports, so the app's Jest suite tests it as
// it is and Deno runs the same file.
//
// The model reads the card into the shape `CARD_SCHEMA` describes. Structured output
// guarantees that shape but not the numbers in it, so `draftFrom` checks every value
// itself: a par of 3 to 6, a stroke index that is one of the holes and not repeated on
// its tee, a slope of 55 to 155, a rating plausible for the hole count, yards a hole
// could be. A value that fails is null, never a guess, and the golfer types it.

export const MAX_IMAGES = 4;
/** Scans each account gets a day. The server's `take_scorecard_scan` holds the count; this is for the words. */
export const DAILY_SCANS = 10;
/** A photo, as base64, of at most about 5 MB: what the model takes for one image. */
export const MAX_IMAGE_BASE64 = 7_000_000;
export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type ImageType = (typeof IMAGE_TYPES)[number];

export interface CardImage {
  mediaType: ImageType;
  /** Base64, no data: prefix. */
  data: string;
}

/** The modes `read-scorecard` reads in. Scores (#255) comes later. */
export const MODES = ['teeCard'] as const;
export type Mode = (typeof MODES)[number];

export type Checked = { ok: true; mode: Mode; images: CardImage[] } | { ok: false; reason: string };

/** The request body, checked: a mode and one to 4 photos of one card. */
export function checkRequest(body: unknown): Checked {
  const request = (body ?? {}) as { mode?: unknown; images?: unknown };
  if (!MODES.includes(request.mode as Mode)) return { ok: false, reason: 'Say which mode to read in: teeCard.' };
  const images = Array.isArray(request.images) ? request.images : [];
  if (images.length < 1 || images.length > MAX_IMAGES) {
    return { ok: false, reason: `Send one to ${MAX_IMAGES} photos of one card.` };
  }
  const checked: CardImage[] = [];
  for (const image of images as { mediaType?: unknown; data?: unknown }[]) {
    if (!IMAGE_TYPES.includes(image?.mediaType as ImageType)) {
      return { ok: false, reason: 'A photo has to be a JPEG, PNG or WebP image.' };
    }
    // The pattern needs one character at least, so an empty photo fails it too.
    if (typeof image.data !== 'string' || !/^[A-Za-z0-9+/]+=*$/.test(image.data)) {
      return { ok: false, reason: 'A photo has to be sent as base64.' };
    }
    if (image.data.length > MAX_IMAGE_BASE64) return { ok: false, reason: 'A photo is too large: keep each under 5 MB.' };
    checked.push({ mediaType: image.mediaType as ImageType, data: image.data });
  }
  return { ok: true, mode: request.mode as Mode, images: checked };
}

const nullable = (type: 'integer' | 'number' | 'string') => ({ anyOf: [{ type }, { type: 'null' }] });
const perHole = { type: 'array', items: nullable('integer') } as const;

/** The shape the model reads a card into. Ranges aren't in it: structured output can't hold them. */
export const CARD_SCHEMA = {
  type: 'object',
  properties: {
    holeCount: nullable('integer'),
    tees: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: nullable('string'),
          slope: nullable('integer'),
          rating: nullable('number'),
          yards: perHole,
          par: perHole,
          strokeIndex: perHole,
        },
        required: ['name', 'slope', 'rating', 'yards', 'par', 'strokeIndex'],
        additionalProperties: false,
      },
    },
  },
  required: ['holeCount', 'tees'],
  additionalProperties: false,
} as const;

/** What the model is told. The checks above it are the function's, not the model's. */
export const TEE_CARD_PROMPT = [
  'These photos are of one golf scorecard: the front nine and back nine, or both sides, may be in separate photos.',
  'Read it into the schema. holeCount is the number of holes the card has, 9 or 18.',
  'Give one entry in tees for every tee row the card prints (Black, Blue, White, Red, and the like), with its name as printed and its yards for each hole, in hole order.',
  "Give each tee the par and stroke index (often labelled HCP or Handicap) rows that apply to it: a ladies' row belongs to the tees it is printed for, and a row printed once applies to every tee.",
  'Give each tee its slope and course rating where the card prints them, often as "71.2/128".',
  'Use null for anything you cannot read clearly, or that the card does not print. Never estimate or fill a value in.',
].join(' ');

export interface HoleDraft {
  number: number;
  par: number | null;
  strokeIndex: number | null;
  yards: number | null;
}

export interface TeeDraft {
  name: string | null;
  slope: number | null;
  rating: number | null;
  holes: HoleDraft[];
}

/**
 * The tees a scan read, for the golfer to check: each with its name, slope and rating
 * and its tee card, every value the photos gave and the checks passed, the rest null.
 */
export interface TeesDraft {
  holeCount: 9 | 18;
  tees: TeeDraft[];
}

/** More tee rows than any scorecard prints: past it is a misreading. */
const MAX_TEES = 12;

const integer = (value: unknown, low: number, high: number): number | null =>
  typeof value === 'number' && Number.isInteger(value) && value >= low && value <= high ? value : null;

/** Course rating to one decimal: about 55 to 85 for 18 holes, half that for 9. */
function rating(value: unknown, holeCount: 9 | 18): number | null {
  const [low, high] = holeCount === 18 ? [55, 85] : [27, 43];
  if (typeof value !== 'number' || !Number.isFinite(value) || value < low || value > high) return null;
  return Math.round(value * 10) / 10;
}

function name(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().slice(0, 40);
  return trimmed === '' ? null : trimmed;
}

/**
 * Each hole's stroke index, null where it's out of range or another hole on the tee has
 * it too. A nine-hole card often prints its indexes on the eighteen-hole scale (the odd
 * numbers, or the evens for the other nine): when every hole has one, all different and
 * all within 1 to 18, they're ranked into 1 to 9, which keeps their order.
 */
function strokeIndexes(values: unknown[], holeCount: 9 | 18): (number | null)[] {
  if (holeCount === 9) {
    const wide = Array.from({ length: 9 }, (_, i) => integer(values[i], 1, 18));
    const all = wide.filter((index): index is number => index !== null);
    // Nine different ones means every hole has one. Ones already within 1 to 9 rank to themselves.
    if (new Set(all).size === 9) {
      const order = [...all].sort((a, b) => a - b);
      return all.map((index) => order.indexOf(index) + 1);
    }
  }
  const read = Array.from({ length: holeCount }, (_, i) => integer(values[i], 1, holeCount));
  const seen = new Map<number, number>();
  for (const index of read) if (index !== null) seen.set(index, (seen.get(index) ?? 0) + 1);
  return read.map((index) => (index !== null && seen.get(index) === 1 ? index : null));
}

/** The card's hole count: as the model read it, or else the length of its hole rows, when that is 9 or 18. */
function holeCountOf(card: { holeCount?: unknown; tees?: unknown }): 9 | 18 | null {
  if (card.holeCount === 9 || card.holeCount === 18) return card.holeCount;
  const lengths = (Array.isArray(card.tees) ? (card.tees as Record<string, unknown>[]) : []).flatMap((tee) =>
    ['par', 'strokeIndex', 'yards'].map((key) => (Array.isArray(tee?.[key]) ? (tee[key] as unknown[]).length : 0)),
  );
  const longest = Math.max(0, ...lengths);
  return longest === 9 || longest === 18 ? longest : null;
}

/**
 * The model's reading as a draft of the card's tees, checked. Null when it isn't a
 * scorecard at all: no tee, or no way to tell 9 holes from 18.
 */
export function draftFrom(reading: unknown): TeesDraft | null {
  const card = (reading ?? {}) as { holeCount?: unknown; tees?: unknown };
  const holeCount = holeCountOf(card);
  if (holeCount === null || !Array.isArray(card.tees) || card.tees.length === 0) return null;
  const tees = (card.tees as Record<string, unknown>[]).slice(0, MAX_TEES).map((tee): TeeDraft => {
    const perHoleValues = (key: string) => (Array.isArray(tee?.[key]) ? (tee[key] as unknown[]) : []);
    const indexes = strokeIndexes(perHoleValues('strokeIndex'), holeCount);
    return {
      name: name(tee?.name),
      slope: integer(tee?.slope, 55, 155),
      rating: rating(tee?.rating, holeCount),
      holes: Array.from({ length: holeCount }, (_, i) => ({
        number: i + 1,
        par: integer(perHoleValues('par')[i], 3, 6),
        strokeIndex: indexes[i],
        yards: integer(perHoleValues('yards')[i], 40, 750),
      })),
    };
  });
  return { holeCount, tees };
}
