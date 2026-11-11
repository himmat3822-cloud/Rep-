import 'dotenv/config'
import { defineConfig } from 'prisma/config'

// Prisma 7: the datasource URL lives here, not in schema.prisma.
// Migrations use DIRECT_URL (Neon non-pooled) when set, else DATABASE_URL.
const url = process.env.DIRECT_URL || process.env.DATABASE_URL || 'postgresql://placeholder:placeholder@localhost:5432/placeholder'

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url,
  },
})
