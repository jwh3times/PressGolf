import React, { useState } from 'react';
import { AccessibilityInfo, Alert } from 'react-native';
import { act, fireEvent, render, screen, userEvent, waitFor } from '@testing-library/react-native';
import { useAuth } from '../../auth/AuthProvider';
import { STORAGE_VERSION } from '../../config/flags';
import { courseField, holeField, teeField } from '../../domain/course-draft';
import { makeCourse } from '../../domain/factory';
import type { Course } from '../../domain/types';
import { positionHere, roughPosition } from '../../hooks/position';
import { findCourses } from '../../osm/client';
import { AppStoreProvider, useStore, type AppStore } from '../../store/AppStore';
import { loadDataset, loadScanNoticeSeen, loadSettings, saveScanNoticeSeen } from '../../store/persistence';
import { scanScorecard } from '../../hooks/scanner';
import { readScorecard } from '../../sync/scorecard';
import { fetchLibraryCourse, searchLibrary, type LibraryMatch } from '../../sync/library';
import { isSupabaseConfigured } from '../../sync/supabase';
import { useDataSync } from '../../sync/useDataSync';
import CourseEditorScreen from '../course/[id]';
import CourseLocationScreen from '../course-location';
import CoursesScreen from '../courses';

/**
 * Creating a course from the course library (#383), on the real store: the Courses
 * screen, the course editor and the map pick, with the server, the phone's position and
 * its storage faked underneath.
 */

type Place = { path: string; params: Record<string, string> };
let mockStack: Place[] = [];
let mockRender = () => {};
const toPlace = (href: string): Place => {
  const course = /^\/course\/(.+)$/.exec(href);
  return course ? { path: '/course/[id]', params: { id: course[1] } } : { path: href, params: {} };
};
const mockRouter = {
  push: jest.fn((to: string | { pathname: string; params?: Record<string, string> }) => {
    mockStack = [...mockStack, typeof to === 'string' ? toPlace(to) : { path: to.pathname, params: to.params ?? {} }];
    mockRender();
  }),
  back: jest.fn(() => {
    mockStack = mockStack.slice(0, -1);
    mockRender();
  }),
};

jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => mockStack.at(-1)?.params ?? {},
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('react-native-maps', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  const { forwardRef } = jest.requireActual<typeof import('react')>('react');
  const MapView = forwardRef((props: Record<string, unknown>, _ref) => <View testID="map" {...props} />);
  const Marker = (props: Record<string, unknown>) => <View testID="pin" {...props} />;
  return { __esModule: true, default: MapView, Marker };
});
jest.mock('../../auth/AuthProvider', () => ({ useAuth: jest.fn() }));
jest.mock('../../sync/useDataSync', () => ({ useDataSync: jest.fn() }));
jest.mock('../../store/persistence', () => ({
  clearDataset: jest.fn(),
  loadDataset: jest.fn(),
  loadSettings: jest.fn(),
  saveDataset: jest.fn(() => Promise.resolve()),
  saveSettings: jest.fn(() => Promise.resolve()),
  loadScanNoticeSeen: jest.fn(),
  saveScanNoticeSeen: jest.fn(() => Promise.resolve()),
}));
// The phone's document scanner and the server's reading of the photos (#385).
jest.mock('../../hooks/scanner', () => ({ MAX_PHOTOS: 4, scanScorecard: jest.fn() }));
jest.mock('../../sync/scorecard', () => ({ readScorecard: jest.fn() }));
jest.mock('../../sync/suggestions', () => ({ editCourse: jest.fn(), isAdmin: jest.fn(() => Promise.resolve(false)) }));
jest.mock('../../sync/supabase', () => ({ deleteAccount: jest.fn(), isSupabaseConfigured: jest.fn(() => true) }));
jest.mock('../../sync/library', () => ({ ...jest.requireActual('../../sync/library'), searchLibrary: jest.fn(), fetchLibraryCourse: jest.fn() }));
jest.mock('../../hooks/position', () => ({ roughPosition: jest.fn(), positionHere: jest.fn() }));
jest.mock('../../osm/client', () => ({ findCourses: jest.fn() }));

