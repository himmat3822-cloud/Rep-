import 'server-only'
import type { TenantDb } from '@/lib/db/tenant'
import { getGymFeatures } from './features'
import { parseGymSettings, type GymSettings } from './settings'
import type { FeatureKey } from '@/lib/features'

// Settings + features for a gym, loaded together (used by attendance routes).
export async function loadGymConfig(db: TenantDb, gymId: string): Promise<{ settings: GymSettings; rawSettings: unknown; features: FeatureKey[]; sessionMinutes: number; slug: string }> {
  const [gym, features] = await Promise.all([db.gym.findFirstOrThrow({ select: { settings: true, sessionMinutes: true, slug: true } }), getGymFeatures(gymId)])
  return { settings: parseGymSettings(gym.settings), rawSettings: gym.settings, features, sessionMinutes: gym.sessionMinutes, slug: gym.slug }
}
