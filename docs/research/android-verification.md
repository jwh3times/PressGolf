# Play Console device verification and the closed test, without an Android phone of our own

Research for [#151](https://github.com/jwh3times/PressGolf/issues/151). Checked 2026-10-17 against
Google's Play Console Help. Google's pages change without notice, so check them again before
acting on anything here. "Not stated" means Google's official pages don't answer the point. It
doesn't mean the answer is no.

## 1. Android device verification (new personal accounts)

Source for this section unless noted:
[Device verification requirements for new developer accounts](https://support.google.com/googleplay/android-developer/answer/14316361?hl=en).

- **What it is.** New personal accounts "will be required to verify that they have access to a
  real Android mobile device" through the Play Console mobile app before an app can be made
  available on Google Play.
- **Steps.** Sign in to the web Play Console as the account owner. On Home, open the task "Verify
  that you have access to an Android mobile device" and scan its QR code. That installs or opens the
  Play Console app. Sign in there as the account owner, select the developer account, tap
  **Verify**, then follow the prompts. Google says it "should take less than a minute".
- **Device bar.** "Any non-rooted physical Android mobile device that runs at least the Android 10
  operating system." The word *physical* rules out an emulator.
- **Keeping the device.** Not required. Google's answer: "No. We may ask you to verify in the
  future, but you will not have to use same device."
- **Reusing a device.** "You can use the same device to verify multiple accounts." The device's
  phone number isn't used or collected, so it doesn't have to match the sign-up number.
- **Someone else's phone.** Not stated. The page requires only that the account owner signs in on
  the device. It doesn't say who owns the device or whether you can sign out afterwards. Nothing
  forbids a friend's phone, but nothing explicitly allows it either.
- **Minimum Android version for the Play Console app.** The Play listing's "Requires Android"
  value isn't in the listing's static page, so it wasn't found
  ([listing](https://play.google.com/store/apps/details?id=com.google.android.apps.playconsole)).
  The verification bar above, Android 10, is the number that counts.
- **Deadline.** None stated for device verification. Device verification must come before
  contact-phone verification. For individual accounts, the prerequisites are identity
  verification and device verification, and "phone number verification can't proceed until these
  prerequisites are met"
  ([Verify your developer identity information](https://support.google.com/googleplay/android-developer/answer/10841920?hl=en)).
- **Not the same thing.** *Android developer verification* is the 2026 package-name registration
  for certified devices. It's a separate programme. For an app created in Play Console, "Google
  Play automatically registers the package name"
  ([developer.android.com](https://developer.android.com/developer-verification/guides/google-play-console)).

## 2. Closed test: 12 testers, 14 days

Source unless noted:
[App testing requirements for new personal developer accounts](https://support.google.com/googleplay/android-developer/answer/14151465?hl=en).

- **Scope.** Personal accounts created after 13 November 2023. Production and pre-registration stay
  disabled until the requirement is met.
- **Rule.** At least 12 testers must be opted in when you apply, and they must have been opted in
  continuously for the preceding 14 days.
- **Continuity.** Testers who opt in, test for fewer than 14 days and then opt out don't count. A
  tester who opts out and later opts back in counts only if the 14 days are consecutive.
- **Uninstalling.** Not stated. Google measures *opted in*, not *installed*. A second-hand
  community guide claims rejections cite testers who "did not have your app installed" or "did not
  actively test the app daily"
  ([community guide, not Google policy](https://support.google.com/googleplay/android-developer/community-guide/255621488/everything-about-the-12-testers-requirement?hl=en)).
  Treat that claim as unverified.
- **Physical devices for testers.** Not stated, either here or in
  [Set up an open, closed, or internal test](https://support.google.com/googleplay/android-developer/answer/9845334?hl=en).
- **Distinct accounts.** Each tester joins with a Google Account or a Google Workspace account and
  "each tester needs to opt in using the link" (same page). Testers are added by email list or
  Google Group. Whether 12 must be 12 different people isn't stated, but the count is of opted-in
  accounts.
- **Developer's own account counting as one of the 12.** Not stated.
- **Engagement Google asks for.** Give testers clear instructions and a feedback channel. Tell them
  to stay opted in for at least 14 days. Encourage them to use as many features as possible, and
  recruit people who resemble the target audience. Keep a record of feedback, because the
  application asks for a summary. Google may require more testing if there were fewer than 12
  opted-in testers or "insufficient tester engagement".
- **The production-access application** (Dashboard, then **Apply for production**) has three
  parts:
  - *About your closed test*: how easy recruiting was, whether testers used all features, whether
    usage matched expected production use, and a summary of feedback and how it was gathered.
  - *About your app*: target audience, value proposition, and expected installs in the first year.
  - *Production readiness*: what changed after the test, and how you decided the app was ready.
- **Review time.** "Usually seven days or less", though it can take longer. Google sends an email
  when review finishes. If it isn't approved, you may need to keep running the closed test.

## 3. Other onboarding steps that affect timing

- **Identity verification.** A US individual submits a US government photo ID (passport, state
  ID, driving licence or permanent resident card). The photo must be in colour, not expired and not
  a photocopy. Proof of address must be issued within the last 90 days. Name and address must match
  the Google payments profile *exactly*
  ([accepted documents](https://support.google.com/googleplay/android-developer/answer/15633622)).
  Review time: not stated.
- **Contact details.** The contact email, contact phone and developer email are each verified with
  a one-time code, and they must "remain operational for the duration of your developer account"
  ([required information](https://support.google.com/googleplay/android-developer/answer/13628312?hl=en)).
  Phone verification waits on identity verification and device verification (see section 1).
- **What's shown publicly for a personal account.** Legal name, country and developer email. The
  full address is shown only if you monetize with paid apps or in-app products, and some regions
  show more. A phone number isn't shown
  ([required information](https://support.google.com/googleplay/android-developer/answer/13628312?hl=en)).
  Press is free, so the home address stays off the listing unless that changes.
- **Payment method verification** (monetizing accounts only) "can take up to 5 days" (same page).
- **Inactivity closure.** An account without apps is closed if it is more than a year old and has
  never submitted an app for review. Notice comes 60, 30 and 7 days before closure, and the fee
  isn't refunded. A closed-testing upload counts as a way to keep the account active
  ([closure of inactive accounts](https://support.google.com/googleplay/android-developer/answer/11605267?hl=en)).

## 4. Recommendation (ours, not Google's)

1. **Device verification on the friend's phone.** It meets every rule Google states: physical,
  Android 10 or later, not rooted, and the device needn't be kept. Sign in to the Play Console app
  as the developer account, verify, then remove that account from the phone. Google may ask for
  verification again later, so keep access to the friend's phone, or budget for a cheap
  Android 10+ phone as a fallback. An emulator won't do.
2. **Order of steps.** Do identity verification first, then device verification, then phone
  verification. Have the ID and a proof of address under 90 days old ready, with the payments
  profile name and address matching them exactly.
3. **Closed test: recruit 15 or more testers, not exactly 12.** Use distinct real people on their
  own phones, so that one opt-out doesn't reset the count. Ask them to keep Press installed and
  open it during the 14 days. Don't count the developer's own account. Keep a feedback log from the
  start, because the application asks for a summary of it.
4. **Calendar.** Plan on at least 14 days of closed testing plus up to 7 days of review, about
  three weeks, after the testers are opted in.
