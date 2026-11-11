import 'server-only'
import { prisma } from '@/lib/db/client'
import { ApiError } from '@/lib/api/errors'
import { parseGymSettings } from '@/lib/gym/settings'
import { loadMessagingContext } from './send'
import { sendDueReminderNow } from './dues'

// Owner-triggered sends from the dashboard. Uses the raw client because the
// quota counter is an atomic SQL update; every query is scoped to gymId.

export async function remindDueNow(gym: { id: string; name: string }, dueId: string) {
  const row = await prisma.gym.findUniqueOrThrow({ where: { id: gym.id }, select: { settings: true } })
  const ctx = await loadMessagingContext(prisma, gym.id)
  const result = await sendDueReminderNow(prisma, ctx, { id: gym.id, name: gym.name, messaging: parseGymSettings(row.settings).messaging }, dueId)
  switch (result.outcome) {
    case 'sent':
      return { ok: true, template: result.template }
    case 'not_found':
      throw new ApiError(404, 'NOT_FOUND', 'Due not found')
    case 'not_open':
      throw new ApiError(409, 'CONFLICT', 'This due is already paid or waived')
    case 'duplicate':
      throw new ApiError(409, 'CONFLICT', 'A reminder for this due already went out today')
    case 'quiet_hours':
      throw new ApiError(422, 'VALIDATION_ERROR', 'Reminders do not go out between 9 PM and 8 AM. Try again after 8 AM.')
    case 'opted_out':
      throw new ApiError(422, 'VALIDATION_ERROR', 'This member replied STOP and has opted out of WhatsApp messages. Give them a call instead.')
    case 'paused':
      throw new ApiError(403, 'GYM_READ_ONLY', 'Your Rep+ access is paused, so messages cannot go out')
    case 'quota':
      throw new ApiError(429, 'RATE_LIMITED', 'Your WhatsApp messages for this month are used up. Ask Rep+ for a top-up.')
    default:
      throw new ApiError(502, 'DELIVERY_FAILED', result.error ?? 'WhatsApp did not accept the message. Try again later.')
  }
}
