# Guard

The commands and paths `scripts/guard.mjs` stops here, on top of the rules it applies everywhere.
Each `##` heading is one setting, defined in `.agents/skills/open-pr/settings/guard.md`.

## Deny commands

- `^(npx (-y |--yes )?)?supabase stop\b.*\s--no-backup\b` — it deletes the local database with the
  stack. Stop it with `npx supabase stop`, which keeps the data.
- `^docker (volume (rm|remove)\b.*\bsupabase_\w+_PressGolf\b|volume prune\b|system prune\b.*\s--volumes\b)` — it
  deletes the local stack's database volumes. Stop the stack with `npx supabase stop` instead.
- `^(npx (-y |--yes )?)?supabase db reset\b` — it wipes the local database, whose rows the
  integration runs leave behind on purpose. Investigate a slow local stack instead
  (`docs/agents/local-runs.md`).
- `^npm (run|run-script) db:push\b` — it runs `supabase db push --remote`, which changes the linked
  production project; only CI's `migrate` job pushes migrations. A bare `npx supabase db push`
  applies them to the local stack.
- `^(npx (-y |--yes )?)?supabase db push\b.*\s--(remote|linked|project-ref|db-url)\b` — it pushes
  migrations to a hosted project, the linked production one by default; only CI's `migrate` job
  does. A bare `npx supabase db push` applies them to the local stack.
- `^(npx (-y |--yes )?)?supabase functions deploy\b` — it deploys an Edge Function to a hosted
  project; CI's `migrate` job deploys them on every merge, and a personal project is the owner's to
  deploy.
- `^node (\.[\\/])?scripts[\\/]release-tag\.mjs\b` — it tags a release and pushes the tag. Test it only
  through `node --test scripts/release-tag.test.mjs`; the **Tag the release** job runs it.
- `^((npx|bunx) (-y |--yes )?)?eas(-cli(@\S+)?)? build:configure\b` — the project is already
  linked to EAS, and reconfiguring rewrites that link.
- `^npx (-y |--yes )?skills update\b` — it leaves `.claude/skills/` linked to its source instead of
  copied. Re-run the `npx skills add ... --copy` install in `AGENTS.md` instead.

## Ask commands

none

## Protected paths

- `^\.env(\.(?!op(/|$)).*)?$` — resolved values; only the tracked `.env.op`, which holds 1Password
  references, is safe to replace.
- `^supabase/\.temp/` — the `npx supabase link` state that `db:status` and `db:lint` use;
  recreating it needs the maintainer's login.
- `^supabase/(\.branches/|\.env\.keys$|\.env\.local$)` — Supabase CLI branch state and local keys.
- `^\.expo/` — Expo's local device and dev-server state, not debris.
- `^(.*/)?[^/]*\.(jks|p8|p12|key|pem|mobileprovision)$` — signing material, which is not
  regenerable.
- `^node_modules/` — every check runs from it.
- `^\.claude/settings\.local\.json$` — the maintainer's local Claude Code settings.
