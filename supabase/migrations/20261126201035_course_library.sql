-- One course for everyone (#378, docs/adr/0001-one-course-record-with-versions.md).
--
-- A course stops being its creator's alone. Every signed-in account reads every
-- course, with its tees, cards, greens and map: the course library. Writing it
-- stays with whoever created it until changes open to every golfer (#381), and
-- the creator is kept on each row for the edit history only. A course holds no
-- personal data, so deleting an account no longer copies or moves its courses:
-- they stay, with the creator cleared. Hole notes are still their author's
-- (#380 settles who reads them), so they keep their own rules here.
--
-- The switch starts from a clean server, before launch, so no per-account copy
-- of the same course is carried into the library. Everything that hangs off a
-- course goes: courses, tees, cards, greens, map, hole notes, outings, rounds
-- and everything on them, and the marks made in those rounds. Accounts, groups,
-- rosters, players and the bag stay. A backup of the hosted database is taken
-- by hand before this runs, and the app clears its own copy once when it first
-- opens on this version.

-- ── The fresh start ─────────────────────────────────────────────────────────
-- `where true` so it reads as meant. Children before parents: a round holds its
-- course and an outing holds its group and course without a cascade.

delete from mutations where true;
delete from scores where true;
delete from junk where true;
delete from presses where true;
delete from wolf_picks where true;
delete from round_games where true;
delete from round_options where true;
delete from round_teams where true;
delete from round_pairings where true;
delete from round_players where true;
delete from marks where true;
delete from rounds where true;
delete from outing_members where true;
delete from outing_field_entrants where true;
delete from outing_field_games where true;
delete from outing_field where true;
delete from outings where true;
update groups set default_course_id = null where default_course_id is not null;
delete from course_hole_notes where true;
delete from course_features where true;
delete from course_greens where true;
delete from tee_holes where true;
delete from tees where true;
delete from courses where true;
-- A course or tee never moves again, and every outing a notice named has gone.
delete from move_notices where kind in ('course', 'tee', 'outing');

alter table move_notices drop constraint move_notices_kind_check;
alter table move_notices add constraint move_notices_kind_check check (kind in ('group', 'player', 'outing'));

-- ── The course library ──────────────────────────────────────────────────────

-- Where the course is, for telling two of the same name apart. Both or neither;
-- new courses will need one (#383).
alter table courses
  add column lat double precision check (lat between -90 and 90),
  add column lng double precision check (lng between -180 and 180),
  add constraint courses_location_check check ((lat is null) = (lng is null));

-- The creator, kept for the history. Null once their account has gone; the
-- course stays for everyone else.
alter table courses         alter column owner_id drop not null;
alter table tees            alter column owner_id drop not null;
alter table tee_holes       alter column owner_id drop not null;
alter table course_greens   alter column owner_id drop not null;
alter table course_features alter column owner_id drop not null;

drop policy "owner reads" on courses;
drop policy "guests read shared courses" on courses;
drop policy "owner reads" on tees;
drop policy "guests read shared tees" on tees;
drop policy "owner reads" on tee_holes;
drop policy "guests read shared tees" on tee_holes;
drop policy "owner reads" on course_greens;
drop policy "guests read shared greens" on course_greens;
drop policy "owner reads" on course_features;
drop policy "guests read shared features" on course_features;

do $$
declare t text;
begin
  foreach t in array array['courses', 'tees', 'tee_holes', 'course_greens', 'course_features'] loop
    execute format('create policy "signed in reads the library" on %I for select to authenticated using (true)', t);
  end loop;
end
$$;

-- A round or outing may be played on any course in the library. The group and
-- the day are still checked as before.
drop policy "owner writes outings" on outings;
drop policy "owner updates outings" on outings;
create policy "owner writes outings" on outings for insert
  with check (owner_id = auth.uid() and (owns_group(group_id) or shared_group(group_id)));
create policy "owner updates outings" on outings for update
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid() and (owns_group(group_id) or shared_group(group_id)));

drop policy "owner writes" on rounds;
drop policy "owner updates" on rounds;
create policy "owner writes" on rounds for insert
  with check (
    owner_id = auth.uid() and (owns_group(group_id) or shared_group(group_id))
    and (outing_id is null or owns_outing(outing_id))
  );
create policy "owner updates" on rounds for update
  using (owner_id = auth.uid())
  with check (
    owner_id = auth.uid() and (owns_group(group_id) or shared_group(group_id))
    and (outing_id is null or owns_outing(outing_id))
  );

-- ── Deleting an account ─────────────────────────────────────────────────────

-- Who keeps rows on this account's groups: courses are nobody's to keep now.
-- The same columns as before, so its callers are unchanged; `course_id` is
-- always null.
create or replace function kept_by_others(target uuid)
returns table (user_id uuid, group_id text, course_id text)
language sql
stable
set search_path = public
as $$
  select distinct held.owner_id, g.id, null::text
  from (
    select coalesce(o.owner_id, r.owner_id) as owner_id, r.group_id
    from rounds r
    left join outings o on o.id = r.outing_id
    where r.owner_id <> target and o.owner_id is distinct from target
    union all
    select o.owner_id, o.group_id
    from outings o
    where o.owner_id <> target
  ) held
  join groups g on g.id = held.group_id and g.owner_id = target
$$;

-- As 20261110033336_marks.sql left it, less everything about courses and tees:
-- this account's courses stay where they are, with their creator cleared, and its
-- hole notes go with it. No notice names a course or tee, and none is copied.
create or replace function delete_account_data(target uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  hanging record;
  copying record;
  pointer record;
  departing_ids text[];
  owned record;
begin
  if target is null then
    raise exception 'delete_account_data needs an account';
  end if;

  -- A guest joining takes a lock on the outing row, so nobody can join between
  -- working out who holds what and the deletes. A new round or outing takes one on its
  -- group, so it waits here too, and is refused once it has gone. Its phone then reads
  -- its notices before it next pushes.
  perform 1 from groups where owner_id = target for update;
  perform 1 from outings o
  where o.owner_id = target
    or o.group_id in (select id from groups where owner_id = target)
  for update;

  -- The library keeps this account's courses for everyone. Before anything below
  -- reads an owner, so no step takes them for this account's.
  update courses set owner_id = null where owner_id = target;
  update tees set owner_id = null where owner_id = target;
  update tee_holes set owner_id = null where owner_id = target;
  update course_greens set owner_id = null where owner_id = target;
  update course_features set owner_id = null where owner_id = target;

  -- A row of this account's under someone else's round, outing or group becomes
  -- theirs, so their card still adds up: a score or junk claim typed there, and, from
  -- older builds, a press or a player. Its own round or outing on someone else's goes
  -- with it, even in their outing. Read from the catalog, so a table added later with
  -- one of these columns can't be missed. A mark stays its owner's, and goes with them,
  -- and so does a hole note: a course is nobody's now, so it has no one to pass to.
  for hanging in
    select c.table_name, c.column_name, parent.table_name as parent_table
    from information_schema.columns c
    join (values
      ('group_id', 'groups'),
      ('round_id', 'rounds'),
      ('outing_id', 'outings')
    ) as parent (column_name, table_name) on parent.column_name = c.column_name
    join information_schema.columns owner_column
      on owner_column.table_schema = c.table_schema
     and owner_column.table_name = c.table_name
     and owner_column.column_name = 'owner_id'
    where c.table_schema = 'public' and c.table_name not in ('rounds', 'outings', 'marks')
  loop
    execute format(
      'update %I child set owner_id = parent.owner_id from %I parent
       where parent.id = child.%I and child.owner_id = $1 and parent.owner_id <> $1',
      hanging.table_name, hanging.parent_table, hanging.column_name
    ) using target;
  end loop;

  -- Everyone whose phone may hold the day: its members, and anyone with a round in
  -- it, as older builds could write. And anyone with rows that stay on this account's
  -- group, or who's in someone else's outing on it. Nobody for a group of their own.
  -- Every player, not only those on the phone: it ignores the rest. A notice can
  -- already be there if the same ids came back under a new account, and that mustn't
  -- stop this one deleting.
  with holders as (
    select m.user_id, o.id as outing_id, o.group_id
    from outing_members m
    join outings o on o.id = m.outing_id
    where o.owner_id = target and m.user_id <> target
    union
    select r.owner_id, o.id, o.group_id
    from rounds r
    join outings o on o.id = r.outing_id
    where o.owner_id = target and r.owner_id <> target
    union
    select kept.user_id, null, kept.group_id
    from kept_by_others(target) kept
    union
    select m.user_id, null, g.id
    from outing_members m
    join outings o on o.id = m.outing_id
    join groups g on g.id = o.group_id and g.owner_id = target
    where o.owner_id <> target and m.user_id <> target
    union
    select r.owner_id, null, g.id
    from rounds r
    left join outings o on o.id = r.outing_id
    join groups g on g.id = r.group_id and g.owner_id = target
    where r.owner_id <> target and o.owner_id is distinct from target
  ), moved as (
    select user_id, 'outing' as kind, outing_id as from_id from holders where outing_id is not null
    union
    select h.user_id, 'group', g.id from holders h join groups g on g.id = h.group_id and g.owner_id <> h.user_id
    union
    select h.user_id, 'player', p.id
    from holders h
    join groups g on g.id = h.group_id and g.owner_id <> h.user_id
    join players p on p.group_id = g.id
  )
  insert into move_notices (user_id, kind, from_id, to_id)
  select user_id, kind, from_id, case when kind = 'outing' then null else gen_random_uuid()::text end
  from moved
  on conflict do nothing;

  -- A copy for each group of this account's that someone's rows stay on, under the
  -- ids in their notices. Each row is the original with its ids and owner swapped, so
  -- a column added later comes too. `on conflict` for the same reason as above: those
  -- ids may already be theirs.
  for copying in
    select distinct kept.user_id, n.from_id, n.to_id
    from kept_by_others(target) kept
    join move_notices n on n.user_id = kept.user_id and n.kind = 'group' and n.from_id = kept.group_id
  loop
    insert into groups
    select copied.*
    from groups original,
      lateral jsonb_populate_record(original, jsonb_build_object('id', copying.to_id, 'owner_id', copying.user_id)) copied
    where original.id = copying.from_id
    on conflict do nothing;

    -- Only the players they could already read, that their own rows name, or that
    -- they added themselves. The rest of the roster is the departed account's, and
    -- goes with it.
    with their_outings as (
      select id from outings where owner_id = copying.user_id
    ), their_rounds as (
      select id from rounds where owner_id = copying.user_id
      union select id from rounds where outing_id in (select id from their_outings)
    ), known (id) as (
      select f.player_id from outing_field f join outing_members m on m.outing_id = f.outing_id where m.user_id = copying.user_id
      union select player_id from outing_members where user_id = copying.user_id
      union select player_id from outing_field where outing_id in (select id from their_outings)
      union select player_id from outing_field_entrants where outing_id in (select id from their_outings)
      union select player_id from round_players where round_id in (select id from their_rounds)
      union select player_id from scores where round_id in (select id from their_rounds)
      union select player_id from junk where round_id in (select id from their_rounds)
      union select by_player from presses where round_id in (select id from their_rounds)
      union select against_player from presses where round_id in (select id from their_rounds)
      union select wolf from wolf_picks where round_id in (select id from their_rounds)
      union select partner from wolf_picks where round_id in (select id from their_rounds)
      union select player_a from round_teams where round_id in (select id from their_rounds)
      union select player_b from round_teams where round_id in (select id from their_rounds)
      union select player_a from round_pairings where round_id in (select id from their_rounds)
      union select player_b from round_pairings where round_id in (select id from their_rounds)
    )
    insert into players
    select copied.*
    from players original
    join move_notices player on player.user_id = copying.user_id and player.kind = 'player' and player.from_id = original.id
    cross join lateral jsonb_populate_record(original, jsonb_build_object(
      'id', player.to_id, 'owner_id', copying.user_id, 'group_id', copying.to_id)) copied
    where original.group_id = copying.from_id
      and (original.owner_id = copying.user_id or original.id in (select id from known))
    on conflict do nothing;
  end loop;

  -- A round or outing holds its group without a cascade, so these go first. A round
  -- in its outing goes with the day whoever owns it: outing_id isn't a foreign key.
  -- Before the rewrite below, which would point them at copies nobody made.
  delete from rounds where owner_id = target
    or outing_id in (select id from outings where owner_id = target);
  delete from outings where owner_id = target;

  -- Every column naming a moved id, on the rows of whoever the notice is for, as
  -- `applyMoveNotices` does on their phone. Only this account's ids, so an old notice
  -- can't point a row at a copy this didn't make. A cell belongs with its round, a
  -- round in an outing with that outing, and a field or a membership with its outing,
  -- whoever owns the row itself. A new column naming one of these has to be added
  -- here, in `applyMoveNotices`, and, for a player, to `known` above.
  departing_ids := array(
    select id from groups where owner_id = target
    union select id from players where owner_id = target
  );

  for pointer in
    select * from (values
      ('groups', 'you_id', 'player'),
      ('rounds', 'group_id', 'group'),
      ('outings', 'group_id', 'group'),
      ('round_players', 'player_id', 'player'),
      ('scores', 'player_id', 'player'),
      ('junk', 'player_id', 'player'),
      ('presses', 'by_player', 'player'),
      ('presses', 'against_player', 'player'),
      ('wolf_picks', 'wolf', 'player'),
      ('wolf_picks', 'partner', 'player'),
      ('round_teams', 'player_a', 'player'),
      ('round_teams', 'player_b', 'player'),
      ('round_pairings', 'player_a', 'player'),
      ('round_pairings', 'player_b', 'player'),
      ('outing_field', 'player_id', 'player'),
      ('outing_field_entrants', 'player_id', 'player'),
      ('outing_members', 'player_id', 'player')
    ) as naming (table_name, column_name, kind)
  loop
    execute format(
      'update %1$I t set %2$I = notice.to_id
       from move_notices notice
       where notice.kind = %3$L and notice.from_id = t.%2$I and notice.from_id = any($1) and notice.user_id = %4$s',
      pointer.table_name, pointer.column_name, pointer.kind,
      case
        when pointer.table_name in ('groups', 'outings') then 't.owner_id'
        when pointer.table_name = 'rounds' then 'coalesce((select o.owner_id from outings o where o.id = t.outing_id), t.owner_id)'
        when pointer.table_name like 'outing_%' then '(select o.owner_id from outings o where o.id = t.outing_id)'
        else '(select coalesce(o.owner_id, r.owner_id) from rounds r left join outings o on o.id = r.outing_id where r.id = t.round_id)'
      end
    ) using departing_ids;
  end loop;

  for owned in
    select c.table_name
    from information_schema.columns c
    join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
    where c.table_schema = 'public' and c.column_name = 'owner_id' and t.table_type = 'BASE TABLE'
  loop
    execute format('delete from %I where owner_id = $1', owned.table_name) using target;
  end loop;

  delete from outing_members where user_id = target;
  delete from mutations where user_id = target;
  delete from move_notices where user_id = target;
end
$$;
