import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { DEMO_MODE_DEFAULT } from '../config/flags';
import { buildDemoDataset } from '../demo/seed';
import { RoundContext, settleOuting, settleRound } from '../domain/engine';
import { defaultTeams, makeId, reconcileRound } from '../domain/factory';
import { handicapPops } from '../domain/handicap';
import type {
  Course,
  FieldGameConfig,
  FieldGameKey,
  GameKey,
  GameOptions,
  Group,
  Hole,
  JunkKind,
  Outing,
  OutingSettlement,
  Player,
  PlayerId,
  Round,
  Settlement,
  Tee,
  TeeId,
} from '../domain/types';
import { useAuth } from '../auth/AuthProvider';
import { useDataSync, type SyncState } from '../sync/useDataSync';
import type { Documents } from '../sync/rows';
import { clearDataset, loadDataset, loadSettings, saveDataset, saveSettings } from './persistence';

interface Dataset {
  groups: Group[];
  courses: Course[];
  rounds: Round[];
  outings: Outing[];
  activeGroupId: string | null;
  activeRoundId: string | null;
  activeOutingId: string | null;
  /** A finished card being typed in. While set it stands in for the live round, which is left alone. */
  cardRoundId: string | null;
}

interface AppState extends Dataset {
  ready: boolean;
  demoMode: boolean;
}

/** A playing group as the organiser screen edits it. */
export interface OutingGroupDraft {
  roundId: string | null;
  name: string;
  teeTime: string | null;
  playerIds: PlayerId[];
}

export interface AppStore extends AppState {
  /** Where this phone's data stands with the server. Never blocks an edit. */
  sync: SyncState;
  // Derived — the active round (one foursome)
  group: Group | null;
  course: Course | null;
  round: Round | null;
  settlement: Settlement | null;

  // Derived — the active outing (a whole day, if there is one)
  outing: Outing | null;
  outingCourse: Course | null;
  outingGroup: Group | null;
  outingRounds: Round[];
  outingSettlement: OutingSettlement | null;

  // Outings
  startOuting(outing: Outing, groups: Round[]): void;
  setActiveOuting(id: string | null): void;
  updateOuting(patch: Partial<Outing>): void;
  setFieldGame(key: FieldGameKey, patch: Partial<FieldGameConfig>): void;
  toggleFieldEntrant(key: FieldGameKey, playerId: PlayerId): void;
  setOutingGroups(groups: OutingGroupDraft[]): void;
  completeOuting(id: string): void;

  // Mode
  setDemoMode(on: boolean): void;
  resetDemoData(): void;
  eraseLiveData(): void;

  // Groups and players
  createGroup(name: string): Group;
  updateGroup(id: string, patch: Partial<Group>): void;
  deleteGroup(id: string): void;
  setActiveGroup(id: string): void;
  addPlayer(groupId: string, player: Player): void;
  updatePlayer(groupId: string, playerId: PlayerId, patch: Partial<Player>): void;
  removePlayer(groupId: string, playerId: PlayerId): void;

  // Courses
  createCourse(course: Course): void;
  updateCourse(id: string, patch: Partial<Course>): void;
  updateHole(courseId: string, teeId: TeeId, holeIndex: number, patch: Partial<Hole>): void;
  /** Copies an existing tee's card under a new name. Null when the course is unknown. */
  addTee(courseId: string, fromTeeId: TeeId, name: string): Tee | null;
  updateTee(courseId: string, teeId: TeeId, patch: Partial<Pick<Tee, 'name' | 'slope' | 'rating'>>): void;
  /** False — and nothing changes — when it is the course's last tee or a saved round plays from it. */
  deleteTee(courseId: string, teeId: TeeId): boolean;
  deleteCourse(id: string): void;

  // Rounds
  startRound(round: Round): void;
  setActiveRound(id: string | null): void;
  completeRound(id: string): void;
  reopenRound(id: string): void;
  deleteRound(id: string): void;

  // Card entry: a finished paper card, typed in beside whatever round is live
  startCard(round: Round): void;
  /** Completes the card on the day it was played. Empty boxes become pick-ups when asked. */
  saveCard(markBlanksPickedUp: boolean): void;
  discardCard(): void;

