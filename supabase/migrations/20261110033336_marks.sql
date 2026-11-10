-- Marks, backed up with the account (#296).
--
-- Where the bag's owner stood at their ball during a round, and what they were
-- about to hit from it (#295). A mark is its owner's alone, like the bag: no
-- outing shares it, so there is no guest policy, and nobody else ever sees one.
-- A guest's mark sits on the organiser's round, so `round_id` is not a foreign
-- key, and nor is `club_id`: a club can leave the bag on another phone first.

create table marks (
  id         text primary key check (length(id) between 1 and 100),
  owner_id   uuid not null default auth.uid() references auth.users (id) on delete no action,
  round_id   text not null check (length(round_id) between 1 and 100),
  -- The hole the Score screen was showing, from 1.
  hole       integer not null check (hole between 1 and 99),
  lat        double precision not null check (lat between -90 and 90),
  lng        double precision not null check (lng between -180 and 180),
  -- Metres, as the phone gave it; null where it didn't say. No upper bound: a
  -- wild fix is still kept with its accuracy, and refusing it would stall sync.
  accuracy_m double precision check (accuracy_m >= 0),
  -- Milliseconds since the epoch, as rounds keep their times.
  marked_at  bigint not null check (marked_at > 0),
  kind       text not null check (kind in ('full', 'partial', 'green')),
  -- The club hit, for a full swing, and only then.
  club_id    text check (length(club_id) between 1 and 100),
  check ((kind = 'full') = (club_id is not null))
);

create index marks_owner_idx on marks (owner_id);

alter table marks enable row level security;

create policy "owner reads" on marks for select using (owner_id = auth.uid());
create policy "owner writes" on marks for insert with check (owner_id = auth.uid());
create policy "owner updates" on marks for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "owner deletes" on marks for delete using (owner_id = auth.uid());

-- Deleting an account hands a row of its own under someone else's round to that
-- round's owner, so their card still adds up. It finds them by their `round_id`
-- column, which a mark has too: a guest's marks on the organiser's round would
-- have become the organiser's. A mark goes with its owner instead. The rest is as
-- 20261107142331_index_owner_and_moved_columns.sql left it.
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
  course_child text;
begin
  if target is null then
    raise exception 'delete_account_data needs an account';
  end if;

  -- A guest joining takes a lock on the outing row, so nobody can join between
  -- working out who holds what and the deletes. A new round or outing takes one on its group
  -- and course, so it waits here too, and is refused once they've gone. Its phone
  -- then reads its notices before it next pushes.
  perform 1 from groups where owner_id = target for update;
  perform 1 from courses where owner_id = target for update;
  perform 1 from outings o
  where o.owner_id = target
    or o.group_id in (select id from groups where owner_id = target)
    or o.course_id in (select id from courses where owner_id = target)
  for update;

  -- A row of this account's under someone else's round, outing, group or course becomes
  -- theirs, so their card still adds up: a score or junk claim typed there, and, from
  -- older builds, a press, a player or a hole note. Its own round or outing on someone
  -- else's goes with it, even in their outing. Read from the catalog, so a table added
  -- later with one of these columns can't be missed. A mark is the one exception: it
  -- stays its owner's, and goes with them.
  for hanging in
    select c.table_name, c.column_name, parent.table_name as parent_table
    from information_schema.columns c
    join (values
      ('group_id', 'groups'),
      ('course_id', 'courses'),
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
  -- group or course, or who's in someone else's outing on it. Nobody for a group or
  -- course of their own. Every player and tee, not only those on the phone: it ignores
  -- the rest. A notice can already be there if the same ids came back under a new
  -- account, and that mustn't stop this one deleting.
  with holders as (
    select m.user_id, o.id as outing_id, o.group_id, o.course_id
    from outing_members m
    join outings o on o.id = m.outing_id
    where o.owner_id = target and m.user_id <> target
    union
    select r.owner_id, o.id, o.group_id, o.course_id
    from rounds r
    join outings o on o.id = r.outing_id
    where o.owner_id = target and r.owner_id <> target
    union
    select kept.user_id, null, kept.group_id, kept.course_id
    from kept_by_others(target) kept
    union
    select m.user_id, null, g.id, c.id
    from outing_members m
    join outings o on o.id = m.outing_id
    left join groups g on g.id = o.group_id and g.owner_id = target
    left join courses c on c.id = o.course_id and c.owner_id = target
    where o.owner_id <> target and m.user_id <> target and (g.id is not null or c.id is not null)
    union
    select r.owner_id, null, g.id, c.id
    from rounds r
    left join outings o on o.id = r.outing_id
    left join groups g on g.id = r.group_id and g.owner_id = target
    left join courses c on c.id = r.course_id and c.owner_id = target
    where r.owner_id <> target and o.owner_id is distinct from target and (g.id is not null or c.id is not null)
  ), moved as (
    select user_id, 'outing' as kind, outing_id as from_id from holders where outing_id is not null
    union
    select h.user_id, 'group', g.id from holders h join groups g on g.id = h.group_id and g.owner_id <> h.user_id
    union
    select h.user_id, 'player', p.id
    from holders h
    join groups g on g.id = h.group_id and g.owner_id <> h.user_id
    join players p on p.group_id = g.id
    union
    select h.user_id, 'course', c.id from holders h join courses c on c.id = h.course_id and c.owner_id <> h.user_id
    union
    select h.user_id, 'tee', t.id
    from holders h
    join courses c on c.id = h.course_id and c.owner_id <> h.user_id
    join tees t on t.course_id = c.id
  )
  insert into move_notices (user_id, kind, from_id, to_id)
  select user_id, kind, from_id, case when kind = 'outing' then null else gen_random_uuid()::text end
  from moved
  on conflict do nothing;

  -- A course the server has no tees for reads back with a stand-in, its id built
  -- from the course's (`courseTees` in src/sync/rows.ts). A round can name it, and it
  -- would otherwise be the same on every guest's copy.
  insert into move_notices (user_id, kind, from_id, to_id)
  select n.user_id, 'tee', n.from_id || '_default', n.to_id || '_default'
  from move_notices n
  join courses c on c.id = n.from_id and c.owner_id = target
  where n.kind = 'course'
  on conflict do nothing;

  -- A copy for each group and course of this account's that someone's rows stay on,
  -- under the ids in their notices. Each row is the original with its ids and owner
  -- swapped, so a column added later comes too. `on conflict` for the same reason as
  -- above: those ids may already be theirs.
  for copying in
    select distinct kept.user_id, n.kind, n.from_id, n.to_id
    from kept_by_others(target) kept
    join move_notices n on n.user_id = kept.user_id
      and ((n.kind = 'group' and n.from_id = kept.group_id) or (n.kind = 'course' and n.from_id = kept.course_id))
  loop
    if copying.kind = 'group' then
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
    else
      insert into courses
      select copied.*
      from courses original,
        lateral jsonb_populate_record(original, jsonb_build_object('id', copying.to_id, 'owner_id', copying.user_id)) copied
      where original.id = copying.from_id
      on conflict do nothing;

      insert into tees
      select copied.*
      from tees original
      join move_notices tee on tee.user_id = copying.user_id and tee.kind = 'tee' and tee.from_id = original.id
      cross join lateral jsonb_populate_record(original, jsonb_build_object(
        'id', tee.to_id, 'owner_id', copying.user_id, 'course_id', copying.to_id)) copied
      where original.course_id = copying.from_id
      on conflict do nothing;

      insert into tee_holes
      select copied.*
      from tee_holes original
      join move_notices tee on tee.user_id = copying.user_id and tee.kind = 'tee' and tee.from_id = original.tee_id
      cross join lateral jsonb_populate_record(original, jsonb_build_object(
        'tee_id', tee.to_id, 'owner_id', copying.user_id, 'course_id', copying.to_id)) copied
      where original.course_id = copying.from_id
      on conflict do nothing;

      -- Named rather than read from the catalog: a table added later on a course
      -- shouldn't reach a guest without someone deciding it should.
      foreach course_child in array array['course_greens', 'course_features', 'course_hole_notes'] loop
        execute format(
          'insert into %I
           select copied.*
           from %I original,
             lateral jsonb_populate_record(original, jsonb_build_object(''owner_id'', $1::uuid, ''course_id'', $2)) copied
           where original.course_id = $3
           on conflict do nothing',
          course_child, course_child
        ) using copying.user_id, copying.to_id, copying.from_id;
      end loop;
    end if;
  end loop;

  -- A round or outing holds its course without a cascade, so these go first. A round
  -- in its outing goes with the day whoever owns it: outing_id isn't a foreign key.
  -- Before the rewrite below, which would point them at copies nobody made.
  delete from rounds where owner_id = target
    or outing_id in (select id from outings where owner_id = target);
  delete from outings where owner_id = target;

  -- Every column naming a moved id, on the rows of whoever the notice is for, as
  -- `applyMoveNotices` does on their phone. Only this account's ids, so an old notice
  -- can't point a row at a copy this didn't make. A cell belongs with its round, a
  -- round in an outing with that outing, and a field or a membership with its outing,
  -- whoever owns the row itself. A new column naming one of
  -- these has to be added here, in `applyMoveNotices`, and, for a player, to `known`
  -- above.
  departing_ids := array(
    select id from groups where owner_id = target
    union select id from players where owner_id = target
    union select id from courses where owner_id = target
    union select id from tees where owner_id = target
    union select id || '_default' from courses where owner_id = target
  );

  for pointer in
    select * from (values
      ('groups', 'you_id', 'player'),
      ('groups', 'default_course_id', 'course'),
      ('rounds', 'group_id', 'group'),
      ('rounds', 'course_id', 'course'),
      ('rounds', 'tee_id', 'tee'),
      ('outings', 'group_id', 'group'),
      ('outings', 'course_id', 'course'),
      ('round_players', 'player_id', 'player'),
      ('round_players', 'tee_id', 'tee'),
      ('round_players', 'handicap_tee_id', 'tee'),
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
