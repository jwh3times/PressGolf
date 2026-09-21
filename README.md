# Press

A weekend golf betting tracker for iOS and Android. Set the format, enter scores,
and the app works out who hands who cash in the car park.

Nassau with live presses, skins that carry, junk, Stableford, four-ball, Wolf,
Vegas, match play and stroke play — all nine settling off one card, netted down
to the fewest hand-offs. One Expo / React Native codebase ships to both platforms.

## Running it

```bash
npm install
npx expo start          # then scan the QR with Expo Go
npx expo start --android
npx expo start --ios    # needs macOS, or use Expo Go
```

Checks:

```bash
npm test          # jest — 30 engine tests
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
      ledger.ts     payment matrix, even splits, minimum transfers
      formats/      one file per game
      index.ts      settleRound() — runs every switched-on format
    __tests__/      30 tests over the money math
  store/            AsyncStorage persistence + React context
  components/       primitives, floating tab bar, screen chrome
  theme/tokens.ts   design tokens lifted from the prototype
  app/              expo-router routes
    (tabs)/         index · format · score · settle
    roster · courses · course/[id] · sides · new-round · history · settings
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

- **Single device.** One person scores for the group, as the design assumed.
  There is no account, no sync and no server. The data model is serialisable and
  id-based, so adding sync later is a data-layer job, not a rewrite.
- **Web is for previewing only.** `react-native-web` is installed and the app
  runs in a browser, but `Alert`-based confirmations (post to ledger, delete
  player, switch datasets) are no-ops there. They work on iOS and Android.
- **Dark theme only**, as designed. It is used outdoors with the brightness up.

## License

MIT — see [LICENSE](LICENSE).
