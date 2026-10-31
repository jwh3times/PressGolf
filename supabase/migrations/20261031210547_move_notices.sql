-- An organiser can delete their account, and guests keep the day on their phones.
--
-- The whole day leaves the server: group, course, rounds, cards including the
-- scores guests typed, every membership and the edit log. A guest's phone would
-- then read those rows as its own and upload them, so the clean-up leaves it a
-- notice for each thing it holds. For a group, player, course or tee, the notice
-- names a new id for this guest to use, so that guests can never collide. For an
-- outing, it has none: it's gone from the server, and the phone keeps its copy.
--
-- It still refuses an organiser with a guest who has a round or outing of their own
-- on the organiser's group or course, and any other row of someone else's hanging
-- from those. It also refuses one with a guest in an outing on someone else's group
-- or course. The guest's phone can't keep a copy of those without moving it from
-- under another outing they share, and a notice stays, so it would keep applying.

create table move_notices (
  user_id    uuid not null default auth.uid() references auth.users (id),
  kind       text not null check (kind in ('group', 'player', 'course', 'tee', 'outing')),
  from_id    text not null,
  to_id      text,
  created_at timestamptz not null default now(),
  primary key (user_id, kind, from_id),
  check ((kind = 'outing') = (to_id is null))
);

-- Nothing can write one from the client: the clean-up runs as the definer.
alter table move_notices enable row level security;

create policy "read your own notices" on move_notices for select using (user_id = auth.uid());

create or replace function delete_account_data(target uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  hanging record;
  shared boolean;
  owned record;
begin
  if target is null then
    raise exception 'delete_account_data needs an account';
  end if;

  -- A guest joining takes a lock on the outing row, so nobody can join between
  -- the check below and the deletes.
  perform 1 from outings where owner_id = target for update;

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
    from outing_members m
    join outings o on o.id = m.outing_id
    join groups g on g.id = o.group_id
    join courses c on c.id = o.course_id
    where o.owner_id = target and m.user_id <> target
      and (g.owner_id <> target or c.owner_id <> target)
  );

  -- Rows either way round. Anyone's row under this account's round or outing goes
  -- with the day. Under its group or course, one of someone else's can't, unless
  -- it's a round in this account's own outing. This account's row under someone
  -- else's can't either, unless it's its own round or outing on their group or
  -- course. Read from the catalog, so a table added later with one of these columns
  -- can't be missed.
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
          then 'parent.owner_id = $1 and not exists (select 1 from outings o where o.id = child.outing_id and o.owner_id = $1)'
        when hanging.table_name = 'outings'
          then 'parent.owner_id = $1'
        else '$1 in (child.owner_id, parent.owner_id)'
      end
    ) into shared using target;
  end loop;

  if shared then
    raise exception 'This account shares data with another account'
      using errcode = 'PR001';
  end if;

  insert into move_notices (user_id, kind, from_id)
  select m.user_id, 'outing', o.id
  from outing_members m
  join outings o on o.id = m.outing_id
  where o.owner_id = target and m.user_id <> target;

  -- Every player and tee, not only those on the guest's phone: it ignores the rest.
  with holders as (
    select distinct m.user_id, o.group_id, o.course_id
    from outing_members m
    join outings o on o.id = m.outing_id
    where o.owner_id = target and m.user_id <> target
  ), moved as (
    select user_id, 'group' as kind, group_id as from_id from holders
    union
    select h.user_id, 'player', p.id from holders h join players p on p.group_id = h.group_id
    union
    select user_id, 'course', course_id from holders
    union
    select h.user_id, 'tee', t.id from holders h join tees t on t.course_id = h.course_id
  )
  insert into move_notices (user_id, kind, from_id, to_id)
  select user_id, kind, from_id, gen_random_uuid()::text from moved;

  -- A round or outing holds its course without a cascade, so these go first. A round
  -- in its outing goes with the day whoever owns it: outing_id isn't a foreign key.
  delete from rounds where owner_id = target
    or outing_id in (select id from outings where owner_id = target);
  delete from outings where owner_id = target;

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
