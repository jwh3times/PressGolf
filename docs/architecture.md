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
store build needs the Google Maps key (see `docs/development.md`). The web has
no switch.

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

### How each hole plays

`holeStrategy` (`src/domain/hole-strategy.ts`, #136) reads a mapped hole the
same way for everyone, from the course map alone, like a yardage book, which
is what lets the Rules of Golf allow it in a counted round. It reads up to
three zones:

- **Around the green**: short, long, left and right, along the line of
  approach from the hole line's last bend. A bunker or penalty area within
  35 m of the middle (`GREENSIDE_M`) takes the side its nearest point is on;
  out of bounds counts within 55 m (`EDGE_NOTICE_M`).
- **The tee shot**, on par 4s and 5s: left, right and across the line, 180 to
  280 yards from the tee being played (`TEE_SHOT_YARDS`), stopping 40 yards
  short of the green. The map's line starts at the back of the tees, so the
  zone and every yard in it move forward by the longest tee's yards less the
  played tee's. Outside a round it reads from the course's first tee.
- **The second shot**, on par 5s: 80 to 200 yards short of the green
  (`SECOND_SHOT_YARDS`), in yards to the green, for laying up.

Each side is graded `worst` (an out-of-bounds line, or the course edge as
likely out of bounds), `bad` (water of either colour), `someTrouble`
(bunkers) or `clear`, with every cause and its yards. A zone with no hazard or
fairway mapped in it says `nothingMapped` rather than claim a side is clear,
and a hole with none at all has no strategy. Out-of-bounds lines count on the
holes they're limited to (`CourseFeature.holes`, every hole when missing), and
once the owner has drawn one that counts for a hole (`source: 'map'`), the
course edge stops counting there.

It shows as **How the hole plays** on the hole map, and in the **course
guide** (`src/app/course-guide.tsx`), which lists every hole with its drawing,
par, yards, one summary line per zone (`zoneSummary`) and the owner's note.
Under the Score screen's preview, one line follows the shot the player faces
(`facingZone`): the tee shot until 100 yards from the tee, then on a par 5 the
second shot while 200 yards or more from the green, then the green. It never
steps back during a hole, so a jumpy fix can't flick it, and with no fix it
stays put. Position only picks which fixed reading to show, and it comes from
the yardage card: until the player taps for yardage on a hole, the line stays
on the tee shot.

**Where to aim** (`Aim`, `aimSentence`) comes from the grades: away from the
worse side, or the middle when both are alike, and around the green whether
long or short is the safer miss. That is line-of-play advice, which Rule 4.3a
doesn't allow from a device in a counted round. So it shows when looking a
course over outside a round, and in a round only when this phone has marked it
as a **practice round** (`AppData.practice`, by round id). The switch is on New
round, the hole map and the course guide, and explains the Rule and its
penalty before turning on. The mark is kept on the phone and never synced,
since each phone chooses for itself; `ever` stays set once it has been on, for
History's "Practice". It changes nothing about scores, games or money.

The course's owner can leave a **note** on each hole (`Course.notes`, synced as
`course_hole_notes`): plain text up to 280 characters (`MAX_NOTE`), written on
the hole map and shown there and in the course guide, in any round, as a
yardage book would be. Guests of a shared outing read it. Only the course's
owner may write one, as with every row hung from a course (see below).

**Draw out of bounds**, on the course editor's satellite map
(`src/app/green-map.tsx`), draws a line along the stakes: taps add points,
points can be dragged, and a line can be limited to chosen holes, for internal
out of bounds. The side away from the hole is out. Saving makes a line the
owner's (`source: 'map'`): an imported line keeps its OpenStreetMap id, and a
later import leaves it as the owner left it (`withImportedFeatures`). Deleting
an imported line doesn't stick, since nothing records the deletion and the
next import brings it back; the editor says so, and limiting the line to a
hole it doesn't touch takes it out of play instead. The web
has no satellite map, so lines are drawn on a phone and read everywhere.

### The bag

