# Testing and CI

## Local checks

Run these before opening a pull request:

```bash
npm run test:coverage
npm run typecheck
npm run lint
npx expo-doctor
```

When a change touches `scripts/` or `.agents/skills/`, also run:

```bash
npm run test:scripts        # node:test suites for the repository scripts
npm run sync:agents:check   # .claude/skills matches .agents/skills
```

When a change touches `src/sync/` or `supabase/migrations/`, run the sync
integration tests against a local Supabase stack (Docker required; see
[development.md](development.md#sync-integration-tests)):

```bash
npm run test:integration    # needs `npx supabase start` first
```

When a change touches what a screen shows or how it is labelled, run the web
UI suite (Docker required):

```bash
npm run test:web            # screenshots, accessibility tree and axe
npm run test:web:update     # accept intended changes: rewrites the baselines
```

`npm run sync:agents` rewrites the generated mirror; see
[AGENTS.md § Agent skills](../AGENTS.md#agent-skills) for which tree is authored.

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

`src/domain/__tests__/properties.test.ts` checks settlement invariants over
generated rounds and outings rather than worked examples. The generators in
`arbitraries.ts` draw 2–6 players on 9 or 18 holes, any mix of games and
options, pops, pick-ups, presses and Wolf picks. Every round must:

- net to zero, with transfers that repay it exactly;
- settle the same as a card as it does live; and
- never count a score higher than was written.

An outing must keep every cent either with a player or still in a pot. Once the
field is in, only a pot whose leftovers carry may keep anything, and a refund
only ever hands back a buy-in. The outing generator also produces fields where
every card is finished, and fields level on every hole where nobody wins, so
the end of the day is actually exercised. Transfers never need more than one
fewer than the players with money to move, and every Handicap Index reads back as written. The suite uses a fixed seed (in
`PROPERTY_RUNS`), so a CI failure reproduces locally, and fast-check prints the
shrunk counter-example.

The September 2026 audit baseline is 22 suites, 310 tests, 90.19% branch
coverage, and 94.22% line coverage. Thresholds, rather than these point-in-time
figures, are authoritative.

## Pull-request CI

`.github/workflows/ci.yml` runs on every pull request and every push to `main`.

| Check | What it proves |
|---|---|
| **Tests, types, lint** | Jest coverage, 90% patch coverage on PRs, TypeScript, Oxlint, repository-script tests, generated agent-skill mirrors are current, and Expo dependency/config compatibility |
| **Expo production bundle** | Metro, Babel, assets, and production transforms can export Android and iOS bundles |
| **UI regression and accessibility** | Each main screen of the web build matches its committed screenshot and accessibility tree, at phone width and at 320 px, and passes axe's WCAG 2.1 A and AA rules |
| **Sync against a local Supabase stack** | A full season round-trips through the real API. Two accounts can't read or write each other's data through it. A guest joins a shared outing by code and sees that day and nothing else. Members' edits reach each other through the log and live over realtime, and a stranger's don't |
| **Migrations and row-level security** | Every migration applies to Postgres 16, the baseline is repeatable, and 30 account-isolation assertions pass |
| **Dependency review** | A pull request does not introduce a dependency with a known high-or-critical vulnerability |

On a push to `main`, another job applies pending migrations to the linked
Supabase project. It runs only after the tests, the bundle, the throwaway
database and the sync integration tests have all passed. It uses
`SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`, and `SUPABASE_DB_PASSWORD` from
the protected GitHub `production` environment. `supabase db push` is safe to
run when there are no pending migrations.

## UI regression and accessibility (web)

`tests/web/screens.spec.ts` opens the web export (`npx expo export --platform
web`, demo data, clock frozen at 2026-09-26) in Playwright. It visits Home,
Format, Score (hole by hole and whole card), Settle, Roster, History and Outing
by tapping through the app, as a user would. On each screen it checks three
things:

1. **Screenshot.** It must match `tests/web/__snapshots__/<project>/<screen>.png`
   exactly: there is no per-pixel tolerance, so even a one-step change to a
   colour token fails.
2. **Accessibility tree.** It must match `<screen>.aria.yml`: every role, name
   and state, as a screen reader reads it.
3. **axe.** It finds no WCAG 2.1 A or AA violation, such as a missing name, an
   invalid role or poor colour contrast.

It runs twice: as `phone` (390×844) and as `reflow-320` (320×640, the WCAG
1.4.10 reflow width).

Baselines only compare cleanly against the renderer that made them, so the CI
job runs inside `mcr.microsoft.com/playwright:v<version>-noble`.
`npm run test:web` runs the same image locally through Docker. Don't run a bare
`npx playwright test` on Windows or macOS: their fonts render differently and
every screenshot fails. The image tag in `ci.yml` must equal the pinned
`@playwright/test` version, and a CI step fails if they drift. Update both
together.

When a change to a screen is intended, run `npm run test:web:update`, review
the changed PNG and `.aria.yml` files in the diff, and commit them with the
change. On failure, CI uploads a `playwright-report` artifact with the expected,
actual and diff images and a trace.

Limits:

- **Web is a preview target.** Native `Alert`s and the date picker don't behave
  as they do on a phone, so the suite checks screens rather than full flows.
- **Large text isn't emulated.** React Native's font scale is fixed at 1 on the
  web, so maximum text size is covered by the native nightly's large-text
  pass instead (see [Native smoke workflow](#native-smoke-workflow)). The 320 px
  project checks reflow.
- **This is not a screen-reader pass.** See [accessibility.md](accessibility.md).

## Native smoke workflow

`.github/workflows/native-e2e.yml` runs nightly at 06:47 UTC and can be started
manually from GitHub Actions. It is intentionally separate from the fast PR
gate.

- Android: generates the native project, builds a release APK, boots an API 34
  Pixel 6 emulator with KVM acceleration, and runs Maestro.
- iOS: builds a release simulator app on macOS, boots an available iPhone
  simulator, and runs the same Maestro flows.

There is one flow per journey in `.maestro/flows/`, each starting from a fresh
install of the demo data through `.maestro/subflows/launch.yml`:

| Flow | Journey |
| --- | --- |
| `round.yml` | Enter a score on the live round, settle, and post to the season ledger. |
| `card-entry.yml` | Enter a finished card: switch Wolf on, record a lone-wolf pick and a press, save the card, and find it in History. |
| `outing.yml` | Switch to the demo society, open its outing, and check both field pots and the standings. |
| `handicaps.yml` | Change a player's index on the roster, see Format offer to recalculate, recalculate, and check the pops row. |

`.maestro/passes.sh` runs every flow twice: at the default text size, then at
the largest the platform offers (iOS Dynamic Type
`accessibility-extra-extra-extra-large` through `xcrun simctl ui`, Android
`font_scale` 2.0 through `adb`). A control pushed off-screen or out of reach at
large text fails its flow. The large-text pass runs even when the default pass
failed, and the text size is reset afterwards. The job fails if either pass
does, but the workflow is nightly and report-only: it never gates a PR.

`.maestro/run.sh` runs each flow, and runs that flow once more if its first
attempt fails. A hosted simulator can stall Maestro's own driver (seen as
"Timed out while requesting screenshot"), which fails a run for reasons
unrelated to the app. A real regression fails both attempts, and a
first-attempt failure is still reported as a warning naming the flow. A flow
that fails twice fails the run, but the flows after it still run.

Maestro gives its driver a startup window, set by `MAESTRO_DRIVER_STARTUP_TIMEOUT`
in the workflow: 5 minutes on Android and 10 on iOS. XCTest on a cold hosted
simulator can take close to four minutes to start even on a passing run.

Every Maestro run starts its own driver, so with four flows at two text sizes
the jobs allow 90 minutes on Android and 120 on iOS.

Each attempt keeps its own output under `default/` or `large-text/`, then the
flow's name: a screenshot and log for each step under `attempt-N/`, and its own
JUnit report, `junit-attempt-N.xml`. A failed attempt
sets `MAESTRO_ATTEMPT_FAILED=true` for the rest of the job. The job uploads the
output as a `maestro-android` or `maestro-ios` artifact on every run, kept for
14 days: the report job reads it, and a first attempt that fails before a
passing retry still leaves its evidence. `npm run test:scripts`
covers `run.sh` and `passes.sh` against stand-ins for Maestro, `xcrun` and
`adb`.

The flows wait on what is on screen rather than on timing, and check results by
scrolling to them rather than by asserting on whatever happens to be showing.
Every tap goes through `.maestro/subflows/tap.yml`, which first scrolls the
control to the middle of the screen in the direction given. At the largest
text size most controls start off-screen, and a control left at the bottom
edge can sit under the floating tab bar, or on Android over the system
navigation bar, where Maestro still counts it as visible and the tap lands on
the bar (an early run tapped Android's Home button this way).

The flows wait for native alerts (Post it, Mark and save) before tapping them.
They find controls by their accessibility labels; the one exception is a
game's switch on Format, whose label repeats the title beside it, so the
shared `Switch` carries a `switch-<label>` test ID. iOS reads a button with no
label of its own as its children's text joined together, while Android keeps
each text separate, so a flow that matches such a row uses a pattern open at
both ends.

Two Android behaviours shape the shared steps:

- **Launching.** Clearing the app's state removes its task, and the system's
  delayed kill of that old task can land on the process a launch has just
  started, leaving the splash screen over a dead process. `launch.yml` stops,
  clears, pauses and then launches, and launches once more if the home screen
  hasn't appeared after 90 seconds.
- **The keyboard.** Maestro sees the soft keyboard's keys. A flow that types
  and then taps a button named Done must hide the keyboard first, or it taps
  the keyboard's own Done key.

The workflow catches native compilation, installation, startup, navigation,
the four journeys, and controls that large text pushes out of reach. It does
not replace physical-device checks for safe areas, outdoor touch use,
VoiceOver, or TalkBack; see [accessibility.md](accessibility.md).

### Native nightly report

The flows pass through eight checkpoints (`.maestro/subflows/checkpoint.yml`):
Home, Score hole by hole, Settle, Score as a whole card, History, Outing,
Format and Roster. A checkpoint waits half a second for text that never
appears, as an optional step: Maestro saves a failing step's screenshot and
view hierarchy, and an optional failure doesn't fail the flow. Each checkpoint
is captured on both platforms at both text sizes.

A third job, `report`, runs after both platform jobs, whatever their result.
It downloads their output and runs two scripts:

- **`scripts/native-screens.mjs`** compares each screenshot with its baseline
  in `.maestro/baselines/<platform>/<text size>/<flow>--<checkpoint>.png`. A
  screen is reported when more than 0.2% of its pixels differ, when it has no
  baseline, or when its size changed. Text that changes by itself, such as the
  demo data's dates (seeded relative to today), is masked using its bounds in
  the hierarchy captured with the screenshot.
- **`scripts/a11y-lint.mjs`** lints each hierarchy; see
  [accessibility.md](accessibility.md#native-accessibility-tree-lint).

Both are **report-only**: a finding never fails the run. The report goes to
the run's summary and a `native-report` artifact, which holds the expected,
actual and diff image of every screen that differs. The scheduled nightly also
writes it to one open issue titled "Native nightly report", replacing the
previous night's.

Screenshots only compare when the renders are pinned, so the workflow:

- boots a named simulator, iPhone 17 Pro on iOS 26.4 (`IOS_DEVICE` and
  `IOS_RUNTIME` in the workflow), and warns and falls back to the newest
  iPhone when the runner image no longer has it;
- keeps the fixed Pixel 6, API 34 emulator; and
- pins the status bar to 9:41, full battery and full signal
  (`.maestro/pin-status-bar.sh`: the simulator's status bar override on iOS,
  System UI demo mode on Android).

To read a difference, download `native-report` and open the three images for
the screen. An intended change needs new baselines:

1. Run the workflow by hand from the branch (Actions → Native smoke tests →
   Run workflow) with **Record this run's screenshots** ticked.
2. The report job commits the run's screenshots to a `baselines/run-<id>`
   branch and links to it from the run summary. GitHub Actions may not open
   pull requests in this repository, so open the PR from that link.
3. Review the images in the PR as you would any other change.

The baselines also need recording again when the runner image changes the
simulator, the emulator image, or the OS fonts. The 0.2% allowance
(`DEFAULT_MAX_DIFF_RATIO`) is a starting point: each report prints the largest
difference among the screens that matched, which is the figure to tune it
from.

`npm run test:scripts` covers both scripts and `pin-status-bar.sh`.

## Repository protections

The active `Protect main` ruleset applies to the default branch. It:

- requires pull requests and resolved review threads;
- requires the six PR checks above against the latest `main`;
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

When changing a user flow, update the matching flow in `.maestro/flows/` if the
stable visible labels or navigation path change. When changing a control or dense layout, add
or update a React Native Testing Library assertion and repeat the relevant
manual accessibility pass.
