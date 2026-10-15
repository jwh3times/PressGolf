import { Platform } from 'react-native';
import type { LatLng } from '../domain/types';
import type { OsmElement } from './greens';

/**
 * The two public OpenStreetMap services the greens import uses: Nominatim to
 * find a course by name, Overpass to read its holes and greens.
 *
 * Both are free and run by volunteers, on conditions: requests that a person
 * asked for (one search per tap, never search-as-you-type), an identifying
 * User-Agent, at most one a second, and the data credited wherever it shows.
 * Each URL is a constant so the app can move to another server if asked to.
 * https://operations.osmfoundation.org/policies/nominatim/
 */
export const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
/**
 * Public Overpass servers, tried in turn. Each is a few volunteer machines that
 * are often slow and sometimes briefly down, and one being busy says nothing
 * about the next. The list lives on the OpenStreetMap wiki:
 * https://wiki.openstreetmap.org/wiki/Overpass_API#Public_Overpass_API_instances
 */
export const OVERPASS_URLS = [
  'https://overpass-api.de/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];
/**
 * The app names itself to the servers. A browser names itself, and setting the
 * header there would make every request a cross-origin preflight, which a
 * server that doesn't list the header (maps.mail.ru) refuses.
 */
const IDENTIFY: Record<string, string> =
  Platform.OS === 'web' ? {} : { 'User-Agent': 'PressGolf/1.0 (https://github.com/jwh3times/PressGolf)' };
const SEARCH_TIMEOUT_MS = 30_000;
/** A loaded Overpass server can queue a small query for 40 seconds before answering it. */
export const OVERPASS_ATTEMPT_MS = 60_000;
/** How long the import keeps trying servers before saying OpenStreetMap is busy. */
export const OVERPASS_GIVE_UP_MS = 120_000;
/** The pause before trying the next server. */
export const OVERPASS_SPACING_MS = 2000;

export interface CourseMatch {
  osmType: 'way' | 'relation';
  osmId: number;
  name: string;
  /** Town, region and country, to tell two courses of the same name apart. */
  place: string;
  /** Roughly the middle of the course, for putting a map over it. */
  center: LatLng | null;
}

interface NominatimResult {
  osm_type: string;
  osm_id: number;
  /** Nominatim gives coordinates as strings. */
  lat?: string;
  lon?: string;
  category?: string;
  type?: string;
  name?: string;
  display_name?: string;
  address?: Record<string, string>;
}

type Fetch = typeof fetch;

/**
 * Something the person can act on: the server is busy or slow, or can't be
 * reached. `passing` is true when another try, or another server, might do.
 */
export class OsmUnavailable extends Error {
  readonly passing: boolean;
  readonly offline: boolean;

  constructor(message: string, passing = false, offline = false) {
    super(message);
    this.passing = passing;
    this.offline = offline;
  }
}

const BUSY = 'OpenStreetMap is busy. Try again in a few minutes.';
const SLOW = 'OpenStreetMap is taking too long to answer. Try again in a few minutes.';
// A browser reports a server's error page as a failed request too, so this can't say which.
const OFFLINE = 'Couldn’t reach OpenStreetMap. Check the connection, or try again in a few minutes.';

async function request(fetcher: Fetch, url: string, timeoutMs: number, init: RequestInit = {}): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher(url, {
      ...init,
      headers: { ...IDENTIFY, Accept: 'application/json', ...init.headers },
      signal: controller.signal,
    });
    if (response.status === 429 || response.status >= 500) throw new OsmUnavailable(BUSY, true);
    if (!response.ok) throw new OsmUnavailable(`OpenStreetMap answered ${response.status}. Try again later.`);
    return await response.json();
  } catch (error) {
    if (error instanceof OsmUnavailable) throw error;
    if (controller.signal.aborted) throw new OsmUnavailable(SLOW, true);
    throw new OsmUnavailable(OFFLINE, true, true);
  } finally {
    clearTimeout(timer);
  }
}

