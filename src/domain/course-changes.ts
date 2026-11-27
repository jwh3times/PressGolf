/**
 * Changes to a course someone else created (#381), as the server takes them.
 *
 * A golfer edits someone else's course as a draft, and sends it whole. `courseChanges`
 * turns the draft into the list `edit_course` takes (supabase/migrations, course
 * suggestions): each change names what it changes, the value it replaces (`from`) and
 * the new one (`to`). The server puts a filled gap or an added tee straight in, and
 * the rest waits for the admin as one suggestion. `fillsGap` says which is which, as
 * the server does, so the phone can say so before it sends.
 */
import type { Course, Green, LatLng, Tee } from './types';

export type CourseChange =
  | { kind: 'course'; field: 'name'; from: string; to: string }
  | { kind: 'course'; field: 'location'; from: LatLng | null; to: LatLng | null }
  | { kind: 'tee'; tee: string; field: 'name'; from: string; to: string }
  | { kind: 'tee'; tee: string; field: 'slope' | 'rating'; from: number | null; to: number | null }
  | { kind: 'hole'; tee: string; number: number; field: 'par' | 'strokeIndex' | 'yards'; from: number; to: number }
  | { kind: 'green'; number: number; from: Green | null; to: Green }
  | { kind: 'newTee'; tee: Tee };

const HOLE_FIELDS = ['par', 'strokeIndex', 'yards'] as const;

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Every change from `before` to `draft`, in course, tee, hole and green order. */
export function courseChanges(before: Course, draft: Course): CourseChange[] {
  const out: CourseChange[] = [];
  if (draft.name !== before.name) out.push({ kind: 'course', field: 'name', from: before.name, to: draft.name });
  if (!same(draft.location ?? null, before.location ?? null)) {
    out.push({ kind: 'course', field: 'location', from: before.location ?? null, to: draft.location ?? null });
  }
  for (const tee of draft.tees) {
    const was = before.tees.find((t) => t.id === tee.id);
    if (!was) {
      out.push({ kind: 'newTee', tee });
      continue;
    }
    if (tee.name !== was.name) out.push({ kind: 'tee', tee: tee.id, field: 'name', from: was.name, to: tee.name });
    for (const field of ['slope', 'rating'] as const) {
      if (tee[field] !== was[field]) out.push({ kind: 'tee', tee: tee.id, field, from: was[field], to: tee[field] });
    }
    for (const hole of tee.holes) {
      const old = was.holes.find((h) => h.number === hole.number);
      if (!old) continue;
      for (const field of HOLE_FIELDS) {
        if (hole[field] !== old[field]) out.push({ kind: 'hole', tee: tee.id, number: hole.number, field, from: old[field], to: hole[field] });
      }
    }
  }
  for (const green of draft.greens) {
    const was = before.greens.find((g) => g.number === green.number) ?? null;
    if (!same(green, was)) out.push({ kind: 'green', number: green.number, from: was, to: green });
  }
  return out;
}

const FIELD_NAMES = { par: 'par', strokeIndex: 'stroke index', yards: 'yards', slope: 'slope', rating: 'rating', name: 'name' } as const;

const shown = (value: unknown) => (value === null || value === undefined ? 'none' : String(value));

/**
 * A change in a line a golfer reads: "Hole 4 par: 4 → 5". `teeName` gives a tee's name
 * from its id, for a change that names one; it falls back to the id.
 */
export function describeChange(change: CourseChange, teeName: (id: string) => string = (id) => id): string {
  switch (change.kind) {
    case 'course':
      return change.field === 'name'
        ? `Course name: ${change.from} → ${change.to}`
        : `Location: ${change.from ? 'moved' : 'set'}`;
    case 'tee':
      return `${teeName(change.tee)} tee ${FIELD_NAMES[change.field]}: ${shown(change.from)} → ${shown(change.to)}`;
    case 'hole':
      return `${teeName(change.tee)} tee, hole ${change.number} ${FIELD_NAMES[change.field]}: ${change.from} → ${change.to}`;
    case 'green':
      return `Green ${change.number}: ${change.from ? 'moved' : 'placed'}`;
    case 'newTee':
      return `New tee: ${change.tee.name}`;
  }
}

/** Whether the server puts a change straight in: an added tee, or a value nobody had set. */
export function fillsGap(change: CourseChange): boolean {
  if (change.kind === 'newTee') return true;
  if (change.from !== null) return false;
  return change.kind === 'green' || (change.kind === 'course' && change.field === 'location') || change.kind === 'tee';
}
