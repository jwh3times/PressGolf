import { act, renderHook, waitFor } from '@testing-library/react-native';
import { buildDemoDataset } from '../../demo/seed';
import { changesAnything, mergeShared } from '../merge-shared';
import { pullSharedOutings, pushSnapshot, reconcile } from '../remote';
import { emptySnapshot, toRows } from '../rows';
import { useDataSync } from '../useDataSync';

jest.mock('../remote', () => ({
  pullSharedOutings: jest.fn(),
  pushSnapshot: jest.fn(),
  reconcile: jest.fn(),
}));
jest.mock('../merge-shared', () => ({ changesAnything: jest.fn(), mergeShared: jest.fn() }));

const mockReconcile = reconcile as jest.MockedFunction<typeof reconcile>;
const mockPush = pushSnapshot as jest.MockedFunction<typeof pushSnapshot>;
const mockPullShared = pullSharedOutings as jest.MockedFunction<typeof pullSharedOutings>;
const mockMergeShared = mergeShared as jest.MockedFunction<typeof mergeShared>;
const mockChangesAnything = changesAnything as jest.MockedFunction<typeof changesAnything>;

const seeded = buildDemoDataset(1_750_000_000_000);
const documents = {
  groups: seeded.groups,
  courses: seeded.courses,
  rounds: seeded.rounds,
  outings: seeded.outings,
};

function options(enabled = true) {
  return {
    enabled,
    documents,
    onAdoptRemote: jest.fn(),
    onSharedData: jest.fn(),
  };
}

type SyncOptions = ReturnType<typeof options>;

async function advancePush() {
  await act(async () => {
    jest.advanceTimersByTime(2500);
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  mockReconcile.mockResolvedValue({ status: 'nothing-to-do' });
  mockPush.mockResolvedValue({ upserted: 0, deleted: 0 });
  mockPullShared.mockResolvedValue(emptySnapshot());
  mockMergeShared.mockImplementation((local) => local);
  mockChangesAnything.mockReturnValue(false);
});

afterEach(() => {
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
});

it('stays off and resets server state while disabled', async () => {
  const input = options(false);
  const view = await renderHook((props: SyncOptions) => useDataSync(props), { initialProps: input });
  expect(view.result.current).toEqual({ status: 'off', at: null, message: null });
  expect(mockReconcile).not.toHaveBeenCalled();
  await view.rerender({ ...input, documents: { ...documents, groups: [] } });
  expect(mockPush).not.toHaveBeenCalled();
});

it('adopts a remote season on first contact', async () => {
  const input = options();
  const remote = toRows(documents);
  mockReconcile.mockResolvedValueOnce({ status: 'adopted-remote', rows: 1, snapshot: remote });
  const view = await renderHook(() => useDataSync(input));

  await waitFor(() => expect(view.result.current.status).toBe('synced'));
  expect(input.onAdoptRemote).toHaveBeenCalledWith(documents);
  expect(view.result.current.at).toEqual(expect.any(Number));
});

it.each([
  ['pushed', { status: 'pushed' as const, upserted: 1, deleted: 0 }],
  ['nothing', { status: 'nothing-to-do' as const }],
])('records a successful %s first contact without adopting', async (_name, outcome) => {
  const input = options();
  mockReconcile.mockResolvedValueOnce(outcome);
  const view = await renderHook(() => useDataSync(input));
  await waitFor(() => expect(view.result.current.status).toBe('synced'));
  expect(input.onAdoptRemote).not.toHaveBeenCalled();
});

it.each([
  [new Error('offline'), 'offline'],
  ['offline', 'Could not reach the server.'],
])('reports first-contact failures without blocking local data', async (failure, message) => {
  mockReconcile.mockRejectedValueOnce(failure);
  const view = await renderHook(() => useDataSync(options()));
  await waitFor(() => expect(view.result.current.status).toBe('error'));
  expect(view.result.current).toMatchObject({ message, at: expect.any(Number) });
});

it('debounces later changes, pushes deletions, and merges changed shared data', async () => {
  const input = options();
  const merged = { ...documents, groups: [] };
  mockMergeShared.mockReturnValueOnce(merged);
  mockChangesAnything.mockReturnValueOnce(true);
  const view = await renderHook((props: SyncOptions) => useDataSync(props), { initialProps: input });
  await waitFor(() => expect(view.result.current.status).toBe('synced'));

  const changed = { ...documents, outings: [] };
  await view.rerender({ ...input, documents: changed });
  expect(mockPush).not.toHaveBeenCalled();
  await advancePush();
  await waitFor(() => expect(mockPush).toHaveBeenCalled());
  expect(input.onSharedData).toHaveBeenCalledWith(merged);
  expect(view.result.current.status).toBe('synced');
});

it('does not publish an unchanged shared merge', async () => {
  const input = options();
  const view = await renderHook((props: SyncOptions) => useDataSync(props), { initialProps: input });
  await waitFor(() => expect(view.result.current.status).toBe('synced'));
  await view.rerender({ ...input, documents: { ...documents, rounds: [] } });
  await advancePush();
  await waitFor(() => expect(mockPullShared).toHaveBeenCalled());
  expect(input.onSharedData).not.toHaveBeenCalled();
});

it('reports a later push failure and retries on the next edit', async () => {
  const input = options();
  const view = await renderHook((props: SyncOptions) => useDataSync(props), { initialProps: input });
  await waitFor(() => expect(view.result.current.status).toBe('synced'));
  mockPush.mockRejectedValueOnce(new Error('push failed'));
  await view.rerender({ ...input, documents: { ...documents, groups: [] } });
  await advancePush();
  await waitFor(() => expect(view.result.current.status).toBe('error'));

  await view.rerender({ ...input, documents: { ...documents, courses: [] } });
  await advancePush();
  await waitFor(() => expect(view.result.current.status).toBe('synced'));
  expect(mockPush).toHaveBeenCalledTimes(2);
});

it('does not push while first contact is in flight and ignores completion after unmount', async () => {
  let finish: ((value: { status: 'nothing-to-do' }) => void) | undefined;
  mockReconcile.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)));
  const input = options();
  const view = await renderHook((props: SyncOptions) => useDataSync(props), { initialProps: input });
  await view.rerender({ ...input, documents: { ...documents, groups: [] } });
  await advancePush();
  expect(mockPush).not.toHaveBeenCalled();
  await view.unmount();
  await act(async () => finish?.({ status: 'nothing-to-do' }));
  expect(input.onAdoptRemote).not.toHaveBeenCalled();
});

it('cancels a pending debounce when disabled', async () => {
  const input = options();
  const view = await renderHook((props: SyncOptions) => useDataSync(props), { initialProps: input });
  await waitFor(() => expect(view.result.current.status).toBe('synced'));
  await view.rerender({ ...input, documents: { ...documents, groups: [] } });
  await view.rerender({ ...input, enabled: false });
  await advancePush();
  expect(mockPush).not.toHaveBeenCalled();
  expect(view.result.current.status).toBe('off');
});
