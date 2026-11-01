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
- **Release prep** is a change to `expo.version` in `app.json` or to the `submit` profile in
  `eas.json` for a store build. Build numbers need no commit: `eas.json` sets
  `appVersionSource: "remote"` and `autoIncrement: true`.
- **A user waiver** covers the one change it was given for.
