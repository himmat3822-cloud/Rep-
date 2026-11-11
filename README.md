# Rep+

Multi-tenant gym management SaaS for Indian gyms. Next.js 16 (App Router), Prisma 7 on Neon Postgres, custom JWT auth, WhatsApp OTP.

This README covers every phase. To put Rep+ online, follow **[DEPLOY.md](DEPLOY.md)**.

## Phase status

| Phase | Scope | Status |
| --- | --- | --- |
| 1 | Schema, seed, tenant layer, auth for all roles, OTP, admin TOTP | Done |
| 2 | Admin dashboard, plans CRUD, feature flags, billing state machine, revoke/restore, Razorpay webhook, impersonation | Done |
| 3 | Owner core: landing, signup wizard, members, membership plans, payments, GST invoices, desk mode, settings, owner billing (manual UPI) | Done |
| 4 | Attendance: owner-selected methods (desk QR, self check-in, biometric, manual), occupancy, slots, peak hours | Done |
| 5 | WhatsApp templates (EN/HI/PA), dues reminder engine, renewals, slot reminders, wishes, weekly report cards, daily motivation (Groq), quota, delivery webhooks, pay links | Done |
| 6 | Athlete PWA: install + offline, web push, schedule + slot booking, progress (body, private photos, records, badges, leaderboard), pay (UPI "I've paid", renew early, freeze), refer a friend, feedback, privacy + data export | Done |
| 7 | Trainer desk: roster, weekly splits + diet notes, saved workout plans, notes to members, nudges, PT sessions with member sign-off and commission; owner Trainers and PT page | Done |
| 8 | At-risk call list, leads CRM + public enquiry form, announcements, challenges, complaints board, reports with CSV, expenses and profit, AI insights | Done |
| 9 | Health sync (Health Connect / HealthKit) | Skipped (later) |
| 10 | Security pass, route-guard and token tests, CI, health check, env check, smoke test, production bootstrap, deploy guide | Done |

## Local setup (Windows PowerShell)

Run each command on its own line.

1. Install dependencies (this also runs `prisma generate`):

```powershell
pnpm install
```

2. Create your env file, then fill in `DATABASE_URL`, `DIRECT_URL`, `TEST_DATABASE_URL` and the auth secrets:

```powershell
Copy-Item .env.example .env
```

Generate each secret (run once per secret and paste the output):

```powershell
[Convert]::ToBase64String((1..48 | ForEach-Object { Get-Random -Maximum 256 }))
```

`ENCRYPTION_KEY` must be exactly 32 bytes:

```powershell
[Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Maximum 256 }))
```

3. Create the tables:

```powershell
pnpm db:migrate
```

4. Seed the platform plans, super admin and two demo gyms:

```powershell
pnpm db:seed
```

The first seed prints a TOTP secret for the super admin. Add it to Google Authenticator (or scan the `otpauth://` URI), then put the secret in `ADMIN_SEED_TOTP_SECRET` so re-seeding keeps it.

5. Start the dev server:

```powershell
pnpm dev
```

## Demo logins

When `DEV_LOG_OTP=true` and WhatsApp is not configured, OTP codes print in the `pnpm dev` terminal as `[otp:dev] ... code=123456`.

| Who | Where | How |
| --- | --- | --- |
| Forge Fitness owner (owner handles desk) | /login | `gurpreet@forgefitness.in` / `Rep+@123`, or OTP on 98765 00001 |
| Iron Temple owner (separate staff, trial) | /login | `rajesh@irontemple.in` / `Rep+@123`, or OTP on 98765 00002 |
| Iron Temple front desk | /login | OTP on 98765 00003 |
| Trainers | /login | OTP on 98765 00011 (Forge) or 98765 00021 (Iron Temple) |
| Athlete, Forge | /g/forge-fitness/login | OTP on 98765 11111 |
| Athlete, Iron Temple | /g/iron-temple/login | OTP on 98765 22222 |
| Super admin | /admin/login | `ADMIN_SEED_ID` + `ADMIN_SEED_PASSWORD` + authenticator code |

## Tests

Tests use `TEST_DATABASE_URL`, never your dev database. Apply the migrations to it once (and again after any schema change):

```powershell
pnpm test:db
```

```powershell
pnpm test
```

The suites are:

- `tests/tenant-isolation.test.ts` proves gym A can never read, update, delete or create rows in gym B. It also fails if a new model gets a `gymId` column but is not registered in `TENANT_MODELS`.
- `tests/security.test.ts` reads every `app/api/**/route.ts` and fails if a handler has no guard (`gymRoute`, `athleteRoute`, `adminRoute`, cron secret) or a staff route names no permission. Routes that check access in their own way are listed in the test with the reason. It also covers tampered, unsigned and expired tokens, the cron secret, and that coming-soon features can't be sold or switched on.
- `tests/auth.test.ts` covers the TOTP RFC vectors, phone normalisation, the permission and feature resolvers, JWT audience separation, field encryption, the subscription gate, the Postgres rate limiter, OTP hashing and lockout, refresh-token rotation with reuse detection, and disabled accounts.

