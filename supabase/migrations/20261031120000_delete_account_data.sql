-- Clearing an account's rows off the server, before its auth user is deleted.
--
-- The delete-account Edge Function calls this with the service role, once it has
-- verified the token and the password, and a maintainer runs it by hand for an
-- emailed request (docs/development.md). It runs as one transaction, so it either
-- clears everything or nothing, and running it again finds nothing to do.
--
-- It refuses an account that shares anything with another account, since removing
-- those rows would take someone else's data with them. Re-homing those rows is
-- still to come.

create function delete_account_data(target uuid)
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

  -- Memberships either way round: a guest in an outing this account organised,
  -- or this account in someone else's.
  shared := exists (
    select 1
    from outing_members m
    join outings o on o.id = m.outing_id
    where m.user_id <> o.owner_id and target in (m.user_id, o.owner_id)
  );

  -- Rows either way round: anyone's row hanging from something of this account's,
  -- or this account's row hanging from something of someone else's. Read from the
  -- catalog, so a table added later can't be missed.
  for hanging in
    select c.table_name, c.column_name, parent.table_name as parent_table
    from information_schema.columns c
    join (values
      ('group_id', 'groups'),
      ('course_id', 'courses'),
      ('round_id', 'rounds'),
      ('outing_id', 'outings')
    ) as parent (column_name, table_name) on parent.column_name = c.column_name
    join information_schema.columns o
      on o.table_schema = c.table_schema and o.table_name = c.table_name and o.column_name = 'owner_id'
    where c.table_schema = 'public'
  loop
    exit when shared;
    execute format(
      'select exists (select 1 from %I child join %I parent on parent.id = child.%I
        where child.owner_id <> parent.owner_id and $1 in (child.owner_id, parent.owner_id))',
      hanging.table_name, hanging.parent_table, hanging.column_name
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

-- Supabase grants new functions to its API roles by default, which would let any
-- signed-in phone clear any account by naming it.
revoke execute on function delete_account_data(uuid) from public, anon, authenticated;
grant execute on function delete_account_data(uuid) to service_role;
