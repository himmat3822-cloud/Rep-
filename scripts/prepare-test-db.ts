import 'dotenv/config'
import { spawnSync } from 'node:child_process'

// Applies all migrations to TEST_DATABASE_URL. Cross-platform (works in
// PowerShell, cmd and bash) because the env is set here, not in the shell.
const url = process.env.TEST_DATABASE_URL
if (!url) {
  console.error('TEST_DATABASE_URL is not set in .env')
  process.exit(1)
}

const result = spawnSync('npx', ['prisma', 'migrate', 'deploy'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url },
})
process.exit(result.status ?? 1)
