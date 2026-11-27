-- Changes to a course from any golfer, and suggestions the admin approves (#381, ADR 0001).
--
-- A course's creator, and the admin, change it directly, as before: each change that
-- scores a round makes a new course version on the phone (#377). Everyone else goes
-- through `edit_course`, never the course tables, whose row-level security stays the
-- creator's:
--
--   * filling a value nobody set (a slope, a rating, the location, a green with no
--     position) and adding a tee go straight in;
--   * changing a value someone set becomes a suggestion, which only the admin approves
--     or declines.
--
-- Anything the server changes on a course moves it to a new version first, a rename
-- included, archiving the tees as they stood. A phone takes the server's copy of a
-- course whose version is newer than its own, the creator's phone too, so its next
-- sync can't put the old values back.
--
-- A change is one jsonb object, with the value it replaces in `from` and the new one
-- in `to`:
--
--   { kind: 'course', field: 'name' | 'location', from, to }        location: {lat, lng} or null
--   { kind: 'tee', tee, field: 'name' | 'slope' | 'rating', from, to }
--   { kind: 'hole', tee, number, field: 'par' | 'strokeIndex' | 'yards', from, to }
--   { kind: 'green', number, from, to }                               a green: {middle, front, back, source}
--   { kind: 'newTee', tee: {id, name, slope, rating, holes: [{number, par, strokeIndex, yards}]} }
--
-- Suggestions are online only: the app sends one with signal and reads its status
-- back. Nothing about them is in the offline snapshot.

-- ── The admin ───────────────────────────────────────────────────────────────

-- Granted by hand, with the service role (docs/development.md § The admin). Named
-- `account`, not `user_id`: deleting the account simply removes the role.
create table admins (
  account    uuid primary key references auth.users (id) on delete cascade,
  granted_at timestamptz not null default now()
);

alter table admins enable row level security;
create policy "read your own role" on admins for select to authenticated using (account = auth.uid());

create or replace function is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$ select exists (select 1 from admins where account = auth.uid()); $$;

-- ── Suggestions ─────────────────────────────────────────────────────────────

create table course_suggestions (
  id         text primary key check (length(id) between 1 and 100),
  course_id  text not null references courses (id) on delete cascade,
  owner_id   uuid not null default auth.uid() references auth.users (id) on delete no action,
  changes    jsonb not null check (jsonb_typeof(changes) = 'array' and jsonb_array_length(changes) between 1 and 500),
  status     text not null default 'waiting' check (status in ('waiting', 'approved', 'declined')),
  -- The admin's one line, with a decline.
  reason     text check (length(reason) between 1 and 200),
  -- Why the last approval was refused: a value changed since the suggestion was made.
  conflict   text check (length(conflict) between 1 and 300),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  check ((status = 'declined') = (reason is not null))
);

create index course_suggestions_owner_idx on course_suggestions (owner_id);
create index course_suggestions_waiting_idx on course_suggestions (created_at) where status = 'waiting';

-- Read by whoever made it, and the admin. Only these functions write them.
alter table course_suggestions enable row level security;
create policy "read your own, or every one as the admin" on course_suggestions for select to authenticated
  using (owner_id = auth.uid() or is_admin());

-- ── Applying changes ────────────────────────────────────────────────────────

-- The server archives a course's tees itself now, and a course can reach it with none:
-- the phone stands one in (`courseTees` in src/sync/rows.ts). An empty archive is that.
alter table course_versions drop constraint course_versions_tees_check;
alter table course_versions add constraint course_versions_tees_check
  check (jsonb_typeof(tees) = 'array' and jsonb_array_length(tees) between 0 and 50);

-- A course's tees as the phone keeps them, for the archive.
create or replace function course_tees_json(target text)
returns jsonb
language sql stable set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', t.id, 'name', t.name, 'slope', t.slope, 'rating', t.rating,
    'holes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'number', h.number, 'par', h.par, 'strokeIndex', h.stroke_index, 'yards', h.yards) order by h.number)
      from tee_holes h where h.tee_id = t.id), '[]'::jsonb)
  ) order by t.sort_order, t.id), '[]'::jsonb)
  from tees t where t.course_id = target;
$$;

-- Archives the course's tees under its version and moves it to the next. Every server
-- change to a course goes through here first.
create or replace function next_course_version(target text)
returns void
language plpgsql set search_path = public
as $$
declare
  course record;
begin
  select * into course from courses where id = target for update;
  insert into course_versions (course_id, owner_id, version, tees)
  values (target, course.owner_id, course.version, course_tees_json(target))
  on conflict (course_id, version) do nothing;
  update courses set version = course.version + 1 where id = target;
end
$$;

-- A json value, with json null as SQL null, so two can be compared with `is not distinct from`.
-- Not `json_value`: Postgres 17 has a SQL/JSON function of that name.
create or replace function json_or_null(value jsonb)
returns jsonb
language sql immutable
as $$ select nullif(value, 'null'::jsonb); $$;

