import { gymRoute, ok } from '@/lib/api/guard'
import { checkoutSchema } from '@/lib/validation/attendance'
import { checkOut } from '@/lib/attendance/checkin'

// POST /api/gym/attendance/checkout { checkInId }
export const POST = gymRoute({ permission: 'attendance.checkin', schema: checkoutSchema }, async ({ db, input }) => {
  const visit = await checkOut(db, input.checkInId)
  return ok({ id: visit.id, checkedOutAt: visit.checkedOutAt })
})
