import type { z } from 'zod'
import { errors } from './errors'
import { gymRoute, type GymContext, type GymRouteOptions } from './guard'
import type { FeatureKey } from '@/lib/features'

// gymRoute for the athlete app: athlete session only, and the member's own
// row loaded as ctx.me (never trust ids from the client for "who am I").

type InputOf<S> = S extends z.ZodType ? z.output<S> : undefined

export interface AthleteRow {
  id: string
  name: string
  phone: string
  memberCode: string
  homeBranchId: string
  language: 'EN' | 'HI' | 'PA'
  referralCode: string
  streakDays: number
  bestStreak: number
}

export function athleteRoute<S extends z.ZodType | undefined = undefined>(
  options: Omit<GymRouteOptions<S>, 'allow' | 'permission'> & { feature?: FeatureKey },
  handler: (ctx: GymContext<InputOf<S>> & { me: AthleteRow }) => Promise<Response> | Response,
) {
  return gymRoute<S>({ ...options, allow: ['athlete'] }, async (ctx) => {
    if (!ctx.athlete) throw errors.forbidden()
    const me = await ctx.db.athlete.findFirst({
      where: { id: ctx.athlete.sub, archived: false },
      select: { id: true, name: true, phone: true, memberCode: true, homeBranchId: true, language: true, referralCode: true, streakDays: true, bestStreak: true },
    })
    if (!me) throw errors.unauthenticated()
    return handler({ ...ctx, me })
  })
}
