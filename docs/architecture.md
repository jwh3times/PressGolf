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
| Vegas | Paired net scores form a number; the difference is multiplied by the stake. A net below 1 reads as a 1 |
| Match play | Head-to-head net match play; round robin or selected rivals |
| Stroke play | Lowest complete net total |

Pops continue above 18: a 20-handicap player gets one stroke on every hole and
a second on stroke-index holes 1 and 2. Negative pops are a plus handicap and
give strokes back from the easiest hole: −2 gives one back on stroke-index
holes 18 and 17.

### Courses and tees

A course has one or more tees. Each tee has a name, a slope and a course
rating (both optional until entered), and its own card: par, stroke index and
yards for every hole. Every tee on a course has the same number of holes.
Forward tees often play a hole at a different par or stroke index, which is why
the card belongs to the tee.

A round records its tee (`teeId`), and a player can play a different one
(`playerTees`). Anyone without a tee plays the round's tee, and a round without
one plays the course's first tee. New rounds and outings start on the tee the
group last played at that course.

`RoundContext.par(hole, playerId)` and `strokeIndex(hole, playerId)` read the
player's own tee. Pops allocation, the max score, Stableford, birdie detection,
Vegas's birdie flip and field pots all go through them, so players on different
tees are scored against their own card. Without a player, they read the round's
tee, which is what the hole header and the card grid show.

A tee that a saved round was played from cannot be deleted, and neither can a
course's last tee.

### Greens and yardage

A course can know where each hole's green is (`Course.greens`, synced as
`course_greens`). Greens belong to the course, not a tee, because every tee
plays to the same green. Each has a middle, and optionally a front and back,
which are always set as a pair. `source` records where the points came from:
`marked` standing on the green, placed on a `map`, or `osm` (OpenStreetMap).

On the Score screen's hole-by-hole view, `GreenYardage` shows the distance from
the phone to the green. GPS runs only when asked: a tap watches the position
for a minute (`useLiveLocation`, `LIVE_FOR_MS`), then stops and leaves the last
reading on screen until the next tap or a change of hole. The phone is also
the scorecard, so four hours of continuous GPS is not an option. Distances are
great-circle yards rounded to whole yards (`src/domain/geo.ts`), shown with the
fix's accuracy, because consumer GPS is good to a few metres and nothing finer
would be honest.

A hole with no green offers to mark it. Marking takes one fix at the best
accuracy available and refuses one worse than 15 m (`MARK_ACCURACY_M`), which
would put the middle on the fringe. Marking again replaces the hole's green and
keeps only the middle. The course owner's marks sync; outing guests read them,
as they read the card.

The course editor's **Import from OpenStreetMap** (`src/app/greens.tsx`)
fills in the greens and the course map from OpenStreetMap. About half of US courses are mapped well enough
(checked 2026-10-14: 85 of 194 in Oregon, 199 of 445 in North Carolina, had at
least nine numbered holes and nine greens). Two public OpenStreetMap services
are called, only when someone taps (`src/osm/client.ts`):

- **Nominatim** finds the course by name. When a name alone finds no golf
  course (it can match a road instead), it searches once more with "golf
  course" added, a second later, as the usage policy's one-request-a-second
  limit asks.
- **Overpass** returns the course's own outline and every hole line, green,
  bunker, penalty area, fairway, tee and pond inside it. The query ends
  `out geom`, not `out geom tags`: the tags form leaves out a relation's
  members, and a third of fairways worldwide are multipolygon relations. Its public servers are volunteer-run and often loaded
  (on 2026-10-15 overpass-api.de took 20–45 s for a one-node query, or gave an
  instant 502), so the import tries each server in `OVERPASS_URLS` in turn,
  two seconds apart, gives each a minute, and keeps going for two minutes
  before saying OpenStreetMap is busy. A 200 whose remark says the query was
  cut short counts as busy, not as a course with fewer greens. A 4xx stops at
  once. On the web the app sends no `User-Agent`: the browser names itself,
  and the header would make each request a cross-origin preflight that
  maps.mail.ru refuses.

`greensFromOsm` (`src/osm/greens.ts`) matches each hole's line, by its `ref`
number, to the green it ends in, or the nearest within 30 m. The middle is the
outline's centre; front and back are where the line of play, carried on through
the middle, crosses the outline. A hole two lines claim, as at a 27-hole club,
is left out rather than guessed. The import keeps greens marked on the course
and replaces an earlier import (`withImported`). OpenStreetMap's licence asks
for credit wherever its data shows, so the search screen says "© OpenStreetMap
contributors" and links to its copyright page, and a yardage read from an
imported green says "© OpenStreetMap", the short form its attribution
guidelines accept, as a link to the same page.

