# Deploying Rep+

Production runs on **Vercel** (app + cron), **Neon** (Postgres), **Meta WhatsApp Cloud API** (OTP login and reminders), with **Brevo** (email), **Cloudinary** (images), **Groq** (AI text) and web push.

All commands are Windows PowerShell, one per block. Run them in the project folder.

---

## Showcase: put The Sharp Fitness online today (no domain, no WhatsApp)

Use this to demo Rep+ to gym owners before WhatsApp and a domain are ready. It needs only **Neon + GitHub + Vercel** (free tiers are fine). Render is not needed: Vercel runs the app and the cron jobs.

**How login works in showcase mode.** The phone numbers listed in `DEMO_LOGIN_PHONES` log in with the fixed code in `DEMO_LOGIN_CODE`; no WhatsApp message is sent. Every other phone number cannot log in (there is no WhatsApp to send its code). The owner can also log in with email and password.

### A. Neon
1. Create a Neon project (region: Singapore, to match `vercel.json`).
2. Copy the **pooled** string (host has `-pooler`) and the **direct** string.

### B. `.env.production`

```powershell
Copy-Item .env.example .env.production
```

```powershell
notepad .env.production
```

Fill in:

| Key | Value |
| --- | --- |
| `DATABASE_URL` | Neon pooled string |
| `DIRECT_URL` | Neon direct string |
| `APP_URL` | `https://placeholder.vercel.app` for now (fixed in step E) |
| `ROOT_DOMAIN` | **empty** (`ROOT_DOMAIN=""`). Never a vercel.app address |
| `JWT_SECRET`, `JWT_ADMIN_SECRET`, `OTP_PEPPER`, `QR_SECRET`, `CRON_SECRET` | one new random value each (command below) |
| `ENCRYPTION_KEY` | 32-byte value (command below) |
| `ADMIN_SEED_PASSWORD` | your super admin password, 12+ characters |
| `DEMO_LOGIN_CODE` | `246810` (any 6 digits) |
| `DEMO_LOGIN_PHONES` | `+919876530000,+919876530011,+919876530012,+919876530013,+919876531001,+919876531002` |
| `DEV_LOG_OTP` | `false` |

Leave WhatsApp, Razorpay, Brevo, Cloudinary, Groq, VAPID and Terra empty for the showcase.

Random secret (run once per key):

```powershell
[Convert]::ToBase64String((1..48 | ForEach-Object { Get-Random -Maximum 256 }))
```

Encryption key:

```powershell
[Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Maximum 256 }))
```

Check it (warnings about WhatsApp and showcase mode are expected; there must be no FAIL):

```powershell
pnpm check:env -- .env.production
```

### C. Load the database

```powershell
pnpm prod:migrate
```

```powershell
pnpm prod:bootstrap
```

Save the TOTP secret it prints into your authenticator app and into `ADMIN_SEED_TOTP_SECRET`.

```powershell
pnpm prod:demo
```

This creates only The Sharp Fitness (about 110 members, 2 months of attendance, payments, dues, leads, PT sessions). Run it again any time to reset the demo.

### D. GitHub
Follow section 4 below (git init, add, commit, push to a **private** repository).

### E. Vercel
1. **Add New > Project**, import the repository, keep the defaults.
2. **Environment Variables**: paste the whole `.env.production` into the first key field. Tick Production.
3. **Deploy**. Copy the address Vercel gives you (for example `https://rep-plus.vercel.app`).
4. **Settings > Environment Variables**: change `APP_URL` to that address. **Deployments > ... > Redeploy**.

### F. Logins (code `246810` for every phone)

| Who | Page | Login |
| --- | --- | --- |
| Jagtar Singh (owner, desk, trainer) | `/login` | email `jagtar@thesharpfitness.in`, password `Rep+@123`, or phone `9876530000` |
| Inder (trainer) | `/login` | phone `9876530011` |
| Lakshay (trainer) | `/login` | phone `9876530012` |
| Daniel (trainer) | `/login` | phone `9876530013` |
| Manmeet Singh (member, English) | `/g/sharp-fitness/login` | phone `9876531001` |
| Surajdeep (member, Punjabi) | `/g/sharp-fitness/login` | phone `9876531002` |
| You (super admin) | `/admin/login` | `ADMIN_SEED_ID`, your password and the TOTP code |

### G. Before a real gym uses the site
Delete `DEMO_LOGIN_CODE` and `DEMO_LOGIN_PHONES` from Vercel, add the WhatsApp keys and your domain (`ROOT_DOMAIN`, `APP_URL`), and redeploy.

---

## 0. Before you start

| Account | Used for | Needed on day one? |
| --- | --- | --- |
| GitHub | code, CI | yes |
| Vercel | hosting, cron | yes |
| Neon | database | yes |
| Meta Business + WhatsApp Business Account | phone OTP login, reminders | yes (staff and members log in by WhatsApp OTP) |
| A domain (for example `kasrat.in`) | app URL, gym subdomains | yes |
| Brevo | owner email login codes, invoices by email | recommended |
| Cloudinary | logos, progress and complaint photos | recommended |
| Groq | motivation lines, AI insights (built-in text is used without it) | optional |

