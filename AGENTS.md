This is an Expo/React Native mobile application. Prioritize mobile-first patterns, performance, and cross-platform compatibility.

## Expo has changed — do not trust your training data

Expo ships breaking changes every SDK release. APIs you remember are likely renamed, moved, or removed. Before writing any code that touches an Expo, EAS, or React Native API:

1. Read the major version of the `expo` package in `package.json`.
2. Fetch the matching versioned docs: `https://docs.expo.dev/versions/v<major>.0.0/`
3. For anything else, fetch https://docs.expo.dev/llms.txt — an index of all Expo docs with corrections to common LLM misconceptions. Follow its links to the specific page you need; never answer from memory.

## Commands

Use `bunx` instead of `npx` if the project uses bun (`bun.lock` present).

```bash
npm ci                      # install the committed dependency graph
npx expo install <package>  # ALWAYS use instead of npm/yarn/pnpm/bun add — resolves SDK-compatible versions
npm start                   # start the dev server
npm run test:coverage       # Jest plus enforced repository coverage floors
npm run typecheck           # tsc --noEmit
npm run lint                # oxlint (ESLint is not installed)
npx expo-doctor             # diagnose dependency and config issues
npx expo install --fix      # fix incompatible package versions
npm run sync:agents         # regenerate .claude/skills from .agents/skills after editing a skill
npm run lint:agents         # agent and skill sources read correctly from their mirrored copies
```

Run lint and typecheck before declaring any task done. Run the relevant tests
for behavior changes; use the full coverage command when the scope is broad.

## Navigation & Routing

- Use **Expo Router** for all navigation. Routes live in `src/app/` — every file there is a screen, `_layout.tsx` files define navigators. Keep non-route code (components, hooks, utils) outside `src/app/`.
- Import `Link`, `router`, and `useLocalSearchParams` from `expo-router`.
- Docs: https://docs.expo.dev/router/introduction.md

## Building with EAS

Use EAS to build, sign, and submit the app in the cloud (`eas build`, `eas submit`) and to ship over-the-air updates (`eas update`) — no local Xcode or Android Studio required. Run EAS CLI as `bunx eas-cli <command>` in Bun projects, or `npx eas-cli@latest <command>` otherwise; substitute that for bare `eas` in docs examples.
Docs: https://docs.expo.dev/eas/index.md

## Rules

- If `ios/` and `android/` directories do not exist, they are generated (Continuous Native Generation). Never create or edit them by hand — configure native behavior in `app.json` and config plugins.
- Expo Go only includes its bundled native modules. After adding a library with native code, the app needs a development build: `npx expo run:ios|android` locally, or `eas build --profile development`.
- Prefer recommended Expo modules over third-party libraries, and check your available skills before adding dependencies. Use the matching versioned SDK reference discovered above, not `/versions/latest/`.

## Documentation

- `README.md` is the durable product overview and quick start. Put detailed setup in `docs/development.md`, design and data-flow details in `docs/architecture.md`, CI behavior in `docs/testing-and-ci.md`, and accessibility evidence in `docs/accessibility.md`.
- Update documentation in the same change whenever commands, environment variables, build profiles, CI, validation status, or known limitations change.
- Treat executable configuration (`package.json`, workflows, `app.json`, `eas.json`, migrations) as authoritative. Date any point-in-time counts and avoid copying volatile service pricing or quotas when an official link is clearer.
- [`docs/agents/docs.md`](docs/agents/docs.md) § Doc map names the document that owns each fact and the change that makes it stale; the `docs-updater` skill keeps the documents in line with the code against it.

## Development flow

<!-- shared:development-flow -->

The flow skills are this repository's binding process for changing code. Read
`.agents/skills/ship/settings/dev-flow.md` (the routing, exemptions and issue linking) and
`docs/agents/dev-flow.md` (what this repository adds) before the first edit of a change, and whenever
no ready issue exists. `/ask-matt` maps the flow itself.

- **The gate.** Every code edit starts from a ready issue: an open `ready-for-agent` issue whose body
  is a `/to-spec` spec or a `/to-tickets` ticket or that carries a `/triage` brief, or a `bug` issue
  worked through `/diagnosing-bugs`, which needs the number and no spec. With none, stop before the
  first edit and route the user. Reading code, running tests and answering questions need no issue.
- **Private work.** A ready issue in the private tracker counts. Its number stays out of the branch,
  the PR, commits and public issues, and it is closed by hand after the merge.
- **The human starts every phase.** `/wayfinder`, `/grill-with-docs`, `/to-spec`, `/to-tickets`,
  `/implement` and `/triage` stay user-invoked. At a phase boundary, name the next command, say in
  one line why, and wait. Inside a phase, use `/tdd`, `/code-review`, `/diagnosing-bugs`,
  `/domain-modeling`, `/codebase-design`, `/prototype` and `/research` whenever they fit.
