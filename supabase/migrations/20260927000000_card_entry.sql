-- Card entry (#6).
--
-- A round is either scored live, hole by hole, or typed in afterwards from a
-- finished paper card. A card round has no presses, Wolf or tapped junk —
-- those are called live — so every phone needs to know which it is.
--
-- Everything already stored was scored live.

alter table rounds
  add column entry text not null default 'live'
    check (entry in ('live', 'card'));
