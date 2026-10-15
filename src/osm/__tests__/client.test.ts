import { fetchCourseFeatures, findCourses, NOMINATIM_URL, OsmUnavailable, OVERPASS_URL, SEARCH_SPACING_MS } from '../client';

const reply = (body: unknown, status = 200) =>
  Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body } as Response);

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
    expect(await fetchCourseFeatures({ osmType: 'relation', osmId: 16064599 }, fetcher as unknown as typeof fetch)).toEqual(elements);

    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(OVERPASS_URL);
    expect(init.method).toBe('POST');
    const query = decodeURIComponent(String(init.body).replace(/^data=/, ''));
    expect(query).toContain('relation(16064599);map_to_area->.course;');
    expect(query).toContain('way["golf"="hole"](area.course)');
    expect(query).toContain('relation["golf"="green"](area.course)');
  });

  it('treats a reply with no elements as none', async () => {
    const fetcher = jest.fn(() => reply({}));
    expect(await fetchCourseFeatures({ osmType: 'way', osmId: 1 }, fetcher as unknown as typeof fetch)).toEqual([]);
  });
});

describe('when OpenStreetMap can\'t help', () => {
  it.each([
    [429, 'busy'],
    [504, 'busy'],
    [500, 'answered 500'],
  ])('says so on a %s', async (status, message) => {
    const fetcher = jest.fn(() => reply({}, status));
    const attempt = fetchCourseFeatures({ osmType: 'way', osmId: 1 }, fetcher as unknown as typeof fetch);
    await expect(attempt).rejects.toBeInstanceOf(OsmUnavailable);
    await expect(fetchCourseFeatures({ osmType: 'way', osmId: 1 }, fetcher as unknown as typeof fetch)).rejects.toThrow(message);
  });

  it('says so when the network is down', async () => {
    const fetcher = jest.fn(() => Promise.reject(new TypeError('Network request failed')));
    await expect(findCourses('Chambers Bay golf', fetcher as unknown as typeof fetch)).rejects.toThrow('Couldn’t reach OpenStreetMap');
  });
});
