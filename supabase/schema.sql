-- Press — Supabase schema
--
-- Run this once in the SQL editor of a fresh Supabase project, then put the
-- project URL and anon key into EXPO_PUBLIC_SUPABASE_URL and
-- EXPO_PUBLIC_SUPABASE_ANON_KEY. See README "Multiplayer scoring".
--
-- Auth is email and password. Every policy keys off auth.uid(), so it does not
-- care how the session was obtained, but the app signs people in with an
-- account and anonymous sign-ins are expected to stay off.
--
-- Two halves, with different jobs:
--
--   Your own data — groups, players, courses, rounds, scores — is stored
--   relationally, one row per thing, owned by you and visible to nobody else.
--   The phone is still the source of truth and still works with no signal;
--   this is where it ends up so that losing a phone does not lose a season.
--
--   Shared outings keep an append-only log of edits (`mutations`), because
--   several phones scoring one card need per-cell conflict resolution that
--   whole-row writes cannot give.
--
-- The server still does not understand golf. It stores what happened; every
-- penny is computed on the device from these rows, which means a scoring bug
-- can never be baked into the database.

create extension if not exists "pgcrypto";

-- Ids are the app's own strings, generated on the phone, so a round created
-- with no signal keeps its identity when it finally syncs.

-- ── Your data ──────────────────────────────────────────────────────────────
--
-- owner_id is repeated on every table rather than joined back to the parent.
-- It denormalises, but it makes every policy a single index lookup instead of
-- a recursive walk, and it means a child row can never outlive its owner check.

create table if not exists groups (
  id                text primary key,
  owner_id          uuid not null default auth.uid(),
  name              text not null,
  -- Whose phone this is, within the group.
  you_id            text,
  default_course_id text,
  subtitle          text not null default '',
  -- The app's own millisecond timestamps, kept as the app sees them.
  created_at        bigint not null,
  updated_at        timestamptz not null default now()
);

create table if not exists players (
  id         text primary key,
  owner_id   uuid not null default auth.uid(),
  group_id   text not null references groups (id) on delete cascade,
  name       text not null,
  initials   text not null,
  color      text not null,
  -- Roster order is meaningful: it is the default tee order.
  sort_order integer not null default 0,
  updated_at timestamptz not null default now()
);

create index if not exists players_group_idx on players (group_id);

create table if not exists courses (
  id         text primary key,
  owner_id   uuid not null default auth.uid(),
  name       text not null,
  created_at bigint not null,
  updated_at timestamptz not null default now()
);

create table if not exists holes (
  course_id    text not null references courses (id) on delete cascade,
  owner_id     uuid not null default auth.uid(),
  -- 1-based, as printed on the card.
  number       integer not null,
  par          integer not null,
  -- 1 = hardest. This is what decides where pops land.
  stroke_index integer not null,
  yards        integer not null,
  primary key (course_id, number)
);

create table if not exists rounds (
  id           text primary key,
  owner_id     uuid not null default auth.uid(),
  group_id     text not null references groups (id) on delete cascade,
  course_id    text not null references courses (id),
  -- Null for a standalone round; set when this foursome is one group of a
  -- bigger day. Deliberately not a foreign key: an outing can arrive from
  -- another phone after the round that belongs to it.
  outing_id    text,
  name         text not null,
  tee_time     text,
  status       text not null default 'active',
  started_at   bigint not null,
  completed_at bigint,
  updated_at   timestamptz not null default now()
);

create index if not exists rounds_group_idx on rounds (group_id);
create index if not exists rounds_outing_idx on rounds (outing_id);

create table if not exists round_players (
  round_id   text not null references rounds (id) on delete cascade,
  player_id  text not null,
  owner_id   uuid not null default auth.uid(),
  -- Tee order for this round, which Wolf rotates through.
  tee_order  integer not null,
  pops       integer not null default 0,
  primary key (round_id, player_id)
);

-- One row per cell of the card. The primary key is exactly the thing two
-- phones might disagree about, so last-write-wins lands at the right grain:
-- two people scoring different holes never collide at all.
create table if not exists scores (
  round_id   text not null references rounds (id) on delete cascade,
  player_id  text not null,
  owner_id   uuid not null default auth.uid(),
  -- 0-based, matching the app's arrays.
  hole       integer not null,
  -- Null means the box is still empty, which is not the same as a zero.
  strokes    integer,
  updated_at timestamptz not null default now(),
  primary key (round_id, player_id, hole)
);

