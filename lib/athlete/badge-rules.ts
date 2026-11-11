import 'server-only'
import { prisma } from '@/lib/db/client'
import type { TenantDb } from '@/lib/db/tenant-core'
import { evaluateAthlete, type BadgeRuleRow } from './badges'

// BadgeRule is a platform-wide catalog (no gymId), so it is read with the
// raw client and cached for a minute. Everything else stays tenant scoped.

let cache: { at: number; rules: BadgeRuleRow[] } | null = null

export async function loadBadgeRules(): Promise<BadgeRuleRow[]> {
  if (cache && Date.now() - cache.at < 60_000) return cache.rules
  const rules = await prisma.badgeRule.findMany({ where: { active: true }, orderBy: { threshold: 'asc' } })
  cache = { at: Date.now(), rules }
  return rules
}

// Called after a check-in. Never fails the check-in itself.
export async function afterCheckIn(db: TenantDb, gym: { id: string; slug: string }, athleteId: string): Promise<void> {
  try {
    await evaluateAthlete(db, gym, athleteId, await loadBadgeRules())
  } catch (error) {
    console.error('[badges] evaluation failed', athleteId, error)
  }
}
