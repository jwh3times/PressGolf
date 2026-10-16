-- The bag (#125).
--
-- The clubs a player carries and how far each carries, in the air on a full
-- swing, as they typed it. A bag is its owner's alone: it belongs to the
-- account, not to a group's player, and no outing shares it, so there is no
-- guest policy. The id is stable, for shots tracked later to name their club.

create table clubs (
  id          text primary key check (length(id) between 1 and 100),
  owner_id    uuid not null default auth.uid(),
  name        text not null check (length(name) between 1 and 40),
  -- Yards; null until typed.
  carry_yards integer check (carry_yards between 1 and 450),
  -- The bag's order, longest first, from 0.
  position    integer not null check (position between 0 and 99)
);

alter table clubs enable row level security;

create policy "owner reads" on clubs for select using (owner_id = auth.uid());
create policy "owner writes" on clubs for insert with check (owner_id = auth.uid());
create policy "owner updates" on clubs for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "owner deletes" on clubs for delete using (owner_id = auth.uid());
