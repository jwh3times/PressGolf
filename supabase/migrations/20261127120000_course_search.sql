-- Searching the course library by name (#383, ADR 0001).
--
-- Creating a course starts here, so nobody types in a course Press already has. A
-- signed-in golfer types part of a name and gets the matching courses, nearest first
-- when the phone says where it is and by name alone when it doesn't, each with its
-- distance and its tee names, which is what tells two same-named courses apart.
--
-- It reads as the caller (security invoker), so the library's own read policy decides
-- what comes back: every course for a signed-in account, nothing for anyone else. The
-- ordering is here rather than on the phone so the nearest match is never cut by the
-- limit. Adding a match reads the course's rows through the tables as before.

create or replace function search_courses(
  term text,
  near_lat double precision default null,
  near_lng double precision default null
)
returns table (id text, name text, lat double precision, lng double precision, km double precision, tees text[])
language sql
stable
security invoker
set search_path = public
as $$
  with wanted as (
    -- A typed % or _ is a letter, not a wildcard.
    select '%' || replace(replace(replace(btrim(term), '\', '\\'), '%', '\%'), '_', '\_') || '%' as pattern
    where char_length(btrim(coalesce(term, ''))) >= 2
  ),
  matches as (
    select c.id, c.name, c.lat, c.lng,
      case when near_lat is null or near_lng is null or c.lat is null then null
      else 6371.0 * 2 * asin(sqrt(
        power(sin(radians(c.lat - near_lat) / 2), 2)
        + cos(radians(near_lat)) * cos(radians(c.lat)) * power(sin(radians(c.lng - near_lng) / 2), 2)
      )) end as km
    from courses c, wanted w
    where c.name ilike w.pattern escape '\'
  )
  select m.id, m.name, m.lat, m.lng, m.km,
    coalesce((select array_agg(t.name order by t.sort_order, t.name) from tees t where t.course_id = m.id), '{}')
  from matches m
  order by m.km asc nulls last, lower(m.name), m.id
  limit 25
$$;

revoke execute on function search_courses(text, double precision, double precision) from public, anon;
grant execute on function search_courses(text, double precision, double precision) to authenticated;
