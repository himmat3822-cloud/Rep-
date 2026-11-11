import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'
import { requireEnv } from '@/lib/env'

// AES-256-GCM for sensitive fields at rest (admin TOTP secrets, athlete
// emergency contacts, medical notes). ENCRYPTION_KEY = 32 random bytes, base64.
// Format: v1.<iv b64url>.<tag b64url>.<ciphertext b64url>

function encryptionKey(): Buffer {
  const key = Buffer.from(requireEnv('ENCRYPTION_KEY'), 'base64')
  if (key.length !== 32) {
    throw new Error('ENCRYPTION_KEY must be 32 bytes encoded as base64')
  }
  return key
}

export function encrypt(plain: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv)
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return ['v1', iv.toString('base64url'), tag.toString('base64url'), body.toString('base64url')].join('.')
}

export function decrypt(payload: string): string {
  const [version, iv, tag, body] = payload.split('.')
  if (version !== 'v1' || !iv || !tag || !body) {
    throw new Error('Unsupported ciphertext format')
  }
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(iv, 'base64url'))
  decipher.setAuthTag(Buffer.from(tag, 'base64url'))
  return Buffer.concat([decipher.update(Buffer.from(body, 'base64url')), decipher.final()]).toString('utf8')
}

export function encryptOptional(plain: string | null | undefined): string | null {
  return plain ? encrypt(plain) : null
}

export function decryptOptional(payload: string | null | undefined): string | null {
  return payload ? decrypt(payload) : null
}

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex')
}

export function hmacHex(secret: string, input: string): string {
  return createHmac('sha256', secret).update(input).digest('hex')
}

export function safeEqualHex(a: string, b: string): boolean {
  const left = Buffer.from(a, 'hex')
  const right = Buffer.from(b, 'hex')
  if (left.length !== right.length || left.length === 0) return false
  return timingSafeEqual(left, right)
}

export function randomToken(bytes = 48): string {
  return randomBytes(bytes).toString('base64url')
}

export function randomDigits(length: number): string {
  let out = ''
  for (let i = 0; i < length; i += 1) out += String(randomInt(0, 10))
  return out
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

export function randomCode(length: number): string {
  let out = ''
  for (let i = 0; i < length; i += 1) out += CODE_ALPHABET[randomInt(0, CODE_ALPHABET.length)]
  return out
}
