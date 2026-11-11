import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/client'
import { tenantDb } from '@/lib/db/tenant'
import { getGymFeatures } from '@/lib/gym/features'
import { getOccupancy } from '@/lib/attendance/insights'

// GET /api/g/{slug}/occupancy - public live crowd meter, cached for 30 s.
// Only counts, never names.
export async function GET(_request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params
  const gym = await prisma.gym.findUnique({ where: { slug }, select: { id: true, sessionMinutes: true, subscriptionStatus: true } })
  if (!gym || gym.subscriptionStatus === 'SUSPENDED' || gym.subscriptionStatus === 'CANCELLED') {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Gym not found' } }, { status: 404 })
  }
  const features = await getGymFeatures(gym.id)
  if (!features.includes('crowd_meter')) return NextResponse.json({ error: { code: 'FEATURE_NOT_IN_PLAN', message: 'Crowd meter is not enabled' } }, { status: 404 })
  const branches = await getOccupancy(tenantDb(gym.id), gym.sessionMinutes)
  return NextResponse.json({ updatedAt: new Date().toISOString(), branches }, { headers: { 'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=30' } })
}
