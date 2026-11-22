# Dependabot

What reviewing a Dependabot pull request takes here, read by the `dependabot` skill in a session
and in the scheduled review. These facts apply to this repository only.

## Stack

An Expo SDK 58 React Native app (`expo` ~58.0.26, `"main": "expo-router/entry"`, react-native
0.88.1, react 19.3.0, react-native-reanimated 4.7.1 with react-native-worklets 0.13.0, and
react-native-web for the web export), installed with npm from the root `package-lock.json`.
AsyncStorage is the authoritative local store, and `src/sync/` syncs it to Supabase snapshot tables
under row-level security through @supabase/supabase-js (`docs/architecture.md`). `src/domain/` is
the plain-TypeScript settlement engine. The schema is in `supabase/migrations/`, and there is one
Edge Function, `supabase/functions/delete-account/`. The support site is a Cloudflare Worker in
`site/`, deployed by Cloudflare's Workers Builds, not by this repository's workflows. Types are
checked with TypeScript 7 (`tsc --noEmit`), lint is oxlint (`.oxlintrc.json`), and tests are Jest
with the jest-expo preset, plus a Playwright web suite for screenshots and accessibility.

`.github/workflows/ci.yml`, on every pull request:

- **Tests, types, lint:** `npm ci`, `npm run test:coverage`, patch coverage of at least 90% against
  the merge base (`scripts/check-patch-coverage.mjs`), `npx tsc --noEmit`, `npx oxlint`,
  `npm run test:scripts`, the changelog check, the agent, skill and docs checks, and "Expo SDK
  agrees with itself", `npx expo-doctor`.
- **Expo production bundle:** `npx expo export --platform all`.
- **UI regression and accessibility:** runs in `mcr.microsoft.com/playwright:v1.65.1-noble`, checks
  that the installed `@playwright/test` is 1.65.1 ("Playwright matches its container"), exports
  the web build, and runs `npx playwright test`.
- **Migrations and row-level security:** a `postgres:16` service, the migrations applied with
  `psql`, then `supabase/ci/rls-test.sql`.
- **Sync against a local Supabase stack:** `npx supabase start`, then `npm run test:integration`.
- **Dependency review:** `actions/dependency-review-action` with `fail-on-severity: high`.

On `main` only, `ci.yml` also runs "Apply migrations to Supabase" (the Supabase CLI's `db push` and
`functions deploy` against production), "Tag the release" and "Store build"
(`npx eas-cli@27.1.0`, pinned by hand). `prepare-release.yml` (manual) opens a release PR, and
`native-e2e.yml` is the nightly Maestro run on Android and iOS; neither is a PR check. PRs also
show Cloudflare's "Workers Builds: pressgolf-site" check. Every action is pinned by commit SHA
with a version comment.

`.github/dependabot.yml` opens updates daily for the root npm manifest and for GitHub Actions; one
review covers a grouped PR:

- **`expo-sdk`:** every Expo-pinned package: `expo`, `expo-*`, `@expo/*`, `@expo-google-fonts/*`,
  `babel-preset-expo`, `jest-expo`, `eslint-config-expo`, `react`, `react-dom`, `react-native`,
  `react-native-*`, `@react-native-async-storage/*`, `@react-native-community/datetimepicker` and
  `@types/react`.
- **`tooling`:** development dependencies outside that set, minor and patch only. A development
  major (the `supabase` CLI, `typescript`) and every production dependency outside `expo-sdk`
  (`@supabase/supabase-js`) arrive as their own PR.
- **`actions`:** every GitHub Action, majors included.

## Review triggers

- **A bump of a package `.github/dependabot.yml` ignores, at an ignored update type.** Any bump of
  react, react-dom, react-native, `@react-native-async-storage/*`,
  `@react-native-community/datetimepicker`, react-native-svg, react-native-maps,
  react-native-reanimated or react-native-worklets; a minor or major of `react-native-*` or
  `@types/react`; a major of jest, `@types/jest`, expo, `expo-*`, `@expo/*`,
  `@expo-google-fonts/*`, babel-preset-expo or jest-expo. Such a PR comes from outside the version
  updates' rules, as #197 did: to remove a transitive dependency it moved expo-router from 57.0.29
  to 58.0.28 with `expo` left on 57. Investigate it on any bump.