## How it fits together

- `prisma/schema.prisma` holds the full data model for every phase, so later phases don't churn migrations. Money is stored in paise and phones in E.164. The datasource URL lives in `prisma.config.ts` (Prisma 7).
- `lib/db/tenant.ts` is the only way gym-facing code reaches the DB. `tenantDb(gymId)` injects the gym filter into every query, blocks cross-gym ids and disables raw SQL. The raw client in `lib/db/client.ts` is used only by auth, admin, cron and webhooks.
- `lib/api/guard.ts` wraps every route handler in this order: auth, permission, tenant, Zod, subscription status, feature flag. It returns errors as `{ error: { code, message } }`.
- `proxy.ts` is the Next 16 replacement for middleware. It handles page-level auth redirects, silent token refresh, `{slug}.kasrat.app` rewrites and security headers.
- Auth works like this:
  - Access JWT: 15 minutes, in an httpOnly cookie.
  - Refresh token: rotating, stored hashed, with reuse detection. Lifetime is 30 days for staff, 90 days for athletes and 12 hours for admin.
  - Staff/athlete tokens and admin tokens use separate secrets and cookies.
- OTP codes are 6 digits, expire after 5 minutes and allow 5 attempts. They are stored as an HMAC and rate-limited per phone and per IP. The OTP endpoints answer the same way whether or not a number has an account.
- RBAC: permissions live in `lib/auth/permissions.ts`. Roles are bundles of permissions, and each user can have extra grants or denies.
- Feature flags live in `lib/features.ts`. Plans store feature keys, and per-gym overrides can add or remove them. Features marked `soon` (health app sync) are shown on pricing as "Coming soon" and can't be put in a plan or granted.
- Locales are in `locales/en.json`, `locales/hi.json` and `locales/pa.json`. Source files are ASCII-only.

## Prisma notes

- `pnpm build` and `postinstall` both run `prisma generate` first.
- After any schema change, run `pnpm db:migrate`, then restart `pnpm dev` (a stale client causes odd errors).

## Phase 2: super admin

Screens (all under `/admin`, separate admin session):

- **Platform** shows total, active, trial and churned gyms, MRR and ARR, a 12-month revenue chart, new gyms per month, overdue gyms and WhatsApp usage.
- **Gyms** has search, a status filter and CSV export. Create gym makes the owner, main branch, roles, starter membership plans, reminder stages and the trial.
- **Gym detail** lets you:
  - edit the profile, link and plan
  - set per-gym overrides: custom price, extra members/branches/staff, feature grants or removals, WhatsApp top-up
  - revoke, restore or cancel, always with a reason
  - extend the trial or give free months
  - record an offline payment
  - impersonate the owner (read-only or write)
- **Plans and features** covers create, edit, archive and delete, with a toggle for every feature flag. A plan that gyms still use is archived instead of deleted.
- **Billing** lists who has not paid and how much (incl. GST), trials ending this week, the latest invoices, and a "Run billing check now" button.
- **Announcements** go to owners in-app, with optional email (Brevo) and WhatsApp.
- **Audit log** is filterable and exports to CSV.

### Billing state machine (`lib/platform/billing.ts`, pure and unit-tested)

1. When the due date or trial end passes unpaid, the gym moves to **PAST_DUE**. Owners get daily WhatsApp and email reminders.
2. After 3 days it moves to **READ_ONLY**. Staff can view but not change anything, and members see a paused message.
3. 15 days after the due date it moves to **SUSPENDED**. Only the billing page works.
4. Data is kept for 90 days after suspension. The gym then appears as "Purge due" on the admin home; nothing is deleted automatically.

Other rules:

- Free months are used instead of going past due.
- A Razorpay `subscription.charged` webhook (or an offline payment you record) restores the gym instantly.
- Admin revoke and goodwill restore set an admin hold, so the automation never undoes them.

### Cron (Vercel)

`vercel.json` runs `GET /api/cron/billing` daily at 00:30 UTC (6:00 AM IST). Vercel sends `Authorization: Bearer <CRON_SECRET>` on its own once `CRON_SECRET` is set in the project env.

To test it locally (PowerShell):

```powershell
curl.exe -H "Authorization: Bearer YOUR_CRON_SECRET" http://localhost:3000/api/cron/billing
```

### Razorpay webhook

1. In Razorpay Dashboard > Settings > Webhooks, add `https://YOUR_DOMAIN/api/webhooks/razorpay`.
2. Set a secret and put the same value in `RAZORPAY_WEBHOOK_SECRET`.
3. Tick these events: `subscription.activated`, `subscription.charged`, `subscription.halted`, `subscription.pending`, `subscription.cancelled`.

