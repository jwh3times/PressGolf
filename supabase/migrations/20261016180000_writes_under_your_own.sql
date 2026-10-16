-- Every write lands under something of the writer's own.
--
-- A row hangs from a group, course, outing or round, and the owner policies
-- check the row's owner_id. They now check its parent's owner as well, the
-- way course_hole_notes already did: a player goes on your own roster, a tee
-- or green on your own course, a press or side game in your own round, a field
-- in your own outing.
--
-- A round or outing of your own may still be on a group or course shared with
-- you through an outing, since a guest's phone holds the organiser's group and
-- course and may play them again. Guests keep writing cells and junk on a
-- shared card through the "guests score shared" policies, unchanged here.
--
-- Rows already on the server aren't touched. A write checks only the row it
-- leaves behind.

create or replace function owns_group(target text)
returns boolean
language sql stable security definer set search_path = public
as $$ select exists (select 1 from groups where id = target and owner_id = auth.uid()); $$;

create or replace function owns_course(target text)
returns boolean
language sql stable security definer set search_path = public
as $$ select exists (select 1 from courses where id = target and owner_id = auth.uid()); $$;

create or replace function owns_tee(target text)
returns boolean
language sql stable security definer set search_path = public
as $$ select exists (select 1 from tees where id = target and owner_id = auth.uid()); $$;

create or replace function owns_outing(target text)
returns boolean
language sql stable security definer set search_path = public
as $$ select exists (select 1 from outings where id = target and owner_id = auth.uid()); $$;

create or replace function owns_round(target text)
returns boolean
language sql stable security definer set search_path = public
as $$ select exists (select 1 from rounds where id = target and owner_id = auth.uid()); $$;

-- A field may name a player of your own, one shared with you, or one since
-- removed from their roster: a finished outing keeps its field.
create or replace function may_field(target text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from players where id = target and owner_id = auth.uid())
      or shared_player(target)
      or not exists (select 1 from players where id = target);
$$;

-- ── The owner policies, rewritten with the parent check ───────────────────────

do $$
declare
  rule record;
begin
  for rule in
    select * from (values
      ('players',               'owns_group(group_id)'),
      ('tees',                  'owns_course(course_id)'),
      ('tee_holes',             'owns_course(course_id) and owns_tee(tee_id)'),
      ('course_greens',         'owns_course(course_id)'),
      ('course_features',       'owns_course(course_id)'),
      ('course_hole_notes',     'owns_course(course_id)'),
      ('outings',               '(owns_group(group_id) or shared_group(group_id)) and (owns_course(course_id) or shared_course(course_id))'),
      ('outing_field',          'owns_outing(outing_id) and may_field(player_id)'),
      ('outing_field_games',    'owns_outing(outing_id)'),
      ('outing_field_entrants', 'owns_outing(outing_id)'),
      ('rounds',                '(owns_group(group_id) or shared_group(group_id)) and (owns_course(course_id) or shared_course(course_id)) and (outing_id is null or owns_outing(outing_id))'),
      ('round_players',         'owns_round(round_id)'),
      ('scores',                'owns_round(round_id)'),
      ('junk',                  'owns_round(round_id)'),
      ('presses',               'owns_round(round_id)'),
      ('wolf_picks',            'owns_round(round_id)'),
      ('round_games',           'owns_round(round_id)'),
      ('round_options',         'owns_round(round_id)'),
      ('round_teams',           'owns_round(round_id)'),
      ('round_pairings',        'owns_round(round_id)')
    ) as t (tbl, parent)
  loop
    -- outings names its owner policies apart from the rest.
    if rule.tbl = 'outings' then
      execute 'drop policy if exists "owner writes outings" on outings';
      execute 'drop policy if exists "owner updates outings" on outings';
      execute format('create policy "owner writes outings" on outings for insert with check (owner_id = auth.uid() and %s)', rule.parent);
      execute format('create policy "owner updates outings" on outings for update using (owner_id = auth.uid()) with check (owner_id = auth.uid() and %s)', rule.parent);
    else
      execute format('drop policy if exists "owner writes" on %I', rule.tbl);
      execute format('drop policy if exists "owner updates" on %I', rule.tbl);
      execute format('create policy "owner writes" on %I for insert with check (owner_id = auth.uid() and %s)', rule.tbl, rule.parent);
      execute format('create policy "owner updates" on %I for update using (owner_id = auth.uid()) with check (owner_id = auth.uid() and %s)', rule.tbl, rule.parent);
    end if;
  end loop;
end $$;

-- ── Membership ────────────────────────────────────────────────────────────────
-- A guest joins with a code, through join_outing. The one membership written
-- directly is the organiser's own, when sharing.

drop policy if exists "join an outing" on outing_members;
create policy "join an outing" on outing_members for insert
  with check (user_id = auth.uid() and owns_outing(outing_id));

drop policy if exists "update your own membership" on outing_members;
create policy "update your own membership" on outing_members for update
  using (user_id = auth.uid()) with check (user_id = auth.uid() and owns_outing(outing_id));