function placeOf(address: Record<string, string> = {}): string {
  const town = address.city ?? address.town ?? address.village ?? address.hamlet ?? address.county;
  return [town, address.state ?? address.region, address.country].filter(Boolean).join(', ');
}

/** Nominatim allows one request a second, so a second search waits this long. */
export const SEARCH_SPACING_MS = 1100;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Golf courses whose name matches, as OpenStreetMap knows them. A name alone
 * can find only a road of the same name ("Torrey Pines South"), so when it finds
 * no course it searches once more with "golf course" added.
 */
export async function findCourses(name: string, fetcher: Fetch = fetch): Promise<CourseMatch[]> {
  const found = await search(name, fetcher);
  if (found.length || /golf/i.test(name)) return found;
  await wait(SEARCH_SPACING_MS);
  return search(`${name} golf course`, fetcher);
}

async function search(q: string, fetcher: Fetch): Promise<CourseMatch[]> {
  const query = new URLSearchParams({ q, format: 'jsonv2', addressdetails: '1', limit: '10' });
  const results = (await request(fetcher, `${NOMINATIM_URL}?${query}`, SEARCH_TIMEOUT_MS)) as NominatimResult[];
  return results
    .filter((r) => r.category === 'leisure' && r.type === 'golf_course')
    .filter((r): r is NominatimResult & { osm_type: 'way' | 'relation' } => r.osm_type === 'way' || r.osm_type === 'relation')
    .map((r) => ({
      osmType: r.osm_type,
      osmId: r.osm_id,
      name: r.name || r.display_name?.split(',')[0] || 'Golf course',
      place: placeOf(r.address),
      center: r.lat && r.lon ? { lat: Number(r.lat), lng: Number(r.lon) } : null,
    }));
}

/**
 * Overpass answers a query it ran out of time or memory for with a 200 and a
 * remark, and only what it found before stopping: half a course's greens.
 */
const CUT_SHORT = /runtime error|timed out|out of memory/i;

export interface FeatureOptions {
  /** Told before each try after the first, so the screen can say it is still going. */
  onRetry?: () => void;
  fetcher?: Fetch;
}

/**
 * Every hole line and green outline inside one course's boundary. Tries each
 * Overpass server in turn, going round again while there is time, and gives up
 * at once on an answer another try won't change.
 */
export async function fetchCourseFeatures(
  match: Pick<CourseMatch, 'osmType' | 'osmId'>,
  { onRetry, fetcher = fetch }: FeatureOptions = {},
): Promise<OsmElement[]> {
  const query = `[out:json][timeout:25];
${match.osmType}(${match.osmId});map_to_area->.course;
(way["golf"="hole"](area.course);way["golf"="green"](area.course);relation["golf"="green"](area.course););
out geom tags;`;
  const giveUpAt = Date.now() + OVERPASS_GIVE_UP_MS;
  let failure: OsmUnavailable | null = null;
  for (let attempt = 0; ; attempt++) {
    if (attempt > 0) {
      if (giveUpAt - Date.now() < OVERPASS_SPACING_MS + 5000) break;
      onRetry?.();
      await wait(OVERPASS_SPACING_MS);
    }
    const timeout = Math.min(OVERPASS_ATTEMPT_MS, giveUpAt - Date.now());
    try {
      const body = (await request(fetcher, OVERPASS_URLS[attempt % OVERPASS_URLS.length], timeout, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(query)}`,
      })) as { elements?: OsmElement[]; remark?: string };
      if (body.remark && CUT_SHORT.test(body.remark)) throw new OsmUnavailable(BUSY, true);
      return body.elements ?? [];
    } catch (error) {
      if (!(error instanceof OsmUnavailable) || !error.passing) throw error;
      // A server that is busy or slow says more than one that can't be reached.
      if (!failure || failure.offline) failure = error;
    }
  }
  throw failure!;
}
