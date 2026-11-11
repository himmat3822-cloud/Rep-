import { gymRoute, ok } from '@/lib/api/guard'
import { errors } from '@/lib/api/errors'
import { dailyQrKey } from '@/lib/attendance/qr'
import { enabledMethods, requireMethod } from '@/lib/attendance/methods'
import { loadGymConfig } from '@/lib/gym/context'

// GET /api/g/{slug}/me/qr-key - daily keys (today + tomorrow, IST) that the
// app uses to draw the 30-second rotating QR, even offline.
export const GET = gymRoute({ allow: ['athlete'] }, async ({ db, gym, athlete }) => {
  if (!athlete) throw errors.forbidden()
  const config = await loadGymConfig(db, gym.id)
  requireMethod(enabledMethods(config.settings.attendance, config.features).deskQr, 'QR check-in')
  const today = new Date(Date.now() + 330 * 60000)
  const dates = [today, new Date(today.getTime() + 86400000)].map((date) => date.toISOString().slice(0, 10))
  return ok(
    { athleteId: athlete.sub, keys: dates.map((date) => ({ date, key: dailyQrKey(gym.id, athlete.sub, date).toString('base64url') })) },
    { headers: { 'Cache-Control': 'private, no-store' } },
  )
})