**My bag** (Settings, `src/app/bag.tsx`) keeps how far the phone's owner
carries each club, in the air on a full swing, in whole yards (#125):
`AppData.clubs`, synced as `clubs`. A bag belongs to the account, not to a
group's player, because the same golfer plays in several groups; no outing
shares it, so the table has owner policies only. Its order is the bag's,
longest first, stored as each club's `position`. A club's id is stable so that
shots tracked later can name the club that hit them.

An empty bag starts from thirteen clubs with no carries (`starterBag`), and
named clubs go in where a bag holds them (`withClub`); any other name goes at
the end. A carry is 1–450 yards (`parseCarry`). A club typed as carrying
further than a longer club above it is flagged (`outOfOrder`), since that is
usually a slip; two clubs carrying the same is not.

A chart of your own distances, made before the round, is allowed in a counted
round (Rule 4.3a), so the bag is plain information and is always on.

The bag also keeps how its owner usually scores (`AppData.usualScore`: the
70s, 80s, 90s or 100s or more), which sets how widely club suggestions spread
their shots. Until they choose, it is about 72 plus the handicap index of their
player in their first group, or a starting guess of the 90s (`usualScoreFor`).
It syncs as `bag_settings`, one owner-only row an account, keyed by its owner
and an `id` that is always `bag`, since the phone's rows carry no owner.

### Club suggestions

In a practice round, or looking a course over outside a round, the app
suggests a club, where to aim and, when it is close, a second way to play the
shot (#146). `suggestShot` (`src/domain/club-suggestion.ts`) is pure: given
the course, the hole, where the shot is from (the tee when it isn't known),
the lie, the bag, the usual score and a seed, it returns the suggestion.

- **The shot pattern** (`src/domain/shot-model.ts`) follows Broadie and Ko
  (WSC 2009): direction error is normal, its standard deviation by usual score
  from Broadie's Golfmetrics paper (Science and Golf V, 2008, Table 1); the
  distance error is a share of the shot, fitted so the median leave from 125
  yards matches that paper's Table 2; and a share of mishits, from its awful
  shots a round (eq. 2), fly 40–80% of the carry. Rough and sand widen it.
- **Each finish** is read from the map (out of bounds, water, sand, the green,
  fairway; anything else rough) and scored by strokes to hole out: Broadie's
  PGA Tour table (Interfaces 42(2), 2012, Table B.1) plus what a golfer of the
  usual score adds, from the published tee regressions, and putting through
  the paper's half-holed and two-putt distances. Out of bounds is stroke and
  distance; water is a penalty stroke and a drop back on the line, or beside
  where it crossed for red water.
- **Choosing**: every club with a carry, aimed at five points across the green,
  the fairway, or the line where neither is mapped, with the same 400 draws
  for each. The fewest expected strokes wins; among options within a tenth of
  a stroke, one that leaves a full swing next; and the middlemost of a club's
  aims that are level. A second option of another approach (going for the
  green against laying up, or the driver against less off the tee of a hole no
  club reaches) shows within a third of a stroke, and never as a lay-up to a
  part-swing.
- **Roll** after landing is a share of carry by kind of club: estimates, for
  tracked shots to replace.

The tests check the model against Broadie's figures: the median leave for each
group from 125 yards, and a 90s golfer's share of greens from 150 (about 35%).
A suggestion takes tens of milliseconds on a desktop; the per-shot code
indexes its pairs rather than destructuring them, which Babel compiles to a
helper call.

On screen (`src/components/ClubSuggestion.tsx`), the start point holds until
the player moves five yards, and the seed comes from the five-yard square, so
the same spot gives the same answer on every screen. A lie the player picks is
kept for that square, shared between the hole map and the Score screen. The
Score screen shows a line under the hole's summary; the hole map, a card, the
oval where about two in three shots finish, and "Plan from here" on a tapped
point; the course guide, the club off each hole's tee, worked out after the
first paint. Where a suggestion shows, its aim replaces the hole strategy's for
the shot it is for.

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

0. Before every push, on first contact and on the debounced path, it reads the
   account's move notices and applies them ([below](#deleting-an-account)). If
   that read fails, sync reports an error like any other, and the phone carries on.
1. On first contact, it pulls the signed-in account's 24 snapshot tables (its
   own rows only) and the outings shared with it.
2. A fresh local dataset adopts existing remote data; otherwise the local
   dataset is pushed. The bag is settled on its own: a phone with no clubs takes
   the account's, rather than pruning it, and a fresh install keeps clubs typed
   before signing in when the account has none. The usual score (`bag_settings`)
   is settled the same way, apart from the clubs. A phone holding only a bag
   still counts as fresh, so it can never prune a season. On a shared round the
   account owns, first contact doesn't prune a score or junk row the shared pull
   shows, or send a blank box over a score it shows: the phone may not have seen
   them yet, as when a guest who deleted their account left them to the organiser.
   They arrive with the next shared merge. A cell cleared there and not pushed
   before the app closed looks the same, so it comes back.
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
pushed, nor is what the phone added under it beyond cells and junk: a player
on her roster, a tee on her course, a press in her round, a round in her
outing. Those stay on the phone. A round or outing of the guest's own may
still be on her group and course. Before this (#127), a guest's every push
after joining failed on the organiser's group.

The schema has 26 application tables: 24 snapshot tables plus
`outing_members` and `mutations`. Row-level security limits private data to its
owner and grants outing members only the shared reads and score/junk writes
they need. Every owner write also checks the row it hangs from (`owns_group`,
`owns_course`, `owns_outing`, `owns_round`): a player goes on the writer's own
roster, a green on their own course, a press in their own round. A round or
outing may be on a group or course shared with the writer. An organiser adds
their own membership directly when sharing; a guest joins only through
`join_outing`, with the code.

This path provides local-first scoring, account backup, and shared snapshots.
It is not currently an instant, conflict-free multi-device feed. A device that
makes no local change does not continuously pull another phone's edits.

## Deleting an account

**Settings → Account → Delete account** opens `src/app/delete-account.tsx`,
shown only when signed in, in demo mode too. It says what goes and what stays,
and takes the password. Deletion needs signal and takes effect at once, with no
grace period.

The server side has two parts, and the app reaches them only through the first:

- **The `delete-account` Edge Function** (`supabase/functions/delete-account/`).
  It takes the account from the verified token, never from the request, whose
  body carries only the password. It checks the password itself by signing in on
  a separate client that keeps no session, so a stolen token isn't enough. Then
  it runs the clean-up function and `auth.admin.deleteUser`. It answers with an
  outcome (`deleted`, `not-signed-in`, `wrong-password`, `shares-data`, `failed`)
  that `deleteAccount` in `src/sync/supabase.ts` words for the person holding the
  phone.
- **`delete_account_data(target)`**, a `security definer` SQL function that only
  the service role may execute. Scores and junk the account typed on someone
  else's round become that round's owner's, so the day's money still adds up. It
  leaves [move notices](#move-notices) for the guests of any outing the account
  organised. Then it deletes every row the account owns, every round in those
  outings whoever owns it, and its memberships, edit-log entries and notices, in
  one transaction. Cascades take guests' cells, memberships and edit-log entries
  on those outings. It finds the tables from the catalog, so a new table with an
  `owner_id` is covered without changing it.

Calling again is safe. If `deleteUser` fails after the clean-up committed, the
next call finds nothing to clean and retries it. If the account has already gone
(the reply was lost), the function says `deleted` without asking for the password,
which it could no longer check, so the phone can finish. That can only erase a
phone whose account no longer exists, which "Erase my data" does with no password.

**Every new row must belong to an account that exists.** Each `owner_id`, and
`user_id` on `outing_members` and `mutations`, has a foreign key to `auth.users`
with `on delete no action`. They're `not valid`, so a row orphaned before they
were added stays where it is, but they apply to every new row and every deletion
of a user. They do two jobs:

- **A deleted account's token can't write.** An access token stays valid for up
  to an hour, and the policies only compare a row with the token. A forgotten
  second phone, or a phone that lost the reply and read it as no signal, would
  otherwise upload the whole season again on first contact. The write is refused,
  so that phone reports a sync error and keeps its data. It's signed out when its
  token runs out and the refresh is refused: `auth-js` keeps a session while its
  access token still works. The data then stays on the phone behind the sign-in
  screen, where Settings can't be reached. A phone that lost the reply can also
  finish by trying again.
- **The clean-up can't be skipped.** Supabase refuses to delete an auth user who
  still has rows, from the dashboard too. If a second phone writes between the
  clean-up and `deleteUser`, `deleteUser` fails and the next call clears that row.

A new table with one of these columns needs its own key; `rls-test.sql` reads the
catalog and fails until it has one.

**A guest can delete their account.** A membership in someone else's outing
doesn't stop it, and the outing no longer lists them. A round or outing of their
own on someone else's group or course goes with them, since that takes nothing of
anyone else's.

**An organiser can delete their account.** The whole day leaves the server, under
every account, and each guest keeps the copy on their phone.

<a id="move-notices"></a>**Move notices** are how a guest's phone finds out. Without
them it would read those rows as its own, once the shared pull stopped showing
them, and upload them. That re-creates deleted data, and the next guest's upload
is refused for good. The `move_notices` table holds, per guest (and anyone else
with a round in the outing), one row for the outing, with no `to_id`, and one each
for the group, its players, the course and its tees, with a new id minted for that
guest, so two guests' copies can never collide. A guest reads only their own,
nothing can write one from the client, and they stay until that guest's account
goes.

`applyMoveNotices` in `src/sync/move-notices.ts` applies them to the phone's
documents. It rewrites every moved id, including those in score and junk keys and
the active group, marks the outing `detached` and the group and course `phoneOnly`,
and changes nothing the second time. Both marks are optional fields that persist
with the documents. `toRows` then leaves out a detached outing and its rounds, and
a phone-only group or course unless a round or outing still syncing uses it, in
which case it goes up as the guest's own under its new id. A phone holding only a
detached day looks like a fresh install, so adopting the account's season keeps
what only the phone has (`keepingPhoneOnly`). The Outing screen shows a notice on a
detached outing and hides sharing. A guest's phone on an older build ignores notices
and can hit the upload problem above.

**Accounts that others depend on are refused for now.** The clean-up raises
`PR001`, with nothing deleted, for an organiser with a guest in an outing on someone
else's group or course: a notice stays, so it would keep moving a group or course
the guest may hold again through another outing. It also refuses another account's
rows hanging from the account's group or course, apart from a round in its own
outing. And it refuses an account with any other row of its own under someone
else's day, beyond the cells above. The policies refuse those now, so any that
exist are older, and removing them would change that person's day. Removing any of
these would take someone else's data with them. The app explains and points to
the email request. Later tickets of
[#206](https://github.com/jwh3times/PressGolf/issues/206) lift this case by case.

On the phone, `deleteAccount` in `AppStore` turns sync off and waits out any
push in flight (`settle` from `useDataSync`), then calls the server. On failure
it turns sync back on, which starts again from first contact, and the phone is
unchanged. On success it erases the live dataset, which includes the bag and
practice-round state, and then signs out, which forgets the remembered email and
unmounts the store, so the phone is back at first run. The demo dataset, the
demo/live preference and the theme stay.

If the app is killed after the server finishes and before the phone erases, it
reopens signed in until its token runs out. **Delete account** or "Erase my data"
finishes the job in that time, so there's no persisted resume flag. After that
it's like any other phone on a deleted account.

A maintainer handles an emailed request with the same clean-up function; see
[Deleting an account by hand](development.md#deleting-an-account-by-hand).

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
  functions/        Edge Functions (Deno), deployed by CI
  ci/               Postgres stand-ins and RLS assertions
scripts/
  check-patch-coverage.mjs
  generate-icons.py
  store-listing.mjs       renders the Play listing's icon, feature graphic and screenshots
  native-screens.mjs      compares the native nightly's screenshots with baselines
  a11y-lint.mjs           lints the native accessibility tree the nightly captures
  maestro-output.mjs      reads Maestro's output tree for the two scripts above
  sync-agents.mjs         .agents/skills -> .claude/skills generator
  lint-agent-neutrality.mjs checks agent and skill sources read correctly from their mirrors
  check-docs.mjs          checks local doc links and anchors, and that the doc map lists every document
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

`scripts/store-listing.mjs` renders the Play store listing graphics: the 512 px
icon, the 1024×500 feature graphic, and six captioned 1080×1920 phone
screenshots. It drives the web export's demo data as `tests/web/` does, with a
frozen clock and a mocked OpenStreetMap course for the hole map, and sets each
screen under a headline in the theme's colours. They are provisional listing art
for the closed test; store assets from phone builds replace them before public
submission. Run it by hand from the repository root; the files land in
`dist/store-listing/`:

```bash
npx expo export --platform web
node scripts/store-listing.mjs
```
