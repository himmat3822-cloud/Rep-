import { ok } from '@/lib/api/guard'
import { athleteRoute } from '@/lib/api/athlete'
import { cancelBooking } from '@/lib/athlete/slots'

// DELETE /api/g/{slug}/bookings/{id} - cancel before the slot starts
export const DELETE = athleteRoute({ feature: 'slot_booking' }, async ({ db, me, params }) => ok(await cancelBooking(db, me.id, params.id)))
