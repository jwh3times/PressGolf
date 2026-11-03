# Development flow

The flow itself is `.agents/skills/ship/settings/dev-flow.md`, and `AGENTS.md` summarizes it. This file holds what this repository
adds.

## Docs and agent config

- `LICENSE`

## Branch types

- `deps`

## Paths

Markdown under `src/` or `site/` is code.

## Exemption details

- **Dependency bumps** are Dependabot PRs (`dependabot/…` branches, titled `deps:`, `deps(dev):` or
  `ci:`) and manual bumps such as #131 and #176, which take Expo patch releases with
  `npx expo install --fix`. A bump touches `package.json`, `package-lock.json` and
  `.github/dependabot.yml`; the exemption also covers the fixes needed to keep CI green on it, as in
  #169. Anything beyond that is a separate change.
- **Release prep** is a release PR, committed as `chore: prepare v<version>, <headline>`: it moves
  `Unreleased` in `CHANGELOG.md` into a dated section and sets the version with
  `node scripts/set-version.mjs <version>` (`package.json`, its lockfile and `app.json`'s
  `expo.version`); the maintainer tags `v<version>` on `main` after it merges
  (`docs/agents/releases.md`). A change to the `submit` profile in `eas.json` for a store build
  is release prep too. Build numbers need no commit: `eas.json` sets
  `appVersionSource: "remote"` and `autoIncrement: true`.
- **A user waiver** covers the one change it was given for.
