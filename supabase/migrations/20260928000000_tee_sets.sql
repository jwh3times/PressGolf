-- Tee sets (#43).
--
-- Slope and rating belong to a set of tees, and forward tees sometimes play a
-- hole at a different par and stroke index. So a course now has tees, and each
-- tee carries its own card. Every existing course's holes become its "Default"
-- tee, with slope and rating left for someone to fill in.
--
-- `holes` is dropped here rather than kept for older builds: a phone still on a
-- build from before tees cannot sync until it updates.

create table tees (
  id         text primary key,
  owner_id   uuid not null default auth.uid(),
  course_id  text not null references courses (id) on delete cascade,
  name       text not null,
  -- Null until entered. Slope runs 55-155; rating is strokes, e.g. 71.2.
  slope      integer check (slope between 55 and 155),
  rating     numeric(4, 1),
  sort_order integer not null default 0,
  updated_at timestamptz not null default now()
);

create index tees_course_idx on tees (course_id);

-- course_id is repeated from the tee so an outing guest's read check is the
-- same single lookup the old `holes` table used.
create table tee_holes (
  tee_id       text not null references tees (id) on delete cascade,
  course_id    text not null references courses (id) on delete cascade,
  owner_id     uuid not null default auth.uid(),
  -- 1-based, as printed on the card.
  number       integer not null,
  par          integer not null,
  -- 1 = hardest. This is what decides where pops land.
  stroke_index integer not null,
  yards        integer not null,
  primary key (tee_id, number)
);

create index tee_holes_course_idx on tee_holes (course_id);

insert into tees (id, owner_id, course_id, name, sort_order)
  select id || '_default', owner_id, id, 'Default', 0 from courses;

insert into tee_holes (tee_id, course_id, owner_id, number, par, stroke_index, yards)
  select course_id || '_default', course_id, owner_id, number, par, stroke_index, yards from holes;

-- Which tee a round is played from, and a player's own when it differs. Not
-- foreign keys: a round can arrive from another phone before its course does.
alter table rounds add column tee_id text;
alter table round_players add column tee_id text;

alter table tees      enable row level security;
alter table tee_holes enable row level security;

do $$
declare t text;
begin
  foreach t in array array['tees', 'tee_holes']
  loop
    execute format('create policy "owner reads" on %I for select using (owner_id = auth.uid())', t);
    execute format('create policy "owner writes" on %I for insert with check (owner_id = auth.uid())', t);
    execute format('create policy "owner updates" on %I for update using (owner_id = auth.uid()) with check (owner_id = auth.uid())', t);
    execute format('create policy "owner deletes" on %I for delete using (owner_id = auth.uid())', t);
    -- The field needs a card to play: guests read the tees of a shared outing's course.
    execute format('create policy "guests read shared tees" on %I for select using (shared_course(course_id))', t);
  end loop;
end
$$;

drop table holes;
