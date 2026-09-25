# Development and configuration

## Prerequisites

- Node.js 22.13 or newer. Expo SDK 57 targets React Native 0.86 and React
  19.2.3; see the [versioned SDK reference](https://docs.expo.dev/versions/v57.0.0/).
- npm, using the committed `package-lock.json`.
- Expo Go for the quickest device loop, or native build tools/a development
  build when a dependency contains custom native code.
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

This project uses Continuous Native Generation. Configure native behavior in
`app.json` or a config plugin. Generated `ios/` and `android/` folders are
ignored and must not be committed or edited as source.

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
is a specific reason.

CI applies every migration to Postgres 16 and runs the RLS assertions before a
merge can reach production. On `main`, the migration job uses secrets from the
GitHub `production` environment.

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
