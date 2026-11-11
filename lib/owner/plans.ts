import type { z } from 'zod'
import type { membershipPlanSchema } from '@/lib/validation/owner'
import { rupeesToPaise } from '@/lib/money'

export function membershipPlanData(input: z.output<typeof membershipPlanSchema>) {
  return {
    name: input.name,
    durationDays: input.durationDays,
    pricePaise: rupeesToPaise(input.priceRupees),
    joiningFeePaise: rupeesToPaise(input.joiningFeeRupees),
    gstPercent: input.gstPercent,
    gstInclusive: input.gstInclusive,
    maxFreezeDays: input.maxFreezeDays,
    crossBranch: input.crossBranch,
    ptAddonPaise: input.ptAddonRupees === undefined ? null : rupeesToPaise(input.ptAddonRupees),
    ptSessionsIncluded: input.ptSessionsIncluded,
    active: input.active,
    sortOrder: input.sortOrder,
  }
}
