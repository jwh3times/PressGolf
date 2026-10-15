-- Greens (#8).
--
-- Where each hole's green is, so the Score screen can give the distance to it.
-- Per course rather than per tee, because every tee plays to the same green.
-- A green marked by standing on it has only a middle; front and back come from
-- a map or from OpenStreetMap, so they are optional and always set as a pair.
--
-- Coordinates are WGS84 degrees, as GPS reports them.

create table course_greens (
  course_id  text not null references courses (id) on delete cascade,
  owner_id   uuid not null default auth.uid(),
  -- 1-based, matching tee_holes.number.
  number     integer not null check (number >= 1),
  middle_lat double precision not null check (middle_lat between -90 and 90),
  middle_lng double precision not null check (middle_lng between -180 and 180),
  front_lat  double precision check (front_lat between -90 and 90),
  front_lng  double precision check (front_lng between -180 and 180),
  back_lat   double precision check (back_lat between -90 and 90),
  back_lng   double precision check (back_lng between -180 and 180),
  -- 'marked' standing on it, placed on a 'map', or from 'osm' (OpenStreetMap).
  source     text not null check (source in ('marked', 'map', 'osm')),
  primary key (course_id, number),
  check ((front_lat is null) = (front_lng is null)),
  check ((back_lat is null) = (back_lng is null))
);

alter table course_greens enable row level security;

create policy "owner reads" on course_greens for select using (owner_id = auth.uid());
create policy "owner writes" on course_greens for insert with check (owner_id = auth.uid());
create policy "owner updates" on course_greens for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "owner deletes" on course_greens for delete using (owner_id = auth.uid());
-- Guests of a shared outing see the yardages too, as they see the card.
create policy "guests read shared greens" on course_greens for select using (shared_course(course_id));