const mockSearch = searchLibrary as jest.MockedFunction<typeof searchLibrary>;
const mockFetch = fetchLibraryCourse as jest.MockedFunction<typeof fetchLibraryCourse>;
const mockRough = roughPosition as jest.MockedFunction<typeof roughPosition>;
const mockHere = positionHere as jest.MockedFunction<typeof positionHere>;
const mockFindCourses = findCourses as jest.MockedFunction<typeof findCourses>;

let store: AppStore;

function Probe() {
  const value = useStore();
  React.useEffect(() => {
    store = value;
  }, [value]);
  return null;
}

/** The stack the screens are on, as expo-router would show its top. */
function Routes() {
  const [, setTick] = useState(0);
  React.useEffect(() => {
    mockRender = () => setTick((tick) => tick + 1);
  }, []);
  const here = mockStack.at(-1)?.path;
  if (here === '/course/[id]') return <CourseEditorScreen />;
  if (here === '/course-location') return <CourseLocationScreen />;
  return <CoursesScreen />;
}

const mine = makeCourse('Home Links');
const seattle: LibraryMatch = { id: 'lib-seattle', name: 'Pine Hollow', location: { lat: 47.61, lng: -122.33 }, km: 1.6, tees: ['White', 'Blue'] };
const portland: LibraryMatch = { id: 'lib-portland', name: 'Pine Hollow', location: { lat: 45.52, lng: -122.68 }, km: 280, tees: ['Red'] };
const theirs: Course = { ...makeCourse('Pine Hollow'), id: seattle.id, location: seattle.location!, createdBy: 'someone-else' };

/** The app on the Courses screen, signed in on a build with a server unless it's the demo. */
async function open({ demo = false }: { demo?: boolean } = {}) {
  (loadSettings as jest.Mock).mockResolvedValueOnce({ demoMode: demo, activeGroupId: null, activeRoundId: null, activeOutingId: null });
  (loadDataset as jest.Mock).mockResolvedValueOnce({
    version: STORAGE_VERSION,
    groups: [],
    courses: [mine],
    rounds: [],
    outings: [],
    clubs: [],
    usualScore: null,
    tournament: {},
    tournamentNext: false,
    marks: [],
    activeGroupId: null,
    openRoundIds: [],
    activeOutingId: null,
    cardRoundId: null,
    seenCells: null,
  });
  mockStack = [{ path: '/courses', params: {} }];
  // Not the last test's store, which was ready long ago.
  store = undefined as unknown as AppStore;
  await render(
    <AppStoreProvider>
      <Probe />
      <Routes />
    </AppStoreProvider>,
  );
  await waitFor(() => expect(store?.ready).toBe(true));
}

const user = () => userEvent.setup();

beforeEach(() => {
  jest.clearAllMocks();
  // A load queued for a test that failed before it opened would open the next one.
  (loadSettings as jest.Mock).mockReset();
  (loadDataset as jest.Mock).mockReset();
  (useAuth as jest.Mock).mockReturnValue({ status: 'signed-in', email: 'golfer@example.com', userId: 'user-1', signOut: jest.fn(), stopDemo: jest.fn() });
  (useDataSync as jest.Mock).mockReturnValue({ status: 'synced', at: null, message: null, settle: jest.fn() });
  mockRough.mockResolvedValue({ lat: 47.6, lng: -122.3 });
  mockSearch.mockResolvedValue([seattle, portland]);
  mockFetch.mockResolvedValue(theirs);
  mockHere.mockResolvedValue({ lat: 45.52, lng: -122.68 });
  mockFindCourses.mockResolvedValue([]);
  (loadScanNoticeSeen as jest.Mock).mockResolvedValue(true);
});