create table if not exists junk (
  round_id  text not null references rounds (id) on delete cascade,
  player_id text not null,
  owner_id  uuid not null default auth.uid(),
  hole      integer not null,
  -- greenie | sandie | chipIn | polie. Birdies and eagles are derived from the
  -- score, never stored — they cannot disagree with the card that way.
  kind      text not null,
  primary key (round_id, hole, player_id, kind)
);

create table if not exists presses (
  round_id       text not null references rounds (id) on delete cascade,
  id             text primary key,
  owner_id       uuid not null default auth.uid(),
  by_player      text not null,
  against_player text not null,
  start_hole     integer not null,
  end_hole       integer not null,
  stake          bigint not null
);

create index if not exists presses_round_idx on presses (round_id);

create table if not exists wolf_picks (
  round_id  text not null references rounds (id) on delete cascade,
  owner_id  uuid not null default auth.uid(),
  hole      integer not null,
  -- Stored rather than derived, so changing tee order does not rewrite history.
  wolf      text not null,
  -- Null means the wolf went alone.
  partner   text,
  primary key (round_id, hole)
);

create table if not exists round_games (
  round_id text not null references rounds (id) on delete cascade,
  owner_id uuid not null default auth.uid(),
  -- nassau | skins | junk | stableford | bestball | wolf | vegas | match | stroke
  key      text not null,
  enabled  boolean not null default false,
  -- Integer cents, always.
  stake    bigint not null default 0,
  primary key (round_id, key)
);

create table if not exists round_options (
  round_id                     text primary key references rounds (id) on delete cascade,
  owner_id                     uuid not null default auth.uid(),
  wolf_lone_multiplier         numeric not null,
  vegas_flip_on_birdie         boolean not null,
  stableford_eagle_or_better   integer not null,
  stableford_birdie            integer not null,
  stableford_par               integer not null,
  stableford_bogey             integer not null,
  stableford_worse             integer not null
);

-- Four-ball and Vegas share one set of sides; match play has its own pairings.
-- Both are ordered lists of two players, so they get the same shape.
create table if not exists round_teams (
  round_id text not null references rounds (id) on delete cascade,
  owner_id uuid not null default auth.uid(),
  slot     integer not null,
  player_a text not null,
  player_b text not null,
  primary key (round_id, slot)
);

create table if not exists round_pairings (
  round_id text not null references rounds (id) on delete cascade,
  owner_id uuid not null default auth.uid(),
  slot     integer not null,
  player_a text not null,
  player_b text not null,
  primary key (round_id, slot)
);

-- ── Outings: one field, several foursomes ──────────────────────────────────
--
-- An outing is both a thing you own and, once shared, a thing other people
-- join. join_code is null until it is published.

create table if not exists outings (
  id           text primary key,
  owner_id     uuid not null default auth.uid(),
  group_id     text not null references groups (id) on delete cascade,
  course_id    text not null references courses (id),
  name         text not null,
  date         bigint not null,
  -- sequential | shotgun
  tee_format   text not null default 'sequential',
  status       text not null default 'active',
  started_at   bigint not null,
  completed_at bigint,
  -- Six characters, unambiguous alphabet. Null until the outing is shared.
  -- This is what people type to join, and it is the only shared secret.
  join_code    text unique,
  updated_at   timestamptz not null default now()
);

create index if not exists outings_join_code_idx on outings (join_code);

create table if not exists outing_field (
  outing_id  text not null references outings (id) on delete cascade,
  player_id  text not null,
  owner_id   uuid not null default auth.uid(),
  sort_order integer not null default 0,
  primary key (outing_id, player_id)
);

create table if not exists outing_field_games (
  outing_id text not null references outings (id) on delete cascade,
  owner_id  uuid not null default auth.uid(),
  -- fieldSkins | scats
  key       text not null,
  enabled   boolean not null default false,
  buy_in    bigint not null default 0,
  -- Net applies pops; gross does not. Scats default to gross because "made
  -- par" is a gross statement; field skins default to net.
  use_net   boolean not null default true,
  -- Ties push the money to the next hole: the rabbit.
  carry     boolean not null default true,
  -- splitAmongWinners | carry
  unclaimed text not null default 'splitAmongWinners',
  primary key (outing_id, key)
);

