# Changelog

Every notable change to Press is recorded here, in the form of
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). A change to the app, the support site,
the schema or the Edge Function adds its entries under `Unreleased`. A release, opened by the
Prepare release workflow, moves them into a dated section and sets `package.json` and `app.json`'s
`expo.version` to the new version; once it has merged and passed CI on `main`, CI tags
`v<version>`, publishes its GitHub Release and builds it for the stores (`docs/agents/releases.md`).

## [Unreleased]

### Changed

- A round now shows club suggestions and where to aim unless the phone makes it a **tournament
  round**, which replaces the practice round (#410). The switch is on New round, the hole map and
  the course guide. It's for any round under the Rules, a competition or one for your handicap,
  where Rule 4.3a doesn't allow a device to give that advice. Distances, hazards, hole notes and
  the bag show in every round, as before, and scores, games and money work the same either way.
  - Each new round starts the way the phone last left the switch. A phone's first round starts
    with it off. While it's off, New round reminds you that a round under the Rules needs it.
  - Turning it on takes effect at once. Turning it off in a round explains Rule 4.3a and its
    penalty first, and **Keep it a tournament round** backs out.
  - History tags a round "TOURNAMENT" when it was one from start to finish. The old "PRACTICE"
    tags are gone.
  - Updating keeps what a round still going showed: one that wasn't marked practice stays without
    advice, as a tournament round. The next new round starts with advice.
  - On a course with no greens mapped, the Score screen says "Mark the green for suggestions" in
    a round, where before it said so only in a practice round.
  - The terms of use say so, effective 27 November 2026, and the account-deletion page now names
    tournament rounds among what a phone erases.
- The search a new course's map starts with, and the first sync after signing in, are rewritten
  to pass oxlint 1.95.0's React checks, which no longer accept the comments that silenced them
  (#407). Both work as before.

## [1.5.0] - 2026-11-27

### Added

- Courses are shared in a course library. Every signed-in golfer can read every course: its
  tees, cards, ratings, greens and hole map. A round or outing can be played on a course someone
  else added. For now only whoever added a course can change it, and their change reaches every
  phone that holds the course the next time it syncs. Hole notes are still their writer's
  (#378).
- A round keeps the course it was played on. Correcting a par, stroke index, yards, slope or
  rating, or adding or removing a tee, makes a new version of the course. Rounds already
  started stay on the version they began with, so a posted round's result, its field pots and
  the season standings never change when its course does. Rounds started later play the new
  card. Picking a tee added after a round started moves that round, if it isn't posted yet, to
  the course as it is now (#377).
- Any signed-in golfer can improve a course someone else added. Edits made in the course editor
  collect as changes, which send together and need a connection. A gap filled (an empty slope,
  rating, location or green) or a tee added goes straight in. Changing a value someone already
  set becomes a suggestion for the admin. The editor shows each change and how it will be taken,
  and your suggestions as waiting, approved, or declined with the reason. The admin reviews them
  on a new Course suggestions screen in Settings. Approving applies a suggestion whole, and is
  refused if a value it changes has changed since. The course's creator still edits it directly.
  A course the server has changed, for example by an approval, reaches every phone on its newer
  version, the creator's included (#381).
- Adding a course starts with the course library, so nobody types in a course Press already has.
  Signed in, type part of its name on the Courses screen and Press lists the courses golfers
  have already set up: nearest first when location is allowed, by name when it isn't, each with
  its distance and tee names. **Add** puts one on your courses. A long press takes a course off
  your list, which leaves it in the library and on any round played there; for now the list is
  kept on the phone. Not there, or no signal? **Type it in** opens a new course in the course
  editor, marked as not saved: nothing of it reaches the library until you save it, and leaving
  saves nothing. A new course needs a location, from where you're standing or a pin on a map.
  Values a later source fills, such as a scorecard scan, will be marked until you check them.
  The demo, and a build with no server, add courses by hand as before. The privacy policy now
  says a course search sends a rough position, which isn't kept, and that a new course's
  location is shared in the library (#383).
- The server can read a photographed scorecard, ready for scanning one when creating a course
  (the app's side comes next). A new `read-scorecard` function takes one to 4 photos of one card
  and returns its tees: the hole count, and each tee's name, slope, rating, and yards, par and
  stroke index for every hole. Anything the card doesn't show, or that can't be right (a stroke
  index used twice on a tee, a slope of 160), comes back blank for the golfer to fill in, never
  guessed. Each account gets 10 scans a day. The photos are read and discarded, never kept
  (#384).
- A course the library doesn't have can be set up by scanning its scorecard. After a search,
  **Scan the scorecard** opens the phone's own document scanner for up to 4 photos of one card.
  What Press reads opens as a new course in the course editor, not saved yet, with every value
  it read marked until you check it and anything it couldn't read left blank. The course can't
  be saved with a tee unnamed, a par or stroke index blank, or one stroke index on two holes of a
  tee, and the hint under **Save the course** says what's left. Before the first scan on a phone, a notice
  says the photos go to Press's server and are read by Claude, from Anthropic, and that Press
  keeps no copy. Scans left today show once 3 or fewer remain. Over the limit, with no signal,
  or when the scanner won't open, Press says why, and **Type it in** is right below. Press
  deletes the photos from the phone as soon as it has them ready to send. The web app has no scan. On iPhone, Press now
  asks to use the camera when you first scan; on Android the scanner in Google Play services
  uses it. Press never uses the microphone. The privacy policy covers scorecard photos,
  Anthropic, and the scanner Android uses (#385).

### Changed

- This version starts the course library afresh. The server's courses, outings, rounds, scores
  and ball marks have been cleared once. A phone that syncs clears its own copy the first time
  it opens on this version, so the old ones aren't sent back. The account, groups, rosters and
  bag all stay. The demo, and a build with no server, keep their courses and rounds (#378).
- Deleting an account no longer deletes the courses it added. They stay in the course library
  for everyone, no longer marked as that account's, and its hole notes go with the account. A
  guest's own rounds on its group still move to a copy of the group, on the same course. The
  privacy policy and the account-deletion page say so (#378).

- On the Score screen's hole-by-hole view, the first tap on a blank score moves off par: **+**
  enters a bogey and **−** a birdie, where both used to enter par. Par is its own tap: a blank
  score shows the player's par, faded, between the buttons, and the line under their name says
  "tap 4 for par". **−** now gives the same tick as **+**, and so does the tap for par. A screen
  reader hears "Enter par, 4, for" the player, and **−** and **+** say where they start until a
  score is in. A player who picked up keeps the dash. The whole card's keypad is unchanged.
- The tests now hold that a screen reader hears an abandoned round's ABANDONED tag in its History
  row, right after the course name, and doesn't hear it on a live or completed round. The app
  itself is unchanged.

### Fixed

- The account-deletion service now runs the same supabase-js version as the app, 2.119.2, where
  it was still on 2.118.0. Dependabot moves only the app's copy, so a new check fails until the
  service's pinned copy moves with it, and fails on an import of it with no version. Deleting an
  account works as before (#363).

## [1.4.0] - 2026-11-10

### Added

- A club's name in the bag opens its **tracked shots**, newest first: the date, course and hole,
  how far each went and carried, and for one that doesn't count, why ("round still open", "no
  finish", "from sand", "from a penalty area", "GPS too rough", "under 40% of carry" or "older than
  the latest 20"). **Delete** takes one marked with the wrong club out of the list, after asking,
  and the club's tracked carry follows. Its mark stays as where the tracked shot before it
  finished, so that one keeps its length. A club with none says "No tracked shots yet".

### Changed

- Once ten of a club's tracked shots count, the club suggestions in a practice round, or looking a
  course over, spread that club's carries the way yours have gone, in place of the figure for your
  usual score. The Bag screen says how far: "Two in three within 4 yd." Which way your shots go,
  mishits, the rough and putting still follow your usual score. Only rounds that have closed
  count, so nothing you mark in the round you're playing changes a suggestion.

## [1.3.0] - 2026-11-10

### Added

- **Try the demo** on the sign-in screen opens Press with an example group, without an account.
  Nothing is sent to Press's server, and the phone reopens on the demo until you sign in. Settings
  shows **Sign in** in place of the account section. Switching **Demo data** off, **Join an outing
  by code** and **Share this outing** need an account, so each one takes you to sign in and the
  sign-in screen says why, out loud to a screen reader too. Signing in opens your own groups and
  rounds, and the demo stays on the phone.
- **Abandon round** closes a round without posting it to the season ledger. It sits under **Post to
  the season ledger** on Settle, and in History's prompt for a round that's still going. **Keep in
  History** keeps the round, marked ABANDONED and showing no money; it never counts in the season
  ledger, and **Reopen** brings it back. **Delete round** removes it after a second confirmation. A
  round in an outing, or a scorecard being typed in (which has **Discard card**), has no Abandon.
  On an older build, an abandoned round shows as finished.
- **Mark ball** in the Score screen's yardage card, in a live round, an outing or the demo, saves
  where your ball lies and what you're about to hit. It waits up to 20 seconds for a close GPS
  fix, keeping the closest it got and saying how rough it is when none is close. Then you pick a
  club from your bag, **Not a full swing** or **On the green**, and the card says "Marked: 7
  iron". A tap on that changes what was hit, or **Undo** removes the mark. Deleting a round
  deletes its marks, and removing a club from the bag deletes the marks that name it, after the Bag
  screen says how many tracked shots go. A scorecard being typed in has no Mark ball.
- Ball marks are backed up with your account, like your bag, and reach your other phones. Nobody
  else sees them, not even someone in the same outing. A phone with no marks of its own takes the
  account's when it first syncs, and one that has marks keeps its own. Marks made on an outing
  whose organiser has deleted their account stay on the phone with that day. **Delete account**
  deletes your marks too, including those on someone else's round.
- The Bag screen shows a club's **tracked carry** once five of your marked shots with it count:
  "Tracked 152 yd, from 7 tracked shots". A tracked shot runs from a full swing you marked to the
  next mark on the same hole. It counts once its round is posted or abandoned, if it was hit from
  the tee, fairway or rough, both GPS fixes were good to 10 m, and it went at least 40% of the
  club's carry, and only a club's latest 20 count. The tracked carry is the middle of their
  carries, after taking off the roll the club suggestions allow for where the ball stopped. **Use**
  copies it into the club's carry. Press never changes a carry on its own, and club suggestions
  use only the carry in your bag.

### Changed

- The iPhone's location prompt says Press also uses your location to save where your ball lies
  when you mark it. The privacy policy says what a ball mark keeps, and that it is backed up with
  your account and seen by nobody else. The account-deletion page lists ball marks among what goes.
- The support page's "Do I need an account?" answer points to **Try the demo**.

### Removed

- The Android app no longer declares the permissions to draw over other apps and to read and write
  shared storage. They came from Expo's default Android template, and Press uses neither. The
  advertising ID permission is blocked too, so a library can't add it: Press doesn't read it, as
  the Play Store's Data safety section says.

### Fixed

- **Delete account** no longer fails once Press's server holds a lot of rounds. Deleting an account
  that had organised an outing someone else joined took longer as everyone's scores added up, and
  past about 1.5 million score rows the server gave up and Press said it couldn't delete the
  account. It now takes a fraction of a second at that size.

## [1.2.0] - 2026-11-04

### Added

- **Forgot password?** on the sign-in screen. It emails a link to the address typed there, and
  Press answers the same way whether or not that address has an account. The link opens a page on
  pressgolf.cc, on any phone or computer, where you type the new password twice and press **Set
  password**. Then you sign in to Press with it. Every phone signed in to the account is signed
  out, with its scores kept, and an email says the password was changed. Links work for an hour
  and only once.

### Changed

- The link in the email that confirms a new account opens a page on pressgolf.cc, where **Confirm
  my email** confirms it; then you sign in to Press. It no longer tries to open the app, which many
  mail apps wouldn't do, and it works from a computer too. Opening either link does nothing until
  its button is pressed, so a mail scanner that opens it first doesn't use it up.
- The support page's "I can't sign in" answer starts with **Forgot password?**, and the privacy
  policy names Cloudflare, which runs those pages, and the reset and password-changed emails.

### Fixed

- Each group has its own round going. Switching groups in Settings shows that group's round on
  Home, Score, Settle and Format, or Start a round when it has none, instead of the other group's.
  The other group's round stays open, with its scores, and is back when you switch back. Finishing
  an outing closes only that day's rounds. A round left going before this update stays open for
  the group it belongs to.

## [1.1.1] - 2026-11-03

### Fixed

- The Android app opens again. Since the move to Expo SDK 58, an Android store or preview build
  closed as soon as it was launched, before showing a screen; iPhone builds were not affected.
- Switching groups in Settings during a round no longer breaks it. The round keeps its own players:
  Score's whole card no longer crashes, and Settle still settles it.

## [1.1.0] - 2026-11-03

### Changed

- Press runs on Expo SDK 58, with React Native 0.88 and React 19.3. The screens and what they do
  are unchanged, but this version needs a new store build: it can't reach installed copies over
  the air.

### Security

- Opening a link into the app no longer goes through a URL-decoding package with a published
  advisory against it.

## [1.0.0] - 2026-11-03

### Added

- The first release recorded here. `1.0.0` is the version the app has shipped to the stores under
  so far; the changes that built it are described in their pull requests, which predate this
  changelog.