> **Vercel plan.** Vercel's Hobby plan is meant for non-commercial use, and its cron jobs can fire up to an hour late. Once gyms are paying you, move the project to Vercel Pro.

---

## 1. Database (Neon)

1. Create a Neon project. Pick the region closest to your users. `vercel.json` runs the app in Singapore (`sin1`); if your Neon region is somewhere else, change `regions` in `vercel.json` to the nearest Vercel region.
2. On the Neon dashboard, copy two connection strings:
   - **Pooled** (host contains `-pooler`) -> `DATABASE_URL`
   - **Direct** (no `-pooler`) -> `DIRECT_URL` (used only for migrations)

---

## 2. Production settings file

Copy the template. This file stays on your computer and is never committed (`.gitignore` ignores `.env*`).

```powershell
Copy-Item .env.example .env.production
```

Generate each secret with this command and paste one result into each of `JWT_SECRET`, `JWT_ADMIN_SECRET`, `OTP_PEPPER`, `QR_SECRET` and `CRON_SECRET` (run it once per secret; they must all be different):

```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

`ENCRYPTION_KEY` must be exactly 32 bytes. **Never change it after launch**, or encrypted fields (medical notes, emergency contacts, admin 2FA) can't be read:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Web push keys (copy all three lines into `.env.production`):

```powershell
pnpm vapid
```

Then fill in:

- `APP_URL=https://kasrat.in` and `ROOT_DOMAIN=kasrat.in` (your domain)
- `ADMIN_SEED_ID`, `ADMIN_SEED_NAME`, `ADMIN_SEED_PASSWORD` (12+ characters) for your super admin login
- `KASRAT_UPI_ID`, `KASRAT_UPI_NAME`, `KASRAT_BANK_DETAILS`, `KASRAT_SUPPORT_WHATSAPP` (where gyms pay you)
- WhatsApp, Brevo, Cloudinary and Groq values (sections 6-8)
- Delete the `DEV_LOG_OTP` line and leave `TEST_DATABASE_URL` empty

Check it. Fix every `[FAIL]` before going on:

```powershell
pnpm check:env .env.production
```

---

## 3. Create the tables and your admin

Apply all migrations to Neon:

```powershell
pnpm prod:migrate
```

Create the Rep+ plans (Solo, Pro, Elite), badge rules and your super admin. **No demo gyms are created.**

```powershell
pnpm prod:bootstrap
```

It prints a **TOTP secret** once. Add it to Google Authenticator / Authy right away, and put it in `ADMIN_SEED_TOTP_SECRET` in `.env.production` so running bootstrap again keeps the same code.

> Never run `pnpm db:seed` against production. It loads demo gyms, and it refuses to run when `NODE_ENV=production`.

---

## 4. Push the code to GitHub

```powershell
git init
```

```powershell
git add .
```

```powershell
git commit -m "Rep+ v1"
```

Create an empty private repository on GitHub, then (replace the URL):

```powershell
git remote add origin https://github.com/CoderManmeet/kasrat.git
```

```powershell
git branch -M main
```

```powershell
git push -u origin main
```

GitHub Actions (`.github/workflows/ci.yml`) now runs on every push: the ASCII rule, typecheck, all tests on a real Postgres, and a production build.

---

## 5. Vercel

1. **Add New > Project**, import the GitHub repository. Vercel detects Next.js and pnpm; keep the default build command (`pnpm build`).
2. **Environment Variables**: open `.env.production`, copy everything, and paste it into the first key field. Vercel splits it into variables. Tick **Production** only.
   - Preview deployments should not use the production database. If you want previews to work, create a Neon **branch** and give the Preview environment its own `DATABASE_URL` / `DIRECT_URL`.
3. **Deploy**.
4. **Domains**: add `kasrat.in` and `www.kasrat.in`. For gym subdomains (`forge.kasrat.in`, Elite "custom subdomain and branding"), also add `*.kasrat.in`. Wildcard domains need the domain's nameservers pointed at Vercel; the Domains page shows what to set.
5. **Cron Jobs** are read from `vercel.json` and appear under **Settings > Cron Jobs**. Vercel sends `CRON_SECRET` automatically.

| Job | Time (IST) | Does |
| --- | --- | --- |
| `/api/cron/billing` | 06:00 | Rep+ subscription state machine, invoices, reminders |
| `/api/cron/attendance` | 00:05 | auto checkout, memberships start/expire, statuses, streaks, slots, peak hours, badges, at-risk list, lead follow-ups |
| `/api/cron/motivation` | 00:20 | today's motivation lines |
| `/api/cron/messages` | 10:00 | dues reminders, renewals, wishes, weekly report cards (never 21:00-08:00) |

Run one by hand to check it (replace the domain and secret):