describe('finding a course in the library (#383)', () => {
  it('lists the matches nearest first as the golfer types, each with its distance and tees', async () => {
    await open();
    await user().type(screen.getByLabelText('Course name'), 'Pine');
    expect(await screen.findByText('1.0 mi · White, Blue')).toBeOnTheScreen();
    expect(screen.getByText('174 mi · Red')).toBeOnTheScreen();
    expect(mockSearch).toHaveBeenLastCalledWith('Pine', { lat: 47.6, lng: -122.3 });
    // Nearest first, as the server ordered them.
    expect(screen.getAllByText(/mi · /).map((node) => node.props.children)).toEqual(['1.0 mi · White, Blue', '174 mi · Red']);
    expect(screen.getByText('Not one of these? Scan its scorecard or type it in.')).toBeOnTheScreen();
  });

  it('drops the matches for a name the golfer has since changed, until the new search answers', async () => {
    await open();
    await user().type(screen.getByLabelText('Course name'), 'Pine');
    expect(await screen.findByText('1.0 mi · White, Blue')).toBeOnTheScreen();
    let answer!: (matches: LibraryMatch[]) => void;
    mockSearch.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
    await user().clear(screen.getByLabelText('Course name'));
    await user().type(screen.getByLabelText('Course name'), 'Oak');
    expect(screen.queryByText('1.0 mi · White, Blue')).toBeNull();
    expect(screen.queryByText('Not one of these? Scan its scorecard or type it in.')).toBeNull();
    expect(screen.getByText('Looking…')).toBeOnTheScreen();
    await waitFor(() => expect(mockSearch).toHaveBeenLastCalledWith('Oak', { lat: 47.6, lng: -122.3 }));
    await act(async () => answer([]));
    expect(await screen.findByText(/No course called “Oak”/)).toBeOnTheScreen();
  });

  it('searches by name alone when location is refused, and shows the tees without a distance', async () => {
    mockRough.mockResolvedValue(null);
    mockSearch.mockResolvedValue([{ ...seattle, km: null }]);
    await open();
    await user().type(screen.getByLabelText('Course name'), 'Pine');
    expect(await screen.findByText('White, Blue')).toBeOnTheScreen();
    expect(mockSearch).toHaveBeenLastCalledWith('Pine', null);
  });

  it("doesn't search for one letter, and leaves typing it in when the library can't be reached", async () => {
    mockSearch.mockRejectedValue(new Error('Network request failed'));
    await open();
    await user().type(screen.getByLabelText('Course name'), 'P');
    await act(() => new Promise((resolve) => setTimeout(resolve, 500)));
    expect(mockSearch).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Type it in' })).toBeNull();
    await user().type(screen.getByLabelText('Course name'), 'i');
    expect(await screen.findByText('Network request failed')).toBeOnTheScreen();
    expect(screen.getByText('Or type it in.')).toBeOnTheScreen();
    await user().press(screen.getByRole('button', { name: 'Type it in' }));
    expect(await screen.findByText(/Not saved yet/)).toBeOnTheScreen();
  });

  it("adds a match to the golfer's courses with one tap, and takes it off the list without touching the library", async () => {
    await open();
    await user().type(screen.getByLabelText('Course name'), 'Pine');
    await user().press(await screen.findByRole('button', { name: 'Add Pine Hollow, 1.0 mi, White, Blue' }));
    expect(await screen.findByText('ON YOUR LIST')).toBeOnTheScreen();
    expect(store.myCourses.map((c) => c.id)).toEqual([mine.id, theirs.id]);
    expect(mockFetch).toHaveBeenCalledWith(seattle.id);
    expect(store.courses.find((c) => c.id === theirs.id)?.createdBy).toBe('someone-else');

    // Taking it off the list, as the alert's button does.
    const alert = jest
      .spyOn(Alert, 'alert')
      .mockImplementation((_title, _message, buttons) => buttons?.find((b) => b.text === 'Take it off')?.onPress?.());
    fireEvent(screen.getAllByRole('button', { name: /Pine Hollow/ })[0], 'longPress');
    expect(alert).toHaveBeenCalledWith('Take Pine Hollow off your courses?', expect.stringContaining('stays in Press'), expect.any(Array));
    await waitFor(() => expect(store.myCourses.map((c) => c.id)).toEqual([mine.id]));
    // Still on the phone, for any round on it, and nothing to delete on the server.
    expect(store.courses.map((c) => c.id)).toContain(theirs.id);
    alert.mockRestore();

    // Adding it again puts it back on the list.
    await user().press(await screen.findByRole('button', { name: 'Add Pine Hollow, 1.0 mi, White, Blue' }));
    expect(await screen.findByText('ON YOUR LIST')).toBeOnTheScreen();
    expect(store.myCourses.map((c) => c.id)).toContain(theirs.id);
  });
});

