-- Does row-level security actually keep two accounts apart?
--
-- Run against a throwaway database that has had the migrations applied. Every
-- check raises on failure, so with ON_ERROR_STOP the job goes red rather than
-- printing something nobody reads.
--
-- This is the one part of the app where being wrong is not a bug but a breach:
-- a policy that leaks is somebody reading another group's money. It is also
-- the part no unit test can reach, because the rules live in the database.

\set ON_ERROR_STOP on

\set alice '11111111-1111-1111-1111-111111111111'
\set bob   '22222222-2222-2222-2222-222222222222'

grant usage on schema public, auth to authenticated;
grant all on all tables in schema public to authenticated;
grant all on all sequences in schema public to authenticated;
grant execute on all functions in schema public to authenticated;

create or replace function expect(label text, got bigint, want bigint)
returns void language plpgsql as $$
begin
  if got is distinct from want then
    raise exception 'FAILED: % — expected %, got %', label, want, got;
  end if;
  raise notice 'ok: %', label;
end
$$;

-- ── Alice sets up a day, and keeps a private season of her own ──────────────

set role authenticated;
set request.jwt.claim.sub = :'alice';

insert into groups (id, name, created_at) values ('g1', 'Pine Hollow Society', 1);
insert into players (id, group_id, name, initials, color) values
  ('p1', 'g1', 'Jerry', 'JH', '#8BE0AE'),
  ('p2', 'g1', 'Sam',   'SM', '#E8C46A');
insert into courses (id, name, created_at) values ('c1', 'Pine Hollow', 1);
insert into tees (id, course_id, name, slope, rating) values ('t1', 'c1', 'Blue', 131, 71.8);
insert into tee_holes (tee_id, course_id, number, par, stroke_index, yards) values ('t1', 'c1', 1, 4, 5, 410);
insert into course_greens (course_id, number, middle_lat, middle_lng, source) values ('c1', 1, 45.5, -122.6, 'marked');
insert into course_features (course_id, id, kind, hole, points, source)
  values ('c1', 'osm:way/1', 'bunker', null, '[[45.5, -122.6], [45.5, -122.601], [45.501, -122.6]]', 'osm');
insert into course_hole_notes (course_id, number, text) values ('c1', 1, 'Blind tee shot, aim at the steeple.');
insert into outings (id, group_id, course_id, name, date, started_at, join_code)
  values ('o1', 'g1', 'c1', 'Saturday', 1, 1, 'ABC234');
insert into outing_field (outing_id, player_id) values ('o1', 'p1'), ('o1', 'p2');
insert into rounds (id, group_id, course_id, outing_id, name, started_at)
  values ('r1', 'g1', 'c1', 'o1', 'Group 1', 1);
insert into round_players (round_id, player_id, tee_order) values ('r1', 'p1', 0);
insert into scores (round_id, player_id, hole, strokes) values ('r1', 'p1', 0, 4);
insert into round_games (round_id, key, enabled, stake) values ('r1', 'nassau', true, 500);

-- Nothing to do with the outing. Bob must never see any of this.
insert into groups (id, name, created_at) values ('g9', 'Private fourball', 1);
insert into courses (id, name, created_at) values ('c9', 'Somewhere else', 1);
insert into course_greens (course_id, number, middle_lat, middle_lng, source) values ('c9', 1, 44.1, -121.3, 'marked');
insert into course_features (course_id, id, kind, hole, points, source)
  values ('c9', 'osm:way/9', 'water', null, '[[44.1, -121.3], [44.1, -121.301], [44.101, -121.3]]', 'osm');
insert into course_hole_notes (course_id, number, text) values ('c9', 1, 'Private note.');
insert into rounds (id, group_id, course_id, name, started_at)
  values ('r9', 'g9', 'c9', 'Private', 1);
insert into clubs (id, name, carry_yards, position) values ('k1', '7 iron', 150, 0);
insert into scores (round_id, player_id, hole, strokes) values ('r9', 'p1', 0, 3);

-- ── A stranger, holding no code ─────────────────────────────────────────────

set request.jwt.claim.sub = :'bob';

select expect('stranger sees no outings',  (select count(*) from outings), 0);
select expect('stranger sees no groups',   (select count(*) from groups), 0);
select expect('stranger sees no players',  (select count(*) from players), 0);
select expect('stranger sees no rounds',   (select count(*) from rounds), 0);
select expect('stranger sees no scores',   (select count(*) from scores), 0);
select expect('stranger sees no courses',  (select count(*) from courses), 0);
select expect('stranger sees no tees',     (select count(*) from tees), 0);
select expect('stranger sees no card',     (select count(*) from tee_holes), 0);
select expect('stranger sees no greens',   (select count(*) from course_greens), 0);
select expect('stranger sees no map',      (select count(*) from course_features), 0);
select expect('stranger sees no notes',    (select count(*) from course_hole_notes), 0);
select expect('stranger sees no bag',      (select count(*) from clubs), 0);

-- ── The same stranger, now holding the code ─────────────────────────────────

select join_outing('abc234', 'p2', 'Sam');

