-- A guest's own rows survive the organiser's account going.
--
-- A round or outing a guest keeps on the departed account's group or course moves
-- to a copy of that group or course, under the new ids the guest's notices already
-- name. Each guest gets their own, so two can never collide, and nobody who didn't
-- need one gets one. Then every column naming a moved id is rewritten, the way the
-- phone rewrites its own when it applies the notices, so the two agree.
--
-- It still refuses while someone else's outing on those parents has a third account
-- in it, or a round of one, and any other row of someone else's hanging from them.

-- Someone else's rounds and outings that stay when this account goes, with whichever
-- of the group and course they're on is this account's. A round in this account's
-- own outing doesn't stay: it goes with the day, whoever owns it.
create function kept_by_others(target uuid)
returns table (user_id uuid, group_id text, course_id text)
language sql
stable
set search_path = public
as $$
  select distinct held.owner_id, g.id, c.id
  from (
    select r.owner_id, r.group_id, r.course_id
    from rounds r
    where r.owner_id <> target
      and not exists (select 1 from outings o where o.id = r.outing_id and o.owner_id = target)
    union all
    select o.owner_id, o.group_id, o.course_id
    from outings o
    where o.owner_id <> target
  ) held
  left join groups g on g.id = held.group_id and g.owner_id = target
  left join courses c on c.id = held.course_id and c.owner_id = target
  where g.id is not null or c.id is not null
$$;

revoke execute on function kept_by_others(uuid) from public, anon, authenticated;

create or replace function delete_account_data(target uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  hanging record;
  shared boolean;
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
  -- the check below and the deletes. A new round or outing takes one on its group
  -- and course, so it waits here too, and is refused once they've gone. Its phone
  -- then reads its notices before it next pushes.
  perform 1 from groups where owner_id = target for update;
  perform 1 from courses where owner_id = target for update;
  perform 1 from outings o
  where o.owner_id = target
    or o.group_id in (select id from groups where owner_id = target)
    or o.course_id in (select id from courses where owner_id = target)
  for update;

  -- The two tables a guest may write (GUEST_WRITES in src/sync/diff.ts). Before the
  -- check, which would otherwise read these as rows of this account's hanging from
  -- someone else's. A refusal rolls this back with everything else.
  update scores cell set owner_id = round.owner_id
  from rounds round
  where round.id = cell.round_id and cell.owner_id = target and round.owner_id <> target;

  update junk cell set owner_id = round.owner_id
  from rounds round
  where round.id = cell.round_id and cell.owner_id = target and round.owner_id <> target;

  shared := exists (
    select 1
    from outings o
    join groups g on g.id = o.group_id
    join courses c on c.id = o.course_id
    where o.owner_id = target and (g.owner_id <> target or c.owner_id <> target)
      and (
        exists (select 1 from outing_members m where m.outing_id = o.id and m.user_id <> target)
        or exists (select 1 from rounds r where r.outing_id = o.id and r.owner_id <> target)
      )
  );

  -- Rows either way round. Anyone's row under this account's round or outing goes
  -- with the day. Under its group or course, someone else's round or outing moves
  -- to their copy, unless a third account is in it. Anything else of someone else's
  -- there can't move. This account's row under someone else's can't either, unless
  -- it's its own round or outing on their group or course. Read from the catalog, so
  -- a table added later with one of these columns can't be missed.
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
    where c.table_schema = 'public'
  loop
    exit when shared;
    execute format(
      'select exists (select 1 from %I child join %I parent on parent.id = child.%I
        where child.owner_id <> parent.owner_id and %s)',
      hanging.table_name, hanging.parent_table, hanging.column_name,
      case
        when hanging.column_name in ('round_id', 'outing_id')
          then 'child.owner_id = $1'
        when hanging.table_name = 'rounds'
          then 'parent.owner_id = $1 and exists (select 1 from outings o where o.id = child.outing_id and o.owner_id not in ($1, child.owner_id))'
        when hanging.table_name = 'outings'
          then 'parent.owner_id = $1 and (
            exists (select 1 from outing_members m where m.outing_id = child.id and m.user_id not in ($1, child.owner_id))
            or exists (select 1 from rounds r where r.outing_id = child.id and r.owner_id <> child.owner_id))'
        else '$1 in (child.owner_id, parent.owner_id)'
      end
    ) into shared using target;
  end loop;

  if shared then
    raise exception 'This account shares data with another account'
      using errcode = 'PR001';
  end if;

  -- Everyone whose phone may hold the day: its members, and anyone with a round in
  -- it, as older builds could write. And anyone with rows that stay on this account's
  -- group or course. Every player and tee, not only those on the phone: it ignores
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
  ), moved as (
    select user_id, 'outing' as kind, outing_id as from_id from holders where outing_id is not null
    union
    select user_id, 'group', group_id from holders where group_id is not null
    union
    select h.user_id, 'player', p.id from holders h join players p on p.group_id = h.group_id
    union
    select user_id, 'course', course_id from holders where course_id is not null
    union
    select h.user_id, 'tee', t.id from holders h join tees t on t.course_id = h.course_id
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

      -- Only the players they could already read, or that their own rows name. The
      -- rest of the roster is the departed account's, and goes with it.
      with their_rounds as (
        select id from rounds where owner_id = copying.user_id
      ), their_outings as (
        select id from outings where owner_id = copying.user_id
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
      where original.group_id = copying.from_id and original.id in (select id from known)
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
  -- can't point a row at a copy this didn't make. A cell belongs with its round, and
  -- a field with its outing, whoever owns the row itself. A new column naming one of
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
        when pointer.table_name in ('groups', 'rounds', 'outings') then 't.owner_id'
        when pointer.table_name = 'outing_members' then 't.user_id'
        when pointer.table_name like 'outing_%' then '(select o.owner_id from outings o where o.id = t.outing_id)'
        else '(select r.owner_id from rounds r where r.id = t.round_id)'
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