- **`@playwright/test`, any bump.** It is pinned exactly, and CI's UI job is red until `ci.yml`
  moves with it (Playbook; #169, #343).
- **`@axe-core/playwright`, a minor.** axe-core 4.14 enforced a new rule
  (`label-content-name-mismatch`) and failed the UI job on controls the app already had (#169).

## Resolution

- **Toolchain.** Node 22: no `.nvmrc` or `engines` names it; every `actions/setup-node` step in
  `.github/workflows/` pins `node-version: '22'`. npm is the one Node 22 ships with.
- **npm** (`package.json`, `package-lock.json`), from the repository root: `npm ci`.

## Where to look

- `app.json`, `app.config.js`, `babel.config.js` and `eas.json`, for an Expo or React Native bump.
- `src/app/` (Expo Router routes), `src/domain/`, `src/store/`, `src/sync/` (the Supabase client
  and the sync calls) and `src/components/`.
- The `jest` block of `package.json`, `jest.integration.config.js`, `playwright.config.ts`,
  `tests/web/`, `.oxlintrc.json` and `tsconfig.json`.
- `supabase/config.toml`, the `migrate` job in `ci.yml` and the `db:*` scripts in `package.json`,
  for a Supabase CLI bump.
- `supabase/functions/delete-account/index.ts`, which imports
  `npm:@supabase/supabase-js@2.118.0`: a second pin of supabase-js that Dependabot does not update
  (`.github/dependabot.yml` covers only the root npm manifest and the workflows).
- The `uses:` comments and `with:` inputs in `ci.yml`, `native-e2e.yml` and `prepare-release.yml`.

## Grounding facts

- **Expo owns the versions of react, react-dom, react-native and the Expo-pinned packages.** The
  only correct way to move them is `npx expo install --fix` as part of an SDK upgrade
  (`.github/dependabot.yml`, `docs/development.md`). A bump that leaves the set disagreeing fails
  `npx expo-doctor` even when every unit test passes: react-native-svg 15.15.4 to 15.15.5 (#142)
  and `@react-native-community/datetimepicker` 9.1.0 to 9.2.1 (#45) both did. For an `expo-sdk`
  PR or an Expo-pinned package, expo-doctor decides: when it reports a mismatch, the verdict is
  NEEDS EFFORT, quoting it.
- **An Expo SDK major is always NEEDS EFFORT.** `.github/dependabot.yml` ignores it: it is a
  deliberate upgrade done with `npx expo install --fix` after reading the SDK's changelog and
  upgrade guide (`docs/development.md`), followed by a `native-e2e.yml` run on the branch before
  merging (`docs/agents/merging.md`). Ground the steps in the SDK release notes and in `app.json`,
  `app.config.js` and the native config.
- **A lone expo-router major cannot be repaired by rebasing.** The router moves a major while
  `expo` stays, and `npm ci` fails with `ERESOLVE` (`docs/agents/merging.md`; #197, closed for the
  next SDK upgrade). NEEDS EFFORT: it cannot be taken until that upgrade.
- **jest-expo 58 is a Jest 30 preset.** The lockfile's `jest-expo` 58.0.15 depends on babel-jest,
  jest-environment-jsdom, jest-snapshot and `@jest/globals` at `^30.0.0`. A jest major is NEEDS
  EFFORT until the jest-expo of a later SDK needs it; cite jest-expo's ranges from
  `package-lock.json`.
- **`@playwright/test` is pinned to exactly 1.65.1, and the UI job runs in
  `mcr.microsoft.com/playwright:v1.65.1-noble`.** A bump that does not also change that image tag
  and the version in the "Playwright matches its container" step fails that step by design
  (`docs/testing-and-ci.md`). `scripts/test-web.mjs` derives its image from the installed version,
  so only `ci.yml` needs the edit.
- **A green PR does not run the Supabase CLI's production commands.** On a pull request the CLI
  only runs `npx supabase start` in the sync job; `db push` and `functions deploy` run in the
  `migrate` job, on `main` only. CLI v3 changed both commands' flags, which CI could not see before
  the merge (#276).
- **The `postgres:16` service in the database job is a throwaway CI database**, and
  `.github/dependabot.yml` has no docker ecosystem, so a Postgres data-directory hazard does not
  apply here. Production is the hosted Supabase project, migrated by the `migrate` job.
- **The changelog and patch-coverage steps say nothing about the dependency.** The changelog step
  requires an `Unreleased` entry only for a change under `src`, `site`, `supabase/migrations` or
  `supabase/functions` (its `--source` paths in `ci.yml`), and a Dependabot PR changes only
  `package.json`, `package-lock.json` or the workflows. Patch coverage then finds no new source
  lines and passes.
- **`native-e2e.yml`'s iOS job runs on `macos-latest`**; every other job runs on `ubuntu-latest`.

## Playbook

- **Any npm bump**, the gates after `npm ci`: `npx expo-doctor`, `npm run test:coverage`,
  `npx tsc --noEmit`, `npx oxlint`, and, for anything that reaches the bundle,
  `CI=true EXPO_NO_TELEMETRY=1 EXPO_PUBLIC_DEMO_MODE=true npx expo export --platform all
  --output-dir <a scratch directory>`. If expo-doctor cannot reach Expo's servers from this
  machine, say so and let CI's "Expo SDK agrees with itself" step decide. `npm run test:web` runs
  the UI suite locally only through Docker, and the database and sync jobs are CI's gates.
- **`expo-sdk` group, a patch or minor within SDK 58:** VERIFIED LOW-RISK only when expo-doctor
  passes (this machine's run, or CI's step) and every gate is green. A patch can change web
  behavior (expo-router 58.0.31 made unfocused screens `inert`), so the UI job is a gate too.
- **Expo SDK major:** NEEDS EFFORT (Grounding facts). List the SDK's breaking changes that reach
  this repository's config and code, and give the upgrade steps: `npx expo install --fix`,
  `npx expo-doctor`, the export, the tests, and `native-e2e.yml` on the branch.
- **`expo-doctor` red on every branch** with "Patch version mismatches" in "Tests, types, lint",
  on PRs that touch no dependency too: that is `main`'s red, from Expo shipping patches. The fix,
  on its own branch from `main`: `npx expo install --fix` (it can exit 1 the first time and succeed
  on a second), `npx expo-doctor`, `npm run test:web`, then a `deps:` PR; once it merges, catch the
  blocked branches up (`docs/agents/merging.md`). Dependabot does not open these.
- **`@playwright/test` bump:** the fix is to change both `1.65.1`s in `ci.yml` to the new version:
  the UI job's `container.image` tag and the version in "Playwright matches its container". That
  turns the UI job's version step green (#169, #343).
- **`@axe-core/playwright` bump:** a new axe rule fails the UI job on existing controls. The fix is
  in the app's accessible names and the web baselines (`npm run test:web:update`), so it is a code
  change for the user to review, not a mechanical one (#169).
- **TypeScript or oxlint major:** run `npx tsc --noEmit` and `npx oxlint`, and cite the compiler
  flag or rule change against `tsconfig.json` or `.oxlintrc.json`. A red oxlint run on a Dependabot
  PR can be stale: Dependabot may pull a newer patch that clears it, as oxlint 1.92.0 dropped a
  false positive, so read the rebased run first (`docs/agents/merging.md`).
- **@supabase/supabase-js major:** read the migration guide, check `src/sync/` (the client and the
  sync calls), and run `npm run test:coverage`; the integration tests run in CI's sync job. The
  Edge Function's own `npm:@supabase/supabase-js@2.118.0` pin does not move with it.
- **Supabase CLI (`supabase`) major:** read the release notes for every flag the `migrate` job
  (`db push --yes --remote=…`, `functions deploy delete-account --yes --remote=… --use-api`), the
  sync job (`supabase start -x …`) and the `db:*` scripts use, and for `supabase/config.toml` keys
  and local environment variables in `docs/development.md`. CI green does not cover the `migrate`
  job (Grounding facts), so name the first `migrate` run after the merge as the real check (#276).
- **GitHub Actions (`actions` group):** each action is pinned by SHA, so read the release notes for
  the version in the comment. NEEDS EFFORT only when a removed or renamed input, or a changed
  default, reaches a `with:` input; name the step. The inputs in use: `actions/checkout`
  (`fetch-depth: 0`, `token`), `actions/setup-node` (`node-version: '22'`, `cache: npm`),
  `actions/upload-artifact` (`name`, `path`, `if-no-files-found: ignore`, `retention-days: 14`) and
  `actions/dependency-review-action` (`fail-on-severity: high`). These run only in
  `native-e2e.yml` and `prepare-release.yml`, which no PR runs, so CI green does not cover them:
  `actions/download-artifact` (`pattern`, `path`), `actions/create-github-app-token` (`client-id`,
  `private-key`), `actions/setup-java` (`distribution: temurin`, `java-version: '17'`) and
  `reactivecircus/android-emulator-runner` (`api-level: 34`, `arch: x86_64`, `profile: pixel_6`,
  `disable-animations: true`, `script`).
