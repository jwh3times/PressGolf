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
import { withClub } from '../domain/bag';
import { hitFields, inBag } from '../domain/marks';
import { trackedShots } from '../domain/tracked-shots';
import { withNote } from '../domain/course-map';
import { defaultTeams, makeId, reconcileRound } from '../domain/factory';
import { DEFAULT_HOUSE_RULES, houseRules } from '../domain/formats';
import { withGreen } from '../domain/geo';
import { withHandicapPops } from '../domain/handicap';
import type {
  Club,
  Course,
  FieldGameConfig,
  FieldGameKey,
  GameKey,
  GameOptions,
  CourseFeature,
  Green,
  Group,
  Hole,
  JunkKind,
  Mark,
  MarkHit,
  Outing,
  OutingSettlement,
  Player,
  PlayerId,
  PracticeMark,
  UsualScore,
  Round,
  RoundId,
  Settlement,
  Tee,
  TeeId,
} from '../domain/types';
import { useAuth } from '../auth/AuthProvider';
import { applyFollowed, type MoveNotice } from '../sync/move-notices';
import { deleteAccount as deleteAccountRemote } from '../sync/supabase';
import { useDataSync, type SyncState } from '../sync/useDataSync';
import type { Documents, SeenCells } from '../sync/rows';
import { clearDataset, loadDataset, loadSettings, saveDataset, saveSettings } from './persistence';

interface Dataset {
  groups: Group[];
  courses: Course[];
  rounds: Round[];
  outings: Outing[];
  /** The phone owner's bag (#125). */
  clubs: Club[];
  /** How the bag's owner usually scores, once they've said (#146). */
  usualScore: UsualScore | null;
  /** Rounds this phone marked as practice (#136). Saved here, never synced. */
  practice: Record<RoundId, PracticeMark>;
  /** The bag's owner's marks (#295), synced with their account like the bag (#296). */
  marks: Mark[];
  activeGroupId: string | null;
  /**
   * Each group's open round, at most one per group (#258). The active group's is
   * the one on Home and Score; another group's waits for a switch back. Held as
   * round ids, which never change, rather than keyed by group ids, which can.
   */
  openRoundIds: RoundId[];
  activeOutingId: string | null;
  /**
   * A finished card being typed in. While its group is active it stands in for
   * that group's live round, which is left alone.
   */
  cardRoundId: string | null;
  seenCells: SeenCells | null;
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
  // Derived — the active group, and its open round (one foursome)
  group: Group | null;
  /** The active group's open live round, if it has one. A card being typed in is not it. */
  activeRoundId: RoundId | null;
  /**
   * The group the active round belongs to: its players and its "you". The
   * active group, since a group only shows its own round; a round whose group
   * has gone falls back to the active one.
   */
  roundGroup: Group | null;
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
  /**
   * Deletes the account from the server, then erases the live dataset and signs
   * out. Throws a message worth showing, with the phone unchanged, if the server
   * says no or can't be reached. Sync is off throughout.
   */
  deleteAccount(password: string): Promise<void>;

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
  /** Saves where a hole's green is, replacing what the course had for that hole. */
  setGreen(courseId: string, green: Green): void;
  /** Replaces all of a course's greens, as an import does. */
  setGreens(courseId: string, greens: Green[]): void;
  /** Replaces all of a course's map: its hazards, fairways and the like (#125). */
  setFeatures(courseId: string, features: CourseFeature[]): void;
  /** Sets the owner's note on a hole, trimmed to fit (#136). A blank note takes it away. */
  setNote(courseId: string, hole: number, text: string): void;
  deleteCourse(id: string): void;

  // The bag
  /** Adds a club where it belongs in the bag; nothing for a name already there. */
  addClub(name: string): void;
  /** A whole set of clubs, with no carries yet, for an empty bag. */
  fillBag(clubs: Club[]): void;
  setCarry(id: string, carry: number | null): void;
  /** Sets a club's carry to its tracked carry (#297); nothing for a club without one yet. Press never does this on its own. */
  takeTrackedCarry(id: string): void;
  removeClub(id: string): void;
  setUsualScore(score: UsualScore): void;

