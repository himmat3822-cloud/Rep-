import { gymRoute, ok } from '@/lib/api/guard'
import { toSessionUser } from '@/lib/auth/session-user'
import type { MeResponse } from '@/lib/api/types'

// GET /api/auth/me - current staff or athlete plus their gym.
// Works even when the gym is suspended so the UI can show the right banner.
export const GET = gymRoute({ allow: ['staff', 'athlete'], allowWhenSuspended: true }, async ({ claims, gym }) => {
  const user = toSessionUser(claims)
  if (user.type === 'admin') throw new Error('unreachable')
  const body: MeResponse = {
    user,
    gym: {
      id: gym.id,
      slug: gym.slug,
      name: gym.name,
      city: gym.city,
      subscriptionStatus: gym.subscriptionStatus,
      athleteLabel: gym.athleteLabel,
      athleteLabelPlural: gym.athleteLabelPlural,
    },
  }
  return ok(body)
})
