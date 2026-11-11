import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/client'
import { errorResponse, errors } from '@/lib/api/errors'
import { hitRateLimit } from '@/lib/rate-limit'
import { punchesSchema } from '@/lib/validation/attendance'
import { deviceKeyMatches, parseDeviceKey, parseIstDateTime } from '@/lib/attendance/devices'
import { acceptPunches } from '@/lib/attendance/device-auth'

// POST /api/devices/punches
// Authorization: Bearer kd_<prefix>_<secret>
// { "punches": [ { "userId": "105", "timestamp": "2026-11-10 06:42:13", "direction": "in" } ] }
// Timestamps without a zone are IST. ISO timestamps with a zone are accepted too.
export async function POST(request: Request) {
  try {
    const key = parseDeviceKey(request.headers.get('authorization'))
    if (!key) throw errors.unauthenticated('Missing or malformed device key')
    const limit = await hitRateLimit(prisma, `device:${key.prefix}`, 120, 60)
    if (!limit.ok) throw errors.rateLimited(limit.retryAfterSeconds)
    const device = await prisma.attendanceDevice.findUnique({ where: { keyPrefix: key.prefix } })
    if (!device || !deviceKeyMatches(key.raw, device.keyHash)) throw errors.unauthenticated('Unknown device key')
    const body = punchesSchema.parse(await request.json().catch(() => ({})))
    const punches = body.punches.map((punch) => {
      const at = /[zZ]|[+-]\d{2}:?\d{2}$/.test(punch.timestamp) ? new Date(punch.timestamp) : parseIstDateTime(punch.timestamp)
      if (!at || Number.isNaN(at.getTime())) throw errors.validation(`Bad timestamp: ${punch.timestamp}`)
      return { userId: punch.userId, at, direction: punch.direction }
    })
    const outcome = await acceptPunches(device, request, punches)
    if (!outcome.ok) return NextResponse.json({ error: { code: 'FORBIDDEN', message: outcome.message } }, { status: outcome.status })
    return NextResponse.json(outcome.result)
  } catch (error) {
    return errorResponse(error)
  }
}
