import { sendNotification, setVapidDetails } from 'web-push'
import type { TenantDb } from '@/lib/db/tenant-core'
import { optionalEnv } from '@/lib/env'

// Web push for the athlete PWA. Free (no per-message cost), so it is tried
// first for nice-to-have messages; WhatsApp is the fallback.

export interface PushPayload {
  title: string
  body: string
  url: string
  tag?: string
}

export type PushTransport = (subscription: { endpoint: string; p256dh: string; auth: string }, payload: PushPayload) => Promise<'ok' | 'gone' | 'error'>

let configured: boolean | null = null

export function pushConfigured(): boolean {
  if (configured !== null) return configured
  const publicKey = optionalEnv('VAPID_PUBLIC_KEY')
  const privateKey = optionalEnv('VAPID_PRIVATE_KEY')
  if (!publicKey || !privateKey) return (configured = false)
  setVapidDetails(optionalEnv('VAPID_SUBJECT') ?? 'mailto:support@kasrat.app', publicKey, privateKey)
  return (configured = true)
}

export const webPushTransport: PushTransport = async (subscription, payload) => {
  if (!pushConfigured()) return 'error'
  try {
    await sendNotification({ endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } }, JSON.stringify(payload), { TTL: 6 * 3600, urgency: 'normal' })
    return 'ok'
  } catch (error) {
    const status = (error as { statusCode?: number }).statusCode
    // 404/410: the browser dropped the subscription (app uninstalled, permission revoked).
    if (status === 404 || status === 410) return 'gone'
    console.error('[push] send failed', status ?? '', error instanceof Error ? error.message : error)
    return 'error'
  }
}

// Sends to every device of one member. Returns how many devices got it.
export async function pushToAthlete(db: TenantDb, athleteId: string, payload: PushPayload, transport: PushTransport = webPushTransport): Promise<number> {
  const subscriptions = await db.pushSubscription.findMany({ where: { athleteId } })
  if (subscriptions.length === 0) return 0
  let delivered = 0
  for (const subscription of subscriptions) {
    const result = await transport(subscription, payload)
    if (result === 'ok') {
      delivered += 1
      await db.pushSubscription.update({ where: { id: subscription.id }, data: { lastUsedAt: new Date() } })
    } else if (result === 'gone') {
      await db.pushSubscription.deleteMany({ where: { id: subscription.id } })
    }
  }
  return delivered
}
