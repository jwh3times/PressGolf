-- Handicaps (#7).
--
-- A player can carry a WHS Handicap Index, and pops are worked out from it and
-- the player's own tee when a round starts. How is a house rule, following the
-- max-score pattern: a group sets full handicaps or off the low man, and an
-- allowance, which is copied onto each new round and outing. An outing locks
-- them for the whole field.
--
-- Everything already stored plays off the low man at 100%, which is what the
-- Format tab has always said, and keeps the pops it has. No settled round moves.

-- A plus index is stored negative. Null means the player has none.
alter table players
  add column handicap_index numeric(3, 1) check (handicap_index between -20.0 and 54.0),
  -- When it was last entered, in epoch milliseconds like created_at elsewhere.
  add column handicap_updated_at bigint;

alter table groups
  add column strokes text not null default 'off_low' check (strokes in ('full', 'off_low')),
  add column allowance integer not null default 100 check (allowance between 0 and 100);

alter table round_options
  add column strokes text not null default 'off_low' check (strokes in ('full', 'off_low')),
  add column allowance integer not null default 100 check (allowance between 0 and 100);

alter table outings
  add column strokes text not null default 'off_low' check (strokes in ('full', 'off_low')),
  add column allowance integer not null default 100 check (allowance between 0 and 100);

-- The tee a player's pops were last worked out from, so a tee change can ask
-- for a recalculation. Not a foreign key, like round_players.tee_id.
alter table round_players add column handicap_tee_id text;
