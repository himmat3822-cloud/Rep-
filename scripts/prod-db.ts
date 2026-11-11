import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { config } from 'dotenv'

// pnpm prod:migrate     apply migrations to the production database
// pnpm prod:bootstrap   create Rep+ plans, badge rules and the super admin
// pnpm prod:demo        load (or reset) the showcase gym "The Sharp Fitness"
//
// Reads .env.production (never committed) so your normal .env keeps pointing
// at the local database. Works the same in PowerShell, cmd and bash.

const action = process.argv[2]
const file = process.argv[3] ?? '.env.production'
if (action !== 'migrate' && action !== 'bootstrap' && action !== 'demo') {
  console.error('Usage: tsx scripts/prod-db.ts migrate|bootstrap|demo [env-file]')
  process.exit(1)
}
if (!existsSync(file)) {
  console.error(`${file} not found. Copy .env.example to ${file} and fill in the production values.`)
  process.exit(1)
}
const loaded = config({ path: file, override: true, quiet: true }).parsed ?? {}
const url = loaded.DIRECT_URL || loaded.DATABASE_URL
if (!url) {
  console.error(`DIRECT_URL / DATABASE_URL missing in ${file}`)
  process.exit(1)
}
const host = (() => {
  try {
    return new URL(url).host
  } catch {
    return 'unknown host'
  }
})()
console.info(`${action === 'migrate' ? 'Migrating' : action === 'demo' ? 'Loading the showcase gym into' : 'Bootstrapping'} database at ${host} (from ${file})\n`)

const env: NodeJS.ProcessEnv = { ...process.env, ...loaded, NODE_ENV: 'production' }
const args: string[] =
  action === 'migrate' ? ['prisma', 'migrate', 'deploy'] : action === 'demo' ? ['tsx', 'prisma/seed.ts', '--only=sharp-fitness', '--force-demo'] : ['tsx', 'prisma/seed.ts', '--platform-only']
const result = spawnSync('npx', args, { stdio: 'inherit', shell: process.platform === 'win32', env })
process.exit(result.status ?? 1)
