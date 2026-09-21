-- Press — Supabase schema
--
-- Run this once in the SQL editor of a fresh Supabase project, then put the
-- project URL and anon key into EXPO_PUBLIC_SUPABASE_URL and
-- EXPO_PUBLIC_SUPABASE_ANON_KEY. See README "Multiplayer scoring".
--
-- The design is deliberately thin. The app already knows how to settle a round
-- from plain data, so the server does not need to understand golf — it stores
-- an outing, who is in it, and an append-only log of edits. All the money is
-- computed on device from that log, which means a scoring bug can never be
-- baked into the database.

create extension if not exists "pgcrypto";

-- ── Outings ────────────────────────────────────────────────────────────────

create table if not exists outings (
  id            text primary key,
  -- Six characters, unambiguous alphabet. This is what people type to join.
  join_code     text unique not null,
  name          text not null,
  course        jsonb not null,
  -- Field, field games, groups: the whole outing document, written by the
  -- organiser. Scores never live here — they arrive as mutations.
  payload       jsonb not null,
  created_by    uuid not null default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  status        text not null default 'active'
);

create index if not exists outings_join_code_idx on outings (join_code);

-- ── Membership ─────────────────────────────────────────────────────────────

create table if not exists outing_members (
  outing_id     text not null references outings (id) on delete cascade,
  user_id       uuid not null default auth.uid(),
  -- Which player in the outing's field this device is scoring as.
  player_id     text,
  display_name  text,
  role          text not null default 'player',
  joined_at     timestamptz not null default now(),
  primary key (outing_id, user_id)
);

create index if not exists outing_members_user_idx on outing_members (user_id);

-- ── The edit log ───────────────────────────────────────────────────────────
--
-- Append-only and monotonically ordered by `seq`. Clients keep the last seq
-- they have seen and ask for everything after it, which makes reconnecting
-- after nine holes with no signal a single cheap query.

create table if not exists mutations (
  seq           bigserial primary key,
  id            text not null,
  outing_id     text not null references outings (id) on delete cascade,
  round_id      text,
  kind          text not null,
  -- Identifies the cell being edited, e.g. 'score:player_7:11'.
  key           text not null,
  value         jsonb,
  -- Device clock, milliseconds. Used for last-write-wins on a cell.
  at            bigint not null,
  device_id     text not null,
  author_id     text,
  user_id       uuid not null default auth.uid(),
  created_at    timestamptz not null default now(),
  -- Re-sending after a timeout must not duplicate the edit.
  unique (outing_id, id)
);

create index if not exists mutations_outing_seq_idx on mutations (outing_id, seq);

-- ── Row level security ─────────────────────────────────────────────────────
--
-- The rule throughout: you can see and write to an outing only if you have
-- joined it. Joining requires the code, which is the shared secret.

alter table outings enable row level security;
alter table outing_members enable row level security;
alter table mutations enable row level security;

create or replace function is_member(target_outing text)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from outing_members m
    where m.outing_id = target_outing and m.user_id = auth.uid()
  );
$$;

drop policy if exists "members read outings" on outings;
create policy "members read outings" on outings
  for select using (is_member(id));

drop policy if exists "anyone creates an outing" on outings;
create policy "anyone creates an outing" on outings
  for insert with check (auth.uid() = created_by);

drop policy if exists "organiser updates the outing" on outings;
create policy "organiser updates the outing" on outings
  for update using (auth.uid() = created_by);

drop policy if exists "read your memberships" on outing_members;
create policy "read your memberships" on outing_members
  for select using (user_id = auth.uid() or is_member(outing_id));

drop policy if exists "join an outing" on outing_members;
create policy "join an outing" on outing_members
  for insert with check (user_id = auth.uid());

drop policy if exists "update your own membership" on outing_members;
create policy "update your own membership" on outing_members
  for update using (user_id = auth.uid());

drop policy if exists "members read mutations" on mutations;
create policy "members read mutations" on mutations
  for select using (is_member(outing_id));

-- Members may only write edits attributed to themselves. Nothing is updatable
-- or deletable: the log is the record, and corrections are new entries.
drop policy if exists "members write mutations" on mutations;
create policy "members write mutations" on mutations
  for insert with check (is_member(outing_id) and user_id = auth.uid());

-- ── Joining by code ────────────────────────────────────────────────────────
--
-- Joining has to read an outing you are not yet a member of, so it goes
-- through a definer function rather than opening up the table.

create or replace function join_outing(code text, as_player text default null, display text default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  target text;
begin
  select id into target from outings where join_code = upper(code) and status = 'active';
  if target is null then
    raise exception 'No outing with that code';
  end if;

  insert into outing_members (outing_id, user_id, player_id, display_name)
  values (target, auth.uid(), as_player, display)
  on conflict (outing_id, user_id)
  do update set player_id = coalesce(excluded.player_id, outing_members.player_id),
                display_name = coalesce(excluded.display_name, outing_members.display_name);

  return target;
end;
$$;

-- ── Realtime ───────────────────────────────────────────────────────────────
-- Phones subscribe to mutations for their outing, so a score entered in the
-- group ahead shows up without anybody pulling to refresh.

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'mutations'
  ) then
    alter publication supabase_realtime add table mutations;
  end if;
end
$$;
