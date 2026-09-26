-- Max score per hole, and pick-ups (#36).
--
-- A group sets a house rule — off, double bogey (par + 2) or net double bogey
-- (par + 2 + the strokes received on the hole) — which is copied onto each new
-- round and outing. The engine caps scores when it reads them; the card keeps
-- what was written.
--
-- Everything already stored is 'off', so no settled round moves by a cent.

alter table groups
  add column max_score text not null default 'off'
    check (max_score in ('off', 'double_bogey', 'net_double_bogey'));

alter table round_options
  add column max_score text not null default 'off'
    check (max_score in ('off', 'double_bogey', 'net_double_bogey'));

-- One rule for the whole day, so field pots compare like with like.
alter table outings
  add column max_score text not null default 'off'
    check (max_score in ('off', 'double_bogey', 'net_double_bogey'));

-- A pick-up lives on its cell, so it syncs at the same grain as the score and
-- outing guests can mark one under the policy they already score with.
alter table scores
  add column picked_up boolean not null default false;
