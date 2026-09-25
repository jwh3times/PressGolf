---
name: end-session
description: Use at the end of a work session or day, or when the user says "end session", "wrap up", "done for the day", or asks to "clean up the local workspace and update any github issues that need it from this session." Sweeps the session for durable discoveries and lands them in memory and GitHub issues, then cleans the local workspace. PressGolf-specific.
---

# End session

The one-line contract this skill exists to execute:

> clean up the local workspace, update any memory and github issues that need it from this session.

Ending a session cleanly means nothing learned today survives only in the transcript. Three
destinations, in this order — memory, GitHub issues, then the workspace itself.

**Announce at start:** "I'm using the end-session skill to wrap up this session."

## Why this exists

A session's discoveries land in places with different visibility:

- **Memory** (the directory the harness names in its system prompt) — cross-session orientation.
  Local to the machine, never committed.
- **GitHub issues** — the tracker per [`docs/agents/issue-tracker.md`](../../../docs/agents/issue-tracker.md).
  **This repo is public.** Anything written there is published.
- **The working tree** — coverage output, Expo caches, scratch files, stray branches, a running
  local Supabase stack.

CI enforces none of this. `/ship` covers the docs for a _branch_; this skill covers the _session_,
including everything that never reaches a commit.

Run this **after** `/ship`, not instead of it. If a branch is ready for review, ship it first; this
skill does not open PRs.

## Steps

### 1. Reconstruct the session

Before writing anything, establish what actually happened. Do not rely on recollection alone:

```
git status --short --branch
git log --oneline -15
git log --oneline origin/main..HEAD
```

Then list, for yourself, the session's candidate outputs in four buckets:

- **Discoveries** — a trap, a constraint, a corrected assumption, a thing that cost time and would
  cost it again.
- **Decisions** — something chosen or deferred that is not derivable from the diff.
- **Work state** — what shipped, what is half-done, what is blocked and on whom.
- **Debris** — files, processes, and branches created along the way.

If a bucket is genuinely empty, say so in the report rather than inventing an entry. A session that
only read code may legitimately produce no memory write and no issue edit.

### 2. Memory sweep

Path: the memory directory the harness supplies for this session — use it exactly as given. Do not
hardcode or derive one from the checkout path: the directory name encodes a checkout location, so a
moved or additional checkout maps to a different, possibly stale, directory whose writes succeed
silently and are never read back. If the harness names no memory directory, skip this step and say
so in the report. One fact per file; `MEMORY.md` is the index (one line per memory, never content).

**Update before you create.** Read `MEMORY.md` first and match each discovery against the existing
files — most session findings belong in one that already exists.

Rules that bite here:

- **Position, not history.** If `git log`, an issue, or `AGENTS.md` already says it, do not restate
  it in memory. Record what none of them say.
- **Absolute dates**, never "yesterday" or "last week".
- Convert a superseded fact by **editing** the memory, not by appending a contradiction. Delete a
  memory that turned out to be wrong.
- Link related memories with `[[slug]]`.
- New file ⇒ add its one-line pointer to `MEMORY.md` in the same pass.
- **Security findings stay out of memory bodies in exploitable detail.**

### 3. GitHub issues

Conventions and exact `gh` invocations: [`docs/agents/issue-tracker.md`](../../../docs/agents/issue-tracker.md).
Label vocabulary: [`docs/agents/triage-labels.md`](../../../docs/agents/triage-labels.md).

```
gh issue list --state open --json number,title,labels --jq '[.[] | {number, title, labels: [.labels[].name]}]'
gh pr list --state open --json number,title,headRefName
```

Then reconcile:

- **An issue this session resolved** and whose PR has merged → comment the outcome and close it
  (`gh issue close <n> --comment "..."`). If the PR is open but not merged, comment the state; do
  not close — the PR's `Fixes #NN` will close it on merge.
- **An issue whose premise this session disproved or narrowed** → comment the correction. A
  narrowed ticket gets its narrowed scope written down, not left in the transcript.
- **Work discovered but not done** → file it. A discovery that only exists in memory is not
  scheduled work.
- **Human-only follow-ups** (hardware validation, store-console steps, secrets to rotate) → file or
  update an issue labelled with the human-ready role from the triage table, with the exact steps and
  the evidence that proves it done.
- **Wayfinder maps** — if the session resolved a map's child: comment the answer on the child and
  close it. **Do not write the child's status into the map body**; the task list renders it.

**Never publish to an issue:** secrets, resolved 1Password values, Supabase keys, or exploitable
detail about an unpatched security weakness. `SECURITY.md` says where vulnerabilities go.

### 4. Clean the local workspace

Work outward from the tree. **List before you delete, and confirm anything that is not obviously
regenerable output.**

Uncommitted work first — this is the one that loses real work:

```
git status --short
git stash list
```

For each untracked or modified file, decide out loud: commit it, stash it, or delete it. **Do not
delete or discard uncommitted changes without the user's explicit yes.** If a change belongs on a
branch that is ready, that is `/ship`, not this skill.

Regenerable output safe to sweep once identified (all gitignored; confirm the list first):

- `coverage/`
- `dist/`, `web-build/`, and any `expo export --output-dir` target left inside the repo
- `ios/`, `android/` generated by a local `npx expo run:*` or `expo prebuild` — only when the user is
  done with that development build
- stray `*.tsbuildinfo`
- scratch files written outside the session scratchpad — anything ad hoc at the repo root

Leave `.expo/` alone unless the user asks; it is Expo's local state, not debris.

Then the rest of the local environment:

- **Generated-mirror drift.** If the session edited `.agents/skills/` or `.claude/agents/`:

  ```
  npm run sync:agents:check
  ```

  If stale, run `npm run sync:agents` and commit the result, or CI fails.

- **Processes.** Stop what the session started: the Expo dev server, emulators or simulators, and a
  local Supabase stack (`npx supabase stop` keeps its data; never add `--no-backup`). Leave them
  running only if the user says they are coming back to them.

- **Branches and worktrees.** Report unpushed commits and list merged local branches, but **do not
  delete a branch without confirmation**:

  ```
  git worktree list
  git branch --merged origin/main
  gh pr view <number> --json state,mergedAt,mergeCommit,headRefName
  ```

  `git branch --merged` is only trustworthy for PRs landed with a merge commit. A squash- or
  rebase-merged branch looks unmerged; confirm it with the PR's `MERGED` state and an empty
  `git diff <mergeCommit> <branch> --` before offering to delete it.

- **Scratchpad.** Session scratch files live in the OS temp scratchpad, not the repo. Leave them.

### 5. Report

Close with a short, honest account:

- Memories written, updated, or deleted — by slug.
- Issues commented, closed, labelled, or filed — by number, with URLs.
- Workspace: what was deleted, what was left alone and why, process and branch state, and any
  uncommitted work still in the tree.
- **Anything deliberately not recorded** — an unresolved question, a finding too raw to file. Say it
  plainly so it does not silently evaporate at the end of the session.

If a branch is still unshipped, say so and point at `/ship`; do not ship it as a side effect.

## Do not

- Open, update, or merge a PR — that is `/ship`.
- Publish secrets or unpatched-security detail to an issue or any committed file.
- Delete uncommitted changes, stashes, or branches without explicit confirmation.
- Reset the local database or drop Supabase volumes.
- Invent memory entries or issue comments for a session that did not produce them.
- Restate in memory what `git log`, `AGENTS.md`, or an issue already records.
