# Local runs

Checks, stacks and tools on a development machine, mostly the maintainer's Windows PC, and the
traps that have cost time there. The commands themselves are in
[Development and configuration](../development.md) and [Testing and CI](../testing-and-ci.md).

## After switching machines

Dependencies added on one machine aren't in the other's `node_modules` until `npm ci` runs there,
and the gate then fails with "Cannot find module" for reasons unrelated to the branch. After pulling,
if `git diff --name-only <old>..origin/main` includes `package-lock.json`, run `npm ci` first.

## Line endings on the Windows checkout

Tracked files are LF in the index and CRLF in the working tree (`git ls-files --eol` shows
`i/lf w/crlf`), so:

- a multi-line replace from a script fails to match unless it handles `\r\n`: read, turn `\r\n`
  into `\n`, edit, and write back with `\r\n` if the file had them;
- Git Bash `sed -i` silently rewrites a whole file to LF, and a pattern ending in `\r$` then matches
  nothing;
- a shell script built from a checked-out file carries CRLF: `bash -n` passes and shellcheck fails
  with SC1017. Run `tr -d '\r'` over it first;
- `npx prettier --check <file>.md` flags every Markdown file in the working tree, untouched ones too.
  For a docs-only change, trust `git diff --check` and `node scripts/check-docs.mjs`.

## Checking a migration before CI

Docker runs on the Windows PC, so a migration and the RLS assertions can be proven before pushing.
This mirrors CI's "Migrations and row-level security" job:

```bash
export MSYS_NO_PATHCONV=1   # Git Bash otherwise rewrites -w /work
docker run -d --name pg-check -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=press \
  -v "$(pwd -W)/supabase:/work/supabase:ro" postgres:16
until docker exec pg-check pg_isready -h localhost -U postgres -q; do sleep 1; done
P="docker exec -w /work pg-check psql -U postgres -d press -v ON_ERROR_STOP=1"
base=supabase/migrations/20260921000000_initial_schema.sql
$P -q -f supabase/ci/stubs.sql
$P -q -f "$base"; $P -q -f "$base"   # CI applies the baseline twice, before the rest
for f in supabase/migrations/*.sql; do [ "$f" = "$base" ] || $P -q -f "$f"; done
$P -f supabase/ci/rls-test.sql 2>&1 | grep -c "NOTICE:  ok:"   # psql prints notices on stderr
docker rm -f pg-check
```

`rls-test.sql` can't rerun on the same database (duplicate keys), so recreate it between runs. To
test a data-moving migration, apply the migrations before it, insert rows as the superuser with an
explicit `owner_id`, then apply it.

## The local Supabase stack

