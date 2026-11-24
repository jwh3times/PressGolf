# Test proof

How `test-prover` runs one test on its own in this repository, and how it tells a run that tested
nothing from a pass. Every command runs in bash from the repository root.

## Test commands

- **Jest, app and site** (repository root): `src/**/__tests__/*.test.ts`,
  `src/**/__tests__/*.test.tsx` and `site/__tests__/*.test.ts`, never `*.integration.test.ts`.
  One file: `npx jest <file>`; one test: `npx jest <file> -t "<name>"`, where `<name>` is a regex
  matched against the `describe` names and the test's name joined by spaces (use a plain part of a
  name that holds `(`, `?` or `+`). Count: Jest's `Tests:` line, which `mutate.mjs` reads
  already. Worktree: link `node_modules`.
- **node:test, repository scripts** (repository root): `scripts/*.test.mjs`. One file:
  `node --test <file>`; one test: `node --test --test-name-pattern="<name>" <file>`. Worktree: link
  `node_modules` (`native-screens.test.mjs` loads `pngjs`).
- **Jest, sync and link-page integration** (repository root):
  `src/sync/__tests__/*.integration.test.ts` and `site/__tests__/*.integration.test.ts`. One file:
  `node scripts/test-integration.mjs <file>`; one test: add `-t "<name>"`, counted as the Jest
  suite above. Not run by `test-prover`: it needs a running local Supabase stack
  (`npx supabase start`, Docker; `docs/development.md` § Sync integration tests), and without one
  the runner exits 1 before Jest starts.
- **Playwright, web UI and accessibility** (repository root): `tests/web/*.spec.ts`. One file:
  `node scripts/test-web.mjs <file>`; one test: add `-g "<name>"`. Not run by `test-prover`: it
  builds the web export and runs in the Playwright Linux container (Docker), whose screenshots are
  the baselines, and a scratch worktree's linked `node_modules` points outside the folder the
  container mounts.
- **Row-level security assertions**: `supabase/ci/rls-test.sql`, one psql script with no
  single-test form. Not run by `test-prover`: it needs Postgres 16 with every migration applied
  (`docs/agents/local-runs.md` § Checking a migration before CI).
- **Maestro, native smoke**: `.maestro/flows/*.yml`. Not run by `test-prover`: it needs an emulator
  or a device with a development build (`docs/testing-and-ci.md` § Native smoke workflow).

## Zero-match signature

- `The local Supabase stack is not running`: `scripts/test-integration.mjs` with no stack. It exits
  1 before any test runs.

## Guide

none