describe('typing a course in, as a draft (#383)', () => {
  async function typeItIn(name = 'Pine Hollow') {
    mockSearch.mockResolvedValue([]);
    await open();
    await user().type(screen.getByLabelText('Course name'), name);
    expect(await screen.findByText(`No course called “${name}” in Press yet. Scan its scorecard or type it in, and it’s there for the next golfer.`)).toBeOnTheScreen();
    await user().press(screen.getByRole('button', { name: '9 holes' }));
    await user().press(screen.getByRole('button', { name: 'Type it in' }));
    expect(await screen.findByText(/Not saved yet/)).toBeOnTheScreen();
  }

  it('opens an unsaved draft, and leaving it without saving makes nothing', async () => {
    await typeItIn();
    expect(screen.getByText('New course · 9 holes · par 36')).toBeOnTheScreen();
    expect(store.courses).toHaveLength(1);
    await user().press(screen.getByRole('button', { name: 'Cancel' }));
    expect(store.newCourse).toBeNull();
    expect(store.courses.map((c) => c.id)).toEqual([mine.id]);
    expect(screen.getByLabelText('Course name')).toBeOnTheScreen();
  });

  it("won't save without a location, and saves with the golfer's position", async () => {
    await typeItIn();
    const save = screen.getByRole('button', { name: 'Save the course' });
    expect(save).toBeDisabled();
    expect(screen.getByText('To save it, say where it is.')).toBeOnTheScreen();

    await user().press(screen.getByRole('button', { name: 'Use where I’m standing' }));
    expect(await screen.findByText(/At 45\.5200, -122\.6800\./)).toBeOnTheScreen();
    await user().press(screen.getByRole('button', { name: 'Save the course' }));
    const saved = store.courses.find((c) => c.name === 'Pine Hollow');
    expect(saved).toMatchObject({ location: { lat: 45.52, lng: -122.68 } });
    expect(saved!.tees[0].holes).toHaveLength(9);
    expect(store.newCourse).toBeNull();
    expect(store.myCourses.map((c) => c.id)).toContain(saved!.id);
  });

  it('says so when location is refused, and takes a pick on the map instead', async () => {
    mockHere.mockResolvedValue(null);
    mockFindCourses.mockResolvedValue([{ osmType: 'way', osmId: 1, name: 'Pine Hollow', place: 'Portland', center: { lat: 45.5, lng: -122.6 } }]);
    await typeItIn();
    await user().press(screen.getByRole('button', { name: 'Use where I’m standing' }));
    expect(await screen.findByText(/Location is off for Press/)).toBeOnTheScreen();

    await user().press(screen.getByRole('button', { name: 'Pick it on a map' }));
    expect(await screen.findByText('Where it is')).toBeOnTheScreen();
    // The map starts on the course OpenStreetMap knows by that name.
    await waitFor(() => expect(mockFindCourses).toHaveBeenCalledWith('Pine Hollow'));
    expect(screen.getByRole('button', { name: 'Done' })).toBeDisabled();
    // As a tap on the map gives it, the way the map's own tests do.
    await act(async () => screen.getByTestId('map').props.onPress({ nativeEvent: { coordinate: { latitude: 45.51, longitude: -122.61 } } }));
    expect(screen.getByText('At 45.5100, -122.6100.')).toBeOnTheScreen();
    await user().press(screen.getByRole('button', { name: 'Done' }));

    await user().press(await screen.findByRole('button', { name: 'Save the course' }));
    expect(store.courses.find((c) => c.name === 'Pine Hollow')?.location).toEqual({ lat: 45.51, lng: -122.61 });
  });

  it('marks the values a source filled until the golfer confirms them', async () => {
    await open();
    const draft = makeCourse('Scanned Links');
    const tee = draft.tees[0].id;
    await act(async () =>
      store.startNewCourse(draft, {
        [courseField('name')]: 'scan',
        [teeField(tee, 'slope')]: 'scan',
        [holeField(tee, 1, 'par')]: 'scan',
      }),
    );
    await act(async () => mockRouter.push(`/course/${draft.id}`));
    expect(screen.getByText(/3 values came from the scorecard photo/)).toBeOnTheScreen();
    expect(screen.getAllByText('From the scorecard photo. Check it against the card.')).toHaveLength(2);
    expect(screen.getByLabelText('Hole 1 came from the scorecard photo: check it')).toBeOnTheScreen();

    // A value the golfer changes is theirs.
    await user().press(screen.getByRole('button', { name: 'Raise par on hole 1' }));
    expect(screen.queryByLabelText('Hole 1 came from the scorecard photo: check it')).toBeNull();
    expect(screen.getByText(/2 values came from the scorecard photo/)).toBeOnTheScreen();

    await user().press(screen.getByRole('button', { name: 'They’re all right' }));
    expect(screen.queryByText('From the scorecard photo. Check it against the card.')).toBeNull();
    expect(store.newCourse?.marks).toEqual({});
    expect(store.newCourse?.course.tees[0].holes[0].par).toBe(5);
  });
});

