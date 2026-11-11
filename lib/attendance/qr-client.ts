'use client'

// Browser side of the rotating QR: computes the 30-second code from the
// daily key with WebCrypto, so the QR keeps working with no network.
// Must match lib/attendance/qr.ts exactly.

export const QR_STEP_SECONDS = 30

function base64UrlToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((value.length + 3) % 4)
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function bytesToBase64Url(bytes: ArrayBuffer): string {
  let binary = ''
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export async function computeQrToken(dailyKeyB64: string, athleteId: string, nowMs: number = Date.now()): Promise<{ token: string; step: number; secondsLeft: number }> {
  const step = Math.floor(nowMs / 1000 / QR_STEP_SECONDS)
  const key = await crypto.subtle.importKey('raw', base64UrlToBytes(dailyKeyB64), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${athleteId}.${step}`))
  return { token: `KQ1.${athleteId}.${step}.${bytesToBase64Url(sig).slice(0, 22)}`, step, secondsLeft: QR_STEP_SECONDS - (Math.floor(nowMs / 1000) % QR_STEP_SECONDS) }
}

export function istDateNow(nowMs: number = Date.now()): string {
  return new Date(nowMs + 330 * 60 * 1000).toISOString().slice(0, 10)
}