Every event is signature-checked over the raw body. Each `X-Razorpay-Event-Id` is processed at most once, and every payment id is invoiced at most once. Gyms are matched by `razorpaySubscriptionId`, or by `notes.gymId` on the Razorpay subscription. Phase 3 sets that note when the owner subscribes.

### WhatsApp templates used by the platform

Create these as Utility templates in en, hi and pa:

- `kasrat_billing_notice`: body `{{1}}` (owner first name), `{{2}}` (message)
- `kasrat_platform_announcement`: body `{{1}}` (title), `{{2}}` (message)

## Phase 3: owner core

### Signup (`/signup`)

1. The owner verifies their WhatsApp number with an OTP. They get a 30-minute signup ticket, so the rest of the wizard isn't limited by the 5-minute OTP expiry.
2. They enter gym details. The member app link is checked live for availability.
3. They answer "Do you also manage the reception?"
4. They pick a plan and cycle.

The gym starts a 14-day trial with no card. Signup creates the gym, its main branch, roles, four starter membership plans and the reminder stages, then logs the owner in.

### Landing (`/`)

Pricing is read live from the plans in the database, with a monthly/annual toggle. "Book a demo" opens WhatsApp on `KASRAT_SUPPORT_WHATSAPP`.

### Owner and front desk screens

- **Members** (`/owner/members`, `/desk/members`): search, status chips, add and edit. Emergency contact and medical notes are encrypted.
- **Member page** (one counter panel):
  - Sell or renew a plan. An early renewal starts the day after the current plan ends.
  - Joining fee, discount and part payment. Any balance becomes a due.
  - Collect or waive dues.
  - Freeze within the plan's allowance; the end date moves forward.
  - Payment history with invoice PDFs.
- **Payments and dues**: totals this month by method, every payment with its invoice, and open dues.
- **Membership plans**: price, joining fee, GST 0/5/12/18% inclusive or exclusive, freeze days, PT add-on, cross-branch, on sale or not.
- **Settings**:
  - gym profile, GSTIN and logo (Cloudinary)
  - what members are called (label used everywhere), default language, owner-handles-desk toggle
  - attendance thresholds, session length, member app features, renew-early discount, referral reward
  - invoice prefix, the gym's own UPI ID
  - branches, opening hours and holidays
  - staff with per-person permission toggles; disabling someone ends their sessions immediately
- **Desk tools** (Quick add, Collect payment) appear in the owner's own menu when "owner handles desk" is on. Desk staff get them at `/desk/*`.
- **Plan limits** (members, branches, staff, trainers, desk) are enforced on create, including the admin's per-gym extras. A downgrade is refused while the gym is over the new plan's limits.

### GST invoices

- Every payment issues an invoice numbered `PREFIX/26-27/0001`. The sequence restarts each financial year (April, IST) and is generated atomically per gym.
- Collected amounts are GST-inclusive and split into taxable value, CGST and SGST.
- SAC code 999723.
- The PDF is generated on the server with pdf-lib: `GET /api/gym/invoices/{id}/pdf`. Staff with `payments.read` can open any invoice; a member can open only their own.

### Rep+ billing without a payment gateway

The owner billing page (`/owner/billing`) works even when the gym is suspended. It shows the plan, price incl. GST, a UPI QR and deep link (`KASRAT_UPI_ID`), and bank details (`KASRAT_BANK_DETAILS`).

1. The owner pays by UPI or bank transfer and submits the UTR.
2. You check it in your bank or UPI app and approve it in `/admin/billing` under "To verify".
3. Approving issues the Rep+ invoice and restores the gym instantly. Rejecting notifies the owner with your reason.

Razorpay code from Phase 2 stays in the repo but does nothing until keys are set.

### Suspended gyms

Every owner page redirects to `/owner/billing`. Staff and members are blocked with a clear message.

## Phase 4: attendance

### The owner picks the methods

Gyms work differently. Some have a fingerprint machine, some have nothing but a notebook. The owner switches on any mix of four methods in **Settings > Attendance**. They are stored in `Gym.settings.attendance`. A method only works if it is switched on **and** the plan includes it. Routes for a method that is off return `METHOD_DISABLED`.

| Method | What happens | Plan feature |
| --- | --- | --- |
| QR at the desk | Member opens My QR in the app. The code changes every 30 s and works offline. The desk scans it with a webcam, a phone camera or a USB/Bluetooth scanner at `/owner/desk/scanner` or `/desk/scanner`. | `qr_attendance` |
| Self check-in | Member scans the printed entrance poster, or taps Check in in the app. The owner can require the poster, the phone location (geofence set in Branches), or both. | `qr_attendance` |
| Biometric / turnstile | ZKTeco/eSSL push (ADMS), a generic API, or a CSV/TXT log import. Members are matched by Biometric ID (enrolment number), falling back to member code. | `biometric_integration` (Elite) |
| Manual / register | Desk searches a name and checks the member in. A paper register for a day can be typed in at once (backdated). | always |