### Course map

A course can also carry a map for the hole map and distances to trouble
(#125): `Course.features`, synced as `course_features`, one row per feature,
its outline a jsonb array of `[lat, lng]` pairs. Kinds are `bunker`, `water`
(a yellow penalty area) and `lateralWater` (red), `fairway`, `green`, `tee`,
`courseEdge` (the mapped boundary, outside which is likely out of bounds),
`outOfBounds` (a line drawn in the app where the stakes are) and `holeLine`
(tee to green, carrying its hole number). Areas are rings stored without
repeating the first point; lines run in order.

`featuresFromOsm` (`src/osm/features.ts`) reads them from the same Overpass
reply as the greens: `golf=bunker`, `golf=water_hazard`,
`golf=lateral_water_hazard`, `golf=penalty_area`, untagged `natural=water`,
`golf=fairway`, `golf=green`, `golf=tee`, `golf=out_of_bounds`, `golf=hole` and
the course's `leisure=golf_course` outline. A multipolygon's outer rings are
joined from its member ways, each becoming its own feature; a ring that never
closes is dropped. Outlines are simplified to half a metre (`SIMPLIFY_M`),
harder if one would pass the database's 5,000 points, and rounded to six
decimal places: Torrey Pines South keeps 2,962 points, about 71 KB. Ids such as
`osm:way/123` are stable, and an import replaces the earlier one whole while
keeping anything drawn in the app (`withImportedFeatures`).

Measured 2026-10-15 across the 88 Oregon courses with at least nine holes and
greens mapped: 81% have at least nine bunkers, 87% at least nine fairways, 85%
a tagged water hazard, and 2% any `golf=out_of_bounds`. Out of bounds therefore
comes from the course edge and from lines the owner draws.

### Hole map

**Map of hole N** on the Score screen, and **View the hole map** in the course
editor, open `src/app/hole-map.tsx` for a course and hole, both carried in the
URL. On the Score screen a course with a map shows the hole itself under the
yardage (`HoleMapPreview`): the drawing, turned to play left to right across
the card, with no distances of its own, as one button that opens the full
map. A hole with only a green shows the button alone, and an unmapped hole
nothing. Both entries appear once a hole has a green or the course has a map. A course
whose greens were imported before the course map existed has no hazards, so
the hole map offers to import it again; greens marked on the course are kept. `holePlan` (`src/domain/hole-map.ts`) gathers the hole's line, its green,
everything within 60 m of the line (`CORRIDOR_M`), and the course's edge.
`HoleDiagram` draws them with `react-native-svg`, turned so the hole plays up
the screen, from the saved map alone: it needs no signal on the course, no map
provider and no API key, and it works on the web. The map's colours come from
the theme (`src/theme/course-colors.ts`).

Distances are from the phone when it is within 1 km of the hole
(`ON_HOLE_M`); from the Score screen GPS starts for a minute, as the yardage
card's does. Anywhere else they are from the tee, so a hole can be looked over
beforehand. The target is the next bend in the hole's line, as mappers draw
it through the landing area (`defaultTarget`), or the green. A lay-up button
measures to a point 100, 150 or 200 yards short of the green along the line
(`pointShort`), and a tap on the map measures to that point.

On a phone, a **Satellite** switch swaps the drawing for `HoleSatellite`:
`react-native-maps` imagery (Apple Maps on iOS, Google Maps on Android) with
the same target, yards and taps, and only the trouble outlined (bunkers,
water by stake colour, the course edge, out of bounds), since the picture
shows the grass. Apple's camera takes an altitude and Google's a zoom, and
neither documents how much ground a value shows, so the map first frames the
hole's corners north-up (`fitToCoordinates`), then `turnedCamera` turns it to
the hole's heading and comes in by the ratio of the two boxes, which scales
either value on any screen. It needs signal for the imagery, and an Android
store build needs the Google Maps key (below). The web has no switch.

`hazardsBetween` lists each bunker and penalty area within 40 m of the line to
the target and short of 30 m past it, nearest first: its side, the yards to
its front and to its far end, and for one across the line, the carry.
`aroundGreen` adds those within 35 m of the green when the target is short of
it, and `edgesNear` says how close the course's edge or an out-of-bounds line
comes to the target. These are all distances between two points, which
Rule 4.3a allows a device to show during a round; nothing here suggests a
club.

For a course nobody has mapped and nobody is standing on, **Place greens on a
map** (`src/app/green-map.tsx`) shows a satellite map (`react-native-maps`:
Apple Maps on iOS, Google Maps on Android). Pick a hole and tap where its
green's middle is; placing a new middle moves on to the next hole. Front and
back can be placed once the middle is down, and any pin of the chosen hole can
be dragged (`placePoint`). The map opens over the course's greens, or where the
phone last was if location is already allowed, and the course name can be
searched (Nominatim) to move the map there. `react-native-maps` has no web
version, so `GreenMap.web.tsx` says to use the OpenStreetMap search instead.

### Max score and pick-ups

A round carries a max-score rule in its options:

| Rule | Most a player can take on a hole |
|---|---|
| Off | No limit |
| Double bogey | Par + 2 |
| Net double bogey | Par + 2 + the pops received on that hole (the WHS rule) |

The card stores scores as written. `RoundContext.gross()` applies the cap when
the engine reads a score, so changing the rule or the pops re-settles
correctly. A pick-up is a flag on its box (`Round.pickups`, keyed
`${hole}:${playerId}`). With a max, a pick-up counts as the max and the hole
settles. With no max, it is treated like an empty box: the player sits out the
hole, and games that need every score wait.

A group's rule is its default: new rounds and outings copy it. After that,
each round's own copy governs. Changing the group default never rewrites a
settled round.

### Handicaps

A player can carry a WHS Handicap Index (`Player.handicapIndex`, with the date
it was entered). A plus index is stored negative and typed with its plus sign,
e.g. +1.4; a typed minus sign is read as plus too. `src/domain/handicap.ts` works pops out from it in the order the
2024 Rules of Handicapping set:

1. **Course handicap** from the player's own tee: Index × (Slope ÷ 113) +
   (Rating − Par). On a 9-hole tee the index is halved and rounded to the
   nearest tenth first (Rule 6.1b). An unrated tee counts as slope 113 and a
   rating equal to par.
2. **Playing handicap**: the allowance applied to the *unrounded* course
   handicap, then rounded once, .5 upwards (Rule 6.2a). A plus handicap
   therefore moves towards zero.
3. **Off the low man**, when that is the rule: everyone's playing handicap less
   the lowest. In an outing the low man is the lowest in the whole field.

How pops are taken is a strokes mode (`full` or `off_low`) and an allowance
(a percentage, one number for every game). They follow the max-score pattern:
the group sets a default, each new round and outing copies it, the Format tab
edits a round's copy, and an outing locks both for every group in it.

Pops are worked out once, when a round, a card or an outing starts. After that
the stepper overrides them, and **Recalculate from handicaps** works them out
again. A player with no index keeps the pops typed in, is flagged "no index",
and is left out when finding the low man. The round remembers the tee each
player's pops came from (`Round.handicapTees`). A later tee change never
recalculates by itself; the pops row says "tee changed · recalculate?"
instead. Whenever a player's pops differ from what their handicap now gives
(an override, or an index or rule changed since), the row says so, e.g.
"handicaps give 12 · recalculate?". Each pops row shows its working, e.g. "12.4 · Blue 128/71.2 → 15 · 3
off the low man".

Data saved before handicaps plays off the low man at 100%, as the Format tab
always said, and keeps its pops, so nothing already settled moves. Every demo
player carries an index. The Saturday Dogs' indexes work out to the demo
round's stored pops, and the demo outing's pops are worked out from the
society's indexes across the whole field, so neither asks for a recalculation.

### Card entry

A round's `entry` is `live` (scored hole by hole on the course) or `card`
(typed in afterwards from a finished paper card). A card round is dated the
day it was played: `startedAt` and `completedAt` are both the Played-on date.

A card starts with the same games as a live round and settles the same way.
Under the card grid, a Wolf row takes each hole's partner (or a lone wolf),
and a Presses section records who pressed whom from the hole under the
cursor. `addPress` runs every press, live or card, to the end of the nine it
started on, at the Nassau stake. Junk still pays birdies and eagles, which come
from the scores on the card. Greenies, sandies, chip-ins and polies are tapped
live, so they are not offered.

Saving a card with empty boxes can mark them as pick-ups. With no max score, a
pick-up sits out the hole, so the app warns that stroke play and Stableford
will undercount.

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

An outing has one max-score rule, set on the Field pots screen. Every group in
the outing follows it, and the Format tab shows it as locked, so field pots
compare like with like.

A field hole remains unresolved until every entrant has posted a score for that
hole, and under a max a pick-up counts as a posted score. Contributions are shown immediately, so standings can be temporarily
negative or fail to sum to zero while part of a pot is still unresolved.

Once the whole field is in, money still in a pot follows the pot's leftovers
rule:

- **Split among winners** (the default): the leftovers are shared between
  everyone who won a hole. If nobody won one, every buy-in is handed back. A
  refund goes in `FieldGameResult.refunds`, never in `payouts`, so it never
  reads as winnings.
- **Carry to next time:** the money stays in `unclaimedPot`, and the field's nets
  sum to minus that amount. The pot card shows it as still riding, and no
  transfer moves it: whoever runs the outing carries it forward by hand. This
  is the decided rule (#70); the domain has no organiser player to hand it to.

## Local data and demo isolation

`AppStore` writes the active dataset to AsyncStorage and renders from local
state. A card being typed in lives in its own slot (`cardRoundId`) beside the
active round. While it is open, `store.round` is the card and edits land on
it. The live round is untouched, and returns when the card is saved or
discarded. Server availability is never on the path of score entry. Demo and live
datasets have separate namespaces and demo data is excluded from sync.

The demo seed contains an in-progress Saturday Dogs round and prior completed
rounds generated from a fixed seed. Its Pine Hollow course has two tees: Blue,
and a forward Red tee that plays one par 4 as a par 5 and swaps the two
hardest stroke indexes. Its season ledger is calculated by the same
engine as live data.

## Active server synchronization

When the two Supabase public variables are present and a user is signed in,
`useDataSync` is the active synchronization path:

1. On first contact, it pulls the signed-in account's 21 snapshot tables (its
   own rows only) and the outings shared with it.
2. A fresh local dataset adopts existing remote data; otherwise the local
   dataset is pushed.
3. Later local changes are debounced for 2.5 seconds, persisted locally first,
   then upserted in parent-before-child order. Only rows that differ from the
   last known remote snapshot go up (`changedRows`), so an edit sends one
   score, not the season.
4. Rows deleted locally are pruned child-first after comparison with the last
   known remote snapshot.
5. After a successful push, shared outings are pulled and merged into local
   data.

A guest's phone holds the organiser's group, course and rounds once it has
merged a shared outing, and the server refuses to let it write them. Every
push therefore splits the phone's rows by owner first (`splitByOwner`), using
the last pull of the shared outings, which carries each row's `owner_id`.
Rows the account owns, or is adding, go up as its own. Of someone else's
outing, only the tables a guest may write (`GUEST_WRITES`: scores and junk) go
up, only where the phone changed them since that pull, and without an
`owner_id`, so an edited cell stays the organiser's; a new junk claim takes the
column's default and is the guest's. The rest of the organiser's day isn't
pushed. Before this (#127), a guest's every push after joining failed on the
organiser's group.

The schema has 23 application tables: 21 snapshot tables plus
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

## Themes

Every colour belongs to a theme (`src/theme/themes.ts`): a base (dark, light,
or either at high contrast) and an accent (green, blue, violet or gold).
Components read it with `useTheme()`, and style sheets are built per theme by
`makeStyles()` (`src/theme/theme.tsx`); nothing imports a colour from a module.
Only the default, dark with green, is written out. The other bases name their
surfaces and ink, and the ink levels, accents, money colours and outlines are
derived from the contrast floor the base sets (4.5:1, or 7:1 at high
contrast). Colours that come with the data, a player's or a game's, pass
through `theme.tint()`, which darkens or lightens them only as far as the floor
needs. Money won uses `colors.up`, which stays green whatever the accent.

The choice is saved under its own AsyncStorage key, `press:theme`, apart from
`press:settings`, because it is needed before sign-in and the store that writes
the settings only exists after. `ChosenThemeProvider` (`src/theme/ChosenTheme.tsx`)
reads it before drawing anything, while the splash screen is still up, and sets
the system's colour scheme (keyboard, alerts, status bar) and root background
to match. The splash screen and `app.json` stay dark for every theme.

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
  theme/            themes (every colour), the provider and hooks that read them,
                    type and size tokens, and contrast calculations
supabase/
  migrations/       versioned production schema
  ci/               Postgres stand-ins and RLS assertions
scripts/
  check-patch-coverage.mjs
  generate-icons.py
  native-screens.mjs      compares the native nightly's screenshots with baselines
  a11y-lint.mjs           lints the native accessibility tree the nightly captures
  maestro-output.mjs      reads Maestro's output tree for the two scripts above
  sync-agents.mjs         .agents/skills -> .claude/skills generator
.agents/skills/     authored agent skills (Claude Code and Codex)
.claude/skills/     generated copy for Claude Code; do not edit
.maestro/
  flows/            one native flow per journey (round, card entry, outing, handicaps)
  subflows/         steps the flows share: a fresh launch, scroll-then-tap
  baselines/        native screenshot baselines, by platform and text size
  run.sh            runs every flow, retrying each once
  passes.sh         runs the flows at default and maximum text size
  pin-status-bar.sh fixes the status bar's time, battery and signal for screenshots
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
