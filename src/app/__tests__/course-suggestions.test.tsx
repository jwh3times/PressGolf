import React from 'react';
import { render, screen, userEvent, waitFor } from '@testing-library/react-native';
import { makeTestCourse } from '../../domain/__tests__/helpers';
import type { Course } from '../../domain/types';
import { useStore, type AppStore } from '../../store/AppStore';
import { approveSuggestion, declineSuggestion, mySuggestions, waitingSuggestions, type Suggestion } from '../../sync/suggestions';
import CourseEditorScreen from '../course/[id]';
import SuggestionsScreen from '../suggestions';

const mockRouter = { back: jest.fn(), push: jest.fn() };

jest.mock('expo-router', () => ({ useRouter: () => mockRouter, useLocalSearchParams: () => ({ id: 'course1' }) }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('../../store/AppStore', () => ({ useStore: jest.fn() }));
jest.mock('../../sync/suggestions', () => ({
  mySuggestions: jest.fn(),
  waitingSuggestions: jest.fn(),
  approveSuggestion: jest.fn(),
  declineSuggestion: jest.fn(),
}));

const course: Course = { ...makeTestCourse(), createdBy: 'someone-else' };
const suggestion = (overrides: Partial<Suggestion>): Suggestion => ({
  id: 's1',
  courseId: course.id,
  changes: [{ kind: 'hole', tee: 'white', number: 1, field: 'par', from: 4, to: 5 }],
  status: 'waiting',
  reason: null,
  conflict: null,
  createdAt: '2026-11-27T00:00:00Z',
  ...overrides,
});

/** A store holding someone else's course, with this phone's draft of it. */
function storeWith(overrides: Partial<AppStore> = {}) {
  const store = {
    courses: [course],
    ownsCourse: jest.fn(() => false),
    isAdmin: false,
    courseDraft: jest.fn(() => null),
    sendCourseDraft: jest.fn(),
    discardCourseDraft: jest.fn(),
    updateCourse: jest.fn(),
    updateHole: jest.fn(),
    updateTee: jest.fn(),
    addTee: jest.fn(),
    deleteTee: jest.fn(),
    ...overrides,
  } as unknown as AppStore;
  (useStore as jest.Mock).mockReturnValue(store);
  return store;
}

beforeEach(() => {
  jest.clearAllMocks();
  (mySuggestions as jest.Mock).mockResolvedValue([]);
  (waitingSuggestions as jest.Mock).mockResolvedValue([]);
});

describe("the course editor on someone else's course (#381)", () => {
  it('says how changes go, and offers no tee to delete', async () => {
    storeWith({ courses: [{ ...course, tees: [...course.tees, { ...course.tees[0], id: 'red', name: 'Red' }] }] });
    await render(<CourseEditorScreen />);
    expect(screen.getByText(/Someone else added this course/)).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: /Delete the/ })).toBeNull();
  });

  it("shows nothing of the kind on the golfer's own course", async () => {
    storeWith({ ownsCourse: jest.fn(() => true) });
    await render(<CourseEditorScreen />);
    expect(screen.queryByText(/Someone else added this course/)).toBeNull();
    expect(mySuggestions).not.toHaveBeenCalled();
  });

  it('lists the draft’s changes, which go straight in and which are suggestions, and sends them together', async () => {
    const draft: Course = {
      ...course,
      tees: [{ ...course.tees[0], slope: 128, holes: course.tees[0].holes.map((h, i) => (i === 0 ? { ...h, par: 5 } : h)) }],
    };
    const store = storeWith({
      courseDraft: jest.fn(() => draft),
      sendCourseDraft: jest.fn().mockResolvedValue({ applied: 1, suggestion: 's1' }),
    });
    const user = userEvent.setup();
    await render(<CourseEditorScreen />);

    expect(screen.getByText('2 unsent changes')).toBeOnTheScreen();
    expect(screen.getByText('White tee slope: none → 128 · goes straight in')).toBeOnTheScreen();
    expect(screen.getByText('White tee, hole 1 par: 4 → 5 · a suggestion')).toBeOnTheScreen();

    await user.press(screen.getByRole('button', { name: 'Send changes' }));
    expect(store.sendCourseDraft).toHaveBeenCalledWith(course.id);
    expect(await screen.findByText('1 went straight in; 1 wait for the admin.')).toBeOnTheScreen();
  });

  it("says the admin's every change goes straight in", async () => {
    storeWith({
      isAdmin: true,
      courseDraft: jest.fn(() => ({
        ...course,
        tees: [{ ...course.tees[0], holes: course.tees[0].holes.map((h, i) => (i === 0 ? { ...h, par: 5 } : h)) }],
      })),
    });
    await render(<CourseEditorScreen />);
    expect(screen.getByText(/As the admin, your changes go straight in/)).toBeOnTheScreen();
    expect(screen.getByText('White tee, hole 1 par: 4 → 5 · goes straight in')).toBeOnTheScreen();
  });

  it('keeps the changes when they can’t be sent, and says so', async () => {
    storeWith({
      courseDraft: jest.fn(() => ({ ...course, name: 'Renamed' })),
      sendCourseDraft: jest.fn().mockRejectedValue(new Error('Network request failed')),
    });
    const user = userEvent.setup();
    await render(<CourseEditorScreen />);
    await user.press(screen.getByRole('button', { name: 'Send changes' }));
    expect(await screen.findByText('Couldn’t send: Network request failed. Your changes are kept.')).toBeOnTheScreen();
  });

  it('discards the draft', async () => {
    const store = storeWith({ courseDraft: jest.fn(() => ({ ...course, name: 'Renamed' })) });
    const user = userEvent.setup();
    await render(<CourseEditorScreen />);
    await user.press(screen.getByRole('button', { name: 'Discard changes' }));
    expect(store.discardCourseDraft).toHaveBeenCalledWith(course.id);
  });

  it("shows the golfer's suggestions waiting, approved, or declined with the reason", async () => {
    storeWith();
    (mySuggestions as jest.Mock).mockResolvedValue([
      suggestion({ id: 'a' }),
      suggestion({ id: 'b', status: 'approved' }),
      suggestion({ id: 'c', status: 'declined', reason: 'The card says 4.' }),
    ]);
    await render(<CourseEditorScreen />);
    expect(await screen.findByText('Waiting for the admin')).toBeOnTheScreen();
    expect(screen.getByText('Approved')).toBeOnTheScreen();
    expect(screen.getByText('Declined')).toBeOnTheScreen();
    expect(screen.getByText('Reason: The card says 4.')).toBeOnTheScreen();
    expect(mySuggestions).toHaveBeenCalledWith(course.id);
  });
});