  // Marking the ball (#295)
  /**
   * Marks where the owner's ball lies on a hole of a live round, with what
   * they're about to hit. False, and nothing saved, for no such round, a card
   * being typed in, or a club that isn't in the bag.
   */
  markBall(roundId: RoundId, hole: number, fix: Pick<Mark, 'position' | 'accuracy'>, hit: MarkHit): boolean;
  /** Changes what was hit from a mark; nothing for a club that isn't in the bag. */
  changeMark(id: string, hit: MarkHit): void;
  undoMark(id: string): void;

  // Rounds
  startRound(round: Round): void;
  /**
   * Marks a round as practice on this phone, or not, which decides whether
   * aiming advice is shown in it. Once on, the round stays marked as having been.
   */
  setPractice(roundId: string, on: boolean): void;
  setActiveRound(id: string | null): void;
  completeRound(id: string): void;
  /** Closes a round without posting it: it stays in History and never counts in the ledger. */
  abandonRound(id: string): void;
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
  /** A press runs from `startHole` to the end of that nine, at the Nassau stake. */
  addPress(by: PlayerId, against: PlayerId, startHole: number): void;
  removePress(pressId: string): void;
  setWolfPick(hole: number, wolf: PlayerId, partner: PlayerId | null): void;
  /** Leaves the hole with no pick at all; a null partner on setWolfPick is a lone wolf. */
  clearWolfPick(hole: number): void;
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
  clubs: [],
  usualScore: null,
  practice: {},
  marks: [],
  activeGroupId: null,
  openRoundIds: [],
  activeOutingId: null,
  cardRoundId: null,
  seenCells: null,
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
function withFieldHandicapPops(state: AppState, rounds: Round[]): Round[] {
  const first = rounds[0];
  const course = first && state.courses.find((c) => c.id === first.courseId);
  if (!course) return rounds;
  const roster = state.groups.find((g) => g.id === first.groupId)?.players ?? [];
  const ids = new Set(rounds.map((r) => r.id));
  const others = first.outingId
    ? state.rounds.filter((r) => r.outingId === first.outingId && !ids.has(r.id))
    : [];
  return withHandicapPops([...rounds, ...others], course, roster).slice(0, rounds.length);
}

type Pointers = Pick<Dataset, 'groups' | 'rounds' | 'activeGroupId' | 'openRoundIds' | 'cardRoundId'>;

/** The active group: the one chosen, or the first when none is. */
function activeGroupOf(state: Pointers): Group | null {
  return state.groups.find((g) => g.id === state.activeGroupId) ?? state.groups[0] ?? null;
}

/** A group's open live round, if it has one. */
function openRoundOf(state: Pointers, groupId: string | undefined): Round | null {
  if (!groupId) return null;
  return state.rounds.find((r) => r.groupId === groupId && state.openRoundIds.includes(r.id)) ?? null;
}

/** The round the active group shows: its card being typed in, else its open live round. */
function shownRound(state: Pointers): Round | null {
  const groupId = activeGroupOf(state)?.id;
  const card = state.rounds.find((r) => r.id === state.cardRoundId);
  if (card && card.groupId === groupId) return card;
  return openRoundOf(state, groupId);
}

/** The open rounds with `round` as its group's, in place of whatever that group had open. */
function withOpen(state: Pointers, round: Round): RoundId[] {
  const others = state.openRoundIds.filter((id) => {
    const open = state.rounds.find((r) => r.id === id);
    return open != null && open.id !== round.id && open.groupId !== round.groupId;
  });
  return [...others, round.id];
}

/**
 * Points the store at a round, making its group the active one: a card round
 * opens in the card slot, a live one as its group's open round. No round closes
 * the active group's open round.
 */
function focusRound(state: AppState, id: string | null): AppState {
  const round = state.rounds.find((r) => r.id === id);
  if (!round) {
    const closing = openRoundOf(state, activeGroupOf(state)?.id);
    return closing ? { ...state, openRoundIds: state.openRoundIds.filter((rid) => rid !== closing.id) } : state;
  }
  if (round.entry === 'card') return { ...state, cardRoundId: round.id, activeGroupId: round.groupId };
  return { ...state, openRoundIds: withOpen(state, round), activeGroupId: round.groupId };
}

/** Finishes a round. A card is dated the day it was played, not the day it was typed in. */
/** The bag with one club's carry set. */
const withCarry = (clubs: Club[], id: string, carry: number | null) => clubs.map((c) => (c.id === id ? { ...c, carry } : c));

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
  return closeIn({ ...state, rounds }, id);
}

