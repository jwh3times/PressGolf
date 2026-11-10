# Development and configuration

## Prerequisites

- Node.js 22.13 or newer on the 22 line, 24.3 or newer on the 24 line, or 26
  and later (`engines` in `expo`'s `package.json`); 23 and 25 are not
  supported. Expo SDK 58 targets
  React Native 0.88 and React 19.3.0; see the
  [versioned SDK reference](https://docs.expo.dev/versions/v58.0.0/).
- npm, using the committed `package-lock.json`.
- Expo Go for the quickest device loop, or native build tools/a development
  build when a dependency contains custom native code.
- Docker, for `npm run test:web`, which runs the web UI suite in Playwright's
  Linux container so screenshots match CI's.
- Optional: the separately installed 1Password CLI for the maintainer
  configuration. The Supabase CLI used for database work is already a local
  development dependency and is invoked through `npx` or npm scripts.

Install exactly what the lockfile records:

```bash
npm ci
```

## Running the app

| Command | Purpose |
|---|---|
| `npm start` | Start Metro and show the Expo QR code |
| `npm run ios` | Start Metro and open the iOS target |
| `npm run android` | Start Metro and open the Android target |
| `npm run web` | Open the preview-only web target |
| `npx expo start --tunnel` | Use a tunnel when phone and computer cannot communicate over LAN |

Without server variables, Press runs local-only. Demo mode defaults on in a
plain development session and can be changed under **Settings → Demo data**.

The current dependencies run in Expo Go. Expo Go can only load native modules
included in its own runtime. After adding a package with custom native code,
install `expo-dev-client` with `npx expo install expo-dev-client` and use a
[development build](https://docs.expo.dev/develop/development-builds/introduction/).

## Adding or updating dependencies

Use Expo's installer for Expo or React Native packages so versions remain
compatible with SDK 58:

```bash
npx expo install <package>
npx expo install --fix
npx expo-doctor
```

Do not install a different React, React Native, or Expo package version merely
because npm reports a newer release. An SDK upgrade is a deliberate change and
must follow the matching Expo upgrade guide.

Jest's major is SDK-owned as well: `jest-expo` 58 is a Jest 30 preset, so a
new major of `jest` or `@types/jest` waits for the `jest-expo` of a later SDK.
Minor and patch releases still come through Dependabot.

`app.json` turns off Expo Router's async routes (`"asyncRoutes": false` on the
`expo-router` plugin). SDK 58 made them the web default, which splits each
route into its own bundle; under that split, the hole map opened from the
course guide mounted nothing on the web export. Native builds never used async
routes, so this keeps the web preview on the single bundle it used before
SDK 58. The cause inside Expo Router was not found, so the setting stays until
the web suite's course-map tests pass without it.

As of 2026-11-03, `npm ci` still reports deprecation warnings, all from test
tooling the SDK pins: `glob@7` and `inflight` through `@react-native/jest-preset`
→ `babel-jest@29`, `glob@10` through Jest 30's `test-exclude`, and
`whatwg-encoding` through jsdom 26. Never run `npm audit fix --force`; it
proposes downgrading Expo.

This project uses Continuous Native Generation. Configure native behavior in
`app.json` or a config plugin. Generated `ios/` and `android/` folders are
ignored and must not be committed or edited as source.

Android release builds are not minified. Expo SDK 58's native template turns R8
on for them, and under R8 the WorkManager library that `react-native-maps`
brings in can't create its database, so the app crashed on launch (#250). The
`expo-build-properties` plugin in `app.json` sets
`android.enableMinifyInReleaseBuilds` to `false`, as SDK 57 had it, and
`scripts/app-config.test.mjs` fails if that goes. Turning R8 on means adding keep
rules (`extraProguardRules`) for every library that needs them, then proving the
release build in the native smoke run.

Location (for yardage to the green, marking a green and marking the ball) is
foreground-only. The `expo-location` plugin in `app.json` sets the one iOS
prompt, "when in use", and turns off the plugin's default "always" prompt, which
the app never asks for. Its motion
purpose string stays, worded to say Press doesn't use motion: `expo-location`
compiles motion code into every iOS build, and App Store Connect rejects an
upload that references it without the string (ITMS-90683, #188). Press never
asks for motion access, so iOS never shows it. `scripts/app-config.test.mjs`
checks the generated `Info.plist` for both. Android gets coarse and fine
location and no background location.

The greens map uses `react-native-maps`, which is in Expo Go and needs no key
there. A store or development build for Android needs a Google Maps API key.
`app.config.js` passes `GOOGLE_MAPS_ANDROID_API_KEY` to the `react-native-maps`
config plugin as `androidGoogleMapsApiKey`, and the plugin writes it into the
Android manifest. A build without the variable has no key, and its map stays
blank on Android. iOS uses Apple Maps and needs no key. Where the key lives and
how it is restricted is under [Google Maps key](#google-maps-key-android).

The hole map is drawn with `react-native-svg`, which is also in Expo Go, from
the course map saved on the phone. It needs no key and no signal. Its
Satellite switch uses `react-native-maps`, so the Android key above applies
to it too.

## Environment variables

The app recognizes three public build-time variables:

| Variable | Purpose |
|---|---|
| `EXPO_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Supabase publishable/legacy anon key |
| `EXPO_PUBLIC_DEMO_MODE` | Default dataset; anything except `false` enables demo mode |

Expo embeds every `EXPO_PUBLIC_` value in the app bundle. Never put a Supabase
service-role key, database password, or any other secret in one of these
variables.

One more build-time variable, `GOOGLE_MAPS_ANDROID_API_KEY`, is read by
`app.config.js` for the Android map, not by the app's code. See
[Google Maps key](#google-maps-key-android).

For a personal Supabase project, place the URL and client key in an ignored
`.env.local` file:

```dotenv
EXPO_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=YOUR_CLIENT_KEY
```

Maintainers can instead resolve the committed references in `.env.op`:

```bash
npm run start:op
```

`start:op` uses `eval`, `grep`, and `sed`, so it needs npm to run scripts in a
POSIX shell: it works on macOS, Linux and WSL. On Windows, npm runs scripts
through `cmd.exe` whatever terminal started it, so `npm run start:op` fails with
`'eval' is not recognized`, in Git Bash too. In Git Bash, run the command
yourself instead:

```bash
eval "$(op inject -i .env.op | grep -v '^#' | grep . | sed 's/^/export /')" && npx expo start
```

In native PowerShell, inject the two values into the current process without
writing them to disk:

```powershell
$env:EXPO_PUBLIC_SUPABASE_URL = op read 'op://PressGolf/Supabase Project/url'
$env:EXPO_PUBLIC_SUPABASE_ANON_KEY = op read 'op://PressGolf/Supabase Project/anon_key'
npm start
```

## Configuring Supabase

Press remains usable without Supabase; accounts, backup, and shared outings are
then disabled.

To configure a project:

1. Create a Supabase project and leave email/password authentication enabled.
2. Keep anonymous sign-ins disabled; Press attributes remote writes to signed-in
   users.
3. Deploy the site in `site/` with its two Worker secrets, `SUPABASE_URL` and
   `SUPABASE_ANON_KEY`, set in the Cloudflare dashboard; see
   [Support and privacy site](testing-and-ci.md#support-and-privacy-site). Its
   `/reset/` and `/confirm/` pages are where the account emails link. Do this
   before the next two steps, so no email links to a page that can't yet use
   its token.
4. Under **Authentication → URL Configuration**, set the Site URL to the site
   that serves those pages (`https://pressgolf.cc` for Press), and make the
   redirect allow-list hold only its `/reset/` and `/confirm/` pages. The app
   passes no redirect URL and nothing links into it, so it needs no `press://`
   or `exp://` entry.
5. Apply the email texts in `supabase/templates/`: `confirmation.html` (Confirm
   signup), `recovery.html` (Reset password) and `password_changed.html` (the
   password-changed notification, which must be turned on), with the subjects
   `supabase/config.toml` gives them. They link to `{{ .SiteURL }}/confirm/` and
   `{{ .SiteURL }}/reset/`. The dashboard doesn't read `config.toml`, so a change
   to a template is applied there by hand.
6. In the Email sign-in provider's settings, keep **Confirm email** on, turn on
   leaked-password protection, and set the minimum password length to 8, the
   app's `MIN_PASSWORD_LENGTH`.
7. Use a custom SMTP provider before onboarding a group, with the project's
   email rate limit at 30 an hour, checked against the provider's own daily
   cap. Supabase's built-in sender is intended for testing and has restrictive,
   changeable rate limits. See the
   [SMTP guide](https://supabase.com/docs/guides/auth/auth-smtp) and
   [production checklist](https://supabase.com/docs/guides/deployment/going-into-prod).
8. Link and migrate the project:

   ```bash
   npx supabase login
   npx supabase link --project-ref <project-ref>
   npm run db:push
   ```

9. Deploy the Edge Function, or **Delete account** can't reach a server; see
   [Edge Functions](#edge-functions).

How the reset and confirmation links work is in
[architecture.md](architecture.md#password-reset-and-email-confirmation).

The local stack sends the same texts: `supabase/config.toml` points
`[auth.email.template.confirmation]`, `[auth.email.template.recovery]` and
`[auth.email.notification.password_changed]` at `supabase/templates/`. Local
`enable_confirmations` stays `false`, unlike production, because the integration
tests sign up throwaway accounts and sign straight in. The email provider is on
and the phone provider off (`enabled` under `[auth.email]` and `[auth.sms]`,
which switch sign-up and sign-in together). `scripts/supabase-config.test.mjs`
fails when the installed Supabase CLI warns that a `config.toml` key is
deprecated, so the next CLI major can't quietly drop a setting.

## Database migrations

The repository is the schema source of truth. Do not make unrecorded production
changes in the SQL editor.

```bash
npm run db:new add_descriptive_change
npm run db:status
npm run db:lint
npm run db:push
```

`db:status`, `db:lint` and `db:push` act on the linked project through
`--remote`. Since Supabase CLI v3, the same commands with no target act on the
local stack, so a bare `npx supabase db push` never reaches production.
`db:push` asks before it changes the project.

The initial migration is intentionally safe to reapply because it adopted a
schema that existed before migration history. New migrations should be normal,
single-application migrations and must not imitate that baseline unless there
is a specific reason. Because CI re-applies the baseline to prove it is
repeatable, tables a later migration dropped (such as `holes`, replaced by
`tees` and `tee_holes`) reappear, empty, in that throwaway database only.

CI applies every migration to Postgres 16 and runs the RLS assertions before a
merge can reach production. On `main`, the migration job uses secrets from the
GitHub `production` environment.

### Sync integration tests

`npm run test:integration` runs every `*.integration.test.ts` against a local
Supabase stack (Docker required): the sync suites in `src/sync/` and the site's
reset and confirmation pages (`site/__tests__/link-pages.integration.test.ts`),
through real auth, PostgREST, row-level security, realtime and the Edge
Function, with every migration applied. Start the stack first, with only the
services the app uses:

```bash
npx supabase start -x studio,imgproxy,storage-api,logflare,vector,mailpit,postgres-meta,supavisor
npm run test:integration
npx supabase stop            # when you're done
```

The runner reads the stack's URL, anon key and service-role key from
`supabase status`. The account-deletion tests use the service role to read what
a deleted account has left behind, and to try deleting an auth user who still
has rows. The link-page tests use it to make the token a reset or confirmation
email would carry (`generateLink`), so no mail service is needed and Mailpit
can stay off. Every run signs up fresh accounts and prefixes every id, so it can be
repeated against a stack that stays up. It refuses any host but `localhost` or
`127.0.0.1`.

`supabase stop` keeps the database, so a later `start` restores it as it was and
doesn't apply migrations added since. A missing table in the tests usually means
this: run `npx supabase migration up --local --include-all`. The edge runtime
lists functions as it starts, so restart the stack after adding one.

If another project's local Supabase already holds the default ports (54321 and
up), start this one on others and point the runner at it:

```bash
SUPABASE_API_PORT=55321 SUPABASE_DB_PORT=55322 SUPABASE_DB_SHADOW_PORT=55320 SUPABASE_STUDIO_PORT=55323 SUPABASE_LOCAL_SMTP_PORT=55324 SUPABASE_ANALYTICS_PORT=55327 SUPABASE_DB_POOLER_PORT=55329 npx supabase start -x studio,imgproxy,storage-api,logflare,vector,mailpit,postgres-meta,supavisor
SUPABASE_TEST_URL=http://127.0.0.1:55321 SUPABASE_TEST_ANON_KEY=<ANON_KEY from that start> SUPABASE_TEST_SERVICE_ROLE_KEY=<SERVICE_ROLE_KEY from that start> npm run test:integration
```

### Edge Functions

`supabase/functions/delete-account/` is the one Edge Function. It runs on Deno,
so `tsconfig.json` leaves `supabase/functions` out and `oxlint` ignores
`supabase`. Its `supabase-js` version is pinned in the source, because every
merge to `main` deploys it; move the pin by hand. It uses Supabase's default
secrets (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`), so
there's nothing to set on a project. CI's `migrate` job deploys it. To deploy it
to a personal project:

```bash
npx supabase functions deploy delete-account --remote=<project-ref> --use-api
```

`supabase/config.toml` turns off the platform's token check for it
(`verify_jwt = false`), because the function checks the token itself.

### Deleting an account by hand

The deletion page offers an email request to anyone without the app or who can't
sign in, answered within 30 days. Handle one the way the app does: clean up first,
then delete the auth user. Check first that the request came from the account's
own address.

1. In the Supabase SQL editor, find the account and clear its rows:

   ```sql
   select id from auth.users where email = '<address>';
   select delete_account_data('<id>');
   ```

2. Under **Authentication → Users**, delete that user.

Step 2 fails if step 1 was skipped, or if the account's phone has written since:
Supabase refuses to delete a user who still has rows. Run step 1 again.

For an organiser, step 1 also takes every outing they organised off the server,
with everyone's rounds and scores in it, and leaves the guests their
[move notices](architecture.md#move-notices). Anyone with a round or outing of
their own on the account's group or course keeps it, on
[a copy of their own](architecture.md#a-guests-own-rows). It can't be undone.

## EAS build profiles

Run the EAS CLI through `npx`; a global installation is not required.

| Profile | Intended use | Demo default |
|---|---|---|
| `development` | Internal development client | inherited |
| `preview` | Installable internal build; Android APK, physical-device iOS | on |
| `e2e-test` | Credential-free Android APK or iOS simulator build | on |
| `production` | Store build with remote version auto-increment | off |

Examples:

```bash
npx eas-cli@latest login
npx eas-cli@latest build --profile preview --platform android
npx eas-cli@latest build --profile preview --platform ios
npx eas-cli@latest build --profile production --platform all
npx eas-cli@latest submit --profile production --platform ios
npx eas-cli@latest submit --profile production --platform android
```

The project ID and owner are already set in `app.json`; do not rerun the initial
EAS configuration flow.

The app identifier is `cc.pressgolf.app` on both platforms (the iOS bundle ID
and the Android package). `com.press.golf` was already held by another
developer on Google Play, and Play's package name can't change once an app is
created. Store builds are iPhone-only (`supportsTablet` is off) and declare no
non-exempt encryption (`ios.config.usesNonExemptEncryption`), since Press uses
only the system's HTTPS.

The EAS `production` environment holds the two Supabase public values,
`EXPO_PUBLIC_SUPABASE_URL` (plain text) and `EXPO_PUBLIC_SUPABASE_ANON_KEY`
(sensitive), so production builds talk to the live project. Set or rotate them
from 1Password without printing them:

```bash
npx eas-cli@latest env:set --name EXPO_PUBLIC_SUPABASE_URL \
  --value "$(op read 'op://PressGolf/Supabase Project/url')" \
  --environment production --visibility plaintext --non-interactive
npx eas-cli@latest env:set --name EXPO_PUBLIC_SUPABASE_ANON_KEY \
  --value "$(op read 'op://PressGolf/Supabase Project/anon_key')" \
  --environment production --visibility sensitive --non-interactive
```

Preview builds stay without them, so they open on demo data. Add them to
`preview` too if a preview build ever needs the server.

### Google Maps key (Android)

The key is `Press Android` in the PressGolf Google Cloud project. It is in
1Password at `op://PressGolf/Google Maps/android_api_key`, and in EAS as
`GOOGLE_MAPS_ANDROID_API_KEY` in the `development`, `preview` and `production`
environments. It is a *sensitive* variable, not a *secret* one,
because EAS doesn't give secret variables to `app.config.js`. The key is
readable by anyone holding an APK anyway, so its protection is its restriction
in Google Cloud, not its secrecy:

- **Application restriction:** Android apps, package `cc.pressgolf.app`, with
  the SHA-1 fingerprint of every certificate that signs a build. For EAS builds
  that's the keystore under the project's **Credentials** on expo.dev. For a
  Play Store install it's also the app signing key in the Play Console
  (**Protected with Play → Play Store protection → Manage Play app signing**).
  Both fingerprints are recorded on
  [#162](https://github.com/jwh3times/PressGolf/issues/162). A local debug
  build signs with its own key, so it shows a blank map.
- **API restriction:** Maps SDK for Android only.

To set or rotate it in EAS without printing the value:

```bash
npx eas-cli@latest env:set --name GOOGLE_MAPS_ANDROID_API_KEY \
  --value "$(op read 'op://PressGolf/Google Maps/android_api_key')" \
  --environment development --environment preview --environment production \
  --visibility sensitive --non-interactive
```

For a local `npx expo run:android`, set the variable for that one command:
`GOOGLE_MAPS_ANDROID_API_KEY="$(op read 'op://PressGolf/Google Maps/android_api_key')" npx expo run:android`.

### Android permissions

A store build should declare only what Press uses, so the Play listing and the
Data safety form explain nothing the app never does. The app's own manifest
declares fine and coarse location (`expo-location`, for yardage, marking
greens and marking the ball), internet and vibrate. Libraries add network
state, and a dependency's background work library adds wake lock, boot
completed and foreground service for its own work; those are merged in at build
time.

`android.blockedPermissions` in `app.json` removes these from the merged
manifest, which marks each one `tools:node="remove"`:

- `SYSTEM_ALERT_WINDOW`, `READ_EXTERNAL_STORAGE` and `WRITE_EXTERNAL_STORAGE`,
  which Expo's default Android template declares and Press doesn't use. They
  were in the first production build (#162) and were still in the SDK 58
  prebuild on 2026-11-06.
- `com.google.android.gms.permission.AD_ID`, which nothing declares today. It is
  blocked so that a future library can't add it, because the Data safety form
  says Press doesn't use the advertising ID.

`scripts/app-config.test.mjs` reads the manifest prebuild would write
(`expo config --type introspect`). It fails if one of these stops being removed,
or if location, internet or vibrate stops being declared. To read that manifest
yourself without a cloud build, run `npx expo prebuild --platform android
--clean --no-install`, open `android/app/src/main/AndroidManifest.xml`, then
delete `android/` and revert the `scripts` that prebuild rewrites in
`package.json`. Neither shows what libraries merge in. So before submitting,
check a production `.aab` with
[bundletool](https://developer.android.com/tools/bundletool):
`bundletool dump manifest --bundle=<file>.aab | grep uses-permission`.

### App Store submission (iOS)

The `production` submit profile sends iOS builds to TestFlight. Its only
setting is `ascAppId`, the App Store Connect Apple ID of **Press Golf: Score &
Settle** (also in 1Password at `op://PressGolf/App Store Connect API/asc_app_id`).
It identifies the app record and is not a secret.

EAS Submit authenticates with an App Store Connect API key: the Admin team key
`EAS`. Its Key ID and Issuer ID are in the 1Password item **App Store Connect
API**, with the `.p8` attached. The key is held on EAS and assigned to the app,
so `eas.json` names no key file. Assign it once, or again after the key is
rotated, from Git Bash:

```bash
KEY="$(mktemp -d)/AuthKey.p8"
op read "op://PressGolf/App Store Connect API/AuthKey_<key_id>.p8" --out-file "$KEY"
npx eas-cli@latest credentials --platform ios
rm -r "$(dirname "$KEY")"
```

In the prompts, choose the `production` profile, sign in with the Apple
Developer account, then **App Store Connect: Manage your API Key** → **Set up
your project to use an API Key for EAS Submit**, and give the path in `$KEY`
with the Key ID and Issuer ID from 1Password. Without an assigned key,
`eas submit --non-interactive` fails.

Build and submit in one step:

```bash
npx eas-cli@latest build --platform ios --profile production --auto-submit
```

The first iOS production build asks for the Apple Developer sign-in so EAS can
create the distribution certificate and provisioning profile, which it keeps
under the project's **Credentials** on expo.dev. A submitted build goes to
TestFlight, not to App Store review; external testers get it only after Beta
App Review.

### Play submission (Android)

The `production` submit profile sends Android builds to Play's closed testing
track: `track` `alpha` is the track Play Console shows as **Closed testing -
Alpha**, and `releaseStatus` `completed` releases the build to opted-in testers
once Play has reviewed it. Google required the first `.aab` to be uploaded by
hand; later builds go through EAS Submit.

EAS Submit signs in as the Google Cloud service account `eas-submit` in the
PressGolf project, which has the Google Play Android Developer API enabled. In
Play Console (**Users and permissions**) it has app permissions for Press only:
view app information, edit draft apps, release to production and testing
tracks, manage testing tracks, and manage store presence. Its JSON key is
attached to the 1Password item **Google Play Service Account** and assigned on
EAS, so `eas.json` names no key file. Assign it again after the key is rotated,
from Git Bash:

```bash
KEY="$(mktemp -d)/play-service-account.json"
op read "op://PressGolf/Google Play Service Account/service_account_key" --out-file "$KEY"
npx eas-cli@latest credentials --platform android
rm -r "$(dirname "$KEY")"
```

In the prompts, choose the `production` profile, then **Google Service
Account** → **Manage your Google Service Account Key for Play Store
Submissions** → **Set up a Google Service Account Key for Play Store
Submissions**, and give the path in `$KEY`.

Build and submit in one step:

```bash
npx eas-cli@latest build --platform android --profile production --auto-submit
```

## Troubleshooting

- Run `npx expo-doctor` first for dependency or app-config problems.
- If `expo-modules-core` reports missing source files or Metro cannot resolve a
  package after an interrupted install, stop Metro, remove only the local
  `node_modules` directory, run `npm ci`, and restart with a cleared cache:
  `npx expo start --clear`.
- If browser-based Expo login cannot open a browser on Windows, copy the URL
  printed by the CLI into a browser manually while the command remains running.
- Do not use Node releases below the SDK 58 minimum or untested bleeding-edge
  releases merely to work around an install problem.
