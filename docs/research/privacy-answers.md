# What Press's privacy answers have to say

Research for [#152](https://github.com/jwh3times/PressGolf/issues/152), read from the code at
`2c0be86` (main, 2026-10-17) and from each provider's own documentation, fetched 2026-10-17.
These are draft answers. Every judgement call is marked **JC**, and the store forms are filled
in by the developer, not by this note.

## Headline

- Press sends data to four places: the project's Supabase (account and everything typed in), the
  OpenStreetMap servers (course-name searches and course-map downloads), the map SDK (Apple Maps
  on iOS, Google Maps on Android), and nothing else. There are no ads, no analytics, no crash
  reporter and no purchases. `package.json` has no such dependency, `expo-updates` is not
  installed, and the lockfile has no `expo-updates`, `expo-insights`, Sentry or Firebase.
- Everything stored on the server is linked to the account. None of it is used for tracking.
- A precise location does leave the phone. When a user marks a green by standing on it, that GPS
  fix is saved as the green's middle (`source = 'marked'`) and synced to Supabase.
- Names and handicaps of other people that the user types in are synced to the account, and
  guests of a shared outing can see the ones in that outing's field.
- Account deletion doesn't exist yet. Both stores require it: Apple in the app, Google in the app
  and on the web. Signing out clears only this phone's session.

## 1. Data inventory

"Synced" means upserted to Supabase while signed in with demo data off
(`syncEnabled = state.ready && !state.demoMode && auth.status === 'signed-in'`,
`src/store/AppStore.tsx`). When the build has a server configured, signing in is required
(`src/auth/AuthGate.tsx`), so syncing is the normal case, not an opt-in. Data typed in before
signing in goes up at the first sync (`reconcile`, `src/sync/remote.ts`).

| Data | Goes to | Why | Linked to account | Visible to other users | Kept | User can delete today |
|---|---|---|---|---|---|---|
| Email address and password | Supabase Auth (`signUp`/`signInWithPassword`, `src/sync/supabase.ts`). Email also kept on the phone under `press:auth:remembered-email` (`src/auth/AuthProvider.tsx`) | Sign-in, backup, sharing | Yes, it is the account | No | Until the account is deleted, which no app path does | No. Sign-out is `scope: 'local'` and clears only the phone (`src/sync/supabase.ts`) |
| Supabase user ID (UUID) | Supabase: `owner_id` / `user_id` on every row (`supabase/migrations/20260921000000_initial_schema.sql`) | Ownership and access control | Yes | Outing members can read each other's `outing_members` rows (`"read your memberships"` policy) | As for the account | No |
| IP address, user agent, sign-in events | Supabase platform: auth audit log and API logs, captured automatically ([audit logs](https://supabase.com/docs/guides/auth/audit-logs)). Each request carries an `X-Client-Info` SDK header | Operating the service | Auth audit entries carry the user ID | No | Depends on the Supabase plan: 1 hour of auth audit logs and 1 day of API logs on Free, up to 28 days on Team ([pricing](https://supabase.com/pricing)). Also in `auth.audit_log_entries` unless that is switched off | No |
| Groups, rosters: player **names**, initials, colour, **handicap index** and when it was entered | Supabase `groups`, `players` (`…initial_schema.sql`, `20260929000000_handicaps.sql`) | Scoring, pops | Yes, owned by the user | Players in a shared outing's field, and that outing's group row, are readable by its members (`shared_player`, `shared_group`) | Until deleted | Remove a player (`src/app/roster.tsx`). A group can't be deleted in the UI (`deleteGroup` exists in the store, no screen calls it) |
| Rounds and cards: scores, pick-ups, junk, presses and **stake amounts** (cents), Wolf picks, games, sides, tee choices | Supabase `rounds`, `round_players`, `scores`, `junk`, `presses`, `wolf_picks`, `round_games`, `round_options`, `round_teams`, `round_pairings` | Scoring and settling | Yes | Rounds in a shared outing, and everything hanging off them, are readable by members. Members write scores and junk on the shared card, owned by the writer (`"guests score shared"`) | Until deleted | Delete a round (`src/app/history.tsx`). Local deletions are pruned from the server at the next sync (`pushSnapshot` prune, `src/sync/remote.ts`) |
| Outings: name, date, field, field games, join code, membership, and a guest's **display name** (their own player's name, sent on join, `src/app/join.tsx`) | Supabase `outings`, `outing_field*`, `outing_members` (`join_outing`) | Several groups playing one day | Yes | Members of that outing | Until deleted | No outing-delete or leave-outing in the UI. `outing_members` has no delete policy |
| Courses: name, tees, slope/rating, hole cards | Supabase `courses`, `tees`, `tee_holes` (`20260928000000_tee_sets.sql`) | Scoring | Yes | Members of an outing on that course | Until deleted | Delete a course (`src/app/courses.tsx`) |
| Greens: middle/front/back coordinates. A `marked` green is **the phone's precise GPS fix**, taken at 3 m or better while standing on it (`src/components/GreenYardage.tsx`, `src/hooks/useLiveLocation.ts`). Others are tapped on a map or imported from OSM | Supabase `course_greens` (`20261015000000_course_greens.sql`) | Distance to the green | Yes | Members of an outing on that course | Until deleted | Re-mark it, or delete the course |
| Course map: outlines, hole lines, out-of-bounds lines (OSM or drawn), hole notes (up to 280 characters of free text) | Supabase `course_features`, `course_hole_notes` (`20261015120000_course_features.sql`, `20261016120000_course_hole_notes.sql`) | Hole map, hazards, advice | Yes | Members of an outing on that course | Until deleted | Delete the course |
| Bag: club names and carries, usual score | Supabase `clubs`, `bag_settings` (`20261015180000_clubs.sql`, `20261017120000_bag_settings.sql`) | Club suggestions | Yes | No, there is no guest policy | Until deleted | Remove a club (`src/app/bag.tsx`) |
| Live location (foreground, when-in-use only; the permission text is in `app.json`) | Stays on the phone for yardage (`useLiveLocation`, which runs for 60 s per tap). The map's blue dot (`showsUserLocation` in `src/components/GreenMap.tsx`, `src/components/HoleSatellite.tsx`) is drawn by the map SDK | Distance to the green | — | No | Not stored, except as a marked green | — |
| Course-name search text | OSM Nominatim, `nominatim.openstreetmap.org/search` (`findCourses`, `src/osm/client.ts`), one request per tap, with a `PressGolf/1.0` User-Agent | Finding the course | No identifier is sent. The servers see the IP address | No | OSMF keeps network access data such as IP addresses "temporarily" ([OSMF privacy policy](https://osmfoundation.org/wiki/Privacy_Policy)) | — |
| The chosen course's OSM id (an Overpass query, not the user's location) | One of three public Overpass servers, tried in turn: `overpass-api.de` (FOSSGIS), `maps.mail.ru`, `overpass.private.coffee` (`OVERPASS_URLS`, `src/osm/client.ts`) | Downloading the course map | No identifier is sent. The servers see the IP address | No | Set by each operator. No published retention found ([Overpass API wiki](https://wiki.openstreetmap.org/wiki/Overpass_API)) | — |
| Map viewport and tile requests; on Android, SDK telemetry | Apple Maps (iOS) or Google Maps SDK for Android, through `react-native-maps` (`app.config.js`) | Satellite maps | See §2 | No | Set by Apple or Google | — |
| Local copy of all of the above, plus settings and theme | Phone only: AsyncStorage `press:live` / `press:demo`, `press:settings`, `press:theme` (`src/store/persistence.ts`, `src/config/flags.ts`) | Works offline | — | No | Until the app is uninstalled. Sign-out leaves rounds on the phone (`src/app/settings.tsx`) | Uninstall |

Not collected: contacts, photos, payment details, advertising IDs, device IDs. The per-install
`deviceId` (`src/sync/engine.ts`) belongs to the `mutations` log, and only tests use that log
today. No screen sends it, so the `mutations` table is empty in practice. Fonts are bundled
(`@expo-google-fonts/*`, `src/app/_layout.tsx`), not fetched. The only outbound links open
`openstreetmap.org/copyright`.

## 2. What the third-party SDKs and services collect themselves

| Party | What it says it collects | Role | Source |
|---|---|---|---|
| Google Maps SDK for Android | Always: OS version and device make, model and form factor; SDK version; an "Internal Usage Attribution Identifier"; stack traces and crash metrics; IP address; "a Maps SDK-specific pseudonymous identifier" for counting daily users. When the camera APIs are used (they are: `setCamera`, `fitToCoordinates`, `animateToRegion` in `src/components/HoleSatellite.tsx` and `GreenMap.tsx`), pan and zoom events. Purpose: "maintain and improve Google services". The developer is "solely responsible" for the Data safety answers | Google is an independent controller under the Controller-Controller Data Protection Terms (Terms §4.4(b)). It receives "search terms, IP addresses, and latitude/longitude coordinates" (§4.4(a)) | [Play data disclosure](https://developers.google.com/maps/documentation/android-sdk/play-data-disclosure) (updated 2026-10-15); [Maps Platform Terms](https://cloud.google.com/maps-platform/terms) |
| Apple MapKit | Apple Maps uses a rotating identifier "not tied to your Apple Account" and fuzzes precise locations within 24 hours. The developer is "not responsible for disclosing data collected by Apple" | Apple | [App Privacy Details](https://developer.apple.com/app-store/app-privacy-details/); [Apple Maps privacy](https://www.apple.com/legal/privacy/data/en/apple-maps/) |
| Supabase (supabase-js 2.117) | No client telemetry: the installed source sends requests only to the project URL, and OpenTelemetry headers are opt-in, "disabled by default". The server keeps the auth user record (email, created and last-sign-in times), and auth audit entries with IP address and user agent | Processor ("primarily as a processor"), with a DPA. Data is stored in the region chosen for the project | `node_modules/@supabase`; [SupabaseClientOptions](https://jsr.io/@supabase/supabase-js@2.108.2/doc/~/SupabaseClientOptions); [users](https://supabase.com/docs/guides/auth/users); [privacy](https://supabase.com/privacy); [DPA](https://supabase.com/legal/customer-resources/data-processing-addendum); [regions](https://supabase.com/docs/guides/platform/regions) |
| OSM Nominatim (OSMF) | Network access data such as IP addresses, kept temporarily. Queries may be analysed to find missing addresses. Hosted in the UK and the Netherlands. The usage policy says "do not submit personal data" | Independent third party | [Nominatim policy](https://operations.osmfoundation.org/policies/nominatim/); [OSMF privacy](https://osmfoundation.org/wiki/Privacy_Policy) |
| Overpass servers | No privacy statement on the wiki or on overpass-api.de. The other two instances are run by other operators | Independent third parties | [Overpass API wiki](https://wiki.openstreetmap.org/wiki/Overpass_API) |
| Expo | Nothing at runtime today: no `expo-updates` (the `channel` entries in `eas.json` have no effect without it). If EAS Update is added, each update check sends the OS, project and runtime IDs, a random `EAS-Client-ID`, and the last fatal launch error (`Expo-Fatal-Error`), and Expo sees the IP address | Service provider | [Expo privacy explained](https://expo.dev/privacy-explained); [expo-updates spec](https://docs.expo.dev/technical-specs/expo-updates-1/); [FileDownloader.kt (SDK 57)](https://raw.githubusercontent.com/expo/expo/sdk-57/packages/expo-updates/android/src/main/java/expo/modules/updates/loader/FileDownloader.kt) |

## 3a. Draft Apple App Privacy label

Definitions are from [App Privacy Details](https://developer.apple.com/app-store/app-privacy-details/).
"Collect" means sent off the phone and kept longer than it takes to serve the request. Data
processed only on the phone is not collected, and data Apple collects is not the developer's to
declare.

**Tracking: No.** Press links nothing with third-party data for advertising and shares nothing
with data brokers.

| Data type | Collected | Linked | Purpose | Notes |
|---|---|---|---|---|
| Contact Info → Email Address | Yes | Yes | App Functionality | The account |
| Contact Info → Name | Yes | Yes | App Functionality | **JC**: player names are mostly *other* people's, and a guest's display name is their own. Declaring Name is the safe reading |
| Location → Precise Location | Yes | Yes | App Functionality | **JC**: only a *marked* green stores the fix, and it describes the green, but it is where the user stood, and it is synced. Live yardage stays on the phone. Leaving it out would be defensible only if marking by GPS were removed |
| User Content → Other User Content | Yes | Yes | App Functionality | Scores, courses, greens tapped on a map, course features, hole notes, bag |
| Identifiers → User ID | Yes | Yes | App Functionality | The Supabase account UUID |
| Search History | **JC**: No | — | — | The course name goes to Nominatim, which Press doesn't control and has no partnership with, and serves the request in real time. OSMF keeps IP addresses briefly and may analyse queries. If you want to be conservative: Yes, Not Linked, App Functionality |
| Health & Fitness → Fitness | **JC**: No | — | — | A handicap index is golf performance, not exercise data in Apple's sense. Some golf apps do declare it |
| Financial Info → Other Financial Info | **JC**: No | — | — | Stakes and settlements are amounts in a side game between friends, not the user's finances. Declare them under Other User Content |
| Diagnostics, Usage Data, Device ID, Purchases, Contacts, Photos, Browsing | No | — | — | No crash reporter or analytics. MapKit is Apple's |

The optional-disclosure exemption doesn't apply to any of these. They are part of the app's main
function, and location is collected after a permission prompt.

## 3b. Draft Google Play Data safety form

Definitions are from [Data safety](https://support.google.com/googleplay/android-developer/answer/10787469).
"Collected" means sent off the phone, to you or to any third-party server, and that includes SDK
code such as the Maps SDK. "Shared" means transferred to a third party. Transfers to a service
provider (Supabase) and transfers the user starts and expects are not sharing.

**Security section**
- Collects or shares data: **Yes**.
- Encrypted in transit: **Yes**. The Supabase URL, Nominatim, Overpass and the Maps SDK all use
  HTTPS (`src/osm/client.ts`). Confirm the production `EXPO_PUBLIC_SUPABASE_URL` is `https`.
- Users can request deletion: **only once a deletion path exists** (§4). Until then the answer
  is No.
- Account creation: the form asks for the in-app deletion path and a web deletion URL
  ([account deletion requirements](https://support.google.com/googleplay/android-developer/answer/13327111)).

| Data type | Collected | Shared | Required or optional | Purposes | Notes |
|---|---|---|---|---|---|
| Personal info → Email address | Yes | No | Required | Account management, App functionality | |
| Personal info → Name | Yes | No | Optional | App functionality | **JC**, as on Apple |
| Personal info → User IDs | Yes | No | Required | Account management, App functionality | |
| Location → Precise | Yes | **JC**: No | Optional | App functionality | A marked green goes to Supabase, a service provider. Google's terms say the Maps SDK receives coordinates, which Google keeps as controller. Treating that as sharing is the conservative answer |
| Location → Approximate | **JC**: No | — | — | — | Only implied by the IP address the Maps SDK sends. Its disclosure page doesn't list location |
| App activity → Other user-generated content | Yes | No | Required (a signed-in user's cards always sync) | App functionality | Scores, courses, notes, bag, stakes |
| App activity → In-app search history | **JC**: Yes | No (the user starts it and expects it) | Optional | App functionality | Course names sent to Nominatim. Collection on Play covers third-party servers, and OSMF's logs are not purely in memory |
| App activity → App interactions | **JC**: Yes | **JC** | Required on Android | Analytics (Google's) | The Maps SDK's pan and zoom events. Its purpose is "maintain and improve Google services" |
| App info and performance → Crash logs, Diagnostics | Yes (Maps SDK) | **JC** | Required on Android | Analytics | The Maps SDK's stack traces, crash metrics and device metadata. Press itself collects none |
| Device or other IDs | Yes (Maps SDK) | **JC** | Required on Android | Analytics | The SDK's pseudonymous identifier |
| Financial info, Health and fitness | **JC**: No | — | — | — | As on Apple |

**JC on Maps SDK "shared":** Google acts as an independent controller (Terms §4.4(b)), so it is
not a service provider. It still collects through SDK code in the app, and Google's page leaves
the answer to the developer. The conservative answer is to mark the Maps SDK rows Shared, with
purpose Analytics. Check Google's disclosure page again on each `react-native-maps` update.

## 4. What the privacy policy must state

| Topic | What to say | Where the app has no answer yet |
|---|---|---|
| Who and how to reach them | The developer's name and a contact email ([5.1.1(i)](https://developer.apple.com/app-store/review/guidelines/), Play's privacy policy field) | No policy URL or contact address exists, and no `privacyPolicy` is set in `app.json` |
| What is collected | The table in §1: account email, user ID, names and handicaps of the players the user enters, scores and stakes, courses, greens (including GPS-marked ones), maps, notes, bag; service logs including IP addresses | — |
| Other people's data | Users type in other players' names and handicaps. Members of a shared outing see the field's names, scores and the course | Nothing tells users this, and there is no way for a named non-user to ask for removal other than contacting the developer |
| Location | Foreground only, on request. Used on the phone for distances. Saved only when the user marks a green, and then synced and visible to outing members on that course. Required by Maps Terms §4.4(c)(iii): tell users in advance, and obtain "express, prior, revocable consent" | The permission prompt says only "distance to the green". It doesn't mention marking (`app.json`). **JC**: whether to say so in the prompt or before marking |
| Purposes | Running the app: sign-in, backup across devices, shared outings, maps. No ads, analytics, tracking or sale | — |
| Third parties | Supabase (hosting, processor, region to name); OpenStreetMap Foundation (Nominatim) and the Overpass operators (course searches); Google (Maps on Android); Apple (Maps on iOS). Maps Terms §3.2.2(a)(i) requires the terms to say the app includes Google Maps and is subject to the [Google Maps Additional Terms](https://maps.google.com/help/terms_maps/) and the [Google Privacy Policy](https://policies.google.com/privacy) | No terms of service exist |
| Retention | Account data is kept until the user deletes it or the account. Service logs follow the Supabase plan. Local data is kept until uninstall | No retention period has been chosen, and nothing deletes inactive accounts. Play also wants retention stated on the deletion page |
| Deletion | How to delete rounds, courses, players and clubs (synced deletions remove them from the server), and how to delete the account and everything it owns | **No account deletion.** Apple requires it in the app ([5.1.1(v)](https://developer.apple.com/app-store/review/guidelines/), [offering account deletion](https://developer.apple.com/support/offering-account-deletion-in-your-app/)). Google requires an in-app path and a web page ([answer 13327111](https://support.google.com/googleplay/android-developer/answer/13327111)). Also missing: deleting a group or an outing, leaving an outing, and deciding what happens to a guest's scores in someone else's outing when either account is deleted |
| Security | Encrypted in transit. Access is limited to the owner and to members of an outing they joined | — |
| Children | Not aimed at children under 13, and no knowing collection from them. Pick the stores' age ratings to match. **JC**: whether stake amounts call for a higher age rating, which is an age-rating question rather than a privacy one | — |
| Region | US only. US state privacy laws (e.g. California's) may still ask for a "do not sell or share" statement. Press sells nothing, so the policy says that | **JC**: whether to name state-law rights explicitly |
| Changes | How users are told the policy has changed | — |

## Open judgement calls

1. Whether a GPS-marked green counts as the user's precise location. This draft says yes, on
   both stores.
2. Whether player names count as Name. This draft says yes.
3. Whether handicaps count as fitness data, and stakes as financial data. This draft says no to
   both and puts them under user content.
4. Whether course-name searches to Nominatim count as search history. This draft says no for
   Apple and yes for Play.
5. Whether the Maps SDK telemetry on Android counts as Shared, and with which purpose.
6. How account deletion will work: in the app, on a web page, what it removes (including a
   guest's scores on someone else's card), and how long it takes.
7. Whether to add expo-updates later, which would put Expo on both forms.
