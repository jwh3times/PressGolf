# Architecture and game rules

Press separates settlement rules, local persistence, server synchronization,
and React Native screens so the money math remains deterministic and testable.

```text
Expo Router screens
        │
        ▼
AppStore ───────────────► AsyncStorage (authoritative local dataset)
   │
   ├──► domain engine ──► settlement and season ledger
   │
   └──► useDataSync ────► Supabase snapshot tables and RLS
```

## Domain engine

`src/domain/` is plain TypeScript with no React dependency. The main entry
points accept ordinary data structures and return settlement data:

- `settleRound(round, course, roster)` settles a playing group's games.
- `settleOuting(...)` combines group settlements with field-wide pots.
- `season.ts` rebuilds standings from completed rounds; the ledger is not a
  stored running total.
- `ledger.ts` reduces balances to a small transfer set.

All money is integer cents. Splits preserve the original total, and odd cents
are distributed deterministically rather than lost to floating-point rounding.

## Formats

| Format | Settlement rule |
|---|---|
| Nassau | Front, back, and total for every pair; a press runs to the end of the nine where it started |
| Skins | Low net wins; ties carry; unresolved carry at the end is reported but not paid |
| Junk | Birdies, eagles, albatrosses, greenies, sandies, chip-ins, and polies |
| Stableford | Highest net points wins the pot; an unbroken tie pushes |
| Four-ball | Best ball of two in match play between configured sides |
| Wolf | Per-hole wolf side against the field, including lone-wolf handling |
| Vegas | Paired net scores form a number; the difference is multiplied by the stake |
| Match play | Head-to-head net match play; round robin or selected rivals |
| Stroke play | Lowest complete net total |

Pops continue above 18: a 20-handicap player gets one stroke on every hole and
a second on stroke-index holes 1 and 2.

## Outings and field pots

An outing is one field divided into playing groups. Each group can choose its
own games while field skins and scats cover everyone who buys in.

Field games are buy-in pots rather than per-opponent bets:

| | Field skins | Scats |
|---|---|---|
| Winning score | Unique low score | Unique low score |
| Default basis | Net | Gross |
| Tied hole | No winner | Carries as the rabbit |
| Distribution | Pot split by skins won | Pot split into per-hole shares |

A field hole remains unresolved until every entrant has posted a score for that
hole. Contributions are shown immediately, so standings can be temporarily
negative or fail to sum to zero while part of a pot is still unresolved.

## Local data and demo isolation

`AppStore` writes the active dataset to AsyncStorage and renders from local
state. Server availability is never on the path of score entry. Demo and live
datasets have separate namespaces and demo data is excluded from sync.

The demo seed contains an in-progress Saturday Dogs round and prior completed
rounds generated from a fixed seed. Its season ledger is calculated by the same
engine as live data.

## Active server synchronization

When the two Supabase public variables are present and a user is signed in,
`useDataSync` is the active synchronization path:

1. On first contact, it pulls the signed-in account's 18 snapshot tables.
2. A fresh local dataset adopts existing remote data; otherwise the local
   dataset is pushed.
3. Later local changes are debounced for 2.5 seconds, persisted locally first,
   then upserted in parent-before-child order.
4. Rows deleted locally are pruned child-first after comparison with the last
   known remote snapshot.
5. After a successful push, shared outings are pulled and merged into local
   data.

The schema has 20 application tables: 18 snapshot tables plus
`outing_members` and `mutations`. Row-level security limits private data to its
owner and grants outing members only the shared reads and score/junk writes
they need.

This path provides local-first scoring, account backup, and shared snapshots.
It is not currently an instant, conflict-free multi-device feed. A device that
makes no local change does not continuously pull another phone's edits.

## Staged mutation transport

`src/sync/engine.ts` and `SupabaseTransport` implement and test a more granular
model: durable mutations, idempotent retries, per-cell ordering, backoff, and a
Supabase Realtime subscription. They are not instantiated by `AppStore` today.
Treat them as staged infrastructure, not a guarantee of current app behavior.

Connecting that path requires an explicit integration change with device tests
for concurrent scoring, process termination, replay, and conflict handling.

## Repository layout

```text
src/
  app/              Expo Router routes and layouts
  auth/             session state, validation, and the authentication gate
  components/       reusable controls, screen chrome, and the tab bar
  config/           build-time feature flags
  demo/             deterministic sample data
  domain/           types, constructors, formats, and settlement engine
  hooks/            responsive accessibility helpers
  store/            application state and AsyncStorage persistence
  sync/             row translation, snapshot sync, and staged mutation sync
  theme/            tokens, type floor, and contrast calculations
supabase/
  migrations/       versioned production schema
  ci/               Postgres stand-ins and RLS assertions
scripts/
  check-patch-coverage.mjs
  generate-icons.py
  sync-agents.mjs         .agents/skills -> .claude/skills generator
.agents/skills/     authored agent skills (Claude Code and Codex)
.claude/skills/     generated copy for Claude Code; do not edit
.maestro/
  smoke.yml         native round-to-ledger smoke flow
```

Expo Router screens belong in `src/app/`; non-route components and logic do not.
The generated native directories are build artifacts, not source directories.

## App artwork

`scripts/generate-icons.py` derives the iOS icon, splash image, Android adaptive
layers, and favicon from the same flagstick mark and theme colors. After a mark
or palette change, install Pillow and rerun the script:

```bash
python -m pip install Pillow
python scripts/generate-icons.py
```
