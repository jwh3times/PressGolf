# Development flow

`AGENTS.md` § Development flow states the gate. This doc holds what applying it needs: what makes
an issue ready, where to route the user when none is, the exemptions, and how branches and PRs link
the issue. The full map of skills and flows is the router,
[`.agents/skills/ask-matt/SKILL.md`](../../.agents/skills/ask-matt/SKILL.md) (`/ask-matt`); this
doc adds only the gate.

## Ready issues

A **ready issue** is one of:

- an open issue labelled `ready-for-agent` whose body is a `/to-spec` spec, a `/to-tickets` ticket
  or a `/triage` brief;
- a bug issue (labelled `bug`) worked through `/diagnosing-bugs`. It needs an issue number, not a
  spec.

Check with `gh issue view <n> --json labels,body,assignees`. These are not ready issues:

- `ready-for-human` — the work needs a person (a device check such as #120).
- `needs-triage`, `needs-info`, or no triage label — raw; route to `/triage`.
- `wayfinder:*` — a map ticket. It records a decision, even when its body says to build (#159).
  Once the map clears, route to `/to-spec`.

## Routing

With no ready issue, stop before the first edit, name the next command, and wait.

| Situation                        | Next command                                                               |
| -------------------------------- | -------------------------------------------------------------------------- |
| An idea one session can hold     | `/grill-with-docs`, then `/to-spec` (+ `/to-tickets` if it spans sessions) |
| Huge, foggy, multi-session       | `/wayfinder`, then `/to-spec` once the map clears                          |
| A raw issue someone else filed   | `/triage`                                                                  |
| A ready issue nobody has started | `/implement`, in a fresh context (`/clear` first)                          |
| Something broken                 | File the bug issue, then `/diagnosing-bugs`                                |

"Nobody has started" means open, unassigned, and with no open PR naming it. The repository is
public, so keep vulnerability detail out of a bug issue: a vulnerability is a draft repository
advisory ([`SECURITY.md`](../../SECURITY.md)).

The same one-line handover applies at every phase boundary:

> Next: `/to-spec` — the grilling settled every open question, so the thread is ready to become a
> spec.

## Exemptions

These changes skip the gate. They still go through a topic branch and a PR, because `main` is
protected.

- **Dependency bumps.** Dependabot PRs (`dependabot/…` branches, titled `deps:`, `deps(dev):` or
  `ci:`) and manual bumps such as #131 and #176, which take Expo patch releases with
  `npx expo install --fix`. A bump touches `package.json`, `package-lock.json` and
  `.github/dependabot.yml`; the exemption also covers the fixes needed to keep CI green on it, as
  in #169. Anything beyond that is a separate change.
- **Docs and agent config only.** Every file the change touches is one of:
  - a Markdown file outside `src/` and `site/`: `README.md`, `CONTRIBUTING.md`, `SECURITY.md`,
    `AGENTS.md`, `CLAUDE.md`, and everything under `docs/`;
  - `.agents/`, `.claude/`, or `skills-lock.json`;
  - `.github/PULL_REQUEST_TEMPLATE.md` or `LICENSE`.

  Everything else is **code**: `src/`, `supabase/`, `scripts/`, `tests/`, `.maestro/`, `site/`,
  `assets/`, `.github/workflows/`, and the root config (`app.json`, `app.config.js`, `eas.json`,
  `package.json`, `tsconfig.json`, `babel.config.js`, `jest.integration.config.js`,
  `playwright.config.ts`, `.oxlintrc.json`, `.env.op`). One code file takes the whole change
  through the gate.
- **Release prep.** A change to `expo.version` in `app.json` or to the `submit` profile in
  `eas.json` for a store build. Build numbers need no commit: `eas.json` sets
  `appVersionSource: "remote"` and `autoIncrement: true`.
- **User waiver.** The user says, in this session, to skip the flow for this change. Record it in
  the PR body as `Flow waived by the user: <reason>`. A waiver covers the one change it was given
  for.

## Linking work to its issue

- **Branch:** `<type>/<issue#>-<slug>`, with the types this repo already uses (`feat`, `fix`,
  `chore`, `docs`, `deps`): `feat/136-hole-strategy`, `fix/51-ios-maestro-driver`. An exempt
  change with no issue keeps `<type>/<slug>`, as `docs/research-notes` (#179) did; Dependabot
  names its own branches.
- **PR body:** the first line is `Closes #N` when the PR finishes the ticket, or `Part of #N` when
  it is one slice of a spec that stays open (#137–#139 were `Part of #136`). The PR template's
  first line is the slot for it, and `/ship` writes it there.
- A number in the PR title alone links nothing — GitHub reads closing keywords from the body.