There is also a switch that lets the desk check in someone whose plan has lapsed. The member is checked in with a warning.

### Security

- QR token: `KQ1.<athleteId>.<30s step>.<sig>`. The signature is an HMAC with a per-athlete daily key derived from `QR_SECRET`. The app fetches the daily key once from `/api/g/<slug>/me/qr-key` and computes codes offline with WebCrypto. The server accepts plus or minus 2 steps of clock drift. Every token can be used only once (`QrNonce`).
- Entrance poster URL: signed with HMAC over the branch id and the branch `entranceQrSecret`. "New code" in Settings rotates the secret, and old posters stop working.
- Geofence: haversine distance. The phone's GPS accuracy is allowed as slack, up to 100 m.
- Device keys: `kd_<prefix>_<secret>`. Only a SHA-256 hash is stored, and the key is shown once. Each device can have an optional IP allow-list. ADMS devices are matched by serial number.

### Biometric setup

1. In **Settings > Attendance > Devices**, add a device.
2. ZKTeco / eSSL with cloud push (ADMS):
   - On the machine, under Comm > Cloud Server, set the server to your Rep+ domain on port 443 (or 80) and enter the serial number shown on the device.
   - The machine calls `/iclock/cdata` itself.
3. Any other machine or middleware: POST JSON to `/api/devices/punches` with `Authorization: Bearer <device key>`. Body:

   ```json
   {"punches":[{"userId":"101","timestamp":"2026-11-10 06:05:00","direction":"in"}]}
   ```

   Timestamps without a zone are read as IST. Punches are deduplicated, so resending is safe.
4. No network on the machine: export the attendance log and upload it under **Attendance > Paper register > Import**.
5. Put each member's enrolment number into Biometric ID on their profile.

### Screens

- `/owner/attendance`: tabs for check-in, paper register and import, and peak hours and trends (heatmap, planned vs actual, dayparts, weekly trend, methods used).
- `/owner/settings/attendance`: method cards, entrance posters (print from `/owner/settings/attendance/poster/<branchId>`), and devices.
- Athlete: `/g/<slug>/qr` (My QR) and `/g/<slug>/checkin` (self check-in).
- Public: `/api/g/<slug>/occupancy` (live floor percentage, cached for 30 s).

### Nightly attendance job

`/api/cron/attendance` runs at 18:35 UTC (00:05 IST) and needs `Authorization: Bearer CRON_SECRET`. It does the following:

- Auto-checks-out visits older than the session length.
- Activates or expires memberships.
- Recomputes each member's attendance status and streak.
- Generates the next 7 days of slots from opening hours.
- Rebuilds `PeakHourStat`.

To run it by hand (PowerShell):

```powershell
Invoke-RestMethod -Uri http://localhost:3000/api/cron/attendance -Headers @{ Authorization = "Bearer $env:CRON_SECRET" }
```

### Demo

- Forge Fitness has desk QR, self check-in and manual on.
- Iron Temple (Elite) has biometric and manual on:
  - ADMS device serial `ESSLIT0001`.
  - API device: its key is printed once by `pnpm db:seed`.
  - Members have Biometric IDs 101 and up.

## Phase 5: WhatsApp, reminders and cron jobs

### What goes out, and when

| Message | Template | When | Plan feature |
| --- | --- | --- | --- |
| Dues reminders (soft, due today, follow-up) | `kasrat_due_soft`, `kasrat_due_today`, `kasrat_due_followup` | The owner's stages. Default: 3 days before, on the due date, 3 days after. | `dues_reminders` |
| Owner alert | `kasrat_due_owner_alert` | Default: 5 days after the due date, to the owner (WhatsApp, plus an in-app alert) | `dues_reminders` |
| Plan ending soon | `kasrat_renewal_reminder` | Default: 7 days and 1 day before the end date. Skipped if the member has renewed. | `dues_reminders` |
| Slot reminder | `kasrat_slot_reminder` | About 1 hour before the slot. Slots before 9 AM are reminded the evening before. | `slot_booking` |
| Birthday / anniversary | `kasrat_birthday`, `kasrat_anniversary` | From 9 AM | `birthday_wishes` |
| Weekly report card | `kasrat_weekly_report` | Sunday from 6 PM (Monday morning on a daily cron) | `weekly_report_card` |
| Quota warning (from Rep+) | `kasrat_quota_warning` | At 80% and at 100%. Not counted against the gym's quota. | all |
| Daily motivation line | (in the app, not WhatsApp) | 00:20 IST batch | all |

The owner controls all of this in **Settings > Reminders**:

- the stages: their days, the message, and an optional one-line note
- friendly or firm tone
- send hour
- which other messages go out

The page has a live preview in EN, HI and PA. **WhatsApp and reminders** (sidebar) shows the month's quota meter, what is lined up today, and the full message log with delivery status. The dues list has a **Remind** button for each due, limited to once per due per day.

### Rules every message follows (`lib/messaging/send.ts`)

