# Changelog

Every notable change to Press is recorded here, in the form of
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). A change to the app, the support site,
the schema or the Edge Function adds its entries under `Unreleased`. A release moves them into a
dated section and sets `package.json` and `app.json`'s `expo.version` to the new version; the
maintainer tags `v<version>` on `main` after it merges (`docs/agents/releases.md`).

## [Unreleased]

No unreleased changes.

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