describe('when things go wrong (#383)', () => {
  it("says when a match has gone from the library, or can't be fetched", async () => {
    mockFetch.mockResolvedValueOnce(null);
    await open();
    await user().type(screen.getByLabelText('Course name'), 'Pine');
    await user().press(await screen.findByRole('button', { name: 'Add Pine Hollow, 1.0 mi, White, Blue' }));
    expect(await screen.findByText('Pine Hollow has gone from the library.')).toBeOnTheScreen();
    expect(store.myCourses.map((c) => c.id)).toEqual([mine.id]);

    mockFetch.mockRejectedValueOnce(new Error('Network request failed'));
    await user().press(await screen.findByRole('button', { name: 'Add Pine Hollow, 174 mi, Red' }));
    expect(await screen.findByText('Network request failed')).toBeOnTheScreen();
  });

  it("says when the phone can't tell where it is, and what a draft with no name needs", async () => {
    mockSearch.mockResolvedValue([]);
    mockHere.mockRejectedValue(new Error('Location services are off'));
    await open();
    await user().type(screen.getByLabelText('Course name'), 'Pine Hollow');
    await user().press(await screen.findByRole('button', { name: 'Type it in' }));
    await user().press(await screen.findByRole('button', { name: 'Use where I’m standing' }));
    expect(await screen.findByText(/Couldn’t tell where you are/)).toBeOnTheScreen();
    await user().clear(screen.getByLabelText('Course name'));
    expect(screen.getByText('To save it, give it a name and say where it is.')).toBeOnTheScreen();
    expect(screen.getByText('New course')).toBeOnTheScreen();
  });

  it("says when OpenStreetMap doesn't know the course, or can't be reached, on the map pick", async () => {
    mockSearch.mockResolvedValue([]);
    await open();
    await user().type(screen.getByLabelText('Course name'), 'Pine Hollow');
    await user().press(await screen.findByRole('button', { name: 'Type it in' }));
    await user().press(await screen.findByRole('button', { name: 'Pick it on a map' }));
    expect(await screen.findByText(/doesn’t know a golf course by that name/)).toBeOnTheScreen();

    mockFindCourses.mockRejectedValueOnce(new Error('OpenStreetMap is busy'));
    await user().press(screen.getByRole('button', { name: 'Find Pine Hollow on the map' }));
    expect(await screen.findByText('OpenStreetMap is busy')).toBeOnTheScreen();
    await user().press(screen.getByRole('button', { name: 'Back' }));
    expect(await screen.findByText(/Not saved yet/)).toBeOnTheScreen();
  });

  it('has nothing to place once the draft has gone', async () => {
    await open();
    await act(async () => mockRouter.push({ pathname: '/course-location', params: { id: 'gone' } }));
    expect(screen.getByText('Course not found')).toBeOnTheScreen();
    await user().press(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByText('Courses')).toBeOnTheScreen();
  });
});

