# Changelog

Every notable change to Press is recorded here, in the form of
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). A change to the app, the support site,
the schema or the Edge Function adds its entries under `Unreleased`. A release moves them into a
dated section and sets `package.json` and `app.json`'s `expo.version` to the new version; the
maintainer tags `v<version>` on `main` after it merges (`docs/agents/releases.md`).

## [Unreleased]

### Fixed

- Switching groups in Settings during a round no longer breaks it. The round keeps its own players:
  Score's whole card no longer crashes, and Settle still settles it.

## [1.1.0] - 2026-11-03

### Changed

- Press runs on Expo SDK 58, with React Native 0.88 and React 19.3. The screens and what they do
  are unchanged, but this version needs a new store build: it can't reach installed copies over
  the air.

### Security

- Opening a link into the app no longer goes through a URL-decoding package with a published
  advisory against it.

## [1.0.0] - 2026-11-03

### Added

- The first release recorded here. `1.0.0` is the version the app has shipped to the stores under
  so far; the changes that built it are described in their pull requests, which predate this
  changelog.
