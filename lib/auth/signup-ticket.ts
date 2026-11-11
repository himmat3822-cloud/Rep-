import { SignJWT, jwtVerify } from 'jose'
import { ApiError } from '@/lib/api/errors'

// After the owner verifies their WhatsApp number in step 1 of signup, they
// get a 30-minute ticket so the rest of the wizard is not bound by the
// 5-minute OTP expiry. The ticket only proves "this phone was verified".

const TTL_SECONDS = 30 * 60

function secret(): Uint8Array {
  const value = process.env.JWT_SECRET
  if (!value || value.length < 32) throw new Error('JWT_SECRET must be set')
  return new TextEncoder().encode(value)
}

export async function issueSignupTicket(phone: string): Promise<string> {
  return new SignJWT({ phone }).setProtectedHeader({ alg: 'HS256' }).setIssuer('kasrat').setAudience('signup').setIssuedAt().setExpirationTime(`${TTL_SECONDS}s`).sign(secret())
}

export async function readSignupTicket(ticket: string): Promise<string> {
  try {
    const { payload } = await jwtVerify(ticket, secret(), { issuer: 'kasrat', audience: 'signup' })
    if (typeof payload.phone !== 'string') throw new Error('bad ticket')
    return payload.phone
  } catch {
    throw new ApiError(401, 'INVALID_OTP', 'Your phone verification expired. Please verify your number again.')
  }
}
