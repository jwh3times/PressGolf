-- Every row must belong to an account that exists.
--
-- A deleted account's access token stays valid for up to an hour, and the policies
-- only compare a row with the token. Without these keys, a forgotten second phone
-- could put the whole season back under an account that's gone, because a phone
-- wins on first contact.
--
-- They also make Supabase refuse to delete an auth user who still has rows, so a
-- dashboard deletion can't skip delete_account_data and leave orphans.
--
-- `not valid` so a row already orphaned on production can't fail this migration.
-- It's still enforced from now on, for new rows and for deleting a user.
--
-- A new table needs its own key: rls-test.sql fails until it has one.

do $$
declare
  holder record;
begin
  for holder in
    select c.table_name, c.column_name
    from information_schema.columns c
    join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
    where c.table_schema = 'public' and c.column_name in ('owner_id', 'user_id') and t.table_type = 'BASE TABLE'
  loop
    execute format(
      'alter table %I add constraint %I foreign key (%I) references auth.users (id) on delete no action not valid',
      holder.table_name, holder.table_name || '_' || holder.column_name || '_fkey', holder.column_name
    );
  end loop;
end
$$;