select expect('guest sees the shared outing',  (select count(*) from outings where id = 'o1'), 1);
select expect('guest sees the shared round',   (select count(*) from rounds where id = 'r1'), 1);
select expect('guest sees the shared scores',  (select count(*) from scores where round_id = 'r1'), 1);
select expect('guest sees the course',         (select count(*) from courses where id = 'c1'), 1);
select expect('guest sees the tees',           (select count(*) from tees), 1);
select expect('guest sees the card',           (select count(*) from tee_holes), 1);
select expect('guest sees the shared greens',  (select count(*) from course_greens where course_id = 'c1'), 1);
select expect('guest sees the shared map',     (select count(*) from course_features where course_id = 'c1'), 1);
select expect('guest sees the shared notes',   (select count(*) from course_hole_notes where course_id = 'c1'), 1);
select expect('guest sees the field',          (select count(*) from players), 2);
select expect('guest sees the organiser group',(select count(*) from groups where id = 'g1'), 1);

-- and still nothing of the private season
select expect('guest sees no private group',  (select count(*) from groups where id = 'g9'), 0);
select expect('guest sees no private round',  (select count(*) from rounds where id = 'r9'), 0);
select expect('guest sees no private scores', (select count(*) from scores where round_id = 'r9'), 0);
select expect('guest sees no private course', (select count(*) from courses where id = 'c9'), 0);
select expect('guest sees no private greens', (select count(*) from course_greens where course_id = 'c9'), 0);
select expect('guest sees no private map',    (select count(*) from course_features where course_id = 'c9'), 0);
select expect('guest sees no private notes',  (select count(*) from course_hole_notes where course_id = 'c9'), 0);
select expect('guest sees no organiser bag',  (select count(*) from clubs), 0);

-- ── What a guest may write ──────────────────────────────────────────────────

insert into scores (round_id, player_id, hole, strokes) values ('r1', 'p2', 0, 5);
update scores set strokes = 6 where round_id = 'r1' and player_id = 'p1' and hole = 0;
select expect('guest scored the shared card',
  (select count(*) from scores where round_id = 'r1' and player_id = 'p2'), 1);
update scores set strokes = null, picked_up = true where round_id = 'r1' and player_id = 'p2' and hole = 0;
select expect('guest marked a pick-up on the shared card',
  (select count(*) from scores where round_id = 'r1' and player_id = 'p2' and picked_up), 1);

-- ── What a guest may not ────────────────────────────────────────────────────

update round_games set stake = 999999 where round_id = 'r1';
update scores set strokes = 99 where round_id = 'r9';
delete from rounds where id = 'r9';
delete from rounds where id = 'r1';
delete from outings where id = 'o1';
update tee_holes set par = 3 where tee_id = 't1';
update tees set slope = 155 where id = 't1';
update course_greens set middle_lat = 0 where course_id = 'c1';
delete from course_greens where course_id = 'c1';
update course_features set kind = 'water' where course_id = 'c1';
delete from course_features where course_id = 'c1';
update course_hole_notes set text = 'Guest was here.' where course_id = 'c1';
delete from course_hole_notes where course_id = 'c1';
update clubs set carry_yards = 300;
delete from clubs;
-- A bag of his own is his to keep, and his alone.
insert into clubs (id, name, carry_yards, position) values ('k2', 'Driver', 260, 0);
select expect('guest sees only his own bag', (select count(*) from clubs), 1);
-- A refused insert raises, where a refused update or delete just finds no rows.
do $$ begin
  insert into course_features (course_id, id, kind, hole, points, source)
    values ('c1', 'map:guest', 'outOfBounds', null, '[[45.5, -122.6], [45.6, -122.6]]', 'map');
exception when insufficient_privilege then null;
end $$;
do $$ begin
  insert into course_hole_notes (course_id, number, text) values ('c1', 2, 'Guest note.');
exception when insufficient_privilege then null;
end $$;

set request.jwt.claim.sub = :'alice';
select expect('shared card untouched',  (select par from tee_holes where tee_id = 't1' and number = 1), 4);
select expect('shared tee untouched',   (select slope from tees where id = 't1'), 131);
select expect('shared green untouched', (select count(*) from course_greens where course_id = 'c1' and middle_lat = 45.5), 1);
select expect('shared map untouched',   (select count(*) from course_features where course_id = 'c1' and kind = 'bunker'), 1);
select expect('guest drew nothing',     (select count(*) from course_features where id = 'map:guest'), 0);
select expect('shared note untouched',  (select count(*) from course_hole_notes where course_id = 'c1' and number = 1 and text like 'Blind%'), 1);
select expect('guest noted nothing',    (select count(*) from course_hole_notes where course_id = 'c1' and number = 2), 0);
select expect('stake untouched',        (select stake from round_games where round_id = 'r1'), 500);
select expect('private score untouched',(select strokes from scores where round_id = 'r9'), 3);
select expect('private round survived', (select count(*) from rounds where id = 'r9'), 1);
select expect('shared round survived',  (select count(*) from rounds where id = 'r1'), 1);
select expect('outing survived',        (select count(*) from outings where id = 'o1'), 1);
select expect('bag untouched',          (select carry_yards from clubs where id = 'k1'), 150);
select expect('sees only her own bag',  (select count(*) from clubs), 1);

-- The organiser joined her own outing when she shared it, which is the only
-- reason she can see what her guests wrote.
insert into outing_members (outing_id, user_id, role) values ('o1', :'alice', 'organiser')
  on conflict do nothing;
select expect('organiser sees the guest score',
  (select count(*) from scores where round_id = 'r1' and player_id = 'p2'), 1);

reset role;
