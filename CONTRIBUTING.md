# Contributing

## Before making a change

Read the guide that matches the work:

- [Development and configuration](docs/development.md)
- [Architecture and game rules](docs/architecture.md)
- [Testing and CI](docs/testing-and-ci.md)
- [Accessibility](docs/accessibility.md)
- [Security policy](SECURITY.md)

Create a branch from the latest `main`. Keep route files in `src/app/` and put
reusable components, hooks, and business logic in their existing non-route
directories.

## Local verification

Install from the lockfile and run the full local gate:

```bash
npm ci
npm run test:coverage
npm run typecheck
npm run lint
npx expo-doctor
```

Add tests with behavior changes. New executable lines must meet the 90% patch
coverage gate, and total coverage must remain above the thresholds in
`package.json`.

For user-interface changes, test at maximum text size and update the mounted
screen assertions when accessible names, roles, states, or layout branches
change. Follow [the accessibility regression checklist](docs/accessibility.md#regression-checklist).

## Expo and native changes

- Read the installed Expo major version from `package.json`, then use that
  version's documentation.
- Install Expo and React Native packages with `npx expo install`, not a generic
  package-manager add command.
- Run `npx expo-doctor` after dependency or app-config changes.
- Configure native behavior in `app.json` or a config plugin. Do not commit the
  generated `ios/` or `android/` directories.
- If a dependency adds native code that Expo Go does not contain, verify a
  development build on both platforms or explain the platform limitation in
  the pull request.

## Database changes

Create migrations with the CLI:

```bash
npm run db:new descriptive_name
```

Do not edit the remote schema without a migration. Review every RLS change as
an authorization change, add a failing/passing assertion in
`supabase/ci/rls-test.sql`, and ensure CI can apply all migrations to a blank
Postgres 16 database.

Never place a service-role key, database password, access token, or resolved
1Password value in the repository. `EXPO_PUBLIC_` values are bundled into the
app and must be safe to disclose.

## Documentation changes

Update documentation in the same pull request when behavior, prerequisites,
commands, environment variables, CI, or known limitations change. Prefer links
to official service documentation over copying prices, quotas, or other values
that can change outside the repository.

Use relative links for repository files and run the documented command before
publishing it. Point-in-time counts should be dated and secondary to executable
configuration.

## Pull requests

Describe the user-visible outcome, the tests run, and any platform or hardware
validation. Call out schema, security, accessibility, or native-build impact
explicitly. The protected `main` ruleset requires a pull request, current green
checks, and resolved review threads.

Report security vulnerabilities privately as described in
[SECURITY.md](SECURITY.md), not in a public issue.
