-- The course map (#125).
--
-- Bunkers, water, fairways, greens and tees as outlines, each hole's line from
-- tee to green, the course's edge, and out-of-bounds lines, for the hole map
-- and the distances to trouble. Per course, like greens: every tee plays the
-- same ground.
--
-- An outline is one jsonb array of [lat, lng] pairs in WGS84 degrees. It is
-- only ever read and written whole. An area's ring doesn't repeat its first
-- point; a line runs in order.

create table course_features (
  course_id text not null references courses (id) on delete cascade,
  owner_id  uuid not null default auth.uid(),
  -- Stable across imports: 'osm:way/123', or an id made when drawn in the app.
  id        text not null check (length(id) between 1 and 100),
  -- 'water' is a yellow penalty area, 'lateralWater' a red one.
  kind      text not null check (kind in (
    'bunker', 'water', 'lateralWater', 'fairway', 'green', 'tee',
    'courseEdge', 'outOfBounds', 'holeLine'
  )),
  -- The hole a holeLine belongs to, 1-based like tee_holes.number; null otherwise.
  hole      integer check (hole >= 1),
  points    jsonb not null check (
    jsonb_typeof(points) = 'array' and jsonb_array_length(points) between 2 and 5000
  ),
  -- From 'osm' (OpenStreetMap), or drawn on a 'map' in the app.
  source    text not null check (source in ('osm', 'map')),
  primary key (course_id, id),
  check ((kind = 'holeLine') = (hole is not null))
);

alter table course_features enable row level security;

create policy "owner reads" on course_features for select using (owner_id = auth.uid());
create policy "owner writes" on course_features for insert with check (owner_id = auth.uid());
create policy "owner updates" on course_features for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "owner deletes" on course_features for delete using (owner_id = auth.uid());
-- Guests of a shared outing see the map too, as they see the greens.
create policy "guests read shared features" on course_features for select using (shared_course(course_id));
