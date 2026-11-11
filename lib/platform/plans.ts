import type { z } from 'zod'
import type { planSchema, planUpdateSchema } from '@/lib/validation/admin'
import { rupeesToPaise } from '@/lib/money'

// Maps the admin plan form (rupees) to DB columns (paise).
export function planData(input: z.output<typeof planUpdateSchema> | z.output<typeof planSchema>) {
  return {
    name: input.name,
    description: input.description,
    monthlyPricePaise: rupeesToPaise(input.monthlyPriceRupees),
    annualPricePaise: rupeesToPaise(input.annualPriceRupees),
    memberLimit: input.memberLimit,
    branchLimit: input.branchLimit,
    extraBranchPaise: input.extraBranchRupees === null ? null : rupeesToPaise(input.extraBranchRupees),
    staffLimit: input.staffLimit,
    trainerLimit: input.trainerLimit,
    deskLimit: input.deskLimit,
    whatsappQuota: input.whatsappQuota,
    features: [...new Set(input.features)],
    isPopular: input.isPopular,
    sortOrder: input.sortOrder,
  }
}
