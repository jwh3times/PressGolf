-- What Supabase provides that a bare Postgres does not.
--
-- Only needed to run the migrations against a throwaway database in CI. It is
-- never applied to a real project — Supabase already has all of this, and
-- these definitions are deliberately cruder than the real ones.

create schema if not exists auth;

-- The real one reads the request's JWT. This reads a session setting, which is
-- what lets a test say "now I am Bob" without minting tokens.
create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

-- Supabase creates this publication for realtime. The migration adds a table
-- to it, so it has to exist.
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end
$$;

-- Client queries run as this role, with row-level security enforced. The
-- distinction matters: a superuser bypasses RLS entirely, so a test that
-- forgot to switch roles would pass no matter how wrong the policies were.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
end
$$;
