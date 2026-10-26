# Production backend facts: Supabase plan, auth email, account deletion

Research for [#153](https://github.com/jwh3times/PressGolf/issues/153). Sources were read on
**2026-10-17**. Prices and quotas are point-in-time; the linked pages are authoritative. Nothing
here decides product rules.

## 1. Supabase Free vs Pro

**Free-plan pausing** ([free-project-pausing](https://supabase.com/docs/guides/platform/free-project-pausing))

- A project is paused after "low activity over a 7-day period".
- "A few user requests to the database each day" counts as activity. Supabase warns this may still not be enough.
- The owner gets a warning email about a week before the pause.
- While paused, API calls return **HTTP 540** ([status codes](https://supabase.com/docs/guides/troubleshooting/http-status-codes)).
- To restore, the owner clicks *Resume project* in the dashboard. Data and config come back. A restore window of 1 year is stated; how long a restore takes was not found.

**Free limits** ([pricing](https://supabase.com/pricing))

- 2 active projects.
- 50,000 MAU.
- 500 MB database. Over that, the project goes read-only ([database-size](https://supabase.com/docs/guides/platform/database-size)).
- 5 GB egress and 1 GB storage.
- 500k Edge Function calls.
- 1-day log retention.
- **No backups.** Supabase suggests regular `supabase db dump` ([backups](https://supabase.com/docs/guides/platform/backups)).
- Going over quota leads to a grace period, then possible restrictions or HTTP 402 ([billing FAQ](https://supabase.com/docs/guides/platform/billing-faq)).

**Pro**

- From **$25/month**, which includes $10 of compute credit (one Micro instance) ([pricing](https://supabase.com/pricing)).
- Never paused.
- 100k MAU, 8 GB disk, 250 GB egress, 100 GB storage, 2M function calls, 7-day logs.
- **Daily backups, kept 7 days.** Storage objects are not included in these backups ([backups](https://supabase.com/docs/guides/platform/backups)).
- **PITR** is a paid add-on, about $100/month for 7 days. It also requires at least the Small compute add-on.

**Spend cap** ([cost-control](https://supabase.com/docs/guides/platform/cost-control))

- On by default for Pro.
- When the cap is on and you go over quota, "further usage of that item is disallowed until the next billing cycle".
- Compute and PITR are not covered by the cap.
- When the cap is off, overage is billed.

## 2. Auth email

**Built-in sender** ([auth-smtp](https://supabase.com/docs/guides/auth/auth-smtp), [rate-limits](https://supabase.com/docs/guides/auth/rate-limits))

- Limited to **2 emails/hour per project**. Requests over the limit return 429.
- It only delivers to members of the project's team. Any other address fails with "Email address not authorized".
- Supabase says it "is not meant for production use".

The app already works around the 2/hour cap with a resend button (`src/sync/supabase.ts`, `resendConfirmation`). It has no password-reset call yet; `resetPasswordForEmail` appears nowhere in `src/`.

**Custom SMTP** ([auth-smtp](https://supabase.com/docs/guides/auth/auth-smtp))

- You enter host, port, username, password, sender address and sender name, under Authentication settings or through the Management API.
- The email rate limit starts at **30/hour**. You can change it under Authentication → Rate Limits.
- Supabase recommends:
  - SPF, DKIM and DMARC.
  - A custom domain, ideally a separate one for auth mail.
  - No marketing mail mixed in.
  - Few links per message.
  - CAPTCHA.

**Providers** (point-in-time, 2026-10-17)

| | Free allowance | Can you send from Gmail/Proton? | DNS setup | Gate before real sending |
|---|---|---|---|---|
| [Resend](https://resend.com/pricing) | 3,000/mo, max 100/day | No. Its test sender only reaches your own address ([doc](https://resend.com/docs/knowledge-base/403-error-resend-dev-domain)) | DKIM TXT, plus SPF/MX on a `send.` subdomain ([doc](https://resend.com/docs/add-a-domain)) | None found. Has a [Supabase SMTP guide](https://resend.com/docs/send-with-supabase-smtp) |
| [Postmark](https://postmarkapp.com/pricing) | 100/mo | No, needs a domain you control ([blog](https://postmarkapp.com/blog/why-cant-i-use-gmail-address)) | DKIM TXT, plus Return-Path CNAME ([doc](https://postmarkapp.com/support/article/how-do-i-verify-a-domain)) | Manual account approval ([doc](https://postmarkapp.com/support/article/1084-how-does-the-account-approval-process-work)) |
| [Amazon SES](https://aws.amazon.com/ses/pricing/) | No permanent free tier: new-account credits, then $0.10 per 1,000 | Lets you verify a single address ([doc](https://docs.aws.amazon.com/ses/latest/dg/creating-identities.html)), but free-mail DMARC defeats it (see below) | 3 DKIM CNAMEs | Sandbox (verified recipients, 200/day) until production access is granted ([doc](https://docs.aws.amazon.com/ses/latest/dg/request-production-access.html)) |
| [Brevo](https://help.brevo.com/hc/en-us/articles/208580669-FAQs-What-are-the-limits-of-the-Free-plan) | 300/day | No. Free domains "cannot be authenticated" | Brevo code, DKIM, DMARC | None found |

The Brevo rows come from help-centre summaries, because the pages refused direct fetch.

**Without a domain:**

- Google tells senders not to impersonate Gmail `From:` headers. Gmail applies quarantine to such mail ([sender guidelines](https://support.google.com/a/answer/81126)).
- `proton.me` publishes strict-alignment `p=quarantine` DMARC (live DNS check, 2026-10-17).
- So no provider can reliably send confirmation or reset mail "from" a Gmail or Proton address. A domain you own (a subdomain such as `auth.` or `send.` is recommended) is the practical precondition.
- Cloudflare Registrar sells domains at cost with no markup ([registrar](https://www.cloudflare.com/products/registrar/)). Per-TLD prices were not found there.

## 3. Self-service account deletion

**What Supabase documents** ([managing-user-data](https://supabase.com/docs/guides/auth/managing-user-data))

- Users can be deleted "directly or via the management console".
- For server code, `auth.admin.deleteUser(id, shouldSoftDelete?)` needs the service-role key and "should only be called on a server" ([reference](https://supabase.com/docs/reference/javascript/auth-admin-deleteuser)).
- Soft delete is irreversible and keeps a hashed ID.
- A user who owns Storage objects can't be deleted until those objects are removed or reassigned.
- A foreign key to `auth.users` without `CASCADE`/`SET NULL` makes deletion fail with "Database error deleting user" ([troubleshooting](https://supabase.com/docs/guides/troubleshooting/dashboard-errors-when-managing-users-N1ls4A)).

**(a) A `security definer` RPC that deletes from `auth.users` where id = `auth.uid()`**

- No doc page endorses this or forbids it.
- The `auth` schema is owned by `supabase_auth_admin`. Changes to it risk breaking Auth ([permissions](https://supabase.com/docs/guides/platform/permissions)).
- The April 2025 lockdown blocks DDL in `auth` but says nothing about DML ([discussion](https://github.com/orgs/supabase/discussions/34270)).
- A staff answer from 2021 suggested a stored procedure; later maintainer replies point to Edge Functions instead ([discussion](https://github.com/orgs/supabase/discussions/1066)).
- Requirements ([functions](https://supabase.com/docs/guides/database/functions)):
  - The function is owned by `postgres`, the migration default.
  - Set `search_path = ''` and use schema-qualified names.
  - Run `revoke execute … from public, anon` and `grant … to authenticated`.

**(b) An Edge Function with the service role**

- `functions.invoke` sends the user's JWT ([functions/auth](https://supabase.com/docs/guides/functions/auth)).
- `verify_jwt` defaults to on.
- The function must take the user ID from the verified claims, never from the request body. It then calls `auth.admin.deleteUser`.
- This needs no `auth`-schema SQL. It does add a deployed function, and the repo has no `supabase/functions/` today.

**(c) The dashboard (Authentication → Users)** is manual, operator-only deletion.

**Sessions**

- A hard delete cascades to sessions and refresh tokens.
- An access JWT that was already issued stays valid until it expires ([managing-user-data](https://supabase.com/docs/guides/auth/managing-user-data)). The local config sets `jwt_expiry = 3600` (`supabase/config.toml`).
- Afterwards the client should clear its session locally: `signOut({ scope: 'local' })` ([signOut](https://supabase.com/docs/reference/javascript/auth-signout)). That step is an inference; no doc states it.

**Store rules**

- Apple 5.1.1(v): an app with account creation must offer deletion **in the app** ([guidelines](https://developer.apple.com/app-store/review/guidelines/), [guidance](https://developer.apple.com/support/offering-account-deletion-in-your-app/)).
- Google Play requires an in-app path **and** a web link for requesting deletion, entered in the Data safety form. Deactivation doesn't count ([Play help](https://support.google.com/googleplay/android-developer/answer/13327111?hl=en)).

**This schema today** (`supabase/migrations/`)

- **No table references `auth.users`.** Every `owner_id`, `outing_members.user_id` and `mutations.user_id` is a bare `uuid default auth.uid()`.
- So deleting an auth user removes **no** public rows and is never blocked by them. The rows stay, keyed to an ID nobody can sign in as.
- The project uses no Storage buckets (`supabase/config.toml`, `src/`).

How rows hang together, which matters to any cleanup that deletes by `owner_id`:

- **Owner-only, no dependants:**
  - `clubs`, `bag_settings`.
  - Course children: `holes`, `tees`, `tee_holes`, `course_greens`, `course_features`, `course_hole_notes`. All cascade from `courses`.
- **`groups`** cascades to `players`, `rounds` and `outings`.
  - Rounds and outings may be created on a group *shared* with you through an outing (`20261016180000_writes_under_your_own.sql`).
  - So deleting an organiser's group also cascades to guests' own rounds and outings on it.
- **`courses`**: `rounds.course_id` and `outings.course_id` have **no ON DELETE** (NO ACTION).
  - A course can't be deleted while any round or outing points at it, including a guest's round on a shared course.
  - Cleanup must delete rounds and outings before courses, and other users' rows can block it.
- **`rounds`** cascade to every round child.
  - Guests insert their own `scores`/`junk` rows into an organiser's shared round, with `owner_id` set to the guest ("guests score shared", `20260921000000_initial_schema.sql`).
  - So one card holds rows owned by several users.
  - Deleting the round removes the guests' rows. Deleting a guest's rows by `owner_id` removes cells from the organiser's card.
  - `rounds.outing_id` is not a foreign key.
- **`outings`** cascade to `outing_field*`, all members' `outing_members` rows, and the whole `mutations` log, which holds every member's edits.
- **`mutations`** has no update or delete policy for anyone, so removing a user's entries needs a definer function or the service role.
- **If the organiser's rows are left in place:**
  - Guests keep read access through `is_member` and the `shared_*` functions.
  - They can still score on shared rounds.
  - Nobody can edit or delete the organiser's rows under RLS.

## 4. Redirect URLs for `press://`

**What the docs say** ([redirect-urls](https://supabase.com/docs/guides/auth/redirect-urls), [native deep linking](https://supabase.com/docs/guides/auth/native-mobile-deep-linking))

- The **Site URL** is the default target for email links. It starts as localhost, so it must be changed.
- `emailRedirectTo` must match the **Redirect URLs** allow list.
- In the allow list, `*` matches within a URL segment and `**` matches across `/`.
- For production, the docs recommend exact URLs and keeping `**` for development.
- Supabase's Expo example allow-lists `scheme://**` and handles the link with `setSession`.
- A `redirectTo` that isn't allowed silently falls back to the Site URL ([auth source](https://github.com/supabase/auth/blob/master/internal/utilities/request.go)).

**Applied to this app** (an inference, not a documented example)

- The app sends `Linking.createURL('/')` (`src/sync/supabase.ts`) with `detectSessionInUrl: false` and has no link handler.
- So: set the Site URL to a `press://` URL and allow-list the exact URLs the release build produces, or `press://**`.
- If password reset is added, it will need a handler that consumes the link.
