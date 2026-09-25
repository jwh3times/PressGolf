# Testing and CI

## Local checks

Run these before opening a pull request:

```bash
npm run test:coverage
npm run typecheck
npm run lint
npx expo-doctor
```

`npm test` runs Jest without collecting coverage. `npm run test:coverage` is the
CI-equivalent suite and enforces the global thresholds in `package.json`:

| Metric | Minimum |
|---|---:|
| Branches | 90% |
| Functions | 87% |
| Lines | 94% |
| Statements | 93% |

On pull requests, `scripts/check-patch-coverage.mjs` also requires at least 90%
line coverage on executable lines added or changed relative to the merge base.
That prevents a well-tested legacy codebase from hiding untested new behavior.

The September 2026 audit baseline is 22 suites, 310 tests, 90.19% branch
coverage, and 94.22% line coverage. Thresholds, rather than these point-in-time
figures, are authoritative.

## Pull-request CI

`.github/workflows/ci.yml` runs on every pull request and every push to `main`.

| Check | What it proves |
|---|---|
| **Tests, types, lint** | Jest coverage, 90% patch coverage on PRs, TypeScript, Oxlint, and Expo dependency/config compatibility |
| **Expo production bundle** | Metro, Babel, assets, and production transforms can export Android and iOS bundles |
| **Migrations and row-level security** | Every migration applies to Postgres 16, the baseline is repeatable, and 24 account-isolation assertions pass |
| **Dependency review** | A pull request does not introduce a dependency with a known high-or-critical vulnerability |

On a push to `main`, a fifth job applies pending migrations to the linked
Supabase project only after the first three cross-platform checks pass. It uses
`SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`, and `SUPABASE_DB_PASSWORD` from
the protected GitHub `production` environment. `supabase db push` is safe to
run when there are no pending migrations.

## Native smoke workflow

`.github/workflows/native-e2e.yml` runs nightly at 06:47 UTC and can be started
manually from GitHub Actions. It is intentionally separate from the fast PR
gate.

- Android: generates the native project, builds a release APK, boots an API 34
  Pixel 6 emulator with KVM acceleration, and runs Maestro.
- iOS: builds a release simulator app on macOS, boots an available iPhone
  simulator, and runs the same Maestro flow.
- Flow: open demo data, start a round, enter scores, settle, and post the result
  to the season ledger.

The workflow catches native compilation, installation, startup, navigation,
and the core round flow. It does not replace physical-device checks for safe
areas, outdoor touch use, Dynamic Type, VoiceOver, or TalkBack.

## Repository protections

The active `Protect main` ruleset applies to the default branch. It:

- requires pull requests and resolved review threads;
- requires the four PR checks above against the latest `main`;
- blocks force pushes and branch deletion; and
- blocks merge on CodeQL errors or high-or-higher security alerts.

GitHub secret scanning and push protection are enabled. Dependabot checks npm
and GitHub Actions daily at 05:00 America/New_York. Workflow actions are pinned
to full commit SHAs; Dependabot groups their updates so the pin can move through
normal review.

Expo-owned dependencies are constrained to SDK-compatible updates. Major SDK
changes are deliberate upgrades followed by `npx expo install --fix` and
`npx expo-doctor`, not isolated React Native version bumps.

## Manual validation status

The completed iOS accessibility pass and remaining Android work are recorded in
[accessibility.md](accessibility.md). Current product-level gaps are kept in the
root README and GitHub issues rather than implied by a green automated run.

When changing a user flow, update `.maestro/smoke.yml` if the stable visible
labels or navigation path change. When changing a control or dense layout, add
or update a React Native Testing Library assertion and repeat the relevant
manual accessibility pass.
