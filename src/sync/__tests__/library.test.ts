import { makeTestCourse } from '../../domain/__tests__/helpers';
import { fetchLibraryCourse, searchLibrary } from '../library';
import { pullLibraryCourses } from '../remote';
import { emptySnapshot, toRows } from '../rows';
import { getSupabase } from '../supabase';

jest.mock('../supabase', () => ({ getSupabase: jest.fn() }));
jest.mock('../remote', () => ({ pullLibraryCourses: jest.fn() }));

const mockGetSupabase = getSupabase as jest.MockedFunction<typeof getSupabase>;
const mockPull = pullLibraryCourses as jest.MockedFunction<typeof pullLibraryCourses>;

function client(result: { data?: unknown; error?: { message: string } | null }) {
  const fake = { rpc: jest.fn(() => Promise.resolve(result)) };
  mockGetSupabase.mockReturnValue(fake as never);
  return fake;
}

beforeEach(() => jest.clearAllMocks());

describe('the course library, searched (#383)', () => {
  it('asks the server with where the phone is, and reads back each match', async () => {
    const fake = client({
      data: [
        { id: 'c1', name: 'Pine Hollow', lat: 45.5, lng: -122.6, km: 1.2, tees: ['White', 'Blue'] },
        { id: 'c2', name: 'Pine Hollow', lat: null, lng: null, km: null, tees: null },
      ],
      error: null,
    });
    await expect(searchLibrary('pine', { lat: 45.4, lng: -122.5 })).resolves.toEqual([
      { id: 'c1', name: 'Pine Hollow', location: { lat: 45.5, lng: -122.6 }, km: 1.2, tees: ['White', 'Blue'] },
      { id: 'c2', name: 'Pine Hollow', location: null, km: null, tees: [] },
    ]);
    expect(fake.rpc).toHaveBeenCalledWith('search_courses', { term: 'pine', near_lat: 45.4, near_lng: -122.5 });
  });

  it('gives a course with half a location none', async () => {
    client({
      data: [
        { id: 'c1', name: 'A', lat: null, lng: -122.6, km: null, tees: [] },
        { id: 'c2', name: 'B', lat: 45.5, lng: null, km: null, tees: [] },
      ],
      error: null,
    });
    const matches = await searchLibrary('pine', null);
    expect(matches.map((m) => m.location)).toEqual([null, null]);
  });

  it('asks by name alone without a position, and takes no rows as no matches', async () => {
    const fake = client({ data: null, error: null });
    await expect(searchLibrary('pine', null)).resolves.toEqual([]);
    expect(fake.rpc).toHaveBeenCalledWith('search_courses', { term: 'pine', near_lat: null, near_lng: null });
  });

  it("passes on the server's refusal, and needs a server", async () => {
    client({ data: null, error: { message: 'permission denied for function search_courses' } });
    await expect(searchLibrary('pine', null)).rejects.toThrow('permission denied');
    mockGetSupabase.mockReturnValue(null);
    await expect(searchLibrary('pine', null)).rejects.toThrow('no server');
  });

  it('brings one course whole, or nothing once it has gone', async () => {
    const course = makeTestCourse();
    mockPull.mockResolvedValueOnce(toRows({ groups: [], courses: [course], rounds: [], outings: [], clubs: [], marks: [] }));
    await expect(fetchLibraryCourse(course.id)).resolves.toMatchObject({ id: course.id, name: course.name, tees: [{ name: 'White' }] });
    expect(mockPull).toHaveBeenCalledWith([course.id]);
    mockPull.mockResolvedValueOnce(emptySnapshot());
    await expect(fetchLibraryCourse('gone')).resolves.toBeNull();
  });
});
