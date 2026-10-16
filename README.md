# Press

Press is an offline-first golf game and settlement tracker for iOS and Android.
Set the format, enter one scorecard, and the app calculates the fewest cash
hand-offs needed at the end of the round.

It supports Nassau with presses, skins, junk, Stableford, four-ball, Wolf,
Vegas, match play, and stroke play. Pops come from each player's Handicap Index
and tee, in full or off the low man, or are typed in by hand. Outings can split
a larger field into playing groups while settling field-wide skins or scats
alongside each group's games. On the course, a tap gives the yardage to the
green, from greens found on OpenStreetMap, placed on a satellite map, or marked
standing on them. Courses imported from OpenStreetMap also get a drawn map of
each hole, with the yards to the green, to a target, and to and over every
bunker and penalty area in play. Each mapped hole also says how it plays:
which misses run into out of bounds, water or bunkers, around the green, off
the tee and on a par 5's lay-up, hole by hole or in a course guide. Where to
aim is shown when looking a course over, or in a round its scorer marks as
practice, since the Rules of Golf don't allow it in a counted one. A course's
owner can leave a note on each hole and draw its out-of-bounds lines. A
player's bag keeps how far they carry each club, typed in once and backed up
with their account.

## Quick start

Press currently targets [Expo SDK 57](https://docs.expo.dev/versions/v57.0.0/),
which requires Node.js 22.13 or newer. Install
[Expo Go](https://expo.dev/go) on a phone, then run:

```bash
git clone https://github.com/jwh3times/PressGolf.git
cd PressGolf
npm ci
npm start
```

Scan the QR code with the iOS Camera app or Expo Go on Android. The computer
and phone normally need to be on the same network; if LAN discovery fails, run
`npx expo start --tunnel`.

Without Supabase variables, the app is intentionally local-only and opens with
the Saturday Dogs demo data. The current dependency set works in Expo Go. If a
future change adds native code that Expo Go does not bundle, use a
[development build](https://docs.expo.dev/develop/development-builds/introduction/)
instead.

For a build that works away from the development computer:

```bash
npx eas-cli@latest login
npx eas-cli@latest build --profile preview --platform android
npx eas-cli@latest build --profile preview --platform ios
```

The project is already linked to EAS; do not run `eas build:configure`. The
preview profile produces an installable Android APK or an internally
distributed iOS build. iOS device distribution requires an Apple Developer
account and registered devices. Native projects are generated through
Continuous Native Generation, so `ios/` and `android/` are not committed or
edited by hand.

## Project guides

- [Development and configuration](docs/development.md) — prerequisites,
  commands, Supabase setup, migrations, and EAS profiles.
- [Architecture and game rules](docs/architecture.md) — domain engine, storage,
  sync boundaries, repository layout, and settlement behavior.
- [Testing and CI](docs/testing-and-ci.md) — local checks, coverage gates,
  protected-branch checks, native smoke tests, and deployment controls.
- [Accessibility](docs/accessibility.md) — automated guarantees, iOS validation,
  the manual regression pass, and the open Android follow-up.
- [Contributing](CONTRIBUTING.md) and [security policy](SECURITY.md).

## Demo and live data

`EXPO_PUBLIC_DEMO_MODE` controls the build-time default. Preview and native
smoke-test builds enable it; production builds disable it. The user can switch
datasets later under **Settings → Demo data**.

Demo and live data use separate AsyncStorage namespaces (`press:demo:*` and
`press:live:*`). Demo data is never uploaded. With demo mode off and no
Supabase configuration, Press remains a fully usable single-device app.

## Current validation

As of October 2026:

- 25 Jest suites and 386 tests pass, including property-based settlement
  checks. Repository coverage is 94.14% statements, 91.36% branches,
  89.48% functions, and 95.14% lines; enforced thresholds live in
  `package.json`.
- Every pull request checks each main screen of the web build against committed
  screenshots and accessibility trees, at phone width and 320 px, and runs axe
  (WCAG 2.1 A and AA).
- Every pull request syncs a full season and a shared outing through a local
  Supabase stack (real auth, API, row-level security and realtime) with two
  accounts that must stay apart.
- CI exports production Metro bundles for Android and iOS and verifies every
  database migration plus 51 row-level-security assertions against Postgres 16.
- A scheduled and manually runnable Maestro workflow builds release apps for
  both platforms and completes a demo round through scoring, settlement, and
  posting to the ledger on an Android emulator and iOS simulator.
- Maximum Dynamic Type and a complete VoiceOver flow were validated on iOS
  hardware: sign in, start a round, enter scores, settle, and post to the
  ledger.

Android hardware validation at maximum font size and with TalkBack remains
open in [issue #22](https://github.com/jwh3times/PressGolf/issues/22). Passing
the Android emulator smoke test does not replace that device accessibility
pass.

## Known limits

- The active app uses locally persisted snapshots for backup and shared outing
  sync. It pushes after local changes and then pulls shared data; a passive
  device does not yet receive another phone's edit immediately. The mutation
  queue and realtime transport exist in `src/sync/`, but are not connected to
  `AppStore` yet.
- Joining and row-level-security boundaries are automated, but a full round
  scored concurrently by multiple physical phones has not been field-tested.
- Remote pruning after local deletion and adopting an existing season on a
  fresh physical device are covered by tests, not by a live-device pass.
- Web is a preview target. Native `Alert` confirmations do not provide the full
  workflow in a browser, and the native date picker for a card's Played-on
  date does not render there, so a card entered on web is dated today.
- Yardage needs a course's greens: found on OpenStreetMap from the course
  editor, which covers about half of courses, placed on a map, or marked by
  standing on each. The map has no web version, and an Android store build
  needs a Google Maps key that isn't set up yet (Expo Go doesn't).
  Importing them, with the course's bunkers, water and fairways for the hole
  map ([#125](https://github.com/jwh3times/PressGolf/issues/125)), sends
  the course name to OpenStreetMap's public services. It has
  been tested in Jest and on the web build, not on a phone on a course. Web
  cannot mark a green, because marking confirms through a native alert.
- The hole map has been checked in Jest and in the web build on Torrey Pines
  South's real map, not yet on a phone. It is drawn from the saved map, so it
  works without signal; its satellite switch, on phones only, needs signal,
  and on Android a store build needs the Google Maps key that isn't set up yet.
- The bag (Settings → My bag) is typed in by hand; nothing reads it yet. The
  practice-round club suggestions in
  [#125](https://github.com/jwh3times/PressGolf/issues/125) will. Checked on an
  iPhone, except at the largest text size and on a second device.
- How each hole plays ([#136](https://github.com/jwh3times/PressGolf/issues/136))
  is only as good as the course's map: a side is called clear only where
  something nearby is mapped, and the course edge counts as likely out of
  bounds until the owner draws lines. The practice-round mark stays on the
  phone that set it. Out-of-bounds lines are drawn on the satellite map, on a
  phone only. Checked in Jest and the web build, not yet on a phone.
- Handicap indexes are typed in by hand. Keeping them in step with GHIN is
  tracked in [issue #44](https://github.com/jwh3times/PressGolf/issues/44).
- Themes: dark (the default, made for daylight), light, and a high-contrast
  version of each, with a choice of four accents (Settings → Appearance). The
  splash screen stays dark whichever is chosen. Checked on an iPhone; not yet
  on Android.

Track planned work and additional limitations in the
[issue tracker](https://github.com/jwh3times/PressGolf/issues).

## License

MIT — see [LICENSE](LICENSE).
