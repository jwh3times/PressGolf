# Docs

## Doc map

- `AGENTS.md` — the canonical operating guide for every agent: Expo version discipline, commands,
  routing, EAS, MCP servers, rules, documentation rules, the development flow gate, agent skills,
  issue tracker, triage labels, domain docs, machine handoff. **When:**
  - a command or `package.json` script changes: `## Commands`;
  - a server is added to or removed from `.mcp.json` / `.codex/config.toml`, or its purpose or
    guarded tools change: `## MCP servers`;
  - the gate, its exemptions or the phase skills change: `## Development flow` (with
    `docs/agents/dev-flow.md`);
  - a skill is added, removed or replaced (`.agents/skills/`, `skills-lock.json`),
    or a shared script changes (`scripts/sync-agents.mjs`, `scripts/lint-agent-neutrality.mjs`,
    `scripts/check-docs.mjs`, `scripts/check-skills.mjs`, `scripts/next-version.mjs`,
    `scripts/check-changelog.mjs`):
    `## Agent skills`;
  - the handoff transport or machine config changes: `### Machine handoff`.
- `CLAUDE.md` — `@AGENTS.md` only. **When:** never for operating context.
- `README.md` — product overview, quick start, project guides index, demo and live data, dated
  "Current validation" figures, "Known limits". **When:** a user-visible feature lands or a
  limitation is resolved or added (`src/app/`, `src/domain/`, `src/sync/`); a quick-start command
  changes; a guide is added; validation figures are refreshed (date them).
- `docs/development.md` — prerequisites, running the app, dependencies, environment variables,
  Supabase setup, migrations, sync integration tests, EAS build profiles, the Android Maps key,
  Android permissions, App Store and Play submission, MCP servers, troubleshooting. **When:**
  `.mcp.json`, `.codex/config.toml` or the `permissions.ask` list in `.claude/settings.json`
  changes (§ MCP servers); `package.json`
  scripts or the Expo SDK change; `app.json`'s `android.blockedPermissions` or a plugin's
  permissions change; an env var changes (`.env.op`, `app.config.js`, `EXPO_PUBLIC_` reads in `src/`);
  `eas.json` build or submit profiles change; `supabase/config.toml` or the migration workflow
  changes; an Edge Function is added or removed, or its secrets or deploy command change
  (`supabase/functions/`: § Edge Functions).
- `docs/architecture.md` — domain engine, formats and game rules, local data and demo isolation,
  sync, themes, repository layout, app artwork. **When:** `src/domain/`, `src/store/`,
  `src/sync/`, `src/theme/` or the data model (`supabase/migrations/`) changes; what the
  `delete-account` Edge Function does changes (`supabase/functions/`: § Deleting an account); a
  top-level `src/` directory, a `scripts/` file or a `.maestro/` file is added or removed
  (§ Repository layout).
- `docs/testing-and-ci.md` — local checks, coverage floors, CI jobs, the support site's deploy,
  web UI and native smoke suites, repository protections, manual validation status. **When:**
  `.github/workflows/`, a test or check script in `package.json`, `coverageThreshold`,
  `scripts/check-patch-coverage.mjs`, `playwright.config.ts`, `tests/web/`, `.maestro/`,
  `site/wrangler.jsonc`, or the `main` ruleset changes.
- `docs/accessibility.md` — automated guarantees, completed iOS and Android
  validation, the large-text pass, the native accessibility-tree lint, the regression checklist.
  **When:** accessible names, roles or layout branches change (`src/app/`, `src/components/`),
  `.maestro/a11y-allowlist.json` or `scripts/a11y-lint.mjs` changes, or a manual pass completes.
