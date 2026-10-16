-- Out of bounds for chosen holes (#136).
--
-- Internal out of bounds, between two holes, applies to one of them only. A
-- line the course owner limits to some holes lists them here; null is every
-- hole, as every line was before. Only an out-of-bounds line may be limited.

alter table course_features
  add column holes integer[] check (
    holes is null
    or (kind = 'outOfBounds' and cardinality(holes) between 1 and 99 and 1 <= all (holes))
  );