- **Exempt from the gate:** dependency bumps, changes touching only docs and agent config, release
  prep, and an explicit user waiver recorded in the PR body as `Flow waived by the user: <reason>`.
- **Linking.** Branches are `<type>/<issue#>-<slug>`; the PR body opens with `Closes #N` or
  `Part of #N`.

<!-- /shared:development-flow -->

## Agent skills

Skills are shared by Claude Code and Codex. **`.agents/skills/` is authored** — Codex reads it
directly, and it is where the skills installer (`npx skills`) writes, so installing or updating a
skill stays a one-way operation. **`.claude/skills/` is generated** for Claude Code by
`scripts/sync-agents.mjs`; each generated `SKILL.md` carries a `# GENERATED — do not edit`
banner as a YAML comment on line 2. The same script generates `.codex/agents/*.toml` from any
specialist agents authored under `.claude/agents/` (none exist yet).

**Edit `.agents/skills/` and `.claude/agents/` only**, never `.claude/skills/` or `.codex/agents/`.
After changing a skill, run `npm run sync:agents` and commit the result. CI runs
`npm run sync:agents:check`, which fails on a stale, missing, or orphaned mirror, and
`npm run lint:agents` (`scripts/lint-agent-neutrality.mjs`), which fails on a source that reads
wrongly from its mirrored copy: a bare `$0`–`$9` in a `SKILL.md` (Claude Code replaces it with the
invocation's arguments), a relative link that breaks under `.claude/skills/`, or a blind
`claude`→`Codex` substitution artifact. Never replace a generated skill directory with a symlink:
`core.symlinks` is `false` on the Windows checkouts, so git would record a copy of every file instead
of a link. `npm run sync:agents` removes any symlink it finds under the generated trees (the skills
installer can leave one) before writing the mirror.

Most skills come from `mattpocock/skills` and are recorded in `skills-lock.json`. `wayfinder` and
`setup-matt-pocock-skills` carry local edits (a Wayfinder map records answers, never delivery
status), so re-installing either from upstream drops them — re-apply after an update.

CI runs `scripts/check-docs.mjs`: local doc links and anchors must resolve, and the `Doc map` in
`docs/agents/docs.md` must list every document.

### Shared skills

<!-- shared:shared-skills -->

`end-session`, `handoff`, `lets-go`, `ship` and `docs-updater` install from `jwh3times/skills`, and
are never edited here: reinstalling overwrites a local edit. A fix goes upstream, and what they need
to know about this repository goes in the settings files under `docs/agents/`, which each skill
proposes on first run. Re-running the install is the update; never run `npx skills update`, which
leaves `.claude/skills/` linked to its source instead of copied:

```bash
npx skills add jwh3times/skills -s end-session -s handoff -s lets-go -s ship -s docs-updater -a codex --copy -y
node scripts/sync-agents.mjs
```

`scripts/sync-agents.mjs`, `lint-agent-neutrality.mjs`, `check-docs.mjs`, and `sync-main.mjs`,
`next-version.mjs` and `check-changelog.mjs` where this repository carries them, are canonical in
`jwh3times/skills` with their tests: fix them there, then copy them here. `sync-agents.mjs` also
writes the marked blocks in this file: change them in `jwh3times/skills`, not here.

<!-- /shared:shared-skills -->

### Issue tracker

GitHub Issues on `jwh3times/PressGolf`, through the `gh` CLI. This repository is public: never put
secrets or unpatched-security detail in an issue. See
[`docs/agents/issue-tracker.md`](docs/agents/issue-tracker.md).

### Triage labels

Default vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`.
See [`docs/agents/triage-labels.md`](docs/agents/triage-labels.md).

### Domain docs

Single-context layout — `CONTEXT.md` and `docs/adr/` at the repository root, created lazily by
`/domain-modeling` when a term or decision is first resolved. See
[`docs/agents/domain.md`](docs/agents/domain.md).

### Machine handoff

`/handoff` writes a handoff document to the shared `Handoffs` folder, marks it active in that
folder's `handoff_map.json` (through `node .agents/skills/handoff/handoff-map.mjs`, never by hand)
and runs `/end-session`; `/lets-go` on the other machine resumes from it. How the folder reaches a
machine belongs to the machine, not the repository: `~/.config/handoffs/config` sets
`HANDOFFS_TRANSPORT` (`folder` for a synced folder, `proton-cli` for a local mirror moved by the
`proton-drive` CLI), `HANDOFFS_DIR` and `HANDOFFS_REMOTE`, and an exported `HANDOFFS_DIR` still
overrides the file. `/handoff` and `/lets-go` propose it on their first run on a machine; see
`.agents/skills/handoff/machine-config.md`.