- `docs/research/*.md` — dated research notes for an issue (#151–#153), each with its sources and
  the date they were read. `amend-only`.
- `SECURITY.md` — reporting route, supported version, security model (RLS, demo isolation, public
  client config), repository controls. **When:** RLS policies or their assertion count
  (`supabase/ci/rls-test.sql`), auth or secret handling, `EXPO_PUBLIC_` configuration, the
  ruleset, or the repository's security settings change.
- `CONTRIBUTING.md` — the local gate, coverage gates, Expo and native rules, database rules, PR
  expectations. **When:** a gate, coverage floor, or the Expo or migration workflow changes.
- `.github/PULL_REQUEST_TEMPLATE.md` — the issue-link slot, verification and impact checklists.
  **When:** the linking rule or the local gate changes.
- `docs/agents/dev-flow.md` — what this repository adds to the shared development flow: paths,
  the `deps` branch type, bump and release details. **When:** one of those changes.
- `docs/agents/*.md` (others) — the issue tracker, triage labels, domain-doc layout, and the
  skills' settings. **When:** a convention, label, route or setting changes.
- `site/public/**/index.html` — the public support, privacy, terms and account-deletion pages at
  pressgolf.cc. **When:** what the app collects, where data goes, or how an account is deleted
  changes — update the page in the same change, and on the privacy and terms pages the
  "Effective" date at its top (the support and account-deletion pages carry no date).
- `CHANGELOG.md` — release notes, Keep a Changelog and SemVer: `Unreleased` collects each change,
  and a release PR cuts a dated section (`docs/agents/releases.md`). `ship-owned`.
- `CONTEXT.md` — the domain glossary, kept by `/domain-modeling`. `docs/adr/*.md` — created lazily
  by `/domain-modeling`; none exist yet. An accepted ADR is `frozen`: report a contradiction instead
  of editing it.
- `.agents/skills/*/**` — skills, mirrored to `.claude/skills/`. The `mattpocock/skills` set in
  `skills-lock.json` and `end-session`, `handoff`, `lets-go`, `ship`, `docs-updater` and
  `what-next` from `jwh3times/skills`: `frozen` here. **When:** a skill is added, removed or
  replaced: `AGENTS.md` § Agent skills.
- `LICENSE` — `owner-only`.
- `THIRD_PARTY_NOTICES.md` — the license notices of third-party files kept here. `owner-only`: report
  the change when a skill's source changes.

**Never in public docs:** secrets, service-role keys, database passwords, tokens or resolved
1Password values; the Supabase project ref; unpatched vulnerability or data-isolation detail;
volatile service prices or quotas outside a dated research note.

## Drift probes

- npm scripts: `scripts` in `package.json`
- Expo SDK: `expo` in `package.json`; the `v58.0.0` doc links in `README.md` and
  `docs/development.md`
- Node: `node-version` in `.github/workflows/*.yml` against "Node.js 22.13 or newer" in
  `docs/development.md`
- Coverage floors: `coverageThreshold` in `package.json`; the patch target in the
  `check-patch-coverage.mjs` step of `.github/workflows/ci.yml`
- CI jobs: the keys under `jobs:` in `.github/workflows/ci.yml`, `native-e2e.yml` and
  `prepare-release.yml`, then each
  one's `name:`
- Required checks and ruleset: `gh api repos/jwh3times/PressGolf/rules/branches/main`
- Security settings: `gh api repos/jwh3times/PressGolf/private-vulnerability-reporting`
- RLS assertion count ("109" in `README.md`, `SECURITY.md`, `docs/testing-and-ci.md`):
  `grep -cE "select (expect|refused|refused_by_key)\(|raise notice 'ok: [^%]" supabase/ci/rls-test.sql`
- Migrations: `supabase/migrations/*.sql`
- EAS profiles: the `build` and `submit` keys in `eas.json`
- Env vars: `.env.op`; `process.env` in `app.config.js` and `src/`
- Routes: `src/app/**/*.tsx`
- Native flows: `.maestro/flows/*.yml`
- Repository layout: `src/*/`, `scripts/*`, `.maestro/*` against `docs/architecture.md`
  § Repository layout
- Jest suites (dated in `README.md`): `npx jest --listTests`
- Site pages: `site/public/**/index.html`; the Worker `name` in `site/wrangler.jsonc`
