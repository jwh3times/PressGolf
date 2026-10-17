# Development and configuration

## Prerequisites

- Node.js 22.13 or newer. Expo SDK 57 targets React Native 0.86 and React
  19.2.3; see the [versioned SDK reference](https://docs.expo.dev/versions/v57.0.0/).
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
compatible with SDK 57:

```bash
npx expo install <package>
npx expo install --fix
npx expo-doctor
```

Do not install a different React, React Native, or Expo package version merely
because npm reports a newer release. An SDK upgrade is a deliberate change and
must follow the matching Expo upgrade guide.

Two pins exist only because SDK 57 fixes React at 19.2:

- `test-renderer` stays on `~1.2.0`. Version 1.3 depends on
  `react-reconciler@0.34`, which requires React 19.3 and causes an `ERESOLVE`
  peer warning. Lift the pin, and its Dependabot ignore rule, when the SDK
  moves to React 19.3.
- `overrides.uuid` forces `^11.1.1` under `xcode` (used by config plugins at
  prebuild time) to clear GHSA-w5hq-g745-h8pq. Remove it once
  `@expo/config-plugins` no longer resolves an older `uuid`.

As of 2026-09-25, `npm ci` still reports deprecation warnings from Jest 29 and
jsdom 20 (`glob@7`, `inflight`, `abab`, `domexception`, `whatwg-encoding`), and
`npm audit` reports decode-uri-component GHSA-vcc3-ghjq-m6fr through
`expo-router` → `query-string@7`. The patched `decode-uri-component` is
ESM-only, so it cannot be overridden. Never run `npm audit fix --force`; it
proposes downgrading Expo.

This project uses Continuous Native Generation. Configure native behavior in
`app.json` or a config plugin. Generated `ios/` and `android/` folders are
ignored and must not be committed or edited as source.

Location (for yardage to the green) is foreground-only. The `expo-location`
plugin in `app.json` sets the one iOS prompt, "when in use", and turns off the
plugin's default "always" and motion prompts, which the app never asks for.
Android gets coarse and fine location and no background location.

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

`start:op` uses `eval`, `grep`, and `sed`, so run it in Bash, Git Bash, or WSL.
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
3. Under **Authentication → URL Configuration**, add `press://**` for installed
   builds. Add the Expo development redirect produced by `Linking.createURL`
   when testing confirmation links in Expo Go; `exp://**` is suitable for local
   development only.
4. Use a custom SMTP provider before onboarding a group. Supabase's built-in
   sender is intended for testing and has restrictive, changeable rate limits.
   See the [SMTP guide](https://supabase.com/docs/guides/auth/auth-smtp) and
   [production checklist](https://supabase.com/docs/guides/deployment/going-into-prod).
5. Link and migrate the project:

   ```bash
   npx supabase login
   npx supabase link --project-ref <project-ref>
   npm run db:push
   ```

The custom scheme comes from `app.json`; do not edit generated native manifests
for deep linking. Supabase's
[native mobile deep-linking guide](https://supabase.com/docs/guides/auth/native-mobile-deep-linking)
has the current platform details.

## Database migrations

The repository is the schema source of truth. Do not make unrecorded production
changes in the SQL editor.

```bash
npm run db:new add_descriptive_change
npm run db:status
npm run db:lint
npm run db:push
```

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

`npm run test:integration` runs `src/sync/**/*.integration.test.ts` against a
local Supabase stack (Docker required): real auth, PostgREST, row-level
security and realtime, with every migration applied. Start the stack first,
with only the services sync uses:

```bash
npx supabase start -x studio,imgproxy,storage-api,edge-runtime,logflare,vector,mailpit,postgres-meta,supavisor
npm run test:integration
npx supabase stop            # when you're done
```

The runner reads the stack's URL and anon key from `supabase status`. Every run
signs up fresh accounts and prefixes every id, so it can be repeated against a
stack that stays up. It refuses any host but `localhost` or `127.0.0.1`.

If another project's local Supabase already holds the default ports (54321 and
up), start this one on others and point the runner at it:

```bash
SUPABASE_API_PORT=55321 SUPABASE_DB_PORT=55322 SUPABASE_DB_SHADOW_PORT=55320 SUPABASE_STUDIO_PORT=55323 SUPABASE_INBUCKET_PORT=55324 SUPABASE_ANALYTICS_PORT=55327 SUPABASE_DB_POOLER_PORT=55329 npx supabase start -x studio,imgproxy,storage-api,edge-runtime,logflare,vector,mailpit,postgres-meta,supavisor
SUPABASE_TEST_URL=http://127.0.0.1:55321 SUPABASE_TEST_ANON_KEY=<ANON_KEY from that start> npm run test:integration
```

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
```

The project ID and owner are already set in `app.json`; do not rerun the initial
EAS configuration flow. Configure the two Supabase public values in the EAS
`preview` and `production` environments when cloud builds need server access.

### Google Maps key (Android)

The key is in 1Password at `op://PressGolf/Google Maps/android_api_key`, and in
EAS as `GOOGLE_MAPS_ANDROID_API_KEY` in the `development`, `preview` and
`production` environments. It is a *sensitive* variable, not a *secret* one,
because EAS doesn't give secret variables to `app.config.js`. The key is
readable by anyone holding an APK anyway, so its protection is its restriction
in Google Cloud, not its secrecy:

- **Application restriction:** Android apps, package `com.press.golf`, with
  the SHA-1 fingerprint of every certificate that signs a build. For EAS builds
  that's the keystore under the project's **Credentials** on expo.dev. For a
  Play Store install it's also the app signing key in the Play Console (**App
  integrity → Play app signing**), once the first upload has created it.
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

## Troubleshooting

- Run `npx expo-doctor` first for dependency or app-config problems.
- If `expo-modules-core` reports missing source files or Metro cannot resolve a
  package after an interrupted install, stop Metro, remove only the local
  `node_modules` directory, run `npm ci`, and restart with a cleared cache:
  `npx expo start --clear`.
- If browser-based Expo login cannot open a browser on Windows, copy the URL
  printed by the CLI into a browser manually while the command remains running.
- Do not use Node releases below the SDK 57 minimum or untested bleeding-edge
  releases merely to work around an install problem.
