import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@/lib/generated/prisma/client'

// Builds a Prisma 7 client with the pg driver adapter.
// Works with Neon (use the pooled connection string in DATABASE_URL) and
// with any local Postgres. Kept free of 'server-only' so the seed script and
// Vitest can use it too.

// Neon's dashboard gives `sslmode=require`. node-postgres already treats
// require / prefer / verify-ca as verify-full (certificate checked) and warns
// that the meaning changes in its next major version. We say verify-full
// explicitly: same security as today, no warning, and no silent downgrade
// when pg is upgraded. An explicit `uselibpqcompat` choice is left alone.
export function normalizeConnectionString(connectionString: string): string {
  try {
    const url = new URL(connectionString)
    const mode = url.searchParams.get('sslmode')
    if (mode && ['require', 'prefer', 'verify-ca'].includes(mode) && !url.searchParams.has('uselibpqcompat')) {
      url.searchParams.set('sslmode', 'verify-full')
      return url.toString()
    }
    return connectionString
  } catch {
    return connectionString
  }
}

export function createPrismaClient(url?: string): PrismaClient {
  const connectionString = url ?? process.env.DATABASE_URL
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set')
  }
  const adapter = new PrismaPg({ connectionString: normalizeConnectionString(connectionString) })
  return new PrismaClient({ adapter })
}
