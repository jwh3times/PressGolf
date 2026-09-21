# Press

A weekend golf betting tracker for iOS and Android. Set the format, enter scores,
and the app works out who hands who cash in the car park.

Nassau with live presses, skins that carry, junk, Stableford, four-ball, Wolf,
Vegas, match play and stroke play — all nine settling off one card, netted down
to the fewest hand-offs. One Expo / React Native codebase ships to both platforms.

Scales from a fourball to a twenty-man society: field-wide pots across everyone
who buys in, split into foursomes that each run their own games, with four
phones scoring the same day at once.

## Running it

```bash
npm install
npx expo start          # then scan the QR with Expo Go
npx expo start --android
npx expo start --ios    # needs macOS, or use Expo Go
```

Checks:

```bash
npm test          # jest — 71 tests (engine, outings, sync)
npm run typecheck # tsc --noEmit
npm run lint      # eslint
```

Building signed apps needs EAS (`npx eas-cli build`); no Xcode or Android Studio
required locally. `ios/` and `android/` are generated, so don't commit them by hand.

## Demo mode

`DEMO_MODE` seeds the Saturday Dogs at Pine Hollow — a live round through eleven
holes, plus eighteen settled Saturdays behind it — so the app has something to
show before a real group exists.

- Build-time default: `EXPO_PUBLIC_DEMO_MODE=false` turns it off at the source.
- Runtime: **Settings → Demo data**. This is the one that persists.

Demo and live data sit in **separate storage namespaces** (`press:demo:*` and
`press:live:*`). Switching never mixes fake money into a real season ledger, and
flipping back and forth loses nothing on either side. With demo off the app is
genuinely empty — that is the correct starting state for a real group, so every
screen has an empty state rather than invented players.

The season ledger is **not** a stored number. It is recomputed by re-settling
every completed round, so correcting a score from three weeks ago moves the
standings. The demo's prior rounds are generated from a fixed seed, so the
history is a real sum of real settlements rather than four numbers typed in.

## Outings: a field, split into groups

A normal Saturday needs none of this — "Start a round" still goes straight to a
card. An **outing** is for the day when twenty of you are out in five groups.

- **The field** is everybody playing. It splits into playing groups of four,
  rearranged by tapping a player and then the group they belong in.
- **Field pots** run across everyone who buys in: field skins and scats.
- **Each group still plays its own games** — Group 1 can have a $5 Nassau while
  Group 3 plays Wolf, and neither affects the other.
- One settlement covers the lot. Lose $30 in your fourball's Nassau, take $180
  out of the scats pot, and you collect $150.

### Field pots are pots, not per-man bets

The foursome games move money directly between players. At twenty that stops
working: one skin at $2 a man would collect $38, and a hot round would swing
someone $300. So field games are buy-in pots — everyone puts up the same stake
and the pot comes back out to whoever won holes.

|  | Field skins | Scats |
|---|---|---|
| Wins the hole | Alone at the low score | Alone at the low score |
| Decided on | Net (pops applied) | Gross |
| Tied hole | Nobody wins it | Carries — the **rabbit** |
| Money | Pot split evenly across every skin won | Pot cut into per-hole shares |

They are the same bet with different money. "Only one man made par on the
fifth" is exactly a skin's win condition, so the two share one calculator —
which means the scat math is covered by the skins tests. The differences that
actually matter are three switches on the pot's setup screen: gross or net,
whether ties carry, and where leftovers go.

Both defaults are stated rather than assumed. Scats default to gross because
that is how "made par" is meant; field skins default to net because that is how
skins have always been played. Either can be flipped per outing.

### Nothing pays until the field has finished the hole

With tee times ten minutes apart, the last group is an hour behind the first.
A hole only settles once every entrant has posted a score on it, and the rabbit
cannot jump a hole the field has not finished — so most of the card is
legitimately unresolved for most of the morning.

The app says so: `6/18 holes settled`, `12 holes waiting on groups still out on
the course`. A field leaderboard that hid that would be worse than none.

Buy-ins come out of everyone's pocket the moment the pot is on, so the standings
read negative for most of the field until the pots pay. That is the truth of a
pot — the money has genuinely left the players and is sitting in an envelope —
and it is why the outing's net does not sum to zero the way a pairwise bet does.

## Multiplayer scoring

Four phones can score the same outing. It is **offline-first**, which is not a
nicety: half of golf courses have no signal on the back nine, and a
request/response app would silently lose people's birdies.

- Every edit is applied **locally first** and queued. Nothing waits on a network.
- The queue is **durable** — it survives the app being killed in a car park.
- Sync is a log of small facts (`player X, hole 7, scored 5, at time T`), not
  whole documents. Two people scoring different holes never conflict; two people
  scoring the same hole resolve to the later edit, with ties broken identically
  on every device.
- Re-sending after a timeout is harmless: every mutation carries a stable id.

### Setting it up

Multiplayer is off unless a server is configured, and the app is fully usable
without one.

1. Create a Supabase project.
2. Run [`supabase/schema.sql`](supabase/schema.sql) once in its SQL editor.
3. Set `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY`.

Sign-in is anonymous — nobody types an email on the first tee. The organiser
gets a six-character join code (no `O`/`0` or `I`/`1`, because people read them
out loud), and that code is the shared secret.