-- What a change finds there now, as its `from` would hold it. Null when the thing it
-- names doesn't exist.
create or replace function course_value(target text, change jsonb)
returns jsonb
language plpgsql stable set search_path = public
as $$
declare
  found jsonb;
begin
  case change ->> 'kind'
    when 'course' then
      select case change ->> 'field'
          when 'name' then to_jsonb(c.name)
          when 'location' then case when c.lat is null then null else jsonb_build_object('lat', c.lat, 'lng', c.lng) end
        end into found
      from courses c where c.id = target;
    when 'tee' then
      select case change ->> 'field'
          when 'name' then to_jsonb(t.name)
          when 'slope' then to_jsonb(t.slope)
          when 'rating' then to_jsonb(t.rating)
        end into found
      from tees t where t.id = change ->> 'tee' and t.course_id = target;
    when 'hole' then
      select case change ->> 'field'
          when 'par' then to_jsonb(h.par)
          when 'strokeIndex' then to_jsonb(h.stroke_index)
          when 'yards' then to_jsonb(h.yards)
        end into found
      from tee_holes h where h.tee_id = change ->> 'tee' and h.course_id = target and h.number = (change ->> 'number')::int;
    when 'green' then
      select jsonb_build_object('lat', g.middle_lat, 'lng', g.middle_lng) into found
      from course_greens g where g.course_id = target and g.number = (change ->> 'number')::int;
    else
      found := null;
  end case;
  return found;
end
$$;

-- Whether a change's `from` still holds. A green compares only its middle.
create or replace function change_holds(target text, change jsonb)
returns boolean
language sql stable set search_path = public
as $$
  select change ->> 'kind' = 'newTee'
    or course_value(target, change) is not distinct from json_or_null(
      case when change ->> 'kind' = 'green' then change #> '{from,middle}' else change -> 'from' end
    );
$$;

-- Whether a change fills a gap rather than replacing a value someone set.
create or replace function change_fills(change jsonb)
returns boolean
language sql immutable
as $$
  select change ->> 'kind' = 'newTee'
    or (json_or_null(change -> 'from') is null and (
      (change ->> 'kind' = 'course' and change ->> 'field' = 'location')
      or (change ->> 'kind' = 'tee' and change ->> 'field' in ('slope', 'rating'))
      or change ->> 'kind' = 'green'
    ));
$$;

-- Makes one change. The caller has checked that its `from` holds.
create or replace function apply_course_change(target text, change jsonb)
returns void
language plpgsql set search_path = public
as $$
declare
  course_owner uuid;
  tee jsonb;
  hole jsonb;
  green jsonb;