- Nothing goes out between 9 PM and 8 AM IST. The next run picks it up.
- Each reminder stage is sent at most once per due, enforced by the unique dedupe key `due:<id>:s<n>`.
- If the cron missed days, only the latest stage is sent. Members never get three messages in one day.
- Only OPEN dues are reminded, so paying a due stops its reminders at once.
- Monthly quota = plan quota + admin top-up. It is counted with one atomic SQL update.
  - Low-priority messages (wishes, weekly report cards) stop at 90% of the quota.
  - Everything else stops at 100%.
  - OTPs always go out, and they still count towards usage.
- Failed sends give the quota back.
- A member who replies STOP is opted out of gym messages. START opts them back in.
- Paused gyms (READ_ONLY or SUSPENDED) send nothing automatic.

### Pay links

Every dues reminder carries `https://<app>/p/<dueId>.<signature>`. This is a public page in the member's language. It shows the amount, a UPI button and a QR for the gym's UPI ID (set it in Settings > App). After paying, the member shows the confirmation at the desk and the desk marks the due paid. No payment gateway is needed. Razorpay can plug into the same page later.

### WhatsApp setup (Meta Cloud API)

1. In Meta Business, create the app, add WhatsApp, and add your number. Then copy these into `.env`:
   - `WHATSAPP_TOKEN` (permanent system-user token)
   - `WHATSAPP_PHONE_NUMBER_ID`
   - `WHATSAPP_BUSINESS_ACCOUNT_ID`
   - `WHATSAPP_APP_SECRET`
2. Create the templates in English, Hindi and Punjabi. `pnpm wa:templates` prints them; `pnpm wa:templates --submit` creates them through the API.
   - `kasrat_otp` is an AUTHENTICATION template. Create it in WhatsApp Manager with a "Copy code" button.
   - Approval usually takes minutes to a day.
3. Set up the webhook:
   - Callback URL: `https://<your-domain>/api/webhooks/whatsapp`
   - Verify token: the value of `WHATSAPP_VERIFY_TOKEN`
   - Subscribe to the `messages` field.

Until `WHATSAPP_TOKEN` is set, messages are logged in the app and printed to the server console as `[whatsapp:dev]`.

### Daily motivation (Groq)

Groq (`GROQ_API_KEY`) generates the lines with LLaMA 3.3 70B through the OpenAI SDK:

- One call per language per gym per day.
- Lines are checked for length, links and a body-shaming word list (in `/locales`).
- They are cached in `MotivationLine`.

If Groq is missing or fails, members get the 20 curated lines per language from `/locales`.

### Cron jobs (`vercel.json`)

| Route | Schedule (UTC) | IST | What |
| --- | --- | --- | --- |
| `/api/cron/billing` | `30 0 * * *` | 06:00 | Rep+ subscription states (Phase 2) |
| `/api/cron/attendance` | `35 18 * * *` | 00:05 | Attendance jobs (Phase 4) |
| `/api/cron/motivation` | `50 18 * * *` | 00:20 | Motivation lines |
| `/api/cron/messages` | `30 4 * * *` | 10:00 | Dues, renewals, wishes, weekly report cards, slot reminders |

`/api/cron/messages` can safely be called every hour. Daily jobs claim a `JobRun` key, so they run once a day per gym.

- **Vercel Hobby** only allows daily crons, so slot reminders only cover the 10-11 AM slots. For real slot reminders, add a free hourly job (for example cron-job.org) that calls the route with the header `Authorization: Bearer <CRON_SECRET>`.
- **Vercel Pro**: change the schedule to `0 * * * *`.

To run the message jobs by hand (PowerShell):

```powershell
Invoke-RestMethod -Uri "http://localhost:3000/api/cron/messages?force=dues,renewals,wishes" -Headers @{ Authorization = "Bearer $env:CRON_SECRET" }
```

`force` runs those jobs again even if they already ran today. Dedupe keys still stop repeat messages, and quiet hours still apply.

### Demo data

Both demo gyms have 5 weeks of WhatsApp history with delivery receipts, so the usage meter matches the log. They also have:

- one member who replied STOP
- two birthdays today
- today's motivation lines

## Phase 6: athlete app (PWA)

Members open `/g/<slug>` (or `<slug>.kasrat.app`) and log in with a WhatsApp OTP.

### Screens

