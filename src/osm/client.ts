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
export const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
const USER_AGENT = 'PressGolf/1.0 (https://github.com/jwh3times/PressGolf)';
const TIMEOUT_MS = 30_000;

export interface CourseMatch {
  osmType: 'way' | 'relation';
  osmId: number;
  name: string;
  /** Town, region and country, to tell two courses of the same name apart. */
  place: string;
}

interface NominatimResult {
  osm_type: string;
  osm_id: number;
  category?: string;
  type?: string;
  name?: string;
  display_name?: string;
  address?: Record<string, string>;
}

type Fetch = typeof fetch;

/** Something the person can act on: the server is busy, or unreachable. */
export class OsmUnavailable extends Error {}

async function request(fetcher: Fetch, url: string, init: RequestInit = {}): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetcher(url, {
      ...init,
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json', ...init.headers },
      signal: controller.signal,
    });
    if (response.status === 429 || response.status === 504) {
      throw new OsmUnavailable('OpenStreetMap is busy. Try again in a minute.');
    }
    if (!response.ok) throw new OsmUnavailable(`OpenStreetMap answered ${response.status}. Try again later.`);
    return await response.json();
  } catch (error) {
    if (error instanceof OsmUnavailable) throw error;
    throw new OsmUnavailable('Couldn’t reach OpenStreetMap. Check the connection and try again.');
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
  const results = (await request(fetcher, `${NOMINATIM_URL}?${query}`)) as NominatimResult[];
  return results
    .filter((r) => r.category === 'leisure' && r.type === 'golf_course')
    .filter((r): r is NominatimResult & { osm_type: 'way' | 'relation' } => r.osm_type === 'way' || r.osm_type === 'relation')
    .map((r) => ({
      osmType: r.osm_type,
      osmId: r.osm_id,
      name: r.name || r.display_name?.split(',')[0] || 'Golf course',
      place: placeOf(r.address),
    }));
}

/** Every hole line and green outline inside one course's boundary. */
export async function fetchCourseFeatures(match: Pick<CourseMatch, 'osmType' | 'osmId'>, fetcher: Fetch = fetch): Promise<OsmElement[]> {
  const query = `[out:json][timeout:25];
${match.osmType}(${match.osmId});map_to_area->.course;
(way["golf"="hole"](area.course);way["golf"="green"](area.course);relation["golf"="green"](area.course););
out geom tags;`;
  const body = (await request(fetcher, OVERPASS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `data=${encodeURIComponent(query)}`,
  })) as { elements?: OsmElement[] };
  return body.elements ?? [];
}
