import { config } from 'dotenv'

// pnpm check:env                      checks .env
// pnpm check:env -- .env.production   checks another file
//
// Run it before every production deploy. It never prints secret values, only
// whether each one is present and well formed. Exit code 1 when something
// required is missing, so it can gate CI.

const file = process.argv.slice(2).find((arg) => !arg.startsWith('-')) ?? '.env'
config({ path: file, override: true, quiet: true })

type Level = 'ok' | 'warn' | 'fail'
const rows: { level: Level; name: string; note: string }[] = []
const env = (name: string) => (process.env[name] ?? '').trim()
const add = (level: Level, name: string, note: string) => rows.push({ level, name, note })

function secret(name: string, min: number, note: string) {
  const value = env(name)
  if (!value) return add('fail', name, `missing - ${note}`)
  if (value.length < min) return add('fail', name, `too short (${value.length} chars, need ${min}+)`)
  if (/change|example|secret|password|xxxx/i.test(value)) return add('fail', name, 'looks like a placeholder')
  add('ok', name, `${value.length} chars`)
}

// ---- Core ---------------------------------------------------------------
const db = env('DATABASE_URL')
if (!db) add('fail', 'DATABASE_URL', 'missing')
else if (db.includes('USER:PASSWORD') || db.includes('ep-xxxx')) add('fail', 'DATABASE_URL', 'still the example value')
else add(db.includes('-pooler') || db.includes('localhost') ? 'ok' : 'warn', 'DATABASE_URL', db.includes('-pooler') ? 'Neon pooled' : db.includes('localhost') ? 'local database' : 'not the Neon pooled host (-pooler); serverless may run out of connections')
const direct = env('DIRECT_URL')
if (!direct) add('warn', 'DIRECT_URL', 'missing - migrations will use DATABASE_URL (Neon: use the non-pooled host)')
else add(direct.includes('-pooler') ? 'warn' : 'ok', 'DIRECT_URL', direct.includes('-pooler') ? 'should be the NON-pooled host' : 'set')

const app = env('APP_URL')
if (!app) add('fail', 'APP_URL', 'missing (https://your-domain)')
else add(app.startsWith('https://') || app.includes('localhost') ? 'ok' : 'warn', 'APP_URL', app.startsWith('https://') || app.includes('localhost') ? app : 'use https:// in production')
if (/(^|\.)vercel\.app$/.test(env('ROOT_DOMAIN'))) add('fail', 'ROOT_DOMAIN', 'must be your own domain, never vercel.app (the app would read your Vercel address as a gym subdomain). Leave it empty until you have a domain')
else add(env('ROOT_DOMAIN') ? 'ok' : 'warn', 'ROOT_DOMAIN', env('ROOT_DOMAIN') || 'empty - fine until you have your own domain (gym subdomains)')

secret('JWT_SECRET', 32, 'signs staff and member logins')
secret('JWT_ADMIN_SECRET', 32, 'signs super admin logins')
if (env('JWT_SECRET') && env('JWT_SECRET') === env('JWT_ADMIN_SECRET')) add('fail', 'JWT_ADMIN_SECRET', 'must be different from JWT_SECRET')
secret('OTP_PEPPER', 32, 'hashes login codes')
secret('QR_SECRET', 32, 'signs check-in QR codes and pay links')
secret('CRON_SECRET', 16, 'Vercel Cron sends it to /api/cron/*')

const key = env('ENCRYPTION_KEY')
if (!key) add('fail', 'ENCRYPTION_KEY', 'missing - 32 random bytes, base64')
else if (Buffer.from(key, 'base64').length !== 32) add('fail', 'ENCRYPTION_KEY', 'must decode to exactly 32 bytes')
else add('ok', 'ENCRYPTION_KEY', '32 bytes - never change it once data exists')

if (env('DEMO_LOGIN_CODE') || env('DEMO_LOGIN_PHONES')) add('warn', 'DEMO_LOGIN_CODE', 'showcase mode is ON: listed numbers log in with a fixed code. Remove before real gyms use the site')
if (env('DEV_LOG_OTP') === 'true') add('warn', 'DEV_LOG_OTP', 'true - fine locally, ignored in production but remove it from Vercel')

// ---- WhatsApp: needed for phone logins in production ----------------------
const wa = ['WHATSAPP_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_BUSINESS_ACCOUNT_ID', 'WHATSAPP_APP_SECRET', 'WHATSAPP_VERIFY_TOKEN']
const waMissing = wa.filter((name) => !env(name))
if (waMissing.length === 0) add('ok', 'WhatsApp Cloud API', 'configured')
else if (env('DEMO_LOGIN_CODE') && env('DEMO_LOGIN_PHONES')) add('warn', 'WhatsApp Cloud API', 'not set - fine for a showcase: only the DEMO_LOGIN_PHONES numbers can log in by phone, and no reminders go out')
else add('fail', 'WhatsApp Cloud API', `missing ${waMissing.join(', ')} - phone OTP login and reminders will not work`)

// ---- Optional integrations ----------------------------------------------
const optional: [string, string[], string][] = [
  ['Brevo email', ['BREVO_API_KEY', 'BREVO_SENDER_EMAIL'], 'owner email login codes, invoices by email, Rep+ billing mail'],
  ['Cloudinary', ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'], 'gym logos, progress photos, complaint photos'],
  ['Web push (VAPID)', ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'NEXT_PUBLIC_VAPID_PUBLIC_KEY'], 'free push notifications (pnpm vapid makes keys)'],
  ['Groq AI', ['GROQ_API_KEY'], 'motivation lines and owner AI insights (falls back to built-in text)'],
  ['Rep+ payments', ['KASRAT_UPI_ID', 'KASRAT_UPI_NAME'], 'where gyms pay their Rep+ subscription'],
]
for (const [label, names, use] of optional) {
  const missing = names.filter((name) => !env(name))
  add(missing.length ? 'warn' : 'ok', label, missing.length ? `not set (${missing.join(', ')}) - ${use}` : 'configured')
}
if (env('VAPID_PUBLIC_KEY') && env('NEXT_PUBLIC_VAPID_PUBLIC_KEY') && env('VAPID_PUBLIC_KEY') !== env('NEXT_PUBLIC_VAPID_PUBLIC_KEY')) add('fail', 'NEXT_PUBLIC_VAPID_PUBLIC_KEY', 'must equal VAPID_PUBLIC_KEY')

// ---- Report -------------------------------------------------------------
const mark: Record<Level, string> = { ok: '[ OK ]', warn: '[WARN]', fail: '[FAIL]' }
console.info(`Rep+ environment check (${file})\n`)
for (const row of rows) console.info(`${mark[row.level]} ${row.name.padEnd(30)} ${row.note}`)
const fails = rows.filter((row) => row.level === 'fail').length
const warns = rows.filter((row) => row.level === 'warn').length
console.info(`\n${fails} failing, ${warns} warnings.`)
process.exit(fails ? 1 : 0)
