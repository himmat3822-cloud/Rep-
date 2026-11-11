import 'server-only'
import { tenantDb } from '@/lib/db/tenant'
import { resolveFeatures, type FeatureKey } from '@/lib/features'

// Effective feature list for a gym = its Rep+ plan + admin overrides.
export async function getGymFeatures(gymId: string): Promise<FeatureKey[]> {
  const db = tenantDb(gymId)
  const [subscription, override] = await Promise.all([
    db.gymSubscription.findFirst({ include: { plan: { select: { features: true } } } }),
    db.gymOverride.findFirst(),
  ])
  if (!subscription) return []
  return resolveFeatures(subscription.plan.features, override?.extraFeatures ?? [], override?.removedFeatures ?? [])
}

export async function gymHasFeature(gymId: string, feature: FeatureKey): Promise<boolean> {
  const features = await getGymFeatures(gymId)
  return features.includes(feature)
}