begin
  select owner_id into course_owner from courses where id = target;
  case change ->> 'kind'
    when 'course' then
      if change ->> 'field' = 'name' then
        update courses set name = change ->> 'to' where id = target;
      else
        update courses set lat = (change #>> '{to,lat}')::double precision, lng = (change #>> '{to,lng}')::double precision
        where id = target;
      end if;
    when 'tee' then
      update tees set
        name = case when change ->> 'field' = 'name' then change ->> 'to' else name end,
        slope = case when change ->> 'field' = 'slope' then (change ->> 'to')::int else slope end,
        rating = case when change ->> 'field' = 'rating' then (change ->> 'to')::numeric else rating end
      where id = change ->> 'tee' and course_id = target;
    when 'hole' then
      update tee_holes set
        par = case when change ->> 'field' = 'par' then (change ->> 'to')::int else par end,
        stroke_index = case when change ->> 'field' = 'strokeIndex' then (change ->> 'to')::int else stroke_index end,
        yards = case when change ->> 'field' = 'yards' then (change ->> 'to')::int else yards end
      where tee_id = change ->> 'tee' and course_id = target and number = (change ->> 'number')::int;
    when 'green' then
      green := change -> 'to';
      insert into course_greens (course_id, owner_id, number, middle_lat, middle_lng, front_lat, front_lng, back_lat, back_lng, source)
      values (
        target, course_owner, (change ->> 'number')::int,
        (green #>> '{middle,lat}')::double precision, (green #>> '{middle,lng}')::double precision,
        (green #>> '{front,lat}')::double precision, (green #>> '{front,lng}')::double precision,
        (green #>> '{back,lat}')::double precision, (green #>> '{back,lng}')::double precision,
        green ->> 'source'
      )
      on conflict (course_id, number) do update set
        middle_lat = excluded.middle_lat, middle_lng = excluded.middle_lng,
        front_lat = excluded.front_lat, front_lng = excluded.front_lng,
        back_lat = excluded.back_lat, back_lng = excluded.back_lng, source = excluded.source;
    when 'newTee' then
      tee := change -> 'tee';
      insert into tees (id, owner_id, course_id, name, slope, rating, sort_order)
      values (
        tee ->> 'id', course_owner, target, tee ->> 'name',
        (tee ->> 'slope')::int, (tee ->> 'rating')::numeric,
        coalesce((select max(sort_order) + 1 from tees where course_id = target), 0)
      );
      for hole in select * from jsonb_array_elements(tee -> 'holes') loop
        insert into tee_holes (tee_id, course_id, owner_id, number, par, stroke_index, yards)
        values (tee ->> 'id', target, course_owner, (hole ->> 'number')::int, (hole ->> 'par')::int,
          (hole ->> 'strokeIndex')::int, (hole ->> 'yards')::int);
      end loop;
    else
      raise exception 'unknown change %', change ->> 'kind';
  end case;
end
$$;

-- A change from the course editor on someone else's course. Gap fills and added tees go
-- straight in, with a new course version; the rest becomes one suggestion. The admin's
-- every change goes straight in. A fill whose gap has since been filled becomes part
-- of the suggestion instead, replacing the value there now, so the admin can approve
-- it. Returns how many went in and the suggestion's id, if any.
create or replace function edit_course(target text, changes jsonb)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  change jsonb;
  direct jsonb := '[]'::jsonb;
  suggested jsonb := '[]'::jsonb;
  suggestion text;
  admin boolean := is_admin();
begin
  if auth.uid() is null then
    raise exception 'edit_course needs an account' using errcode = '42501';
  end if;
  if jsonb_typeof(changes) is distinct from 'array' or jsonb_array_length(changes) not between 1 and 500 then
    raise exception 'edit_course takes 1 to 500 changes' using errcode = '22023';
  end if;
  perform 1 from courses where id = target for update;
  if not found then
    raise exception 'no such course' using errcode = 'P0002';
  end if;

  for change in select * from jsonb_array_elements(changes) loop
    if (admin or change_fills(change)) and change_holds(target, change) then
      direct := direct || jsonb_build_array(change);
    elsif change_fills(change) and change ->> 'kind' <> 'newTee' then
      -- Someone filled the gap first: suggest replacing what they put.
      suggested := suggested || jsonb_build_array(jsonb_set(change, '{from}', coalesce(
        case when change ->> 'kind' = 'green'
          then jsonb_build_object('middle', course_value(target, change))
          else course_value(target, change) end,
        'null'::jsonb)));
    else
      suggested := suggested || jsonb_build_array(change);
    end if;
  end loop;

  if jsonb_array_length(direct) > 0 then
    perform next_course_version(target);
    for change in select * from jsonb_array_elements(direct) loop
      perform apply_course_change(target, change);
    end loop;
  end if;

  if jsonb_array_length(suggested) > 0 then
    suggestion := gen_random_uuid()::text;
    insert into course_suggestions (id, course_id, owner_id, changes) values (suggestion, target, auth.uid(), suggested);
  end if;

  return jsonb_build_object('applied', jsonb_array_length(direct), 'suggestion', suggestion);
end
$$;

-- Applies a waiting suggestion whole, or not at all. When a value it replaces has
-- changed since, nothing is applied, and the suggestion keeps waiting with the conflict.
create or replace function approve_suggestion(target text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  suggestion record;
  change jsonb;
begin
  if not is_admin() then
    raise exception 'only the admin approves a suggestion' using errcode = '42501';
  end if;
  select * into suggestion from course_suggestions where id = target and status = 'waiting' for update;
  if not found then
    raise exception 'no waiting suggestion %', target using errcode = 'P0002';
  end if;
  perform 1 from courses where id = suggestion.course_id for update;

  for change in select * from jsonb_array_elements(suggestion.changes) loop
    if not change_holds(suggestion.course_id, change) then
      update course_suggestions
        set conflict = format('%s changed since: it is now %s', change ->> 'field', coalesce(course_value(suggestion.course_id, change)::text, 'empty'))
        where id = target;
      return jsonb_build_object('status', 'conflict');
    end if;
  end loop;

  perform next_course_version(suggestion.course_id);
  for change in select * from jsonb_array_elements(suggestion.changes) loop
    perform apply_course_change(suggestion.course_id, change);
  end loop;
  update course_suggestions set status = 'approved', conflict = null, decided_at = now() where id = target;
  return jsonb_build_object('status', 'approved');
end
$$;

create or replace function decline_suggestion(target text, why text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not is_admin() then
    raise exception 'only the admin declines a suggestion' using errcode = '42501';
  end if;
  update course_suggestions set status = 'declined', reason = why, decided_at = now()
  where id = target and status = 'waiting';
  if not found then
    raise exception 'no waiting suggestion %', target using errcode = 'P0002';
  end if;
end
$$;

-- Only the entry points are anyone's to call; the helpers run inside them.
revoke execute on function next_course_version(text), apply_course_change(text, jsonb) from public, anon, authenticated;
revoke execute on function edit_course(text, jsonb), approve_suggestion(text), decline_suggestion(text, text) from public, anon;
grant execute on function edit_course(text, jsonb), approve_suggestion(text), decline_suggestion(text, text), is_admin() to authenticated;
