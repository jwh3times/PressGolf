# Press

Press is an offline-first golf game and settlement tracker for iOS and Android.
Set the format, enter one scorecard, and the app calculates the fewest cash
hand-offs needed at the end of the round.

It supports Nassau with presses, skins, junk, Stableford, four-ball, Wolf,
Vegas, match play, and stroke play. Outings can split a larger field into
playing groups while settling field-wide skins or scats alongside each group's
games.

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

As of September 2026:

- 22 Jest suites and 310 tests pass. Repository coverage is 93.22% statements,
  90.19% branches, 87.10% functions, and 94.22% lines; enforced thresholds live
  in `package.json`.
- CI exports production Metro bundles for Android and iOS and verifies every
  database migration plus 24 row-level-security assertions against Postgres 16.
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
  workflow in a browser.
- The app currently ships one dark, outdoor-oriented theme.

Track planned work and additional limitations in the
[issue tracker](https://github.com/jwh3times/PressGolf/issues).

## License

MIT — see [LICENSE](LICENSE).