describe('the admin’s review (#381)', () => {
  it('is for the admin alone', async () => {
    storeWith({ isAdmin: false });
    await render(<SuggestionsScreen />);
    expect(screen.getByText('Only the admin reviews suggested changes.')).toBeOnTheScreen();
    expect(waitingSuggestions).not.toHaveBeenCalled();
  });

  it('shows how many wait, each as its changes, and approves one', async () => {
    storeWith({ isAdmin: true });
    (waitingSuggestions as jest.Mock).mockResolvedValueOnce([suggestion({})]).mockResolvedValue([]);
    (approveSuggestion as jest.Mock).mockResolvedValue('approved');
    const user = userEvent.setup();
    await render(<SuggestionsScreen />);
    expect(await screen.findByText('1 waiting')).toBeOnTheScreen();
    expect(screen.getByText('White tee, hole 1 par: 4 → 5')).toBeOnTheScreen();

    await user.press(screen.getByRole('button', { name: 'Approve' }));
    expect(approveSuggestion).toHaveBeenCalledWith('s1');
    expect(await screen.findByText('Nothing is waiting.')).toBeOnTheScreen();
  });

  it('says so when a value changed since, and the suggestion keeps waiting', async () => {
    storeWith({ isAdmin: true });
    (waitingSuggestions as jest.Mock).mockResolvedValue([suggestion({})]);
    (approveSuggestion as jest.Mock).mockResolvedValue('conflict');
    const user = userEvent.setup();
    await render(<SuggestionsScreen />);
    await user.press(await screen.findByRole('button', { name: 'Approve' }));
    expect(await screen.findByText('A value it replaces has changed since. It keeps waiting.')).toBeOnTheScreen();
  });

  it('declines only with a reason', async () => {
    storeWith({ isAdmin: true });
    (waitingSuggestions as jest.Mock).mockResolvedValue([suggestion({})]);
    (declineSuggestion as jest.Mock).mockResolvedValue(undefined);
    const user = userEvent.setup();
    await render(<SuggestionsScreen />);
    await user.press(await screen.findByRole('button', { name: 'Decline' }));
    expect(screen.getByText('Give a reason to decline: the golfer sees it.')).toBeOnTheScreen();
    expect(declineSuggestion).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText('Reason, to decline'), 'The card says 4.');
    await user.press(screen.getByRole('button', { name: 'Decline' }));
    await waitFor(() => expect(declineSuggestion).toHaveBeenCalledWith('s1', 'The card says 4.'));
  });
});
