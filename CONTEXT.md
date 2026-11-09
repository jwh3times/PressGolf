# Press

Press scores and settles golf side games. These are the words that matter in a round's life, in a
player's bag, and when several accounts share a day.

## Language

**Posted**:
A round closed and counted in the season ledger.

**Abandoned**:
A round closed without being posted, so it never counts in the season ledger.
_Avoid_: cancelled, discarded (discarding a card deletes it)

**Mark**:
Where a player's ball lay when they stood at it during a round, with the club they were about to hit, or that it wasn't a full swing.
_Avoid_: pin, waypoint

**Tracked shot**:
One of a player's own full swings, from its mark to their next mark on the same hole, with the club they picked. Only the bag's owner tracks, and only their own shots.
_Avoid_: shot (on its own, a stroke on the scorecard)

**Carry**:
How far a club sends the ball in the air on a full swing, before it rolls. A tracked shot measures where the ball stopped, so its carry is inferred.
_Avoid_: distance (ambiguous between carry and where the ball stopped)

**Organiser**:
The account that created an outing and shares it by its code; owns the outing's group, course and rounds.
_Avoid_: host, owner (owner is any row's account)

**Guest**:
An account that joined someone else's outing with its code; may score on its cards but owns none of the organiser's rows.
_Avoid_: member (a membership is the row; the organiser has one too), player (a player is a name on a roster)

**Detached**:
Of an outing on a guest's phone: its organiser deleted their account, so it's gone from the server, and this copy stays readable and no longer syncs.
_Avoid_: orphaned, archived

**Move notice**:
What an account's deletion leaves anyone holding its day, group or course: an outing that has gone, or a new id for a group, player, course or tee they hold. Where the guest's own rows stay on that group or course, the server has a copy under the same new id.
