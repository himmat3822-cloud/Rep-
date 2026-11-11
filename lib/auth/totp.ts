import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

// RFC 6238 TOTP (SHA-1, 30 s, 6 digits) - what Google Authenticator,
// Microsoft Authenticator and Authy use. No external dependency.

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
export const TOTP_STEP_SECONDS = 30
const DIGITS = 6

export function base32Encode(buffer: Buffer): string {
  let bits = 0
  let value = 0
  let output = ''
  for (const byte of buffer) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      output += BASE32[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) output += BASE32[(value << (5 - bits)) & 31]
  return output
}

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/=+$/g, '').replace(/\s+/g, '')
  let bits = 0
  let value = 0
  const bytes: number[] = []
  for (const char of clean) {
    const index = BASE32.indexOf(char)
    if (index === -1) throw new Error('Invalid base32 character')
    value = (value << 5) | index
    bits += 5
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255)
      bits -= 8
    }
  }
  return Buffer.from(bytes)
}

export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20))
}

export function currentStep(nowMs: number = Date.now()): number {
  return Math.floor(nowMs / 1000 / TOTP_STEP_SECONDS)
}

export function hotp(secret: Buffer, counter: number): string {
  const message = Buffer.alloc(8)
  message.writeBigUInt64BE(BigInt(counter))
  const digest = createHmac('sha1', secret).update(message).digest()
  const offset = digest[digest.length - 1] & 15
  const binary = ((digest[offset] & 127) << 24) | (digest[offset + 1] << 16) | (digest[offset + 2] << 8) | digest[offset + 3]
  return String(binary % 10 ** DIGITS).padStart(DIGITS, '0')
}

export function totpAt(secretBase32: string, step: number): string {
  return hotp(base32Decode(secretBase32), step)
}

// Returns the matched time step (for replay protection) or null.
// Accepts the previous and next step to tolerate small clock drift.
export function verifyTotp(secretBase32: string, code: string, nowMs: number = Date.now(), window = 1): number | null {
  if (!/^\d{6}$/.test(code)) return null
  const step = currentStep(nowMs)
  const secret = base32Decode(secretBase32)
  for (let delta = -window; delta <= window; delta += 1) {
    const candidate = hotp(secret, step + delta)
    if (timingSafeEqual(Buffer.from(candidate), Buffer.from(code))) return step + delta
  }
  return null
}

export function totpUri(secretBase32: string, account: string, issuer = 'Rep+ Admin'): string {
  const label = encodeURIComponent(`${issuer}:${account}`)
  return `otpauth://totp/${label}?secret=${secretBase32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`
}