  // Live round edits
  setScore(playerId: PlayerId, hole: number, value: number | null): void;
  /** Stops at the round's max score, when it has one. */
  bumpScore(playerId: PlayerId, hole: number, delta: number): void;
  /** A pick-up empties the box; a score in the box clears the pick-up. */
  setPickedUp(playerId: PlayerId, hole: number, on: boolean): void;
  setPops(playerId: PlayerId, pops: number): void;
  /** Re-derives everyone's pops from their index, overwriting typed ones; anyone without an index keeps theirs. */
  recalculatePops(): void;
  toggleJunk(hole: number, playerId: PlayerId, kind: JunkKind): void;
  toggleGame(key: GameKey): void;
  setStake(key: GameKey, cents: number): void;
  setOptions(patch: Partial<GameOptions>): void;
  addPress(by: PlayerId, against: PlayerId, startHole: number, endHole: number, stake: number): void;
  removePress(pressId: string): void;
  setWolfPick(hole: number, wolf: PlayerId, partner: PlayerId | null): void;
  setRoundPlayers(playerIds: PlayerId[]): void;
  setRoundTee(teeId: TeeId): void;
  /** A player on the round's own tee needs no entry, so choosing it clears theirs. */
  setPlayerTee(playerId: PlayerId, teeId: TeeId): void;
}

const EMPTY_STATE: AppState = {
  ready: false,
  demoMode: DEMO_MODE_DEFAULT,
  groups: [],
  courses: [],
  rounds: [],
  outings: [],
  activeGroupId: null,
  activeRoundId: null,
  activeOutingId: null,
  cardRoundId: null,
};

/** Writes one box of the card. A score and a pick-up can never both stand in it. */
function withCell(round: Round, playerId: PlayerId, hole: number, value: number | null, pickedUp: boolean): Round {
  const row = (round.scores[playerId] ?? []).slice();
  row[hole] = value;
  const pickups = { ...round.pickups };
  if (pickedUp) pickups[`${hole}:${playerId}`] = true;
  else delete pickups[`${hole}:${playerId}`];
  return { ...round, scores: { ...round.scores, [playerId]: row }, pickups };
}

/**
 * Rounds with pops taken from their players' handicap indexes. An outing's
 * rounds are worked out against the whole field, including its rounds already
 * in the store.
 */
function withHandicapPops(state: AppState, rounds: Round[]): Round[] {
  const first = rounds[0];
  const course = first && state.courses.find((c) => c.id === first.courseId);
  if (!course) return rounds;
  const roster = state.groups.find((g) => g.id === first.groupId)?.players ?? [];
  const ids = new Set(rounds.map((r) => r.id));
  const others = first.outingId
    ? state.rounds.filter((r) => r.outingId === first.outingId && !ids.has(r.id))
    : [];
  const pops = handicapPops([...rounds, ...others], course, roster);
  return rounds.map((r) => ({ ...r, pops: pops.get(r.id) ?? r.pops }));
}

/** Points the store at a round: a card round opens in the card slot, a live one as the active round. */
function focusRound(state: AppState, id: string | null): AppState {
  const round = state.rounds.find((r) => r.id === id);
  if (round?.entry === 'card') return { ...state, cardRoundId: round.id };
  return { ...state, activeRoundId: id };
}

/** Finishes a round. A card is dated the day it was played, not the day it was typed in. */
function completeIn(state: AppState, id: string, markBlanksPickedUp: boolean): AppState {
  const rounds = state.rounds.map((r) => {
    if (r.id !== id) return r;
    const pickups = { ...r.pickups };
    if (markBlanksPickedUp) {
      for (const playerId of r.playerIds) {
        (r.scores[playerId] ?? []).forEach((score, hole) => {
          if (score == null) pickups[`${hole}:${playerId}`] = true;
        });
      }
    }
    const completedAt = r.entry === 'card' ? r.startedAt : Date.now();
    return { ...r, pickups, status: 'completed' as const, completedAt };
  });
  return {
    ...state,
    rounds,
    activeRoundId: state.activeRoundId === id ? null : state.activeRoundId,
    cardRoundId: state.cardRoundId === id ? null : state.cardRoundId,
  };
}

const StoreContext = createContext<AppStore | null>(null);