```powershell
Invoke-RestMethod -Uri "https://kasrat.in/api/cron/attendance" -Headers @{ Authorization = "Bearer YOUR_CRON_SECRET" }
```

---

## 6. WhatsApp Cloud API

1. In **Meta for Developers**, create an app (type Business) and add **WhatsApp**. Connect your WhatsApp Business Account and a phone number that is **not** used in the WhatsApp app.
2. **Permanent token**: Business Settings > Users > System users > add an admin system user > **Generate token** for your app with `whatsapp_business_messaging` and `whatsapp_business_management`. Put it in `WHATSAPP_TOKEN`.
3. Copy the **Phone number ID** -> `WHATSAPP_PHONE_NUMBER_ID`, the **WhatsApp Business Account ID** -> `WHATSAPP_BUSINESS_ACCOUNT_ID`, and the app's **App secret** (App settings > Basic) -> `WHATSAPP_APP_SECRET`.
4. Make up a random `WHATSAPP_VERIFY_TOKEN`. Under WhatsApp > Configuration > Webhook set:
   - Callback URL: `https://kasrat.in/api/webhooks/whatsapp`
   - Verify token: your `WHATSAPP_VERIFY_TOKEN`
   - Subscribe to the **messages** field (delivery receipts and STOP replies).
5. **OTP template**: in WhatsApp Manager create an **Authentication** template named `kasrat_otp` with a **Copy code** button, in English (add Hindi and Punjabi if you like). Meta writes the text.
6. **All other templates** (EN, HI, PA): point the script at the production settings, submit, then switch back:

```powershell
$env:DOTENV_CONFIG_PATH = ".env.production"
```

```powershell
pnpm wa:templates --submit
```

```powershell
Remove-Item Env:DOTENV_CONFIG_PATH
```

Meta reviews each template; check the status in WhatsApp Manager. A message whose template is not approved yet is logged as failed (see Owner > WhatsApp and reminders) and can go out on a later run.

7. Add a payment method in WhatsApp Manager. Business-initiated messages are charged by Meta. Each Rep+ plan's monthly WhatsApp quota is what keeps that cost bounded.

---

## 7. Email (Brevo)

1. In Brevo, **Senders, Domains & Dedicated IPs** > add and authenticate your domain (DKIM and DMARC records at your DNS).
2. Create an API key -> `BREVO_API_KEY`. Set `BREVO_SENDER_EMAIL` (for example `no-reply@kasrat.in`) and `BREVO_SENDER_NAME`.

## 8. Cloudinary and Groq

- Cloudinary: Dashboard > API keys -> `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`. Progress and complaint photos are stored as **authenticated** assets and shown with signed URLs.
- Groq: console > API keys -> `GROQ_API_KEY`. Without it, members get built-in motivation lines and owners get rule-based insights.

After changing variables in Vercel, **redeploy** (Deployments > ... > Redeploy) so the app picks them up.

---

## 9. Check the live site

```powershell
pnpm smoke https://kasrat.in
```

It checks that the app and database answer, the pages render, the security headers are set (including HSTS), and that owner, admin, gym API, cron and webhook routes refuse anonymous callers.

Then by hand:

1. Log in at `/admin/login` with your admin ID, password and authenticator code.
2. Open `/signup` in another browser and create a real test gym with your own phone (the WhatsApp OTP must arrive).
3. Add a member, sell a plan, collect a payment, open the invoice PDF.
4. Open the member app at `/g/<slug>`, install it, allow notifications, check in.
5. From the admin, **cancel** the test gym. Its data is purged 90 days later.

Add an uptime monitor (UptimeRobot, Better Stack...) on `https://kasrat.in/api/health`. It returns `{"ok":true,"db":"up"}`, or status 503 when the database is down.

---

## 10. Shipping updates

1. Make the change locally and run `pnpm test`.
2. If it adds a migration, apply it to production **first** (migrations only add things, so the running version keeps working):

```powershell
pnpm prod:migrate
```

3. Push. Vercel deploys `main` automatically:

```powershell
git push
```

4. Something wrong? Vercel > Deployments > pick the previous one > **Instant Rollback**. Tell Claude what broke and fix forward; don't edit the production database by hand.

## Backups

Neon keeps a restore window (point-in-time restore) whose length depends on your Neon plan. Check it in the Neon dashboard and pick a plan whose window you are comfortable with. Before a risky migration, create a Neon **branch** of production: it is an instant copy you can restore from.

## Security checklist

- [ ] `pnpm check:env .env.production` shows no `[FAIL]`
- [ ] Every secret is unique, generated with the commands above, and stored only in Vercel and your local `.env.production`
- [ ] `DEV_LOG_OTP` is not set in Vercel
- [ ] Admin 2FA works and the TOTP secret is backed up
- [ ] WhatsApp webhook verified, **messages** field subscribed
- [ ] `pnpm smoke https://your-domain` passes
- [ ] Uptime monitor on `/api/health`
- [ ] GitHub repository is private; CI is green