create table if not exists outing_field_entrants (
  outing_id text not null references outings (id) on delete cascade,
  key       text not null,
  player_id text not null,
  owner_id  uuid not null default auth.uid(),
  primary key (outing_id, key, player_id)
);

-- ── Sharing an outing ──────────────────────────────────────────────────────

create table if not exists outing_members (
  outing_id    text not null references outings (id) on delete cascade,
  user_id      uuid not null default auth.uid(),
  -- Which player in the field this device is scoring as.
  player_id    text,
  display_name text,
  role         text not null default 'player',
  joined_at    timestamptz not null default now(),
  primary key (outing_id, user_id)
);

create index if not exists outing_members_user_idx on outing_members (user_id);

-- The edit log, for phones scoring the same card at the same time. Append-only
-- and ordered by `seq`: a client keeps the last seq it saw and asks for
-- everything after it, so reconnecting after nine blind holes is one query.
create table if not exists mutations (
  seq        bigserial primary key,
  id         text not null,
  outing_id  text not null references outings (id) on delete cascade,
  round_id   text,
  kind       text not null,
  -- Identifies the cell being edited, e.g. 'score:player_7:11'.
  key        text not null,
  value      jsonb,
  -- Device clock, milliseconds. Decides last-write-wins on a cell.
  at         bigint not null,
  device_id  text not null,
  author_id  text,
  user_id    uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  -- Re-sending after a timeout must not duplicate the edit.
  unique (outing_id, id)
);

create index if not exists mutations_outing_seq_idx on mutations (outing_id, seq);

-- ── Row level security ─────────────────────────────────────────────────────

alter table groups                enable row level security;
alter table players               enable row level security;
alter table courses               enable row level security;
alter table holes                 enable row level security;
alter table rounds                enable row level security;
alter table round_players         enable row level security;
alter table scores                enable row level security;
alter table junk                  enable row level security;
alter table presses               enable row level security;
alter table wolf_picks            enable row level security;
alter table round_games           enable row level security;
alter table round_options         enable row level security;
alter table round_teams           enable row level security;
alter table round_pairings        enable row level security;
alter table outings               enable row level security;
alter table outing_field          enable row level security;
alter table outing_field_games    enable row level security;
alter table outing_field_entrants enable row level security;
alter table outing_members        enable row level security;
alter table mutations             enable row level security;

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

-- Your own data: one rule, applied to every table that carries owner_id. You
-- see your rows and nobody else's, and you cannot write a row owned by someone
-- else even by naming them.
do $$
declare t text;
begin
  foreach t in array array[
    'groups', 'players', 'courses', 'holes', 'rounds', 'round_players',
    'scores', 'junk', 'presses', 'wolf_picks', 'round_games', 'round_options',
    'round_teams', 'round_pairings', 'outing_field', 'outing_field_games',
    'outing_field_entrants'
  ]
  loop
    execute format('drop policy if exists "owner reads" on %I', t);
    execute format('create policy "owner reads" on %I for select using (owner_id = auth.uid())', t);
    execute format('drop policy if exists "owner writes" on %I', t);
    execute format('create policy "owner writes" on %I for insert with check (owner_id = auth.uid())', t);
    execute format('drop policy if exists "owner updates" on %I', t);
    execute format('create policy "owner updates" on %I for update using (owner_id = auth.uid()) with check (owner_id = auth.uid())', t);
    execute format('drop policy if exists "owner deletes" on %I', t);
    execute format('create policy "owner deletes" on %I for delete using (owner_id = auth.uid())', t);
  end loop;
end
$$;

-- Outings are the one thing two people can both see: the owner always, and
-- anyone who has joined with the code.
drop policy if exists "owner or member reads outings" on outings;
create policy "owner or member reads outings" on outings
  for select using (owner_id = auth.uid() or is_member(id));

drop policy if exists "owner writes outings" on outings;
create policy "owner writes outings" on outings
  for insert with check (owner_id = auth.uid());

drop policy if exists "owner updates outings" on outings;
create policy "owner updates outings" on outings
  for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists "owner deletes outings" on outings;
create policy "owner deletes outings" on outings
  for delete using (owner_id = auth.uid());

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
