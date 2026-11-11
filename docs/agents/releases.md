# Releases

## Scheme

cut-on-line — a maintainer cuts each release by hand: `Unreleased` in `CHANGELOG.md` collects every
change's entries, a release PR moves them into a dated section and sets the new version, and once
its merge has passed every CI job on `main`, the **Tag the release** job tags it `v<version>`
(`scripts/release-tag.mjs`, #311). Ordinary merges leave the version alone, so they get no
tag. EAS assigns build numbers remotely (`eas.json`: `appVersionSource: "remote"`,
`autoIncrement: true`), so a store build needs no commit of its own.

## Version file

`package.json` — the release line. `app.json`'s `expo.version`, the store version, is kept equal to
it: `scripts/check-changelog.mjs` reads a top-level `version` only, and `scripts/set-version.test.mjs`
fails when the two differ.

## Bump command

`node scripts/set-version.mjs <version>`

From the repository root. It sets `package.json` and its lockfile, through `npm version`, and
`app.json`'s `expo.version`; a second run with the same version changes nothing. Settings shows the
version, so the web suite's Settings baselines change with it: run `npm run test:web:update` after
the bump and commit the `settings-account` and `theme-settings` baselines it rewrites.

## Ask before bumping

always — a release is the maintainer's decision: state the evidence and the proposed version, and
edit nothing until it is confirmed.

## Changelog check

`node scripts/check-changelog.mjs --source src --source site --source supabase/migrations --source supabase/functions`

A change to the app, the support site, the schema or the Edge Function needs `Unreleased` to
change; a release PR that changes the version needs its dated section. CI runs it on every pull
request (`.github/workflows/ci.yml`, **Tests, types, lint**).

## Release commit message

`docs: update docs and changelog for <summary>` for an ordinary change, and
`chore: prepare v<version>, <headline>` for a release, `<headline>` naming it. The development flow
exempts the release commit (`docs/agents/dev-flow.md`), and CI tags `v<version>` once it has
merged and passed.
