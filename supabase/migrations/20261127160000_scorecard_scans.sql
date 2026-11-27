-- How many scorecards each account has had read today (#384, spec #376).
--
-- The `read-scorecard` Edge Function reads a photographed scorecard with a model, which
-- costs money per call, so each account gets 10 scans a day, counted here on the server.
-- One scan is one call, however many photos it carries, and the later scores mode (#255)
-- shares the same count. The day is UTC.
--
-- Only the function touches this table, with the service role: no policy lets a client
-- read or write it, and the two functions below are executable by the service role
-- alone. Nothing of a photo is kept, here or anywhere: the count is all that's written.
--
-- Named `account`, not `owner_id`, and cascading, like `admins`: no client writes a row
-- here, so a deleted account's token can't add one (the job `on delete no action` does
-- for owned rows), and a count has nothing to hand on, so it simply goes with the account.

create table scorecard_scans (
  account uuid not null references auth.users (id) on delete cascade,
  day     date not null,
  scans   integer not null check (scans between 0 and 10),
  primary key (account, day)
);

alter table scorecard_scans enable row level security;

-- Takes one of today's scans for `target`, if one is left. Returns how many are left
-- after it, or null when today's are used up, in which case nothing changes. Atomic, so
-- two scans at once can't both take the last one.
create or replace function take_scorecard_scan(target uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  daily constant integer := 10;
  today date := (now() at time zone 'utc')::date;
  used integer;
begin
  insert into scorecard_scans as s (account, day, scans)
  values (target, today, 1)
  on conflict (account, day) do update set scans = s.scans + 1
    where s.scans < daily
  returning s.scans into used;
  return daily - used;
end
$$;

-- Gives back a scan the function took but couldn't use: the model was never reached,
-- so the golfer isn't charged for a reading they never got. The latest day's, so a
-- call that ran past midnight UTC gives back the scan it took.
create or replace function give_back_scorecard_scan(target uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update scorecard_scans set scans = scans - 1
  where account = target and scans > 0
    and day = (select max(day) from scorecard_scans where account = target);
$$;

revoke all on table scorecard_scans from public, anon, authenticated;
revoke execute on function take_scorecard_scan(uuid), give_back_scorecard_scan(uuid) from public, anon, authenticated;
grant execute on function take_scorecard_scan(uuid), give_back_scorecard_scan(uuid) to service_role;
