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
  the shared access required to join and score. CI exercises 24 isolation and
  write-boundary assertions against Postgres 16.
- Demo and live data use different storage namespaces, and demo data is never
  uploaded.
- `EXPO_PUBLIC_SUPABASE_URL` and the Supabase publishable/legacy anon key are
  public client configuration. Authorization depends on RLS, not on hiding
  those values.
- A Supabase service-role/secret key, database password, GitHub token, or
  1Password token must never be included in a client build or committed file.

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