| Tab | What is on it |
| --- | --- |
| Home | Greeting in EN/HI/PA, streak, today's workout, today's booked slot, live crowd and best time to come, plan days left, challenge, motivation line, latest announcement, buttons for **My QR** and **Check in** |
| Schedule | Week strip and the workout for each day; **slot booking** with live capacity (book, cancel, move); weekly split (members build their own, a trainer's split is read-only for them) |
| Progress | 6-month attendance heatmap, monthly summary, badges, body log with weight trend, **private progress photos** with before/after, personal records, **leaderboard** (attendance and streak only, never weight) |
| Pay | Plan, dues (private), **Pay with UPI** + **"I've paid"**, early renewal with the owner's discount, payment history with GST invoice PDFs, freeze requests |
| Profile | Install the app, push notifications on/off, refer a friend (code + WhatsApp share), privacy switches, download my data, delete my photos, feedback / broken equipment |

There is also a notification bell (`/g/<slug>/notifications`).

### Installable and offline

- `/g/<slug>/manifest.webmanifest` is built per gym. It uses the gym's name and its logo when one is uploaded, otherwise the Rep+ icons in `public/pwa/`.
- `/g/<slug>/sw.js` is the service worker, scoped to `/g/<slug>/`:
  - **Pages:** network first, with the cached copy (or `/g/<slug>/offline`) when there is no signal.
  - **QR key and crowd meter:** network first, with a cached fallback. The rotating QR is computed on the phone, so check-in works offline.
  - **Built JS/CSS:** cache first.
- Logging out clears the cached pages.
- Android shows an **Install** button. iPhone users get the "Share > Add to Home Screen" tip.

### Web push

- Free: generate VAPID keys once (`npx web-push generate-vapid-keys`) and set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY` and `VAPID_SUBJECT`.
- **Push first, WhatsApp as fallback.** Slot reminders, plan-ending reminders, birthdays, anniversaries and weekly report cards go by push when the member has push on, so they cost no WhatsApp quota. If no device takes the push, the message goes on WhatsApp. Dues reminders always go on WhatsApp, because they carry the pay link.
- Dead subscriptions (uninstalled app, revoked permission) are removed automatically.
- Pushes respect the same 9 PM to 8 AM quiet hours. The in-app notification is still created at night.
- iPhone: push works only when the app is opened from the home screen (iOS 16.4+).

### "I've paid" (UPI without a payment gateway)

1. The member taps **Pay with UPI**, which opens their UPI app with the gym's UPI ID and the amount filled in.
2. They tap **I've paid** and enter the UPI reference (UTR). The owner and desk get an in-app alert.
3. The desk opens **Payments > UPI paid claims** (owner) or the **desk home**, checks the bank app, and taps **Confirm**. This records the payment and GST invoice exactly like a counter collection, and the member is notified. **Not received** sends the member the reason.
4. Safeguards:
   - A UTR can be used once per gym.
   - Only one pending claim per due, and one pending renewal at a time.
   - The amount can never be more than the due or the plan price.
   - Confirming twice is blocked.

**Renew early** uses the same flow. The new plan starts the day after the current one ends, and the owner's early-renewal discount (Settings > App) is applied.

### Freeze requests

- Members can ask for a freeze within their plan's free freeze days (set per membership plan).
- The owner or desk approves it under **Payments > Freeze requests** or on the desk home. The plan end date moves forward by the same number of days, and the member is told.

### Refer a friend

- Each member gets a code and a share link: `/g/<slug>/join?ref=CODE`.
- The friend leaves their name and number, which creates a REFERRAL lead for the gym to call.
- When the friend joins (the desk enters the code) and their **first paid plan** is recorded, the referrer's plan gets the owner's reward days (default 7). The referrer gets a notification and the lead is marked joined. This happens only once per friend.

### Badges and challenges

- Badge rules live in the `BadgeRule` table. Supported metrics:
  - `total_visits`
  - `streak`
  - `best_streak`
  - `visits_before_7am`
  - `visits_this_month`
  - `records`
  - `challenge`: only awarded by finishing a challenge
- Badges are checked after each QR, desk or self check-in, when a record is logged, when the Progress tab is opened, and in the nightly attendance job (which also covers biometric and register check-ins).
- Challenges count workout days (or the streak) inside their dates. Finishing one can award a badge.

### Privacy

- Progress photos are uploaded to Cloudinary as **authenticated** (private) images. The app shows them through short signed URLs, and only to the member.
- Trainers see progress, photos or health data only if the member switches it on. Trainer screens come in Phase 7.
- Dues are never shown on any shared screen.
- **Download my data** returns one JSON file with everything Rep+ holds about the member. **Delete all my photos** removes them from Cloudinary and the database.

## Phase 7: trainer desk

Trainers log in with their phone (WhatsApp OTP) and land on `/trainer`. It works on a phone on the gym floor.

### Pages

| Page | What is on it |
| --- | --- |
| `/trainer` (Today) | Roster size, who trained today, booked slots still to come, members who need a nudge, the PT session log, and PT and commission this month |
| `/trainer/athletes` | Roster cards with status, last visit, streak, plan days left, today's slot, plan set or not, PT sessions to confirm and PT left. Filters: In today, Need a nudge, No plan, PT to confirm |
| `/trainer/athletes/<id>` | Tabs: **Overview** (heatmap, visits), **Workout and diet** (weekly split editor, start from a saved plan, hand back), **Notes**, **PT sessions**, **Progress** (only what the member shares) |
| `/trainer/workouts` | Saved plans (split + diet notes) shared by all trainers at the gym; **Give to members** applies one to many members |
| `/trainer/sessions` | Log a session, month view, confirmed / waiting / disputed counts, commission earned |
| `/owner/trainers` | Owner view per trainer: members, slipping members, PT sessions, confirmed / waiting / disputed, fee and %, commission to pay; disputed sessions; bulk **assign members to a trainer** |

### Rules

- **Roster only.** A trainer sees and changes only members assigned to them (`Athlete.trainerId`). Owners see everyone. Other members return 404.
- **No money on the trainer desk.** Dues, payments and invoices are never loaded on trainer pages or APIs.
- **Privacy.**
  - Progress (weight, measurements, records) shows only if the member allows "Trainer can see my progress".
  - Photos show only with "Trainer can see my progress photos", through signed private URLs.
  - Health data sync is not built yet. The `HealthMetric` table is kept for later; nothing reads or writes it.
- **Plans.** Saving a split replaces the member's current plan. The member gets a notification, and their own split editor locks ("your trainer manages this split"). **Hand back** returns control to the member.
- **Notes.** Notes are shown on the member's Home and arrive as a notification.
- **Nudges.** Each nudge has a ready line in the member's language (missed you, come back, great streak, new plan ready, PT coming up), or the trainer writes their own line.
  - It goes by push first (free), with WhatsApp as the fallback (template `kasrat_trainer_nudge`, low priority, so it stops at 90% of the quota).
  - One nudge per member per day. None between 9 PM and 8 AM.
- **PT sessions.**
  1. The trainer logs a session. It can't be in the future or more than 14 days ago, and a double log within 30 minutes is blocked.
  2. The member gets "Confirm your PT session" on Home and taps **Yes, I trained** or **That's not right**.
  3. A confirmed session uses one session from the plan's `ptSessionsLeft`. A dispute alerts the trainer and the owner.
  4. Only the trainer can delete a session, and only before it is confirmed.
- **Commission.** Commission = trainer's **PT session fee** x **commission %**. Both are set in Settings > Staff. It is fixed when the session is logged and counts only for confirmed sessions.

### APIs

| Method | Route |
| --- | --- |
| PUT / DELETE | `/api/gym/trainer/athletes/<id>/split` |
| POST | `/api/gym/trainer/athletes/<id>/notes` |
| DELETE | `/api/gym/trainer/notes/<id>` |
| POST | `/api/gym/trainer/athletes/<id>/nudge` |
| POST | `/api/gym/pt-sessions` |
| DELETE | `/api/gym/pt-sessions/<id>` |
| POST | `/api/gym/workout-templates` |
| PUT / DELETE | `/api/gym/workout-templates/<id>` |
| POST | `/api/gym/workout-templates/<id>/apply` |
| POST | `/api/gym/trainers/assign` (owner) |
| POST | `/api/g/<slug>/me/pt/<id>` (member confirms or disputes) |

### Demo

Demo trainers log in with their phone and a WhatsApp OTP. In dev the OTP is printed in the terminal.

| Gym | Trainers |
| --- | --- |
| Forge Fitness | Harjot Sandhu `+919876500011` (Arjun's trainer), Neha Arora `+919876500012` |
| Iron Temple | Vikram Gill `+919876500021`, Aman Dhillon `+919876500022` |

Each gym has 3 saved plans, about 60 PT sessions (one disputed) and trainer notes. Arjun has one PT session waiting for him to confirm.

## Phase 8: growth and engagement

### Pages

| Page | What is on it |
| --- | --- |
| `/owner/at-risk` | This week's call list, highest risk first. Each member shows a score, the reasons, plan end, last visit and trainer, with Call / WhatsApp buttons and an outcome (Coming back, Renewed, Not interested, No answer). Contacted members move to the bottom. |
| `/owner/leads`, `/desk/leads` | Add a lead (walk-in, Instagram, Google, referral, website), today's follow-ups, a board by stage (New / Trial / Follow-up), joined and lost. Log a call, convert to member in one click, mark lost with a reason. The owner also sees conversion by source and the enquiry form link. |
| `/g/<slug>/enquire` | Public enquiry form in English, Hindi or Punjabi (`?lang=hi`). Put it in the Instagram bio or Google profile. Creates a Website lead. |
| `/owner/announcements` | Publish to every member (or one branch): shown on the member home screen, in the bell and by push. Free, uses no WhatsApp quota. |
| `/owner/challenges` | Create a challenge (days visited or streak), see who is taking part and who finished. Finishers get the Challenge Champ badge. |
| `/owner/complaints`, `/desk/complaints` | Complaints and equipment issues from members. Mark In progress or Resolved; resolving needs a note and the member is told what was fixed. |
| `/owner/reports` | Revenue, Members, Attendance, Dues, Leads, PT, Expenses and profit (Elite), AI insights (Elite). Pick 3 / 6 / 12 months; each tab has a CSV download. |

### At-risk score (0-100)

Recomputed every night by the attendance cron, and on demand with **Refresh now**. A member is listed at 35 or more.

| Signal | Points |
| --- | --- |
| Visits in the last 2 weeks vs their own usual (needs 3+ weeks of history) | up to 40 |
| No visit in 7+ days / 14+ days | 10 / 20 |
| Overdue payment (by days late) | 10 / 15 / 20 |
| Paid late 2+ times in 90 days | 5 |
| Plan ends in 14 / 7 days and not renewed | 8 / 15 |
| Member app not opened in 30 days | 10 |

The contact outcome is kept when the score is refreshed. "No answer" keeps the member on the list. Members who recover drop off unless already contacted.

### Rules

- **Leads.** A number that is already a member, or already an open lead, is refused. "Joined" only happens through **Convert to member**, which creates the member and carries the referral code over. Follow-ups that are due create a bell notification for the assigned staff (or owners and desk) every night just after midnight, ready when the gym opens.
- **Enquiry form.** Rate limited per IP. A hidden honeypot field drops bots silently. It gives the same answer whether or not the number is already a member.
- **Challenges.** One at a time: overlapping dates are refused. A visits target can't be more than the days in the challenge.
- **Reports.** Amounts are in paise in the database and in rupees in CSV. CSV cells that look like formulas are neutralised; plain numbers stay numbers. Profit = revenue without GST - expenses - confirmed PT commission.
- **AI insights.** Rep+ computes the facts (collections, renewals, dues, at-risk, peak and quiet hours, lead conversion). Only those totals go to Groq, which writes 4-6 actions. If Groq is not set up, fails, or returns anything that is not a clean list, rule-based insights are shown instead. Limited to 10 a day per gym.
- **Plans.** At-risk list, leads and challenges: Pro. Expenses and profit, AI insights: Elite. Reports: all plans.

### APIs

| Method | Route |
| --- | --- |
| POST | `/api/gym/leads` |
| PATCH | `/api/gym/leads/<id>` |
| POST | `/api/gym/leads/<id>/contact` |
| POST | `/api/gym/leads/<id>/convert` |
| POST | `/api/gym/risk/<id>/contact` |
| POST | `/api/gym/risk/recalculate` |
| POST | `/api/gym/announcements` |
| DELETE | `/api/gym/announcements/<id>` |
| POST | `/api/gym/challenges` |
| DELETE | `/api/gym/challenges/<id>` |
| PATCH | `/api/gym/complaints/<id>` |
| POST | `/api/gym/expenses` |
| DELETE | `/api/gym/expenses/<id>` |
| GET | `/api/gym/reports/<kind>.csv?months=6` (revenue, members, attendance, dues, leads, pt, expenses) |
| POST | `/api/gym/insights` |
| POST | `/api/g/<slug>/enquire` (public) |

## Phase 10: production readiness

Health app sync (Phase 9) is postponed. It is shown on the pricing page and in the admin as **Coming soon**, it was removed from every plan (migration `20261111090000_health_sync_coming_soon`), and the health-data privacy switch is hidden. The `HealthConsent`, `HealthConnection` and `HealthMetric` tables are kept for later; nothing reads or writes them.

### New commands

| Command | What it does |
| --- | --- |
| `pnpm check:env .env.production` | Checks every setting without printing secrets: present, long enough, not placeholders, `ENCRYPTION_KEY` is 32 bytes, the JWT secrets differ, WhatsApp is complete. Exit code 1 on any failure. |
| `pnpm prod:migrate` | Applies migrations to the database in `.env.production` (prints the host first). |
| `pnpm prod:bootstrap` | Creates Rep+ plans, badge rules and the super admin. No demo data. |
| `pnpm db:bootstrap` | The same against `.env`. |
| `pnpm vapid` | Prints a new web push key pair. |
| `pnpm smoke https://your-domain` | Read-only post-deploy check: health, pages, security headers, and that protected routes refuse anonymous callers. |

`pnpm db:seed` refuses to load demo gyms when `NODE_ENV=production`.

### Added

- `GET /api/health`: `{ ok, db, ms, commit }` for uptime monitors; status 503 if the database is down. No secrets or tenant data.
- `Strict-Transport-Security` on production (Vercel) responses, on top of the existing frame, sniffing, referrer and permissions headers.
- `vercel.json` pins functions to `sin1` (Singapore) to sit next to Neon's Singapore region.
- `.github/workflows/ci.yml`: on every push and pull request it checks that sources are ASCII, typechecks, runs all tests on Postgres 16 and builds.
- `DEPLOY.md`: Neon, secrets, migrations and admin, GitHub, Vercel (env, domains, wildcard subdomains, cron), WhatsApp Cloud API (token, webhook, templates), Brevo, Cloudinary, Groq, the smoke test, shipping updates, rollbacks, backups and a security checklist.
