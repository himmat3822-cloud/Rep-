import { gymRoute, ok } from '@/lib/api/guard'
import { collectSchema } from '@/lib/validation/owner'
import { collectDue } from '@/lib/owner/money'
import { actorFrom } from '@/lib/owner/actor'
import { rupeesToPaise } from '@/lib/money'

// POST /api/gym/dues/{id}/collect { amountRupees?, method } - full or part payment
export const POST = gymRoute({ permission: 'payments.collect', schema: collectSchema }, async ({ db, gym, params, input, staff, meta }) => {
  const settings = await db.gym.findFirst({ select: { settings: true } })
  const result = await collectDue(
    db,
    { id: gym.id, name: gym.name, settings: settings?.settings },
    { dueId: params.id, amountPaise: input.amountRupees !== undefined ? rupeesToPaise(input.amountRupees) : undefined, method: input.method, note: input.note },
    actorFrom(staff, meta),
  )
  return ok({ invoiceId: result.invoice.id, invoiceNumber: result.invoice.number, remainingPaise: result.remainingPaise }, { status: 201 })
})