export function AppStoreProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AppState>(EMPTY_STATE);
  // Writes are debounced, so a burst of +/- taps doesn't hammer AsyncStorage.
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const persist = useCallback((next: AppState) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void saveDataset(next.demoMode, {
        groups: next.groups,
        courses: next.courses,
        rounds: next.rounds,
        outings: next.outings,
        activeGroupId: next.activeGroupId,
        activeRoundId: next.activeRoundId,
        activeOutingId: next.activeOutingId,
        cardRoundId: next.cardRoundId,
      });
    }, 250);
  }, []);

  /** Every mutation goes through here so nothing can change state without being saved. */
  const commit = useCallback(
    (fn: (prev: AppState) => AppState) => {
      setState((prev) => {
        const next = fn(prev);
        if (next === prev) return prev;
        persist(next);
        return next;
      });
    },
    [persist],
  );

  // Initial load.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const settings = await loadSettings({
        demoMode: DEMO_MODE_DEFAULT,
        activeGroupId: null,
        activeRoundId: null,
        activeOutingId: null,
      });
      const dataset = await hydrate(settings.demoMode);
      if (cancelled) return;
      setState({ ready: true, demoMode: settings.demoMode, ...dataset });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const setDemoMode = useCallback((on: boolean) => {
    setState((prev) => ({ ...prev, ready: false }));
    void (async () => {
      const dataset = await hydrate(on);
      await saveSettings({
        demoMode: on,
        activeGroupId: dataset.activeGroupId,
        activeRoundId: dataset.activeRoundId,
        activeOutingId: dataset.activeOutingId,
      });
      setState({ ready: true, demoMode: on, ...dataset });
    })();
  }, []);

  const auth = useAuth();

  // Demo data is never synced: it is invented, and it would land in a real
  // account's season looking exactly like a real Saturday.
  const syncEnabled = state.ready && !state.demoMode && auth.status === 'signed-in';

  const documents = useMemo<Documents>(
    () => ({
      groups: state.groups,
      courses: state.courses,
      rounds: state.rounds,
      outings: state.outings,
    }),
    [state.groups, state.courses, state.rounds, state.outings],
  );

  const adoptRemote = useCallback(
    (remote: Documents) => {
      // A phone with nothing on it, signing in to an account that already has a
      // season. Take what is there rather than pushing emptiness over it.
      commit((prev) => ({
        ...prev,
        groups: remote.groups,
        courses: remote.courses,
        rounds: remote.rounds,
        outings: remote.outings,
      }));
    },
    [commit],
  );

  const takeShared = useCallback(
    (merged: Documents) => {
      // Scores other phones entered on a day we are all playing. Everything
      // outside that day is left exactly as it was.
      commit((prev) => ({
        ...prev,
        groups: merged.groups,
        courses: merged.courses,
        rounds: merged.rounds,
        outings: merged.outings,
      }));
    },
    [commit],
  );

  const sync = useDataSync({
    enabled: syncEnabled,
    documents,
    onAdoptRemote: adoptRemote,
    onSharedData: takeShared,
  });

  const store = useMemo<AppStore>(() => {
    const group = state.groups.find((g) => g.id === state.activeGroupId) ?? state.groups[0] ?? null;
    const round =
      state.rounds.find((r) => r.id === state.cardRoundId) ??
      state.rounds.find((r) => r.id === state.activeRoundId) ??
      null;
    const course = round ? state.courses.find((c) => c.id === round.courseId) ?? null : null;
    const outing = state.outings.find((o) => o.id === state.activeOutingId) ?? null;
    const outingCourse = outing ? state.courses.find((c) => c.id === outing.courseId) ?? null : null;
    const outingGroup = outing ? state.groups.find((g) => g.id === outing.groupId) ?? null : null;

    let settlement: Settlement | null = null;
    if (round && course && group) {
      settlement = settleRound(round, course, group.players);
    }

    // The whole day, when there is one: every group's games plus the field pots.
    let outingSettlement: OutingSettlement | null = null;
    if (outing && outingCourse && outingGroup) {
      outingSettlement = settleOuting(outing, state.rounds, outingCourse, outingGroup.players);
    }

    const patchOuting = (fn: (o: Outing) => Outing) =>
      commit((prev) => {
        if (!prev.activeOutingId) return prev;
        const idx = prev.outings.findIndex((o) => o.id === prev.activeOutingId);
        if (idx < 0) return prev;
        const outings = prev.outings.slice();
        outings[idx] = fn(outings[idx]);
        return { ...prev, outings };
      });

    /** Applies a patch to the active round. No active round means the call is a no-op. */
    const patchRound = (fn: (r: Round, prev: AppState) => Round) =>
      commit((prev) => {
        let idx = prev.rounds.findIndex((r) => r.id === prev.cardRoundId);
        if (idx < 0) idx = prev.rounds.findIndex((r) => r.id === prev.activeRoundId);
        if (idx < 0) return prev;
        const rounds = prev.rounds.slice();
        rounds[idx] = fn(rounds[idx], prev);
        return { ...prev, rounds };
      });

    return {
      ...state,
      sync,
      group,
      course,
      round,
      settlement,
      outing,
      outingCourse,
      outingGroup,
      outingSettlement,
      outingRounds: outing
        ? outing.roundIds
            .map((id) => state.rounds.find((r) => r.id === id))
            .filter((r): r is Round => r != null)
        : [],

      startOuting: (created, groups) =>
        commit((prev) => ({
          ...prev,
          outings: [...prev.outings, created],
          rounds: [...prev.rounds, ...withHandicapPops(prev, groups)],
          activeOutingId: created.id,
          activeGroupId: created.groupId,
          // Drop the phone straight into whichever group holds "you".
          activeRoundId:
            groups.find((r) =>
              r.playerIds.includes(
                prev.groups.find((g) => g.id === created.groupId)?.youId ?? '',
              ),
            )?.id ??
            groups[0]?.id ??
            null,
        })),
      setActiveOuting: (id) => commit((prev) => ({ ...prev, activeOutingId: id })),
      updateOuting: (patch) =>
        commit((prev) => {
          const current = prev.outings.find((o) => o.id === prev.activeOutingId);
          if (!current) return prev;
          const updated = { ...current, ...patch };
          // The whole field plays one max-score and handicap rule, so every group follows the outing's.
          const locked = patch.maxScore !== undefined || patch.strokes !== undefined || patch.allowance !== undefined;
          const rounds = locked
            ? prev.rounds.map((r) =>
                r.outingId === current.id
                  ? {
                      ...r,
                      options: {
                        ...r.options,
                        maxScore: updated.maxScore,
                        strokes: updated.strokes,
                        allowance: updated.allowance,
                      },
                    }
                  : r,
              )
            : prev.rounds;
          return { ...prev, outings: prev.outings.map((o) => (o.id === current.id ? updated : o)), rounds };
        }),
      setFieldGame: (key, patch) =>
        patchOuting((o) => ({
          ...o,
          fieldGames: { ...o.fieldGames, [key]: { ...o.fieldGames[key], ...patch } },
        })),
      toggleFieldEntrant: (key, playerId) =>
        patchOuting((o) => {
          const config = o.fieldGames[key];
          const entrants = config.entrants.includes(playerId)
            ? config.entrants.filter((id) => id !== playerId)
            : [...config.entrants, playerId];
          return { ...o, fieldGames: { ...o.fieldGames, [key]: { ...config, entrants } } };
        }),
      setOutingGroups: (groups) =>
        commit((prev) => {
          if (!prev.activeOutingId) return prev;
          const outingIdx = prev.outings.findIndex((o) => o.id === prev.activeOutingId);
          if (outingIdx < 0) return prev;
          const current = prev.outings[outingIdx];
          const holeCount =
            prev.courses.find((c) => c.id === current.courseId)?.tees[0]?.holes.length ?? 18;

          // Existing groups keep their cards and bets; only the make-up changes.
          const byId = new Map(prev.rounds.map((r) => [r.id, r]));
          const updated = groups.map((g) => {
            const existing = g.roundId ? byId.get(g.roundId) : undefined;
            if (!existing) return null;
            return reconcileRound(
              { ...existing, playerIds: g.playerIds, name: g.name, teeTime: g.teeTime },
              holeCount,
            );
          });

          const rounds = prev.rounds.map((r) => updated.find((u) => u?.id === r.id) ?? r);
          return {
            ...prev,
            rounds,
            outings: prev.outings.map((o) =>
              o.id === current.id ? { ...o, roundIds: groups.map((g) => g.roundId!) } : o,
            ),
          };
        }),
      completeOuting: (id) =>
        commit((prev) => ({
          ...prev,
          outings: prev.outings.map((o) =>
            o.id === id ? { ...o, status: 'completed' as const, completedAt: Date.now() } : o,
          ),
          rounds: prev.rounds.map((r) =>
            r.outingId === id ? { ...r, status: 'completed' as const, completedAt: Date.now() } : r,
          ),
          activeOutingId: prev.activeOutingId === id ? null : prev.activeOutingId,
          activeRoundId: null,
        })),

      setDemoMode,
      resetDemoData: () => {
        void (async () => {
          await clearDataset(true);
          if (state.demoMode) {
            const dataset = await hydrate(true);
            setState((prev) => ({ ...prev, ...dataset }));
          }
        })();
      },
      eraseLiveData: () => {
        void (async () => {
          await clearDataset(false);
          if (!state.demoMode) {
            setState((prev) => ({
              ...prev,
              groups: [],
              courses: [],
              rounds: [],
              outings: [],
              activeGroupId: null,
              activeRoundId: null,
              activeOutingId: null,
              cardRoundId: null,
            }));
          }
        })();
      },

      createGroup: (name) => {
        const created: Group = {
          id: makeId('g'),
          name,
          players: [],
          youId: null,
          defaultCourseId: null,
          maxScore: 'off',
          strokes: 'off_low',
          allowance: 100,
          subtitle: '',
          createdAt: Date.now(),
        };
        commit((prev) => ({ ...prev, groups: [...prev.groups, created], activeGroupId: created.id }));
        return created;
      },
      updateGroup: (id, patch) =>
        commit((prev) => ({
          ...prev,
          groups: prev.groups.map((g) => (g.id === id ? { ...g, ...patch } : g)),
        })),
      deleteGroup: (id) =>
        commit((prev) => {
          const groups = prev.groups.filter((g) => g.id !== id);
          const rounds = prev.rounds.filter((r) => r.groupId !== id);
          const activeGroupId = prev.activeGroupId === id ? groups[0]?.id ?? null : prev.activeGroupId;
          const activeRoundId = rounds.some((r) => r.id === prev.activeRoundId) ? prev.activeRoundId : null;
          return { ...prev, groups, rounds, activeGroupId, activeRoundId };
        }),
      setActiveGroup: (id) => commit((prev) => ({ ...prev, activeGroupId: id })),

      addPlayer: (groupId, player) =>
        commit((prev) => ({
          ...prev,
          groups: prev.groups.map((g) =>
            g.id === groupId
              ? { ...g, players: [...g.players, player], youId: g.youId ?? player.id }
              : g,
          ),
        })),
      updatePlayer: (groupId, playerId, patch) =>
        commit((prev) => ({
          ...prev,
          groups: prev.groups.map((g) =>
            g.id === groupId
              ? { ...g, players: g.players.map((p) => (p.id === playerId ? { ...p, ...patch } : p)) }
              : g,
          ),
        })),
      removePlayer: (groupId, playerId) =>
        commit((prev) => {
          const groups = prev.groups.map((g) => {
            if (g.id !== groupId) return g;
            const players = g.players.filter((p) => p.id !== playerId);
            return { ...g, players, youId: g.youId === playerId ? players[0]?.id ?? null : g.youId };
          });
          // Drop them from any round that has not been settled; completed rounds
          // keep their history so the season ledger stays truthful.
          const rounds = prev.rounds.map((r) => {
            if (r.groupId !== groupId || r.status === 'completed' || !r.playerIds.includes(playerId)) return r;
            const playerIds = r.playerIds.filter((id) => id !== playerId);
            const roundCourse = prev.courses.find((c) => c.id === r.courseId);
            return reconcileRound({ ...r, playerIds }, roundCourse?.tees[0]?.holes.length ?? 18);
          });
          return { ...prev, groups, rounds };
        }),

      createCourse: (created) =>
        commit((prev) => ({ ...prev, courses: [...prev.courses, created] })),
      updateCourse: (id, patch) =>
        commit((prev) => ({
          ...prev,
          courses: prev.courses.map((c) => (c.id === id ? { ...c, ...patch } : c)),
        })),
      updateHole: (courseId, teeId, holeIndex, patch) =>
        commit((prev) => ({
          ...prev,
          courses: prev.courses.map((c) =>
            c.id !== courseId
              ? c
              : {
                  ...c,
                  tees: c.tees.map((t) => {
                    if (t.id !== teeId) return t;
                    const holes = t.holes.slice();
                    holes[holeIndex] = { ...holes[holeIndex], ...patch };
                    return { ...t, holes };
                  }),
                },
          ),
        })),
      addTee: (courseId, fromTeeId, name) => {
        const from = state.courses.find((c) => c.id === courseId)?.tees.find((t) => t.id === fromTeeId);
        if (!from) return null;
        const created: Tee = { ...from, id: makeId('t'), name, holes: from.holes.map((h) => ({ ...h })) };
        commit((prev) => ({
          ...prev,
          courses: prev.courses.map((c) => (c.id === courseId ? { ...c, tees: [...c.tees, created] } : c)),
        }));
        return created;
      },
      updateTee: (courseId, teeId, patch) =>
        commit((prev) => ({
          ...prev,
          courses: prev.courses.map((c) =>
            c.id === courseId ? { ...c, tees: c.tees.map((t) => (t.id === teeId ? { ...t, ...patch } : t)) } : c,
          ),
        })),
      deleteTee: (courseId, teeId) => {
        const target = state.courses.find((c) => c.id === courseId);
        const inUse = state.rounds.some(
          (r) => r.teeId === teeId || Object.values(r.playerTees).includes(teeId),
        );
        if (!target || target.tees.length < 2 || inUse) return false;
        commit((prev) => ({
          ...prev,
          courses: prev.courses.map((c) =>
            c.id === courseId ? { ...c, tees: c.tees.filter((t) => t.id !== teeId) } : c,
          ),
        }));
        return true;
      },
      deleteCourse: (id) =>
        commit((prev) => ({
          ...prev,
          courses: prev.courses.filter((c) => c.id !== id),
          groups: prev.groups.map((g) =>
            g.defaultCourseId === id ? { ...g, defaultCourseId: null } : g,
          ),
        })),

      startRound: (created) =>
        commit((prev) => ({
          ...prev,
          rounds: [...prev.rounds, ...withHandicapPops(prev, [created])],
          activeRoundId: created.id,
          activeGroupId: created.groupId,
        })),
      // A card round opens in the card slot, never as the live round.
      setActiveRound: (id) => commit((prev) => focusRound(prev, id)),
      completeRound: (id) => commit((prev) => completeIn(prev, id, false)),
      reopenRound: (id) =>
        commit((prev) =>
          focusRound(
            {
              ...prev,
              rounds: prev.rounds.map((r) =>
                r.id === id ? { ...r, status: 'active' as const, completedAt: null } : r,
              ),
            },
            id,
          ),
        ),
      deleteRound: (id) =>
        commit((prev) => ({
          ...prev,
          rounds: prev.rounds.filter((r) => r.id !== id),
          activeRoundId: prev.activeRoundId === id ? null : prev.activeRoundId,
          cardRoundId: prev.cardRoundId === id ? null : prev.cardRoundId,
        })),

      startCard: (created) =>
        commit((prev) => ({
          ...prev,
          rounds: [...prev.rounds, created],
          cardRoundId: created.id,
          activeGroupId: created.groupId,
        })),
      saveCard: (markBlanksPickedUp) =>
        commit((prev) => (prev.cardRoundId ? completeIn(prev, prev.cardRoundId, markBlanksPickedUp) : prev)),
      discardCard: () =>
        commit((prev) =>
          prev.cardRoundId
            ? { ...prev, rounds: prev.rounds.filter((r) => r.id !== prev.cardRoundId), cardRoundId: null }
            : prev,
        ),

      setScore: (playerId, hole, value) => patchRound((r) => withCell(r, playerId, hole, value, false)),
      bumpScore: (playerId, hole, delta) =>
        patchRound((r) => {
          const current = r.scores[playerId]?.[hole];
          // First tap from blank lands on par, not on 1 or 13.
          const par = course ? new RoundContext(r, course, []).par(hole, playerId) : 4;
          const base = current == null ? par - delta : current;
          const max = course ? new RoundContext(r, course, []).maxScore(playerId, hole) : null;
          const next = Math.max(1, Math.min(max ?? 20, base + delta));
          return withCell(r, playerId, hole, next, false);
        }),
      setPickedUp: (playerId, hole, on) =>
        patchRound((r) => withCell(r, playerId, hole, on ? null : (r.scores[playerId]?.[hole] ?? null), on)),
      setPops: (playerId, pops) =>
        patchRound((r) => {
          // A plus handicap gives strokes back, down to one on every hole; off the low man nobody is below zero.
          const floor = r.options.strokes === 'full' ? -18 : 0;
          return { ...r, pops: { ...r.pops, [playerId]: Math.max(floor, Math.min(54, Math.round(pops))) } };
        }),
      recalculatePops: () => patchRound((r, prev) => withHandicapPops(prev, [r])[0]),
      toggleJunk: (hole, playerId, kind) =>
        patchRound((r) => {
          const key = `${hole}:${playerId}:${kind}`;
          const junk = { ...r.junk };
          if (junk[key]) delete junk[key];
          else junk[key] = true;
          return { ...r, junk };
        }),
      toggleGame: (key) =>
        patchRound((r) => {
          const on = !r.games[key].on;
          const games = { ...r.games, [key]: { ...r.games[key], on } };
          // Turning on a team game with no sides set picks the obvious default
          // rather than leaving the format silently unable to pay.
          let options = r.options;
          if (on && (key === 'bestball' || key === 'vegas') && options.teams.length < 2) {
            options = { ...options, teams: defaultTeams(r.playerIds) };
          }
          return { ...r, games, options };
        }),
      setStake: (key, cents) =>
        patchRound((r) => ({
          ...r,
          games: { ...r.games, [key]: { ...r.games[key], stake: Math.max(0, Math.round(cents)) } },
        })),
      setOptions: (patch) => patchRound((r) => ({ ...r, options: { ...r.options, ...patch } })),
      // Presses and Wolf picks are called on the course; a finished card cannot carry them.
      addPress: (by, against, startHole, endHole, stake) =>
        patchRound((r) => r.entry === 'card' ? r : ({
          ...r,
          presses: [...r.presses, { id: makeId('press'), by, against, startHole, endHole, stake }],
        })),
      removePress: (pressId) =>
        patchRound((r) => ({ ...r, presses: r.presses.filter((p) => p.id !== pressId) })),
      setWolfPick: (hole, wolf, partner) =>
        patchRound((r) => {
          if (r.entry === 'card') return r;
          const picks = r.wolfPicks.filter((p) => p.hole !== hole);
          return { ...r, wolfPicks: [...picks, { hole, wolf, partner }].sort((a, b) => a.hole - b.hole) };
        }),
      setRoundTee: (teeId) => patchRound((r) => ({ ...r, teeId })),
      setPlayerTee: (playerId, teeId) =>
        patchRound((r) => {
          const playerTees = { ...r.playerTees };
          const roundTee = r.teeId ?? course?.tees[0]?.id ?? null;
          if (teeId === roundTee) delete playerTees[playerId];
          else playerTees[playerId] = teeId;
          return { ...r, playerTees };
        }),
      setRoundPlayers: (playerIds) =>
        patchRound((r) => reconcileRound({ ...r, playerIds }, course?.tees[0]?.holes.length ?? 18)),
    };
  }, [state, sync, commit, setDemoMode]);

  // Keep the demo/live preference and the active pointers in sync on disk.
  useEffect(() => {
    if (!state.ready) return;
    void saveSettings({
      demoMode: state.demoMode,
      activeGroupId: state.activeGroupId,
      activeRoundId: state.activeRoundId,
      activeOutingId: state.activeOutingId,
    });
  }, [state.ready, state.demoMode, state.activeGroupId, state.activeRoundId, state.activeOutingId]);

  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}

/**
 * Loads a dataset, seeding the demo one the first time it is opened.
 *
 * Live mode is never seeded — an empty app is the correct starting state for a
 * real group, and inventing players for them would poison their ledger.
 */
async function hydrate(demoMode: boolean): Promise<Dataset> {
  const stored = await loadDataset(demoMode);
  if (demoMode && stored.groups.length === 0) {
    const seeded = buildDemoDataset();
    await saveDataset(true, seeded);
    return seeded;
  }
  return {
    groups: stored.groups,
    courses: stored.courses,
    rounds: stored.rounds,
    outings: stored.outings,
    activeGroupId: stored.activeGroupId,
    activeRoundId: stored.activeRoundId,
    activeOutingId: stored.activeOutingId,
    cardRoundId: stored.cardRoundId,
  };
}

export function useStore(): AppStore {
  const store = useContext(StoreContext);
  if (!store) throw new Error('useStore must be used inside AppStoreProvider');
  return store;
}
