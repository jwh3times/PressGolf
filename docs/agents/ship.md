# Ship

## Fast checks

Together they cover what the required **Tests, types, lint** check runs. All need `npm ci`.

- repo root: `npm run lint` (**Tests, types, lint**: `npx oxlint`)
- repo root: `npm run typecheck` (**Tests, types, lint**: `npx tsc --noEmit`)
- repo root: `npm run test:scripts` (**Tests, types, lint**: repository script tests)
- repo root: `npm run lint:agents` (**Tests, types, lint**)
- repo root: `node scripts/check-docs.mjs` (**Tests, types, lint**)
- repo root: `npm run sync:agents:check` (**Tests, types, lint**), fixed by `npm run sync:agents`,
  committing the regenerated mirror
- repo root, only when `src/`, `package.json`, `package-lock.json`, `babel.config.js` or
  `tsconfig.json` changed: `npm run test:coverage` (**Tests, types, lint**: Jest with the
  `coverageThreshold` floors), then `node scripts/check-patch-coverage.mjs origin/main 90` (its
  pull-request step "New code is covered")
- repo root, only when `package.json`, `package-lock.json`, `app.json`, `app.config.js` or
  `eas.json` changed: `npx expo-doctor` (**Tests, types, lint**; needs network), fixed by
  `npx expo install --fix`

CI-only, since each needs a longer run, a container, a service or GitHub: **Expo production
bundle** (`npx expo export --platform all`), **UI regression and accessibility** (Playwright in its
container; `npm run test:web` runs it locally with Docker when a screen changes), **Migrations and
row-level security** (Postgres 16 and `psql`), **Sync against a local Supabase stack**
(`npx supabase start …` then `npm run test:integration`, Docker),
**Dependency review** and CodeQL (GitHub only).

## Hook: before PR

1. From `git diff --name-only origin/main...HEAD`, flag each impact the branch has:
   - `supabase/migrations/` or `supabase/ci/` — **schema / RLS**: confirm
     `supabase/ci/rls-test.sql` carries an assertion for each changed policy (`CONTRIBUTING.md`
     § Database changes) and that the migration came from `npm run db:new`;
   - `package.json`, `package-lock.json`, `app.json`, `app.config.js`, `eas.json`, a config
     plugin — **dependency / native build**: say whether Expo Go still runs it or a development
     build is needed;
   - `src/app/` or `src/components/` — **accessibility**: maximum text size considered; the web
     baselines (`npm run test:web:update`, and `--update-snapshots=all` for a new control) and
     `.maestro/flows/` updated when labels or layout changed;
   - `src/auth/`, the Supabase client, `EXPO_PUBLIC_` variables or `.env.op` — **security**;
   - what the app collects or sends, or account deletion — the `site/public/` pages and their
     dates updated in the same change;
   - `.agents/skills/` or `.claude/agents/` — **generated mirror**.
2. Fill the template's **Verification** with the fast checks actually run, and tick its **Impact
   review** boxes from step 1. Name each flagged impact in its own line in the body
   (`CONTRIBUTING.md` § Pull requests). Never put vulnerability detail there (`SECURITY.md`).
