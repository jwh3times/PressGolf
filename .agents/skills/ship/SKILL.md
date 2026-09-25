---
name: ship
description: Use when a branch is ready for review or the user says "ship it", "open a PR", or "push this" — refreshes docs for the branch's changes, flags unlinked issues, runs the local gate, pushes, and opens or updates the PR. PressGolf-specific.
---

# Ship

Take the current branch from "code is done" to "PR is open and green-able": refresh the docs the
branch made stale, run the local gate, push, and open or update the PR.

**Announce at start:** "I'm using the ship skill to open a PR for this branch."

## Why this exists

The protected `main` ruleset requires a pull request, green checks, and resolved review threads,
and `CONTRIBUTING.md` asks every PR to update docs in the same change and to call out schema,
security, accessibility, and native-build impact. None of that is automated end to end: CI catches a
red test, not a stale `docs/development.md` or a PR body that forgot to mention a migration. This
skill does the parts CI cannot.

PressGolf has no changelog or `VERSION` file; the PR body is the change record. This skill stops at
"PR open". It never merges.

## Steps

### 1. Preconditions — stop if any fail

- **Not on `main`.** If on `main`, stop and offer to branch (`git checkout -b <type>/<topic>`, e.g.
  `feat/course-gps`).
- **Clean working tree.** Run `git status --porcelain`. If anything is uncommitted, stop and ask
  whether to commit it — do not commit silently. (This also makes the `git add -A` in step 5 safe.)
- **`gh` authenticated.** `gh auth status` must succeed.

### 2. Read the branch diff

```
git fetch -q origin main
base=$(git merge-base origin/main HEAD)
git diff "$base"..HEAD --stat
git diff "$base"..HEAD
```

Note which of these the branch touches — they drive steps 3, 4, and the PR body:

- `supabase/migrations/` or `supabase/ci/` — **schema / RLS impact**
- `package.json`, `package-lock.json`, `app.json`, `eas.json`, config plugins — **dependency or
  native-build impact**
- `src/app/` screens or shared components — **accessibility impact**
- auth, Supabase client, secrets handling, `EXPO_PUBLIC_` variables — **security impact**
- `.agents/skills/`, `.claude/agents/` — **generated-mirror impact**

### 3. Refresh the docs

Scoped to **this branch's diff only**, not a full audit. `AGENTS.md` § Documentation says where each
kind of fact lives:

- `README.md` — product overview and quick start
- `docs/development.md` — setup, commands, environment variables
- `docs/architecture.md` — design and data flow
- `docs/testing-and-ci.md` — CI jobs and local gates
- `docs/accessibility.md` — accessibility evidence

Update whichever the diff made stale: a new command, env var, build profile, CI step, migration, or
known limitation. Treat executable config (`package.json`, workflows, `app.json`, `eas.json`,
migrations) as the authority and make the docs match it, never the reverse. Date any point-in-time
counts. If nothing is stale, say so — do not invent edits.

### 3b. Check issue linkage (warn only)

```
gh issue list --state open --limit 100 --json number,title --jq '.[] | "\(.number) \(.title)"'
```

**Warn** — never block — when the branch closes no issue (no `Fixes #NN` / `Closes #NN` planned for
the PR body) and the change is not a dependency bump, docs-only edit, or similar housekeeping. Work
that closes no issue is work nobody filed. Surface it and let the maintainer decide.

### 4. Local gate — refuse to push if any fail

Run after the step 3 doc edits:

```
npm run lint
npm run typecheck
npm run test:coverage
npm run test:scripts
npm run sync:agents:check
```

Also run, when step 2 flagged them:

- **Dependency or app-config changes:** `npx expo-doctor`.
- **Patch coverage** (behavior changes under `src/`): after `test:coverage`,
  `node scripts/check-patch-coverage.mjs origin/main 90` — the same gate CI runs on the PR.

If `sync:agents:check` is stale, run `npm run sync:agents` and commit the result. If any other check
is red, **stop and report — do not push.**

Not run here, because CI owns them: the Expo production bundle export, applying migrations to
Postgres, the RLS assertions, and dependency review. For a migration, `supabase/ci/rls-test.sql`
should already carry the matching assertion — check that it does and note it in the report.

### 5. Commit the ship edits

Only if steps 3–4 changed anything:

```
git add -A
git commit -m "docs: update docs for <topic>"
```

`git add -A` is safe because the tree was clean at step 1.

### 6. Push and open or update the PR

```
git push -u origin HEAD
gh pr list --head "$(git branch --show-current)" --state open --json number,url
```

- **No PR** → `gh pr create --base main`.
- **PR exists** → `gh pr edit <number>` to refresh the body. Do not open a second PR.

The body follows `CONTRIBUTING.md` § Pull requests:

- the user-visible outcome;
- the tests and checks run, and any platform or hardware validation (or that none was done);
- an explicit line for each impact step 2 flagged — schema, security, accessibility, native build;
- `Fixes #NN` for the issue it closes.

**Never merge the PR. Never push to `main`.**

### 7. Report

- the PR URL and branch;
- which docs changed, or that none needed to;
- any issue-linkage warning from step 3b;
- local gate results, and whether expo-doctor and patch coverage were run;
- the flagged impacts and how the PR body calls them out.

State plainly that the bundle export, migration apply, and RLS checks run in CI, not locally — do
not imply the branch is verified beyond the local gate.

## Do not

- Merge the PR or push to `main`.
- Commit a secret, a resolved 1Password value, or a generated `ios/` or `android/` directory.
- Hand-edit `.claude/skills/` or `.codex/agents/` — they are generated; edit the source and run
  `npm run sync:agents`.
- Report a vulnerability in a public issue or PR body — `SECURITY.md` says where it goes.
