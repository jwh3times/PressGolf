/**
 * Changes to someone else's course, and the admin's review of them (#381).
 *
 * Online only, unlike the rest of sync: a change to someone else's course goes to the
 * server's `edit_course` when it's sent, which puts a filled gap or an added tee
 * straight in and keeps the rest as a suggestion for the admin. A suggestion's status
 * is the server's alone, so it's read back, never kept on the phone. The library's
 * copy of the course reaches the phone with the next shared pull, a newer version
 * than the phone's.
 */
import type { CourseChange } from '../domain/course-changes';
import { getSupabase, requireUserId } from './supabase';

export type SuggestionStatus = 'waiting' | 'approved' | 'declined';

export interface Suggestion {
  id: string;
  courseId: string;
  changes: CourseChange[];
  status: SuggestionStatus;
  /** The admin's one line, with a decline. */
  reason: string | null;
  /** Why the last approval was refused: a value it replaces has changed since. */
  conflict: string | null;
  createdAt: string;
}

export interface EditResult {
  /** How many changes went straight in. */
  applied: number;
  /** The suggestion the rest became, if any. */
  suggestion: string | null;
}

function client() {
  const supabase = getSupabase();
  if (!supabase) throw new Error('This build has no server configured.');
  return supabase;
}

interface SuggestionRow {
  id: string;
  course_id: string;
  changes: CourseChange[];
  status: SuggestionStatus;
  reason: string | null;
  conflict: string | null;
  created_at: string;
}

const fromRow = (row: SuggestionRow): Suggestion => ({
  id: row.id,
  courseId: row.course_id,
  changes: row.changes,
  status: row.status,
  reason: row.reason,
  conflict: row.conflict,
  createdAt: row.created_at,
});

/** Sends changes to someone else's course. */
export async function editCourse(courseId: string, changes: CourseChange[]): Promise<EditResult> {
  const { data, error } = await client().rpc('edit_course', { target: courseId, changes });
  if (error) throw new Error(error.message);
  return data as EditResult;
}

/** Whether the signed-in account holds the admin role. */
export async function isAdmin(): Promise<boolean> {
  const { data, error } = await client().rpc('is_admin');
  if (error) throw new Error(error.message);
  return data === true;
}

/** This account's own suggestions, newest first, on one course or all. */
export async function mySuggestions(courseId?: string): Promise<Suggestion[]> {
  const supabase = client();
  const me = await requireUserId();
  let query = supabase.from('course_suggestions').select('*').eq('owner_id', me);
  if (courseId) query = query.eq('course_id', courseId);
  const { data, error } = await query.order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return ((data ?? []) as SuggestionRow[]).map(fromRow);
}

/** Every suggestion waiting for the admin, oldest first. Only the admin reads others'. */
export async function waitingSuggestions(): Promise<Suggestion[]> {
  const { data, error } = await client()
    .from('course_suggestions')
    .select('*')
    .eq('status', 'waiting')
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  return ((data ?? []) as SuggestionRow[]).map(fromRow);
}

/** Approves a suggestion whole; `conflict` when a value it replaces changed since. */
export async function approveSuggestion(id: string): Promise<'approved' | 'conflict'> {
  const { data, error } = await client().rpc('approve_suggestion', { target: id });
  if (error) throw new Error(error.message);
  return (data as { status: 'approved' | 'conflict' }).status;
}

export async function declineSuggestion(id: string, reason: string): Promise<void> {
  const { error } = await client().rpc('decline_suggestion', { target: id, why: reason });
  if (error) throw new Error(error.message);
}