The schema's row-level security was exercised against a real Postgres: an
outsider sees no outings and cannot write edits, joining requires the code,
duplicate mutation ids are rejected so retries are safe, and the log is
append-only — `DELETE` affects zero rows even when the grant exists.

## Layout

```
src/
  domain/           pure TypeScript, no React — this is the part that matters
    types.ts        Player, Course, Round, GameConfig, Press, WolfPick…
    formats.ts      the nine formats' copy, colours and defaults
    factory.ts      constructors, id generation, round reconciliation
    season.ts       season standings, rebuilt from completed rounds
    engine/
      context.ts    pops allocation, net scores, money formatting
      ledger.ts     payment matrix, pot contributions, minimum transfers
      formats/      one file per game, incl. field.ts for the pots
      outing.ts     settleOuting() — every group's games plus the field pots
      index.ts      settleRound() — one group's games
    __tests__/      50 tests over the money math
  sync/             offline-first multiplayer
    types.ts        a mutation is one addressable cell, not a document
    merge.ts        per-cell last-write-wins
    engine.ts       durable queue, coalescing flush, backoff
    fake-transport.ts  an in-memory server that can fail on demand
    supabase.ts     the real wire, plus join-by-code
    __tests__/      21 tests, including losing signal mid-round
  store/            AsyncStorage persistence + React context
  components/       primitives, floating tab bar, screen chrome
  theme/tokens.ts   design tokens lifted from the prototype
  app/              expo-router routes
    (tabs)/         index · format · score · settle
    roster · courses · course/[id] · sides · new-round · history · settings
    new-outing · outing · field-games · groups · join
```

The engine is deliberately free of React. `settleRound(round, course, roster)`
takes plain data and returns a settlement, which is why the whole thing is
testable without rendering anything.

### Money is integer cents

Every amount inside the engine is a whole number of cents. Dollars-as-floats
drift the moment you halve a team stake or multiply Vegas points, and a bet
that is off by a penny is an argument. `splitEvenly` guarantees the parts sum
back to the whole, and `Ledger.paySides` rotates the odd cent between winners
so two partners never end a match a cent apart.

## What the nine formats do

| Format | Settles | Notes |
|---|---|---|
| Nassau | Front, back and total, every pair | Presses run to the end of the nine they were fired on |
| Skins | Low net, ties carry | Skins still riding at the end are dead money, reported not paid |
| Junk | Birdies, eagles (2×), albatross (3×), greenies, sandies, chip-ins, polies | Pays as soon as that player has a score |
| Stableford | High net points takes the pot | Winner-takes-all, so an unbroken tie pushes |
| Four-ball | Best ball of two, match play between sides | Each loser ends down exactly the stake |
| Wolf | Per hole, wolf's side vs the rest | Partner picked on the Score screen; lone wolf is a separate bet against each opponent |
| Vegas | Paired net scores as a number, difference × stake | Birdie flips the opposing number; configurable |
| Match play | Straight 1v1 over the round | Defaults to round robin; pick specific rivals in Sides |
| Stroke play | Low net total | Settles only when every score is in |

Formats that need setup say so instead of silently paying nothing: four-ball and
Vegas report "can't pay until the sides are set", and Wolf names how many played
holes have no pick.

## Where this departs from the original prototype

Press started as an interactive HTML prototype — a working demo with four
hardcoded players, one hardcoded course and a hardcoded season. Making it a real
app meant changing some things on purpose:

- **Nothing is hardcoded.** Players, courses (par, stroke index and yards per
  hole), tee order, stakes, pops, teams and rivals are all editable and persisted.
- **Presses are symmetric.** The prototype hardcoded the presser to player 0 and
  compared the current nine while the press itself ran to hole 18. Here any
  player can press any opponent, and the press covers the nine it was fired on.
- **Max exposure is computed per format.** The prototype used flat multipliers
  (`nassau × 3, skins × 18, everything else × 6`) that don't correspond to any
  format's actual worst case. This version derives it, and the screen says what
  the number assumes — Vegas has no theoretical cap, so it is quoted at ten
  points a hole.
- **Pops work above 18.** The prototype's `pops >= strokeIndex` check silently
  caps at one stroke per hole. A 20 handicap now gets a shot everywhere plus a
  second on stroke index 1 and 2.
- **Wolf and Vegas are built, not stubbed.** Wolf gets a per-hole partner picker
  on the Score screen; Vegas and four-ball share one set of sides, because groups
  who split 2v2 play both games with the same partners.
- **Winner-takes-all pots push on a tie** rather than paying a joint winner.
- **The Score screen opens on the hole you're standing on**, not hole 1.

## Known limits

- **The live Supabase wire is untested.** The sync *logic* is covered by 21
  tests against a fake transport that can drop the network on demand, and the
  SQL schema and its row-level security were exercised against a real Postgres.
  But nothing here has talked to an actual Supabase project — that needs a
  provisioned project and two phones.
- **No presence or activity feed yet.** You can see that a group is `THRU 12`,
  but not who is typing right now or who entered a given score.
- **Web is for previewing only.** `react-native-web` is installed and the app
  runs in a browser, but `Alert`-based confirmations (post to ledger, delete
  player, switch datasets) are no-ops there. They work on iOS and Android.
- **Dark theme only**, as designed. It is used outdoors with the brightness up.

## License

MIT — see [LICENSE](LICENSE).
