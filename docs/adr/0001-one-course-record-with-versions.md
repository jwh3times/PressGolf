---
status: proposed
---

# One course record for everyone, versioned, changed through suggestions

Every course used to belong to the account that typed it in: guests read it through an outing, and
an account's deletion copied it under a new id for everyone still holding it. We decided that a
course is one record in a course library that every account uses and no account owns, because a
course holds no personal data and the same real course should not be stored once per account
(#253). A change to anything that scores a round (a tee, a tee card, slope or rating) makes a new
course version and archives the old one; a round links to the version current when it started, so
a posted round never changes when its course does, without copying a course into every round.
Creating a course, filling an empty value and adding a tee go straight in; changing a value someone
set is a suggestion that the maintainer approves.

## Considered options

- **A copy per account, imported from a shared list.** Rejected: duplicates the same course across
  accounts, and corrections never reach the copies.
- **Anyone edits in place, wiki-style.** Rejected: rounds read their course live, so one wrong
  edit would re-settle every posted round on that course for every group.
- **A copy of the tee card in each round.** Rejected: stores the same card again for every round;
  a version per change stores it once per change.
- **The creator approves changes to their course.** Rejected for now: the maintainer approves every
  suggestion, so there is no keeper role to hand over when an account goes.

## Consequences

- Rounds settle from their course version, not from the current course.
- Account deletion no longer moves or copies courses; move notices cover days and groups only.
- Hole notes stay with the account that wrote them: they are not part of the course.
- Greens and hazards imported from OpenStreetMap sit in a database every account uses, so that
  layer is treated as derived from OpenStreetMap under ODbL: credited where it shows, and offered
  under ODbL on request.
- Switching to this model wipes the server's courses, outings, rounds and scores before launch,
  after a backup, and the app clears its local copies once; accounts, groups, rosters and bags stay.
