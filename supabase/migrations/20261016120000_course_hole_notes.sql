-- Hole notes (#136).
--
-- What a course's owner wants players to know about a hole, in a sentence or
-- two: "Blind tee shot, aim at the steeple." Per course, like greens, and read
-- by guests of a shared outing the same way; only the owner writes them.

create table course_hole_notes (
  course_id text not null references courses (id) on delete cascade,
  owner_id  uuid not null default auth.uid(),
  -- 1-based, matching tee_holes.number.
  number    integer not null check (number >= 1),
  text      text not null check (length(text) between 1 and 280),
  primary key (course_id, number)
);

alter table course_hole_notes enable row level security;

create policy "owner reads" on course_hole_notes for select using (owner_id = auth.uid());
create policy "owner writes" on course_hole_notes for insert with check (owner_id = auth.uid());
create policy "owner updates" on course_hole_notes for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "owner deletes" on course_hole_notes for delete using (owner_id = auth.uid());
create policy "guests read shared notes" on course_hole_notes for select using (shared_course(course_id));
