# Releases

## Scheme

cut-on-line — the maintainer decides when to release, and the **Prepare release** workflow cuts it
(#323): `Unreleased` in `CHANGELOG.md` collects every change's entries, and the release PR the
workflow opens moves them into a dated section and sets the new version. Once its merge has passed
every CI job on `main`, the **Tag the release** job tags it `v<version>` (`scripts/release-tag.mjs`,
#311), publishes its GitHub Release, and the **Store build** job builds it for the testers.
Ordinary merges leave the version alone, so they get no tag, no Release and no store build.

### Versions

- **App version**: `1.4.0`, the SemVer release line, chosen by a release. It is `package.json`'s
  `version` and `app.json`'s `expo.version`, which the stores show.
- **Build number**: the iOS build number and Android version code under an app version. EAS assigns
  them (`eas.json`: `appVersionSource: "remote"`, `autoIncrement: true`), so a store build needs no
  commit of its own, and a rebuilt release gets a new one.
- **Tag**: `v<app version>`, annotated "Release v<version>", on the merge that released it. Its
  GitHub Release carries that version's `CHANGELOG.md` section as the notes.

### Cutting a release

1. **Actions → Prepare release → Run workflow** on `main`. **bump** is `auto`, `patch`, `minor` or
   `major`, and **headline** names the release for its title. `auto` releases a patch when
   `Unreleased` holds only `Fixed` or `Security` entries and a minor when it holds any `Added`,
   `Changed`, `Deprecated` or `Removed`; it never releases a major, and refuses a heading it doesn't
   know. The run refuses an empty `Unreleased` and a second open `release/*` PR.
2. It cuts the changelog and sets the version (`scripts/prepare-release.mjs`, through the bump
   command below), refreshes the web baselines that show the version, pushes `release/v<version>`,
   opens the PR with the release App's token, so pull-request CI runs on it, and starts **Native
   smoke tests** on the branch. Native smoke isn't a required check: look at it before merging.
3. Review and merge the PR. The workflow never merges it. `Protect main` may ask for your approval
   first, since an App pushed the commit.
4. CI on `main` tags the merge, publishes the GitHub Release, and runs **Store build**:
   `eas build --profile production --platform all --auto-submit`, which sends the builds to
   TestFlight and Play's closed (alpha) track through `eas.json`'s production submit profile. The job
   waits for both builds, so a failed build fails the run. Whether a submission succeeded shows only
   on expo.dev.
5. Promoting a build to the public App Store or Play production stays in each store's console.

A store build that failed for a passing reason (an EAS outage, an expired credential) is retried
with **Re-run failed jobs** on that run: the tag and the Release are already there, and only
**Store build** runs again. A failure that needs a code change ships as the next patch release.

### Why GitHub Actions, not EAS Workflows

**Store build** is a job in `ci.yml` after the tag, so it runs only once everything else on `main`
has passed. The tag is pushed with `GITHUB_TOKEN`, which can't start another workflow, and EAS's
documentation doesn't say whether its GitHub App reacts to a tag pushed that way. EAS Workflows'
fingerprint-and-deploy jobs suit over-the-air updates, which aren't adopted yet; that work is where to
revisit this.

### Setup

Two credentials, both set up by the maintainer (#324, #325; the steps are in each issue):

- **The release App**, a GitHub App installed on this repository only, with read and write access to
  contents and pull requests. Its client ID and private key are the repository secrets
  `RELEASE_APP_CLIENT_ID` and `RELEASE_APP_PRIVATE_KEY`, read only by Prepare release.
- **`EXPO_TOKEN`**, an Expo robot user's access token with access to the project, in the `production`
  environment, read only by **Store build**. The App Store Connect API key and the Play service
  account are already held on EAS (`docs/development.md`), so no store credential is in GitHub.

**Store build** pins `eas-cli`, since it holds the token, and nothing bumps the pin: move it by hand
to a release at least two weeks old.

## Version file

`package.json` — the release line. `app.json`'s `expo.version`, the store version, is kept equal to
it: `scripts/check-changelog.mjs` reads a top-level `version` only, and `scripts/set-version.test.mjs`
fails when the two differ.

## Bump command

`node scripts/set-version.mjs <version>`

From the repository root. It sets `package.json` and its lockfile, through `npm version`, and
`app.json`'s `expo.version`; a second run with the same version changes nothing. Prepare release runs
it; by hand, it's for a release cut without the workflow. Settings shows the version, so the web
suite's Settings baselines change with it: run `npm run test:web:update` after the bump and commit the
`settings-account` and `theme-settings` baselines it rewrites.

## Ask before bumping

always — a release is the maintainer's decision: state the evidence and the proposed version, and
edit nothing until it is confirmed. The maintainer cuts it by running Prepare release.

## Changelog check

`node scripts/check-changelog.mjs --source src --source site --source supabase/migrations --source supabase/functions`

A change to the app, the support site, the schema or the Edge Function needs `Unreleased` to
change; a release PR that changes the version needs its dated section. CI runs it on every pull
request (`.github/workflows/ci.yml`, **Tests, types, lint**).

## Release commit message

`docs: update docs and changelog for <summary>` for an ordinary change, and
`chore: prepare v<version>, <headline>` for a release, `<headline>` naming it; Prepare release writes
it from its **headline** input. The development flow exempts the release commit
(`docs/agents/dev-flow.md`), and CI tags `v<version>` once it has merged and passed.
