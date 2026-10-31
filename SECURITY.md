# Security policy

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability or data-isolation
failure. Use GitHub's
[private vulnerability reporting](https://github.com/jwh3times/PressGolf/security/advisories/new)
and include:

- the affected commit, screen, API, table, or policy;
- reproduction steps and the expected boundary;
- impact and any data that may have been exposed; and
- a suggested fix, if known.

Avoid including real credentials, access tokens, database passwords, or user
data. The maintainer will acknowledge the report, investigate it privately,
and coordinate disclosure after a fix is available.

## Supported version

Security fixes target the current `main` branch. This repository does not
maintain parallel release branches yet.

## Security model

- The phone is the source of truth for active scoring. Live data is stored in
  AsyncStorage and optionally copied to Supabase.
- Supabase row-level security separates owners and grants outing members only
  the shared access required to join and score. CI exercises 95 isolation and
  write-boundary assertions against Postgres 16 (October 2026).
- Demo and live data use different storage namespaces, and demo data is never
  uploaded.
- `EXPO_PUBLIC_SUPABASE_URL` and the Supabase publishable/legacy anon key are
  public client configuration. Authorization depends on RLS, not on hiding
  those values.
- A Supabase service-role/secret key, database password, GitHub token, or
  1Password token must never be included in a client build or committed file.
- Deleting an account goes through the `delete-account` Edge Function, the one
  place the service role is used at run time. It acts only on the account in the
  verified token and re-checks the password itself. The SQL function it calls can
  be executed only by the service role, and the integration suite checks that a
  signed-in or anonymous call is refused.
- Every new row must name an account that exists, through foreign keys to
  `auth.users`, so a deleted account's token, which stays valid for up to an hour,
  can't write. The same keys stop an auth user being deleted while they still have
  rows.

## Repository controls

The default branch requires pull requests, current CI checks, dependency
review, and CodeQL. Force pushes and deletion are blocked. Dependabot security
updates, secret scanning, and push protection are enabled, and workflow actions
are pinned to full commit SHAs.

Production migration credentials are scoped to the GitHub `production`
environment. Local `.env` files are ignored; `.env.op` contains unresolved
1Password references only.

If a secret is committed or appears in logs, revoke or rotate it immediately,
then remove it from current files. Rewriting history does not make an already
exposed credential safe again.
