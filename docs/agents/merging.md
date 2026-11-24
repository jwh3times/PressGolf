# Merging

From a finished branch to a merged pull request. What the `Protect main` ruleset requires is in
[Testing and CI](../testing-and-ci.md#repository-protections); this file holds the steps around it
and what has gone wrong.

## Before `/open-pr`

- **New or reshaped UI gets a device check before shipping.** The web suite proves names, roles and
  logic, and the native nightly runs only after a merge, on simulators, so a device is the only
  native visual check before a merge. End a UI build with "worth a device check before shipping:
  <screens>". The ask is a prompt, not a gate: if the maintainer says "ship it" without one, ship,
  say in the PR body that no device validation was done and list the screens, and track the check
  in a `ready-for-human` issue.
- **After an SDK upgrade, run `native-e2e.yml` on the branch before merging**
  ([Native smoke workflow](../testing-and-ci.md#native-smoke-workflow)): Expo Go, Jest and the web
  suite can't see a release-build crash (#250).

## Merging

- **Merge only when asked, and only the PR the request names.** "Merge it" or "merge the PR" covers
  the PR under discussion; a later PR needs its own request. Open the PR, report it, and wait.
- **Confirm `gh pr checks <n>` is green, then `gh pr merge <n> --merge --delete-branch`.** Merge
  commits are the only method allowed.
- **A branch behind `main` can't merge.** Run `gh pr update-branch <n>`, wait for the checks to rerun,
  then merge. Auto-merge is off for the repository, so `--auto` is refused; wait yourself. Merging two
  PRs back to back puts the second behind.
- **"The base branch policy prohibits the merge" on a clean, green PR** comes from the ruleset's extra
  approval for unattributed changes. Don't retry or reach for `--admin`: hand the merge to the
  maintainer, who merges it in the web interface.
- **After a merge touching `supabase/migrations/`,** CI's "Apply migrations to Supabase" job updates
  production; check that it succeeded. No manual `db:push` is needed.

## Changes only the maintainer makes

- **Repository rulesets.** An agent can't edit `Protect main` or `Protect Release Tags`. When a PR adds
  a CI job that should be required, give the maintainer the job's exact `name:` and the UI path
  (Settings → Rules → Rulesets), verify afterwards with `gh api repos/jwh3times/PressGolf/rulesets`,
  and update the required-check count in `docs/testing-and-ci.md` in the same PR.
- **Writing to an existing issue the maintainer didn't name** during a skill run: put the exact text
  in the report and ask. Filing new follow-up issues and setting board fields is fine.
- **Never run a release script's `main()` to try it out.** `scripts/release-tag.mjs` tags and pushes;
  test it only through `node --test scripts/release-tag.test.mjs`.

## Dependency pull requests

- **Merge a batch one at a time.** Each merge puts the rest behind: update one, wait for its CI
  (about ten minutes), merge, then the next.
- **A red Dependabot PR can be stale.** After an update, Dependabot may pull a newer patch that clears
  the failure (oxlint 1.92.0 dropped a false positive). Read the rebased run before writing a fix.
- **A `@playwright/test` bump also moves `ci.yml`'s container image and version-check pin**
  ([UI regression and accessibility](../testing-and-ci.md#ui-regression-and-accessibility-web)).
- **`expo-doctor` patch drift reddens every branch** when Expo ships patches, even a PR that touches
  no dependency: the only failing check is "Tests, types, lint", and its log lists "Patch version
  mismatches". On its own branch from `main`, run `npx expo install --fix` (it can exit 1 the first
  time and succeed on a second), confirm `npx expo-doctor` passes, run `npm run test:web` (a patch
  can change web behavior: expo-router 58.0.31 made unfocused screens `inert`), open a `deps:` PR,
  merge it, then merge `main` into the blocked branch. Dependabot doesn't open these.
- **A lone `expo-router` major** (the router moves a major while `expo` stays, and every install fails
  `npm ci` with `ERESOLVE`) can't be repaired by rebasing. Close it and point at the next SDK upgrade
  issue, filing one if none exists.
- **Don't dismiss a Dependabot alert unasked.** Work out the dependency path (`npm ls <package>`),
  whether it reaches the app bundle, and whether a patch exists, then recommend. Alerts with no
  patch that reach only developer tooling stay open, so Dependabot opens the fix PR when a patch is
  published. Keep alert detail out of public issues.

## Store builds

- **Only expo.dev shows whether a submission succeeded.** `eas-cli` has no `submission:view`, and
  `eas build:view --json` has no submission field. Report a submission as unconfirmed, with the
  links the build printed, until someone has looked; never say it reached testers because the build
  finished.
- **A new Play closed-test tester** whose install fails with "Something went wrong on our end" should
  wait and retry before any troubleshooting: access propagates with a delay.