/** Abandons a round: closed without posting, so it never counts in the season ledger. */
function abandonIn(state: AppState, id: string): AppState {
  const rounds = state.rounds.map((r) =>
    r.id === id ? { ...r, status: 'abandoned' as const, completedAt: Date.now() } : r,
  );
  return closeIn({ ...state, rounds }, id);
}

/** Takes a round that has just closed out of its group's open slot and the card slot. */
function closeIn(state: AppState, id: string): AppState {
  return {
    ...state,
    openRoundIds: state.openRoundIds.filter((rid) => rid !== id),
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
        clubs: next.clubs,
        usualScore: next.usualScore,
        practice: next.practice,
        marks: next.marks,
        activeGroupId: next.activeGroupId,
        openRoundIds: next.openRoundIds,
        activeOutingId: next.activeOutingId,
        cardRoundId: next.cardRoundId,
        seenCells: next.seenCells,
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

  const auth = useAuth();
  const { signOut, stopDemo } = auth;
  // Someone trying the demo has no account, so only the demo dataset opens (#275).
  const tryingDemo = auth.status === 'demo';
  const tryingDemoRef = useRef(tryingDemo);
  useEffect(() => {
    tryingDemoRef.current = tryingDemo;
  }, [tryingDemo]);

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
      // The saved preference is a signed-in person's; the demo overrides it
      // without touching it, and their own dataset is never read.
      const demoMode = tryingDemoRef.current || settings.demoMode;
      const dataset = await hydrate(demoMode);
      if (cancelled) return;
      setState({ ready: true, demoMode, ...dataset });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const setDemoMode = useCallback((on: boolean) => {
    if (!on && tryingDemoRef.current) {
      stopDemo('ownData');
      return;
    }
    setState((prev) => ({ ...prev, ready: false }));
    void (async () => {
      const dataset = await hydrate(on);
      await saveSettings({
        demoMode: on,
        activeGroupId: dataset.activeGroupId,
        activeRoundId: openRoundOf(dataset, activeGroupOf(dataset)?.id)?.id ?? null,
        activeOutingId: dataset.activeOutingId,
      });
      setState({ ready: true, demoMode: on, ...dataset });
    })();
  }, [stopDemo]);

  // Signing in after trying the demo opens the person's own data, to start their
  // own season. The demo dataset stays in its own namespace for later.
  const wasTryingDemo = useRef(tryingDemo);
  useEffect(() => {
    if (wasTryingDemo.current && auth.status === 'signed-in') setDemoMode(false);
    wasTryingDemo.current = tryingDemo;
  }, [auth.status, tryingDemo, setDemoMode]);

  // Demo data is never synced: it is invented, and it would land in a real
  // account's season looking exactly like a real Saturday.
  const [deleting, setDeleting] = useState(false);
  const syncEnabled = state.ready && !state.demoMode && auth.status === 'signed-in' && !deleting;

  const documents = useMemo<Documents>(
    () => ({
      groups: state.groups,
      courses: state.courses,
      rounds: state.rounds,
      outings: state.outings,
      clubs: state.clubs,
      marks: state.marks,
      ...(state.usualScore ? { usualScore: state.usualScore } : {}),
    }),
    [state.groups, state.courses, state.rounds, state.outings, state.clubs, state.marks, state.usualScore],
  );

  const adoptRemote = useCallback(
    (remote: Partial<Documents>) => {
      // A phone with nothing on it, signing in to an account that already has a
      // season. Take what is there rather than pushing emptiness over it. Only
      // the bag comes when the phone has a season but no clubs yet.
      commit((prev) => ({ ...prev, ...remote }));
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

  const takeMoveNotices = useCallback(
    (notices: MoveNotice[], taken: Documents) => {
      // An organiser's account went. A day that moved to someone else's copy comes as
      // the server has it. The rest stays here, and the active group follows its new id.
      commit((prev) => applyFollowed(prev, notices, taken));
    },
    [commit],
  );

  const takeSeen = useCallback(
    (cells: SeenCells) => {
      commit((prev) => (JSON.stringify(prev.seenCells) === JSON.stringify(cells) ? prev : { ...prev, seenCells: cells }));
    },
    [commit],
  );

  const sync = useDataSync({
    enabled: syncEnabled,
    documents,
    onAdoptRemote: adoptRemote,
    onSharedData: takeShared,
    onMoveNotices: takeMoveNotices,
    seen: state.seenCells,
    onSeen: takeSeen,
  });

  const store = useMemo<AppStore>(() => {
    const group = activeGroupOf(state);
    const round = shownRound(state);
    const roundGroup = round ? state.groups.find((g) => g.id === round.groupId) ?? group : null;
    const course = round ? state.courses.find((c) => c.id === round.courseId) ?? null : null;
    const outing = state.outings.find((o) => o.id === state.activeOutingId) ?? null;
    const outingCourse = outing ? state.courses.find((c) => c.id === outing.courseId) ?? null : null;
    const outingGroup = outing ? state.groups.find((g) => g.id === outing.groupId) ?? null : null;

    let settlement: Settlement | null = null;
    if (round && course && roundGroup) {
      settlement = settleRound(round, course, roundGroup.players);
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

    /** Applies a patch to the round the active group shows. None means the call is a no-op. */
    const patchRound = (fn: (r: Round, prev: AppState) => Round) =>
      commit((prev) => {
        const shown = shownRound(prev);
        const idx = shown ? prev.rounds.indexOf(shown) : -1;
        if (idx < 0) return prev;
        const rounds = prev.rounds.slice();
        rounds[idx] = fn(rounds[idx], prev);
        return { ...prev, rounds };
      });

    const eraseLive = async () => {
      // A save still on its debounce would otherwise write the dataset back.
      if (!state.demoMode && saveTimer.current) clearTimeout(saveTimer.current);
      await clearDataset(false);
      if (!state.demoMode) {
        setState((prev) => ({
          ...prev,
          groups: [],
          courses: [],
          rounds: [],
          outings: [],
          clubs: [],
          usualScore: null,
          practice: {},
          marks: [],
          activeGroupId: null,
          openRoundIds: [],
          activeOutingId: null,
          cardRoundId: null,
          seenCells: null,
        }));
      }
    };

    return {
      ...state,
      sync,
      group,
      activeRoundId: openRoundOf(state, group?.id)?.id ?? null,
      roundGroup,
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
        commit((prev) => {
          const next = {
            ...prev,
            outings: [...prev.outings, created],
            rounds: [...prev.rounds, ...withFieldHandicapPops(prev, groups)],
            activeOutingId: created.id,
            activeGroupId: created.groupId,
          };
          // Drop the phone straight into whichever group holds "you".
          const youId = prev.groups.find((g) => g.id === created.groupId)?.youId ?? '';
          const mine = groups.find((r) => r.playerIds.includes(youId)) ?? groups[0];
          return mine ? focusRound(next, mine.id) : next;
        }),
      setActiveOuting: (id) => commit((prev) => ({ ...prev, activeOutingId: id })),
      updateOuting: (patch) =>
        commit((prev) => {
          const current = prev.outings.find((o) => o.id === prev.activeOutingId);
          if (!current) return prev;
          const updated = { ...current, ...patch };
          // The whole field plays one set of house rules, so every group follows the outing's.
          const rules = houseRules(updated);
          const rulesChanged = (Object.keys(rules) as (keyof typeof rules)[]).some((key) => patch[key] !== undefined);
          const rounds = rulesChanged
            ? prev.rounds.map((r) => (r.outingId === current.id ? { ...r, options: { ...r.options, ...rules } } : r))
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
          // Only the day's rounds close; another group's round stays open.
          openRoundIds: prev.openRoundIds.filter((rid) => prev.rounds.find((r) => r.id === rid)?.outingId !== id),
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
        void eraseLive();
      },
      deleteAccount: async (password) => {
        setDeleting(true);
        try {
          await sync.settle();
          await deleteAccountRemote(password);
        } catch (error) {
          setDeleting(false);
          throw error;
        }
        // Sync stays off from here. The account has gone, so a failure to erase
        // doesn't stop the sign-out. What's left stays on the phone, behind sign-in.
        await eraseLive().catch(() => {});
        // Last, because signing out unmounts this store.
        await signOut();
      },

      createGroup: (name) => {
        const created: Group = {
          id: makeId('g'),
          name,
          players: [],
          youId: null,
          defaultCourseId: null,
          ...DEFAULT_HOUSE_RULES,
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
          const kept = (rid: string | null) => rounds.some((r) => r.id === rid);
          const openRoundIds = prev.openRoundIds.filter(kept);
          const cardRoundId = kept(prev.cardRoundId) ? prev.cardRoundId : null;
          const marks = prev.marks.filter((m) => kept(m.roundId));
          return { ...prev, groups, rounds, activeGroupId, openRoundIds, cardRoundId, marks };
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
          // Drop them from any round still being played; posted and abandoned
          // rounds keep their history, so each stays as it was played.
          const rounds = prev.rounds.map((r) => {
            if (r.groupId !== groupId || r.status !== 'active' || !r.playerIds.includes(playerId)) return r;
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
      setGreen: (courseId, green) =>
        commit((prev) => ({
          ...prev,
          courses: prev.courses.map((c) => (c.id === courseId ? { ...c, greens: withGreen(c.greens, green) } : c)),
        })),
      setGreens: (courseId, greens) =>
        commit((prev) => ({
          ...prev,
          courses: prev.courses.map((c) => (c.id === courseId ? { ...c, greens } : c)),
        })),
      setFeatures: (courseId, features) =>
        commit((prev) => ({
          ...prev,
          courses: prev.courses.map((c) => (c.id === courseId ? { ...c, features } : c)),
        })),
      setNote: (courseId, hole, text) =>
        commit((prev) => ({
          ...prev,
          courses: prev.courses.map((c) => (c.id === courseId ? { ...c, notes: withNote(c.notes, hole, text) } : c)),
        })),
      deleteCourse: (id) =>
        commit((prev) => ({
          ...prev,
          courses: prev.courses.filter((c) => c.id !== id),
          groups: prev.groups.map((g) =>
            g.defaultCourseId === id ? { ...g, defaultCourseId: null } : g,
          ),
        })),

      addClub: (name) => commit((prev) => ({ ...prev, clubs: withClub(prev.clubs, name) })),
      fillBag: (clubs) => commit((prev) => (prev.clubs.length ? prev : { ...prev, clubs })),
      setCarry: (id, carry) => commit((prev) => ({ ...prev, clubs: withCarry(prev.clubs, id, carry) })),
      takeTrackedCarry: (id) =>
        commit((prev) => {
          const carry = trackedShots(prev)[id]?.trackedCarry;
          return carry == null ? prev : { ...prev, clubs: withCarry(prev.clubs, id, carry) };
        }),
      // Its tracked shots go with it: a club added back may be a different club.
      removeClub: (id) =>
        commit((prev) => ({
          ...prev,
          clubs: prev.clubs.filter((c) => c.id !== id),
          marks: prev.marks.some((m) => m.clubId === id) ? prev.marks.filter((m) => m.clubId !== id) : prev.marks,
        })),
      setUsualScore: (usualScore) => commit((prev) => (prev.usualScore === usualScore ? prev : { ...prev, usualScore })),

      markBall: (roundId, hole, fix, hit) => {
        const marked = state.rounds.find((r) => r.id === roundId);
        if (!marked || marked.entry === 'card' || !inBag(state.clubs, hit)) return false;
        const created: Mark = {
          id: makeId('m'),
          roundId,
          hole,
          position: fix.position,
          accuracy: fix.accuracy,
          at: Date.now(),
          ...hitFields(hit),
        };
        commit((prev) => ({ ...prev, marks: [...prev.marks, created] }));
        return true;
      },
      changeMark: (id, hit) =>
        commit((prev) =>
          inBag(prev.clubs, hit)
            ? { ...prev, marks: prev.marks.map((m) => (m.id === id ? { ...m, ...hitFields(hit) } : m)) }
            : prev,
        ),
      undoMark: (id) => commit((prev) => ({ ...prev, marks: prev.marks.filter((m) => m.id !== id) })),

      setPractice: (roundId, on) =>
        commit((prev) => {
          const was = prev.practice[roundId];
          if ((was?.on ?? false) === on) return prev;
          return { ...prev, practice: { ...prev.practice, [roundId]: { on, ever: on || (was?.ever ?? false) } } };
        }),

      // A new round takes its group's open slot; other groups keep theirs.
      startRound: (created) =>
        commit((prev) =>
          focusRound({ ...prev, rounds: [...prev.rounds, ...withFieldHandicapPops(prev, [created])] }, created.id),
        ),
      // A card round opens in the card slot, never as the live round.
      setActiveRound: (id) => commit((prev) => focusRound(prev, id)),
      completeRound: (id) => commit((prev) => completeIn(prev, id, false)),
      abandonRound: (id) => commit((prev) => abandonIn(prev, id)),
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
          // Gone for good means its marks too.
          marks: prev.marks.filter((m) => m.roundId !== id),
          openRoundIds: prev.openRoundIds.filter((rid) => rid !== id),
          cardRoundId: prev.cardRoundId === id ? null : prev.cardRoundId,
        })),

      startCard: (created) =>
        commit((prev) => ({
          ...prev,
          rounds: [...prev.rounds, ...withFieldHandicapPops(prev, [created])],
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
        patchRound((r, prev) => {
          // A plus handicap gives strokes back, down to one on every hole; off the low man nobody is below zero.
          const holes = prev.courses.find((c) => c.id === r.courseId)?.tees[0]?.holes.length ?? 18;
          const floor = r.options.strokes === 'full' ? -holes : 0;
          return { ...r, pops: { ...r.pops, [playerId]: Math.max(floor, Math.min(54, Math.round(pops))) } };
        }),
      recalculatePops: () => patchRound((r, prev) => withFieldHandicapPops(prev, [r])[0]),
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
      addPress: (by, against, startHole) =>
        patchRound((r) => {
          if (!course) return r;
          const endHole = new RoundContext(r, course, []).nineFor(startHole)[1];
          const stake = r.games.nassau.stake;
          return { ...r, presses: [...r.presses, { id: makeId('press'), by, against, startHole, endHole, stake }] };
        }),
      removePress: (pressId) =>
        patchRound((r) => ({ ...r, presses: r.presses.filter((p) => p.id !== pressId) })),
      setWolfPick: (hole, wolf, partner) =>
        patchRound((r) => {
          const picks = r.wolfPicks.filter((p) => p.hole !== hole);
          return { ...r, wolfPicks: [...picks, { hole, wolf, partner }].sort((a, b) => a.hole - b.hole) };
        }),
      clearWolfPick: (hole) =>
        patchRound((r) => ({ ...r, wolfPicks: r.wolfPicks.filter((p) => p.hole !== hole) })),
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
  }, [state, sync, commit, setDemoMode, signOut]);

  // Keep the demo/live preference and the active pointers in sync on disk.
  const { activeRoundId } = store;
  useEffect(() => {
    if (!state.ready) return;
    void saveSettings({
      // The saved preference is for whoever signs in next. After trying the demo
      // that's their own data, so it reads live while the demo is open (#275).
      demoMode: tryingDemo ? false : state.demoMode,
      activeGroupId: state.activeGroupId,
      activeRoundId,
      activeOutingId: state.activeOutingId,
    });
  }, [state.ready, state.demoMode, state.activeGroupId, activeRoundId, state.activeOutingId, tryingDemo]);

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
    return { ...seeded, seenCells: null };
  }
  return {
    groups: stored.groups,
    courses: stored.courses,
    rounds: stored.rounds,
    outings: stored.outings,
    clubs: stored.clubs,
    usualScore: stored.usualScore,
    practice: stored.practice,
    marks: stored.marks,
    activeGroupId: stored.activeGroupId,
    openRoundIds: stored.openRoundIds,
    activeOutingId: stored.activeOutingId,
    cardRoundId: stored.cardRoundId,
    seenCells: stored.seenCells ?? null,
  };
}

export function useStore(): AppStore {
  const store = useContext(StoreContext);
  if (!store) throw new Error('useStore must be used inside AppStoreProvider');
  return store;
}