describe('scanning the scorecard (#385)', () => {
  const mockScan = scanScorecard as jest.Mock;
  const mockRead = readScorecard as jest.Mock;
  const photo = { mediaType: 'image/jpeg', data: 'aGVsbG8=' };
  /** A nine-hole card with two tees, as the server checked it: blank where it couldn't read. */
  const card = {
    holeCount: 9,
    tees: [
      {
        name: 'Blue',
        slope: 128,
        rating: 35.4,
        holes: Array.from({ length: 9 }, (_, i) => ({ number: i + 1, par: i === 0 ? null : 4, strokeIndex: i + 1, yards: 350 })),
      },
      { name: null, slope: null, rating: null, holes: Array.from({ length: 9 }, (_, i) => ({ number: i + 1, par: 4, strokeIndex: i + 1, yards: null })) },
    ],
  };

  /** The Courses screen, searched to nothing, with Scan the scorecard offered. */
  async function searchedToNothing() {
    mockSearch.mockResolvedValue([]);
    await open();
    await user().type(screen.getByLabelText('Course name'), 'Pine Hollow');
    expect(await screen.findByText(/No course called “Pine Hollow” in Press yet\. Scan its scorecard/)).toBeOnTheScreen();
  }

  it('tells the golfer where the photos go before the first scan, and goes ahead only on their word', async () => {
    (loadScanNoticeSeen as jest.Mock).mockResolvedValue(false);
    const alert = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => buttons?.find((b) => b.text === 'Not now')?.onPress?.());
    await searchedToNothing();
    await user().press(screen.getByRole('button', { name: 'Scan the scorecard' }));
    expect(alert).toHaveBeenCalledWith('Before you scan', expect.stringContaining('Press keeps no copy'), expect.any(Array));
    expect(mockScan).not.toHaveBeenCalled();
    expect(saveScanNoticeSeen).not.toHaveBeenCalled();

    alert.mockImplementation((_t, _m, buttons) => buttons?.find((b) => b.text === 'Scan')?.onPress?.());
    mockScan.mockResolvedValue({ kind: 'cancelled' });
    await user().press(screen.getByRole('button', { name: 'Scan the scorecard' }));
    await waitFor(() => expect(mockScan).toHaveBeenCalledTimes(1));
    expect(saveScanNoticeSeen).toHaveBeenCalled();
    // A cancelled scan reads nothing and costs nothing.
    expect(mockRead).not.toHaveBeenCalled();
    alert.mockRestore();
  });

  it('fills a draft course with what the card gave, marked as read from the photo, and blanks left blank', async () => {
    mockScan.mockResolvedValue({ kind: 'photos', photos: [photo, photo] });
    mockRead.mockResolvedValue({ outcome: 'read', card, scansLeft: 9 });
    const alert = jest.spyOn(Alert, 'alert');
    await searchedToNothing();
    await user().press(screen.getByRole('button', { name: 'Scan the scorecard' }));
    expect(await screen.findByText(/Not saved yet/)).toBeOnTheScreen();
    // The notice was taken before; not asked again.
    expect(alert).not.toHaveBeenCalled();
    alert.mockRestore();
    expect(mockRead).toHaveBeenCalledWith([photo, photo]);

    const draft = store.newCourse!;
    expect(draft.course.name).toBe('Pine Hollow');
    expect(draft.course.tees.map((t) => t.name)).toEqual(['Blue', '']);
    expect(draft.course.tees[0]).toMatchObject({ slope: 128, rating: 35.4 });
    expect(draft.course.tees[0].holes[0]).toEqual({ number: 1, par: 0, strokeIndex: 1, yards: 350 });
    // Nothing is saved before the golfer saves it.
    expect(store.courses.map((c) => c.id)).toEqual([mine.id]);

    // Blue's name, slope and rating and 26 of its hole values, and 18 of the other tee's: what the photos gave.
    expect(screen.getByText(/47 values came from the scorecard photo/)).toBeOnTheScreen();
    expect(screen.getByLabelText('Hole 2 came from the scorecard photo: check it')).toBeOnTheScreen();
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    expect(screen.getByText('To save it, name every tee, fill in every hole’s par and stroke index and say where it is.')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Save the course' })).toBeDisabled();

    // A blank par takes 4 on the first press.
    await user().press(screen.getByRole('button', { name: 'Raise par on hole 1' }));
    expect(store.newCourse!.course.tees[0].holes[0].par).toBe(4);
  });

  it('fills a blank par with 4 either way, and doesn’t call two blank stroke indexes a clash', async () => {
    await open();
    const blank = makeCourse('Blank Links', 9);
    const tee = blank.tees[0];
    const holes = tee.holes.map((h, i) => (i < 2 ? { ...h, par: 0, strokeIndex: 0 } : h));
    await act(async () => store.startNewCourse({ ...blank, tees: [{ ...tee, holes }] }));
    await act(async () => mockRouter.push(`/course/${blank.id}`));
    expect(screen.queryByText(/share a stroke index/)).toBeNull();
    await user().press(screen.getByRole('button', { name: 'Lower par on hole 1' }));
    await user().press(screen.getByRole('button', { name: 'Raise par on hole 2' }));
    expect(store.newCourse!.course.tees[0].holes.slice(0, 2).map((h) => h.par)).toEqual([4, 4]);
  });

  it('says how many scans are left near the limit, and why a reading failed', async () => {
    mockScan.mockResolvedValue({ kind: 'photos', photos: [photo] });
    mockRead.mockResolvedValue({ outcome: 'unreadable', reason: 'Couldn’t read a scorecard in those photos.', scansLeft: 2 });
    await searchedToNothing();
    await user().press(screen.getByRole('button', { name: 'Scan the scorecard' }));
    expect(await screen.findByText(/Couldn’t read a scorecard in those photos\. Try again with the card flat/)).toBeOnTheScreen();
    expect(screen.getByText('2 scans left today.')).toBeOnTheScreen();
    expect(store.newCourse).toBeNull();

    mockRead.mockResolvedValue({ outcome: 'unreadable', reason: 'Couldn’t read a scorecard in those photos.', scansLeft: 1 });
    await user().press(screen.getByRole('button', { name: 'Scan the scorecard' }));
    expect(await screen.findByText('1 scan left today.')).toBeOnTheScreen();
  });

  it('keeps the count through a new search, asks the notice once, and greys the button while it reads', async () => {
    (loadScanNoticeSeen as jest.Mock).mockResolvedValue(false);
    const alert = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => buttons?.find((b) => b.text === 'Scan')?.onPress?.());
    mockScan.mockResolvedValue({ kind: 'photos', photos: [photo] });
    let answer!: (outcome: unknown) => void;
    mockRead.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
    await searchedToNothing();
    await user().press(screen.getByRole('button', { name: 'Scan the scorecard' }));
    const reading = await screen.findByRole('button', { name: 'Reading the card…' });
    expect(reading).toBeDisabled();
    await act(async () => answer({ outcome: 'read', card, scansLeft: 3 }));
    expect(await screen.findByText(/Not saved yet/)).toBeOnTheScreen();

    // Back out, and search again: the count is still known, and the notice isn't asked again.
    await user().press(screen.getByRole('button', { name: 'Cancel' }));
    await user().type(screen.getByLabelText('Course name'), 'Oak Ridge');
    expect(await screen.findByText('3 scans left today.')).toBeOnTheScreen();
    mockRead.mockResolvedValue({ outcome: 'unreadable', reason: 'Couldn’t read a scorecard in those photos.', scansLeft: 2 });
    await user().press(screen.getByRole('button', { name: 'Scan the scorecard' }));
    expect(await screen.findByText('2 scans left today.')).toBeOnTheScreen();
    expect(alert).toHaveBeenCalledTimes(1);
    alert.mockRestore();
  });

  it('says what went wrong aloud, for VoiceOver, which has no live regions', async () => {
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
    mockScan.mockResolvedValue({ kind: 'too-many', count: 5 });
    await searchedToNothing();
    await user().press(screen.getByRole('button', { name: 'Scan the scorecard' }));
    await waitFor(() => expect(announce).toHaveBeenCalledWith('That’s 5 photos. A scan takes up to 4 of one card: scan it again with fewer.'));
    announce.mockRestore();
  });

  it('says there are none left on the next search, once today’s are used up', async () => {
    mockScan.mockResolvedValue({ kind: 'photos', photos: [photo] });
    mockRead.mockResolvedValue({ outcome: 'limit', reason: 'That’s today’s 10 scans used. Type the course in, or scan again tomorrow.' });
    await searchedToNothing();
    await user().press(screen.getByRole('button', { name: 'Scan the scorecard' }));
    expect(await screen.findByText('That’s today’s 10 scans used. Type the course in, or scan again tomorrow.')).toBeOnTheScreen();
    await user().clear(screen.getByLabelText('Course name'));
    await user().type(screen.getByLabelText('Course name'), 'Oak Ridge');
    expect(await screen.findByText('No scans left today. Type the course in, or scan again tomorrow.')).toBeOnTheScreen();
  });

  it('explains when today’s scans are used up, and leaves Type it in to hand', async () => {
    mockScan.mockResolvedValue({ kind: 'photos', photos: [photo] });
    mockRead.mockResolvedValue({ outcome: 'limit', reason: 'That’s today’s 10 scans used. Type the course in, or scan again tomorrow.' });
    await searchedToNothing();
    await user().press(screen.getByRole('button', { name: 'Scan the scorecard' }));
    expect(await screen.findByText('That’s today’s 10 scans used. Type the course in, or scan again tomorrow.')).toBeOnTheScreen();
    expect(screen.queryByText(/scans? left today/)).toBeNull();
    await user().press(screen.getByRole('button', { name: 'Type it in' }));
    expect(await screen.findByText(/Not saved yet/)).toBeOnTheScreen();
  });

  it('refuses more than 4 photos, and says so when the card can’t be read or the scanner won’t open', async () => {
    mockScan.mockResolvedValue({ kind: 'too-many', count: 6 });
    await searchedToNothing();
    await user().press(screen.getByRole('button', { name: 'Scan the scorecard' }));
    expect(await screen.findByText('That’s 6 photos. A scan takes up to 4 of one card: scan it again with fewer.')).toBeOnTheScreen();
    expect(mockRead).not.toHaveBeenCalled();

    mockScan.mockResolvedValue({ kind: 'photos', photos: [photo] });
    mockRead.mockResolvedValue({ outcome: 'failed', reason: 'Couldn’t reach Press to read the card. Check your signal, or type the course in.' });
    await user().press(screen.getByRole('button', { name: 'Scan the scorecard' }));
    expect(await screen.findByText(/Couldn’t reach Press to read the card/)).toBeOnTheScreen();

    mockScan.mockRejectedValue(new Error('no scanner'));
    await user().press(screen.getByRole('button', { name: 'Scan the scorecard' }));
    expect(await screen.findByText('The scanner didn’t open. Type the course in instead.')).toBeOnTheScreen();
  });
});

