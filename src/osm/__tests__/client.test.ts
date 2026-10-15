import {
  fetchCourseFeatures,
  findCourses,
  NOMINATIM_URL,
  OsmUnavailable,
  OVERPASS_ATTEMPT_MS,
  OVERPASS_GIVE_UP_MS,
  OVERPASS_SPACING_MS,
  OVERPASS_URLS,
  SEARCH_SPACING_MS,
} from '../client';

const reply = (body: unknown, status = 200) =>
  Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body } as Response);

/** A fetch that never answers, only gives up when the request is abandoned. */
const hang = (_url: string, init: RequestInit) =>
  new Promise<Response>((_, reject) => init.signal?.addEventListener('abort', () => reject(new Error('Aborted'))));

const features = (fetcher: jest.Mock, onRetry?: () => void) =>
  fetchCourseFeatures({ osmType: 'way', osmId: 1 }, { fetcher: fetcher as unknown as typeof fetch, onRetry });

const course = (extra: Record<string, unknown> = {}) => ({
  osm_type: 'way',
  osm_id: 35679036,
  category: 'leisure',
  type: 'golf_course',
  name: 'Torrey Pines South Course',
  lat: '32.8971363',
  lon: '-117.247647',
  address: { city: 'San Diego', state: 'California', country: 'United States' },
  ...extra,
});

afterEach(() => jest.useRealTimers());