- **Ports:** another project's stack, or a Windows reserved port range, can hold 54321 and up
  ([Sync integration tests](../development.md#sync-integration-tests) has the overrides). Never stop
  another project's containers to make room.
- **Rows pile up across test runs**, and nothing removes them. Never clear them with
  `npx supabase db reset`. A `57014` statement timeout on a large local stack is worth
  investigating, not rerunning: missing indexes made account deletion take over eight seconds (#242).
  To time one deletion without losing data, as `supabase_admin`
  (`psql -U supabase_admin -d postgres`; supautils blocks `auto_explain` for `postgres`):

  ```sql
  begin; set local statement_timeout = '8s'; select delete_account_data('<uuid>'); rollback;
  ```

  Add `auto_explain` with `log_nested_statements` and `log_level = notice` to see each statement's
  plan. PostgREST's `authenticator` role carries the 8-second timeout `delete-account` runs under.

## Linting workflows and scripts

There is no local `actionlint` or `shellcheck`; run their Docker images:

```bash
MSYS_NO_PATHCONV=1 docker run --rm -v "$(pwd -W):/repo" -w /repo rhysd/actionlint:latest -no-color -oneline .github/workflows/<file>.yml
MSYS_NO_PATHCONV=1 docker run --rm -v "$(cygpath -w <dir>):/mnt" koalaman/shellcheck:stable /mnt/<script>.sh
```

actionlint takes `-no-color` (`-color=never` is a parse error), and its image includes shellcheck
for `run:` blocks.

## Native flows

There is no Maestro or iOS simulator on the Windows PC, so `.maestro/` flows are proven only by
`gh workflow run native-e2e.yml --ref <branch>` (add `-f record_baselines=true` to record
baselines). A run takes about an hour, so make each one count:

- Logs and artifacts are unreadable until the whole run finishes, even when one job is done.
- A failing step saves `screenshots/` and `screen-hierarchy/`; the hierarchy JSON shows exactly what
  Maestro could see. Read it before guessing.
- Maestro validates enum fields (`direction`) and names output files before substituting
  `${VARS}`, so neither can come from a subflow's env.
- Parse every flow as YAML locally first (`js-yaml` is in `node_modules`): a parse error fails every
  flow and leaves no artifacts.
- When a run's captures are fine but misnamed, unprocessed, or its `report` job wasn't acquired by a
  runner, process the artifacts locally instead of spending another run:
  `gh run download <id> -p 'maestro-*' -D <dir>`, then
  `node scripts/native-screens.mjs compare <dir> --report <out> --markdown <out.md>`.
- Check both platforms' behavior in the code before dispatching: a tall `lineHeight` centers text on
  iOS but not on Android; use a centered box.
- Screenshots capture the viewport only, so nothing below the fold is ever in a baseline.
- When only some screens should change, take each PNG from the `baselines/run-<id>` branch onto its
  own PR after diffing it against `main`'s baseline, rather than fast-forwarding the whole branch.

## The Android emulator on Windows

Orca's own boot of the AVD (`Medium_Phone_API_37.0`) has failed. What works:

1. Stop any `emulator` or `qemu-system-x86_64*` processes and delete the stale `*.lock` files in
   `%USERPROFILE%\.android\avd\Medium_Phone.avd`.
2. Boot in the background:
   `emulator -avd Medium_Phone_API_37.0 -no-snapshot-load -gpu swiftshader_indirect -no-boot-anim -no-audio`.
3. The AVD is a Play Store image, so `adb devices` shows `unauthorized` until someone ticks "Always
   allow" and clicks Allow in the emulator window.
4. `orca emulator attach emulator-5554 --focus`, then `CI=1 npx expo start --android -c`.

`adb` isn't on Git Bash's `PATH` (use `$LOCALAPPDATA/Android/Sdk/platform-tools/adb.exe`) and needs
`MSYS_NO_PATHCONV=1` for `/sdcard/...` paths. `uiautomator dump` gives labels and bounds, not hints;
`settings put system font_scale 2.0` sets the largest text size. TalkBack works, but `adb input`
taps bypass its touch exploration, so hearing labels needs a person in the window. Stop it with
`adb -s emulator-5554 emu kill`.

## Expo SDK upgrades

`npx expo install expo@~<n>` then `npx expo install --fix` can fail with `ERESOLVE` on the new
router's optional peers after writing `package.json` but not the lockfile, and deleting
`node_modules` alone doesn't help, because npm resolves from the old lockfile. What worked:

1. Delete from `package-lock.json` every `node_modules/<direct dependency>` entry whose version no
   longer satisfies `package.json`, then `npm install` (about 15 minutes, so run it in the
   background).
2. Delete the lock entries nested under another package (`x/node_modules/y`) that have no root
   `node_modules/y`, and reinstall clean.
3. Re-run `npx expo install --fix` for the dev packages (`jest-expo`, `babel-preset-expo`).

Then: diff the new `expo-template-bare-minimum`'s Android build files against the old ones (a
template default turned R8 on, #250); compare a web flake against `main` in a separate worktree
before blaming the machine; and after a local `npx expo prebuild`, `npx expo install` rewrites the
`android`/`ios` scripts in `package.json` to `expo run:*`, so revert them and delete the generated
`android/` before committing.

## Sources that refuse automated fetches

usga.org answers 403 to automated fetches, its rules PDF included. The full 2024 Rules of
Handicapping downloads from GolfRSA:
<https://www.golfrsa.com/wp-content/uploads/2024/01/WHS_Rules_of_Handicapping_2024.pdf>
(`pdftotext -layout` extracts it).
