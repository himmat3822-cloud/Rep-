import { createHmac, timingSafeEqual } from 'node:crypto'
import { Prisma, type MessageStatus, type PrismaClient } from '@/lib/generated/prisma/client'
import { refundMessage } from './quota'

// WhatsApp Cloud API webhooks: delivery receipts and inbound replies.
//  - X-Hub-Signature-256 is an HMAC of the raw body with the app secret
//  - every (message id, status) pair is processed once (WebhookEvent)
//  - receipts can arrive out of order, so a status never moves backwards
//  - a member who replies STOP is opted out of gym messages; START opts back in

export function verifyMetaSignature(rawBody: string, header: string | null, appSecret: string): boolean {
  if (!header?.startsWith('sha256=')) return false
  const expected = Buffer.from(`sha256=${createHmac('sha256', appSecret).update(rawBody, 'utf8').digest('hex')}`)
  const given = Buffer.from(header)
  return expected.length === given.length && timingSafeEqual(expected, given)
}

export interface StatusUpdate {
  providerId: string
  status: 'sent' | 'delivered' | 'read' | 'failed'
  at: Date
  error?: string
}

export interface InboundText {
  id: string
  from: string
  text: string
}

interface MetaPayload {
  entry?: {
    changes?: {
      value?: {
        statuses?: { id?: string; status?: string; timestamp?: string; errors?: { title?: string; message?: string; code?: number }[] }[]
        messages?: { id?: string; from?: string; type?: string; text?: { body?: string }; button?: { text?: string } }[]
      }
    }[]
  }[]
}

const KNOWN = new Set(['sent', 'delivered', 'read', 'failed'])

export function parseWebhook(payload: unknown): { statuses: StatusUpdate[]; messages: InboundText[] } {
  const statuses: StatusUpdate[] = []
  const messages: InboundText[] = []
  for (const entry of (payload as MetaPayload)?.entry ?? []) {
    for (const change of entry.changes ?? []) {
      for (const item of change.value?.statuses ?? []) {
        if (!item.id || !item.status || !KNOWN.has(item.status)) continue
        const seconds = Number(item.timestamp)
        const error = item.errors?.[0]
        statuses.push({
          providerId: item.id,
          status: item.status as StatusUpdate['status'],
          at: Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000) : new Date(),
          error: error ? `${error.code ?? ''} ${error.title ?? error.message ?? 'failed'}`.trim() : undefined,
        })
      }
      for (const item of change.value?.messages ?? []) {
        const text = item.text?.body ?? item.button?.text
        if (item.id && item.from && text) messages.push({ id: item.id, from: item.from, text })
      }
    }
  }
  return { statuses, messages }
}

const RANK: Record<MessageStatus, number> = { QUEUED: 0, BLOCKED: 0, SENT: 1, DELIVERED: 2, READ: 3, FAILED: 1 }
const TO_STATUS: Record<StatusUpdate['status'], MessageStatus> = { sent: 'SENT', delivered: 'DELIVERED', read: 'READ', failed: 'FAILED' }

// The status a log should move to, or null to leave it alone.
export function nextStatus(current: MessageStatus, incoming: StatusUpdate['status']): MessageStatus | null {
  const target = TO_STATUS[incoming]
  if (current === target) return null
  if (target === 'FAILED') return current === 'READ' || current === 'DELIVERED' ? null : 'FAILED'
  if (current === 'FAILED') return null
  return RANK[target] > RANK[current] ? target : null
}

export type OptCommand = 'stop' | 'start' | null

export function optCommand(text: string): OptCommand {
  const word = text.trim().toUpperCase().replace(/[^A-Z]/g, '')
  if (['STOP', 'UNSUBSCRIBE', 'STOPALL', 'CANCEL'].includes(word)) return 'stop'
  if (['START', 'SUBSCRIBE', 'UNSTOP'].includes(word)) return 'start'
  return null
}

async function firstTime(db: PrismaClient, eventId: string, type: string, payload: object): Promise<boolean> {
  try {
    await db.webhookEvent.create({ data: { provider: 'whatsapp', eventId, type, payload, processedAt: new Date() } })
    return true
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return false
    throw error
  }
}

export interface WebhookResult {
  statuses: number
  updated: number
  optOuts: number
  optIns: number
}

export async function applyWhatsAppWebhook(db: PrismaClient, payload: unknown): Promise<WebhookResult> {
  const { statuses, messages } = parseWebhook(payload)
  const result: WebhookResult = { statuses: statuses.length, updated: 0, optOuts: 0, optIns: 0 }

  for (const update of statuses) {
    if (!(await firstTime(db, `${update.providerId}:${update.status}`, `status.${update.status}`, update))) continue
    const log = await db.messageLog.findUnique({ where: { providerId: update.providerId }, select: { id: true, gymId: true, status: true, critical: true, createdAt: true } })
    if (!log) continue
    const target = nextStatus(log.status, update.status)
    if (!target) continue
    const data: Prisma.MessageLogUpdateInput = { status: target }
    if (target === 'SENT') data.sentAt = update.at
    if (target === 'DELIVERED') data.deliveredAt = update.at
    if (target === 'READ') {
      data.readAt = update.at
      if (log.status !== 'DELIVERED') data.deliveredAt = update.at
    }
    if (target === 'FAILED') data.error = update.error ?? 'Delivery failed'
    await db.messageLog.update({ where: { id: log.id }, data })
    if (target === 'FAILED') await refundMessage(db, log.gymId, log.createdAt)
    result.updated += 1
  }

  for (const message of messages) {
    const command = optCommand(message.text)
    if (!command) continue
    if (!(await firstTime(db, `in:${message.id}`, `inbound.${command}`, { from: message.from, command }))) continue
    const phone = `+${message.from.replace(/\D/g, '')}`
    const changed = await db.athlete.updateMany({ where: { phone }, data: { whatsappOptOut: command === 'stop' } })
    if (command === 'stop') result.optOuts += changed.count
    else result.optIns += changed.count
  }
  return result
}
