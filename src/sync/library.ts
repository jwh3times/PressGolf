/**
 * The course library, searched (#383).
 *
 * Creating a course starts here, so nobody types in a course Press already has. The
 * search runs on the server (`search_courses`), which orders the matches nearest first
 * when the phone says where it is, and by name when it doesn't. Online only, like the
 * suggestions: the phone never mirrors the whole library, only the courses it holds.
 */
import type { Course, LatLng } from '../domain/types';
import { pullLibraryCourses } from './remote';
import { fromRows } from './rows';
import { getSupabase } from './supabase';

export interface LibraryMatch {
  id: string;
  name: string;
  location: LatLng | null;
  /** From the phone, when it said where it is and the course has a location. */
  km: number | null;
  /** In the course's tee order. */
  tees: string[];
}

interface MatchRow {
  id: string;
  name: string;
  lat: number | null;
  lng: number | null;
  km: number | null;
  tees: string[] | null;
}

/** The fewest letters worth searching for; the server answers nothing for fewer. */
export const SEARCH_MIN = 2;

/** Library courses whose name holds `term`, nearest to `near` first, or by name. */
export async function searchLibrary(term: string, near: LatLng | null): Promise<LibraryMatch[]> {
  const supabase = getSupabase();
  if (!supabase) throw new Error('This build has no server configured.');
  const { data, error } = await supabase.rpc('search_courses', {
    term,
    near_lat: near?.lat ?? null,
    near_lng: near?.lng ?? null,
  });
  if (error) throw new Error(error.message);
  return ((data ?? []) as MatchRow[]).map((row) => ({
    id: row.id,
    name: row.name,
    location: row.lat == null || row.lng == null ? null : { lat: row.lat, lng: row.lng },
    km: row.km,
    tees: row.tees ?? [],
  }));
}

/** One library course, whole, with its creator, for the phone to hold; null if it's gone. */
export async function fetchLibraryCourse(id: string): Promise<Course | null> {
  return fromRows(await pullLibraryCourses([id])).courses[0] ?? null;
}
