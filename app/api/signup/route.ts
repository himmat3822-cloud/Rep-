import { publicRoute, ok } from '@/lib/api/guard'
import { prisma } from '@/lib/db/client'
import { signupSchema } from '@/lib/validation/owner'
import { readSignupTicket } from '@/lib/auth/signup-ticket'
import { startSession } from '@/lib/auth/session'
import { assertSlugAvailable, createGymWithOwner } from '@/lib/platform/gyms'
import { TRIAL_DAYS } from '@/lib/platform/billing'

// POST /api/signup - owner onboarding: verified phone (ticket) + gym details +
// front-desk answer + plan -> gym created on a 14-day trial, owner logged in.
// No card and no payment gateway at signup.
export const POST = publicRoute({ schema: signupSchema }, async ({ input, meta }) => {
  await assertSlugAvailable(prisma, input.slug)
  const phone = await readSignupTicket(input.ticket)
  const { owner } = await createGymWithOwner(
    prisma,
    {
      name: input.gymName,
      slug: input.slug,
      city: input.city,
      address: input.address,
      ownerName: input.ownerName,
      ownerPhone: phone,
      ownerEmail: input.ownerEmail,
      ownerPassword: input.ownerPassword,
      planId: input.planId,
      cycle: input.cycle,
      trialDays: TRIAL_DAYS,
      ownerHandlesDesk: input.ownerHandlesDesk,
    },
    { type: 'SYSTEM', id: 'signup', ip: meta.ip },
  )
  await startSession('staff', owner.id, meta)
  return ok({ redirectTo: '/owner?welcome=1' }, { status: 201 })
})
