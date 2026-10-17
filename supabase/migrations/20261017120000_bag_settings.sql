-- The bag's settings (#146).
--
-- One row an account, beside its clubs: for now, how its owner usually scores,
-- which sets how widely club suggestions spread their shots. Like the clubs,
-- it is its owner's alone and no outing shares it, so there is no guest
-- policy. The phone's rows carry no owner, so `id` is always 'bag' to name it.

create table bag_settings (
  owner_id    uuid not null default auth.uid(),
  id          text not null default 'bag' check (id = 'bag'),
  usual_score text not null check (usual_score in ('70s', '80s', '90s', '100s')),
  primary key (owner_id, id)
);

alter table bag_settings enable row level security;

create policy "owner reads" on bag_settings for select using (owner_id = auth.uid());
create policy "owner writes" on bag_settings for insert with check (owner_id = auth.uid());
create policy "owner updates" on bag_settings for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "owner deletes" on bag_settings for delete using (owner_id = auth.uid());