describe('the demo, with no course library (#383)', () => {
  it('creates a course by hand, kept on the phone, as before', async () => {
    (useAuth as jest.Mock).mockReturnValue({ status: 'demo', email: null, userId: null, signOut: jest.fn(), stopDemo: jest.fn() });
    await open({ demo: true });
    expect(store.libraryOpen).toBe(false);
    expect(screen.queryByText(/Press looks for it/)).toBeNull();
    await user().type(screen.getByLabelText('Name'), 'Back Nine');
    await user().press(screen.getByRole('button', { name: 'Create course' }));
    expect(store.courses.map((c) => c.name)).toContain('Back Nine');
    expect(store.newCourse).toBeNull();
    expect(await screen.findByText('18 holes · par 72')).toBeOnTheScreen();
    expect(mockSearch).not.toHaveBeenCalled();
  });

  it('creates a course by hand on a build with no server, as before', async () => {
    (isSupabaseConfigured as jest.Mock).mockReturnValue(false);
    (useAuth as jest.Mock).mockReturnValue({ status: 'disabled', email: null, userId: null, signOut: jest.fn(), stopDemo: jest.fn() });
    await open();
    expect(store.demoMode).toBe(false);
    expect(store.libraryOpen).toBe(false);
    await user().type(screen.getByLabelText('Name'), 'Local Links');
    await user().press(screen.getByRole('button', { name: 'Create course' }));
    expect(store.courses.map((c) => c.name)).toContain('Local Links');
    expect(store.courses.find((c) => c.name === 'Local Links')?.location).toBeUndefined();
    expect(mockSearch).not.toHaveBeenCalled();
    (isSupabaseConfigured as jest.Mock).mockReturnValue(true);
  });
});
