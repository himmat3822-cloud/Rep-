import 'server-only'
import { prisma } from '@/lib/db/client'
import { devLogOtp, optionalEnv, requireEnv } from '@/lib/env'
import { hmacHex, randomDigits, safeEqualHex } from '@/lib/crypto'
import { hitRateLimit } from '@/lib/rate-limit'
import { ApiError, errors } from '@/lib/api/errors'
import { sendWhatsAppTemplate, whatsappConfigured, type WaLanguage } from '@/lib/integrations/whatsapp'
import { reserveMessage } from '@/lib/messaging/quota'
import { maskPhone } from '@/lib/phone'

// OTP rules: 6 digits, 5 minute expiry, max 5 attempts, stored as an HMAC
// (never plain), rate-limited per phone and per IP.

export const OTP_TTL_SECONDS = 5 * 60
export const OTP_MAX_ATTEMPTS = 5

const LIMITS = {
  perPhone: { limit: 3, windowSeconds: 10 * 60 },
  perPhoneDay: { limit: 10, windowSeconds: 24 * 3600 },
  perIp: { limit: 20, windowSeconds: 3600 },
  verifyPerIp: { limit: 30, windowSeconds: 10 * 60 },
}

type Scope = 'STAFF' | 'ATHLETE' | 'SIGNUP'

export function hashOtp(scope: Scope, phone: string, gymId: string | null, code: string): string {
  return hmacHex(requireEnv('OTP_PEPPER'), `${scope}:${phone}:${gymId ?? '-'}:${code}`)
}

async function enforce(key: string, rule: { limit: number; windowSeconds: number }) {
  const result = await hitRateLimit(prisma, key, rule.limit, rule.windowSeconds)
  if (!result.ok) throw errors.rateLimited(result.retryAfterSeconds)
}

export interface IssueOtpInput {
  scope: Scope
  phone: string
  gymId: string | null
  language: WaLanguage
  ip: string | null
  // false when no account matches: we still rate-limit and answer the same
  // way, but nothing is sent, so the endpoint cannot be used to find users.
  deliver: boolean
}

// Showcase mode: numbers listed in DEMO_LOGIN_PHONES log in with the fixed
// DEMO_LOGIN_CODE and no WhatsApp message is sent, so a demo deployment
// works before WhatsApp is set up. Leave both empty for real gyms.
export function demoCodeFor(phone: string): string | null {
  const code = optionalEnv('DEMO_LOGIN_CODE')?.trim()
  const phones = optionalEnv('DEMO_LOGIN_PHONES')
  if (!code || !/^\d{6}$/.test(code) || !phones) return null
  const list = phones.split(',').map((item) => item.replace(/\s/g, '')).filter(Boolean)
  return list.includes(phone) ? code : null
}

export async function issueOtp(input: IssueOtpInput) {
  await enforce(`otp:ip:${input.ip ?? 'unknown'}`, LIMITS.perIp)
  await enforce(`otp:phone:${input.phone}`, LIMITS.perPhone)
  await enforce(`otp:phone-day:${input.phone}`, LIMITS.perPhoneDay)

  const response = { sent: true as const, maskedPhone: maskPhone(input.phone), expiresInSeconds: OTP_TTL_SECONDS }
  if (!input.deliver) return response

  const demo = demoCodeFor(input.phone)
  const code = demo ?? randomDigits(6)
  await prisma.$transaction([
    prisma.otpCode.updateMany({
      where: { phone: input.phone, scope: input.scope, gymId: input.gymId, consumedAt: null },
      data: { consumedAt: new Date() },
    }),
    prisma.otpCode.create({
      data: {
        scope: input.scope,
        phone: input.phone,
        gymId: input.gymId,
        codeHash: hashOtp(input.scope, input.phone, input.gymId, code),
        expiresAt: new Date(Date.now() + OTP_TTL_SECONDS * 1000),
      },
    }),
  ])

  if (demo) return response

  if (!whatsappConfigured() && devLogOtp()) {
    console.info(`[otp:dev] ${input.scope} ${input.phone} code=${code} (WhatsApp not configured, printed instead)`)
    return response
  }

  // OTP is critical: it is always sent, even when the gym's monthly
  // WhatsApp quota is used up. It still counts towards the gym's usage.
  let providerId: string | null = null
  try {
    const sent = await sendWhatsAppTemplate({
      to: input.phone,
      template: optionalEnv('WHATSAPP_OTP_TEMPLATE') ?? 'kasrat_otp',
      language: input.language,
      bodyParams: [code],
      urlButtonParam: code,
    })
    providerId = sent.providerId
  } catch (error) {
    console.error('[otp] WhatsApp delivery failed', error)
    throw new ApiError(503, 'DELIVERY_FAILED', 'Could not send the WhatsApp code right now. Please try again in a minute.')
  }
  if (input.gymId) await countOtp(input.gymId, input.phone, input.language, providerId)
  return response
}

export interface CheckOtpInput {
  scope: Scope
  phone: string
  gymId: string | null
  code: string
  ip: string | null
  // When false the code is validated but stays usable (used for the
  // "pick your gym" step when one phone belongs to several gyms).
  consume: boolean
}

export async function checkOtp(input: CheckOtpInput): Promise<void> {
  await enforce(`otp-verify:ip:${input.ip ?? 'unknown'}`, LIMITS.verifyPerIp)

  const record = await prisma.otpCode.findFirst({
    where: { phone: input.phone, scope: input.scope, gymId: input.gymId, consumedAt: null },
    orderBy: { createdAt: 'desc' },
  })
  const invalid = new ApiError(400, 'INVALID_OTP', 'That code is not correct or has expired. Request a new one.')
  if (!record || record.expiresAt.getTime() < Date.now()) throw invalid
  if (record.attempts >= OTP_MAX_ATTEMPTS) {
    throw new ApiError(429, 'OTP_LOCKED', 'Too many wrong attempts. Request a new code.')
  }

  const expected = hashOtp(input.scope, input.phone, input.gymId, input.code)
  if (!/^\d{6}$/.test(input.code) || !safeEqualHex(expected, record.codeHash)) {
    const updated = await prisma.otpCode.update({ where: { id: record.id }, data: { attempts: { increment: 1 } } })
    const left = Math.max(0, OTP_MAX_ATTEMPTS - updated.attempts)
    throw new ApiError(400, 'INVALID_OTP', left > 0 ? `Wrong code. ${left} attempt(s) left.` : 'Too many wrong attempts. Request a new code.')
  }

  if (input.consume) {
    const consumed = await prisma.otpCode.updateMany({ where: { id: record.id, consumedAt: null }, data: { consumedAt: new Date() } })
    if (consumed.count !== 1) throw invalid
  }
}

// Best effort: an OTP that went out must never fail the login because of
// bookkeeping. The code itself is never stored in the log.
async function countOtp(gymId: string, phone: string, language: WaLanguage, providerId: string | null) {
  try {
    await reserveMessage(prisma, gymId, 0, 'critical')
    await prisma.messageLog.create({
      data: { gymId, channel: 'WHATSAPP', template: 'kasrat_otp', language, purpose: 'otp', critical: true, toPhone: phone, body: 'Login code', status: 'SENT', sentAt: new Date(), providerId },
    })
  } catch (error) {
    console.error('[otp] usage count failed', gymId, error)
  }
}
