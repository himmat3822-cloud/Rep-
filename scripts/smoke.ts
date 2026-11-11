// pnpm smoke -- https://your-domain
//
// Post-deploy smoke test. Read-only: it creates nothing and needs no login.
// Checks the app and database answer, pages render, security headers are
// set, and protected routes really refuse anonymous callers.

const base = (process.argv.slice(2).find((arg) => arg.startsWith('http')) ?? 'http://localhost:3000').replace(/\/$/, '')
let failed = 0

async function check(name: string, fn: () => Promise<string | true>) {
  try {
    const result = await fn()
    if (result === true) console.info(`[ OK ] ${name}`)
    else {
      failed += 1
      console.info(`[FAIL] ${name}: ${result}`)
    }
  } catch (error) {
    failed += 1
    console.info(`[FAIL] ${name}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

const get = (path: string, init: RequestInit = {}) => fetch(`${base}${path}`, { redirect: 'manual', ...init })

async function main() {
  console.info(`Rep+ smoke test: ${base}\n`)

  await check('health endpoint, database up', async () => {
    const res = await get('/api/health')
    const body = (await res.json()) as { ok?: boolean; db?: string }
    return res.status === 200 && body.ok === true ? true : `status ${res.status}, db ${body.db}`
  })

  await check('landing page renders with pricing', async () => {
    const res = await get('/')
    const html = await res.text()
    return res.status === 200 && html.includes('pricing') ? true : `status ${res.status}`
  })

  await check('login page renders', async () => {
    const res = await get('/login')
    return res.status === 200 ? true : `status ${res.status}`
  })

  await check('security headers', async () => {
    const res = await get('/login')
    const missing = [
      ['x-frame-options', 'DENY'],
      ['x-content-type-options', 'nosniff'],
      ['referrer-policy', 'strict-origin-when-cross-origin'],
    ].filter(([name, value]) => res.headers.get(name) !== value)
    if (base.startsWith('https://') && !res.headers.get('strict-transport-security')) missing.push(['strict-transport-security', ''])
    if (res.headers.get('x-powered-by')) missing.push(['x-powered-by should be absent', ''])
    return missing.length ? `missing ${missing.map(([name]) => name).join(', ')}` : true
  })

  await check('owner pages need a login', async () => {
    // No cookie: /owner -> refresh attempt -> /login.
    const res = await fetch(`${base}/owner`, { redirect: 'follow' })
    return new URL(res.url).pathname === '/login' ? true : `ended at ${res.url} (status ${res.status})`
  })

  await check('admin pages need a login', async () => {
    const res = await get('/admin')
    return res.status >= 300 && res.status < 400 ? true : `status ${res.status}`
  })

  await check('gym API refuses anonymous calls', async () => {
    const res = await get('/api/gym/leads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    return res.status === 401 ? true : `status ${res.status}`
  })

  await check('cron routes refuse calls without the secret', async () => {
    for (const job of ['attendance', 'messages', 'motivation', 'billing']) {
      const res = await get(`/api/cron/${job}`, { headers: { Authorization: 'Bearer wrong' } })
      if (res.status !== 401) return `${job}: status ${res.status}`
    }
    return true
  })

  await check('WhatsApp webhook rejects unsigned posts', async () => {
    const res = await get('/api/webhooks/whatsapp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"entry":[]}' })
    return res.status >= 400 ? true : `status ${res.status}`
  })

  await check('unknown gym pages are not found', async () => {
    const res = await get('/api/g/no-such-gym-xyz/enquire', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Smoke Test', phone: '9876543210', website: '' }) })
    return res.status === 404 || res.status === 429 ? true : `status ${res.status}`
  })

  console.info(failed ? `\n${failed} check(s) failed.` : '\nAll checks passed.')
  process.exit(failed ? 1 : 0)
}

void main()