describe('findCourses', () => {
  it('keeps only golf courses, named and placed, and identifies the app', async () => {
    const fetcher = jest.fn(() =>
      reply([
        course(),
        { osm_type: 'way', osm_id: 1, category: 'highway', type: 'residential', name: 'Torrey Pines South' },
        course({ osm_type: 'node', osm_id: 2 }),
        course({ osm_type: 'relation', osm_id: 3, name: '', display_name: 'Rancho Park, Los Angeles', address: { town: 'Cheviot Hills' } }),
      ]),
    );
    const found = await findCourses('Torrey Pines golf', fetcher as unknown as typeof fetch);

    expect(found).toEqual([
      {
        osmType: 'way',
        osmId: 35679036,
        name: 'Torrey Pines South Course',
        place: 'San Diego, California, United States',
        center: { lat: 32.8971363, lng: -117.247647 },
      },
      { osmType: 'relation', osmId: 3, name: 'Rancho Park', place: 'Cheviot Hills', center: { lat: 32.8971363, lng: -117.247647 } },
    ]);
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url.startsWith(`${NOMINATIM_URL}?`)).toBe(true);
    expect(new URL(url).searchParams.get('q')).toBe('Torrey Pines golf');
    expect((init.headers as Record<string, string>)['User-Agent']).toMatch(/^PressGolf\//);
    // Searched once: the name already said golf.
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('leaves naming the app to the browser on the web, so no request needs a preflight', async () => {
    const fetcher = jest.fn(() => reply([]));
    jest.isolateModules(() => {
      jest.doMock('react-native', () => ({ Platform: { OS: 'web' } }));
      void (require('../client') as typeof import('../client')).findCourses('Chambers Bay golf', fetcher as unknown as typeof fetch);
    });
    jest.dontMock('react-native');
    await Promise.resolve();
    const [, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.headers).toEqual({ Accept: 'application/json' });
  });

  it('searches once more, a second later, with "golf course" added when the name finds no course', async () => {
    jest.useFakeTimers();
    const fetcher = jest.fn().mockReturnValueOnce(reply([])).mockReturnValueOnce(reply([course()]));
    const found = findCourses('Torrey Pines South', fetcher as unknown as typeof fetch);
    await jest.advanceTimersByTimeAsync(SEARCH_SPACING_MS);

    expect(await found).toHaveLength(1);
    expect(new URL(fetcher.mock.calls[1][0] as string).searchParams.get('q')).toBe('Torrey Pines South golf course');
  });

  it('gives a fallback name, and no place or centre, when the result has none', async () => {
    const fetcher = jest.fn(() =>
      reply([course({ name: undefined, display_name: undefined, address: undefined, lat: undefined, lon: undefined })]),
    );
    expect(await findCourses('golf', fetcher as unknown as typeof fetch)).toEqual([
      { osmType: 'way', osmId: 35679036, name: 'Golf course', place: '', center: null },
    ]);
  });
});

describe('fetchCourseFeatures', () => {
  it('asks Overpass for the holes and greens inside the course', async () => {
    const elements = [{ type: 'way', id: 1, tags: { golf: 'hole', ref: '1' } }];
    const fetcher = jest.fn(() => reply({ elements }));
    expect(await fetchCourseFeatures({ osmType: 'relation', osmId: 16064599 }, { fetcher: fetcher as unknown as typeof fetch })).toEqual(elements);

    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(OVERPASS_URLS[0]);
    expect(init.method).toBe('POST');
    const query = decodeURIComponent(String(init.body).replace(/^data=/, ''));
    expect(query).toContain('relation(16064599)->.edge;\n.edge out geom;\n.edge map_to_area->.course;');
    expect(query).toMatch(/way\["golf"~"\^\(hole\|green\|bunker\|water_hazard\|lateral_water_hazard\|[a-z_|]*fairway[a-z_|]*\)\$"\]\(area\.course\)/);
    expect(query).toContain('relation["natural"="water"](area.course)');
    // The tags-only form drops a relation's members, and with them every multipolygon's rings.
    expect(query).not.toContain('out geom tags');
  });

  it('treats a reply with no elements as none', async () => {
    const fetcher = jest.fn(() => reply({}));
    expect(await features(fetcher)).toEqual([]);
  });

  it.each([502, 504, 429, 500])('moves to the next server on a %s, and says it is still trying', async (status) => {
    jest.useFakeTimers();
    const elements = [{ type: 'way', id: 1, tags: { golf: 'green' } }];
    const fetcher = jest.fn().mockReturnValueOnce(reply({}, status)).mockReturnValueOnce(reply({ elements }));
    const onRetry = jest.fn();
    const found = features(fetcher, onRetry);
    await jest.advanceTimersByTimeAsync(OVERPASS_SPACING_MS);

    expect(await found).toEqual(elements);
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual(OVERPASS_URLS.slice(0, 2));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('gives a slow server a minute before moving on', async () => {
    jest.useFakeTimers();
    const fetcher = jest.fn().mockImplementationOnce(hang).mockReturnValueOnce(reply({ elements: [] }));
    const found = features(fetcher);
    await jest.advanceTimersByTimeAsync(OVERPASS_ATTEMPT_MS - 1);
    expect(fetcher).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(1 + OVERPASS_SPACING_MS);
    expect(await found).toEqual([]);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('tries again when a server stopped the query part way, rather than showing half a course', async () => {
    jest.useFakeTimers();
    const fetcher = jest
      .fn()
      .mockReturnValueOnce(reply({ elements: [{ type: 'way', id: 1 }], remark: 'runtime error: Query timed out in "query" at line 3 after 26 seconds.' }))
      .mockReturnValueOnce(reply({ elements: [] }));
    const found = features(fetcher);
    await jest.advanceTimersByTimeAsync(OVERPASS_SPACING_MS);
    expect(await found).toEqual([]);
  });

  it('gives up after two minutes of busy servers, round the list more than once', async () => {
    jest.useFakeTimers();
    const fetcher = jest.fn(() => reply({}, 502));
    const found = features(fetcher);
    await Promise.all([expect(found).rejects.toThrow('OpenStreetMap is busy'), jest.advanceTimersByTimeAsync(OVERPASS_GIVE_UP_MS)]);
    expect(fetcher.mock.calls.length).toBeGreaterThan(OVERPASS_URLS.length);
  });

  it('says the servers are slow, not that the phone is offline, when one timed out and another can\'t be reached', async () => {
    jest.useFakeTimers();
    const fetcher = jest.fn().mockImplementationOnce(hang).mockImplementation(() => Promise.reject(new TypeError('Network request failed')));
    const found = features(fetcher);
    await Promise.all([expect(found).rejects.toThrow('taking too long'), jest.advanceTimersByTimeAsync(OVERPASS_GIVE_UP_MS)]);
  });

  it('stops at once on an answer another try won\'t change', async () => {
    const fetcher = jest.fn(() => reply({}, 400));
    await expect(features(fetcher)).rejects.toThrow('answered 400');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe('when OpenStreetMap can\'t help', () => {
  it.each([
    [429, 'busy'],
    [502, 'busy'],
    [504, 'busy'],
    [404, 'answered 404'],
  ])('a search says so on a %s', async (status, message) => {
    const fetcher = jest.fn(() => reply({}, status));
    const attempt = findCourses('Chambers Bay golf', fetcher as unknown as typeof fetch);
    await expect(attempt).rejects.toBeInstanceOf(OsmUnavailable);
    await expect(findCourses('Chambers Bay golf', fetcher as unknown as typeof fetch)).rejects.toThrow(message);
  });

  it('says so when the network is down', async () => {
    const fetcher = jest.fn(() => Promise.reject(new TypeError('Network request failed')));
    await expect(findCourses('Chambers Bay golf', fetcher as unknown as typeof fetch)).rejects.toThrow('Couldn’t reach OpenStreetMap');
  });

  it('says the import couldn\'t reach any server when the network is down', async () => {
    jest.useFakeTimers();
    const fetcher = jest.fn(() => Promise.reject(new TypeError('Network request failed')));
    await Promise.all([expect(features(fetcher)).rejects.toThrow('Couldn’t reach OpenStreetMap'), jest.advanceTimersByTimeAsync(OVERPASS_GIVE_UP_MS)]);
  });

  it('says a search is slow, not offline, when it times out', async () => {
    jest.useFakeTimers();
    await Promise.all([expect(findCourses('Chambers Bay golf', jest.fn(hang) as unknown as typeof fetch)).rejects.toThrow('taking too long'), jest.advanceTimersByTimeAsync(30_000)]);
  });
});
