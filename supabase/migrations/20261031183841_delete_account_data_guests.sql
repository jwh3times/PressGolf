-- A guest can delete their account, and the organiser keeps their scores.
--
-- Scores and junk an account typed on someone else's round now take that round's
-- owner, so the day's money still adds up, and a membership in someone else's
-- outing no longer stops the deletion. A round or outing of its own, played on
-- someone else's group or course, goes with it: that takes nothing of theirs.
--
-- It still refuses an account with guests in an outing it organised, anyone's row
-- hanging from something of its own, and any other row of its own hanging from
-- something of someone else's. The policies have refused those last ones since
-- writes_under_your_own, so any that exist are older, and part of someone's day.

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
    where o.owner_id = target and m.user_id <> target
  );

  -- Rows either way round: anyone's row hanging from something of this account's,
  -- or this account's row hanging from something of someone else's, unless it's
  -- its own round or outing on their group or course. Read from the catalog, so a
  -- table added later with one of these columns can't be missed.
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
        when hanging.table_name in ('rounds', 'outings') and hanging.column_name in ('group_id', 'course_id')
          then 'parent.owner_id = $1'
        else '$1 in (child.owner_id, parent.owner_id)'
      end
    ) into shared using target;
  end loop;

  if shared then
    raise exception 'This account shares data with another account'
      using errcode = 'PR001';
  end if;

  -- A round or outing holds its course without a cascade, so these go first.
  delete from rounds where owner_id = target;
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
end
$$;
