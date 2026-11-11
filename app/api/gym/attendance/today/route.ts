import { gymRoute, ok } from '@/lib/api/guard'
import { todayQuerySchema } from '@/lib/validation/attendance'
import { istStartOfDay } from '@/lib/time'

// GET /api/gym/attendance/today?branchId= - today's visits for the desk list
export const GET = gymRoute({ permission: 'attendance.read', schema: todayQuerySchema }, async ({ db, gym, input }) => {
  const visits = await db.checkIn.findMany({ where: { checkedInAt: { gte: istStartOfDay() }, ...(input.branchId ? { branchId: input.branchId } : {}) }, orderBy: { checkedInAt: 'desc' }, take: 300 })
  const athletes = await db.athlete.findMany({ where: { id: { in: [...new Set(visits.map((v) => v.athleteId))] } }, select: { id: true, name: true, memberCode: true } })
  const byId = new Map(athletes.map((a) => [a.id, a]))
  const sessionMs = gym.sessionMinutes * 60000
  return ok(
    visits.map((visit) => ({
      id: visit.id,
      athleteId: visit.athleteId,
      name: byId.get(visit.athleteId)?.name ?? '-',
      memberCode: byId.get(visit.athleteId)?.memberCode ?? '',
      method: visit.method,
      checkedInAt: visit.checkedInAt,
      checkedOutAt: visit.checkedOutAt,
      inside: !visit.checkedOutAt && Date.now() - visit.checkedInAt.getTime() < sessionMs,
    })),
  )
})
