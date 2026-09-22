# Press

A weekend golf betting tracker for iOS and Android. Set the format, enter scores,
and the app works out who hands who cash in the car park.

Nassau with live presses, skins that carry, junk, Stableford, four-ball, Wolf,
Vegas, match play and stroke play — all nine settling off one card, netted down
to the fewest hand-offs. One Expo / React Native codebase ships to both platforms.

Scales from a fourball to a twenty-man society: field-wide pots across everyone
who buys in, split into foursomes that each run their own games, with four
phones scoring the same day at once.

## Running it on a phone

Every native module here ships inside **Expo Go**, so there is nothing to
compile to try it.

```bash
git clone https://github.com/jwh3times/PressGolf.git
cd PressGolf
npm install
npx expo start        # scan the QR: iOS Camera app, Android via Expo Go
```

Your phone and your computer need to be on the same Wi-Fi. If they are not, or
the QR sits there spinning, use `npx expo start --tunnel`.

With no server configured — which is what a plain `npm start` gives you — the
app is local-only and opens straight onto the Saturday Dogs demo, a fourball
through eleven holes. **Settings → Group → Pine Hollow Society** switches to the
twenty-man outing with the field pots running.

Run it with a server (`npm run start:op`, see [Multiplayer
scoring](#multiplayer-scoring)) and it asks you to sign in first, once.

### For testing on an actual course

Expo Go runs the app off your laptop's dev server, which is no use standing on
the twelfth tee. It also cannot test the behaviour that matters most out there:
kill the Wi-Fi and Expo Go stops, where a real build would keep scoring and
queue the edits. For anything resembling a real round you want a standalone
build — it installs like any other app and needs nothing running.

```bash
npm install -g eas-cli
eas login
eas build:configure
eas build --profile preview --platform android   # .apk, install directly
eas build --profile preview --platform ios       # needs a paid Apple account
```

Android gives you an APK you can sideload straight away, no developer account.
iOS internal distribution needs a paid Apple Developer account ($99/yr) to
register the device — without one, Expo Go is the way on iPhone.

Builds happen in the cloud, so no Xcode or Android Studio locally. `ios/` and
`android/` are generated — never edit or commit them by hand.

### Checks

```bash
npm test          # jest — 87 tests (engine, outings, sync, auth)
npm run typecheck # tsc --noEmit
npm run lint      # eslint
npx expo-doctor   # dependency and config sanity
```

### What has and has not been verified

Verified: 87 tests over the money math, the sync logic and the credential checks, a clean typecheck and
lint, bundles for both iOS and Android, a headless run through every route with
no runtime errors, and the SQL schema's row-level security exercised against a
real Postgres.

**Not verified: any of it on real hardware.** Nothing here has run on a phone.
Two things to eyeball first, because a headless browser cannot judge them:

- **Touch targets.** The score steppers carry hit-slop for cold or gloved
  hands, but that is a guess until a thumb lands on one.
- **The floating tab bar against real safe areas.** It reads the actual insets
  rather than hard-coding them, but a notch and a punch-hole are worth seeing.

Also unverified: the live Supabase wire (see [Multiplayer scoring](#multiplayer-scoring)).

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
2. In **Authentication → Providers**, leave **Email** on and turn **Confirm
   email** off. Accounts then work the moment they are created, with no SMTP to
   configure — the join code is the real gate on an outing. Leave **Anonymous
   sign-ins** off; the app does not use them.
3. Run [`supabase/schema.sql`](supabase/schema.sql) once in its SQL editor.
4. Put the project URL and anon key in the `PressGolf` 1Password vault, as an
   item called `Supabase Project`. Writing needs a token with write access on the
   vault; the token the app runs under is read-only:

   ```bash
   OP_SERVICE_ACCOUNT_TOKEN="$OP_WRITE_TOKEN" \
     op item create --vault PressGolf --category "API Credential" --title "Supabase Project" \
       url=https://YOUR-PROJECT.supabase.co anon_key=YOUR-ANON-KEY
   ```

5. Start with the two injected: `npm run start:op`, which wraps
   `op run --env-file=.env.op -- expo start`. That only ever reads, so it runs
   under the default read-only `OP_SERVICE_ACCOUNT_TOKEN`.
   [`.env.op`](.env.op) holds `op://` references rather than values, so it is
   committed and no key is ever written into the working tree. Plain `npm start` still works — without
   the variables the app is simply local-only.

Both variables are `EXPO_PUBLIC_`, so they are compiled into the bundle. The
anon key is *meant* to be public; row-level security is what actually guards
the data. The vault keeps the pair out of git and gives one source of truth —
it does not make them secret from anyone holding a build.

Cloud builds cannot reach your local 1Password, so EAS needs the same two
values set as EAS environment variables against the `preview` and `production`
profiles before a build can talk to Supabase.

Everyone signs in with an email and a password, so an edit can be attributed
to a person rather than to a device. The organiser then gets a six-character
join code (no `O`/`0` or `I`/`1`, because people read them out loud), and that
code is what decides who is in the outing — the account says who you are, the
code says which day you are on.

You sign in once. The session persists, and a phone that has signed in before
is let straight through on later launches whether or not it can reach the
server — being locked out of your own scorecard in a car park with no signal
would defeat the point of an offline-first app. Everything the server actually
protects is still protected: row-level security does not care what the app
chose to render.

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
  auth/             accounts
    validate.ts     credential checks and the copy for what the server says
    AuthProvider.tsx  session state, including the offline grant
    AuthGate.tsx    app, or the way in
    __tests__/      16 tests over the validation and error copy
  sync/             offline-first multiplayer
    types.ts        a mutation is one addressable cell, not a document
    merge.ts        per-cell last-write-wins
    engine.ts       durable queue, coalescing flush, backoff
    fake-transport.ts  an in-memory server that can fail on demand
    supabase.ts     the real wire, plus join-by-code
    __tests__/      21 tests, including losing signal mid-round
  store/            AsyncStorage persistence + React context
  components/       primitives, floating tab bar, screen chrome, sign-in
  theme/tokens.ts   design tokens lifted from the prototype
  app/              expo-router routes
    (tabs)/         index · format · score · settle
    roster · courses · course/[id] · sides · new-round · history · settings
    new-outing · outing · field-games · groups · join
scripts/
  generate-icons.py the icon and splash art, drawn from theme/tokens.ts
```

The mark is a flagstick in the cup, in the app's own paper-white and green.
Every asset in `assets/` — the iOS icon, the splash, the three Android
adaptive layers and the favicon — comes out of `scripts/generate-icons.py`, so
they are one shape at different sizes rather than six files to keep in step.
Re-run it (`pip install Pillow && python3 scripts/generate-icons.py`) after
changing the mark or the palette.

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
- **Nothing has run on a phone yet.** Bundled for both platforms and driven
  headlessly, but never on real hardware — see
  [What has and has not been verified](#what-has-and-has-not-been-verified).
- **No presence or activity feed yet.** You can see that a group is `THRU 12`,
  but not who is typing right now or who entered a given score.
- **Web is for previewing only.** `react-native-web` is installed and the app
  runs in a browser, but `Alert`-based confirmations (post to ledger, delete
  player, switch datasets) are no-ops there. They work on iOS and Android.
- **Dark theme only**, as designed. It is used outdoors with the brightness up.

## License

MIT — see [LICENSE](LICENSE).
