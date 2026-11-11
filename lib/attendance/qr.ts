import { createHmac, timingSafeEqual } from 'node:crypto'
import { requireEnv } from '@/lib/env'

// Rotating member QR (server side).
//
// Every member gets a DAILY key  = HMAC(QR_SECRET, "kq1:{gymId}:{athleteId}:{IST date}")
// The phone turns it into a code that changes every 30 seconds:
//   KQ1.{athleteId}.{step}.{sig}   step = floor(unix / 30)
//   sig = base64url(HMAC(dailyKey, "{athleteId}.{step}")) first 22 chars
// So the QR works offline for the day, a screenshot dies within a minute,
// and a code from another gym never validates here. Each step can be used
// once (QrNonce) so a code cannot check two people in.

export const QR_STEP_SECONDS = 30
export const QR_SKEW_STEPS = 2
export const QR_PREFIX = 'KQ1'

export function currentQrStep(nowMs: number = Date.now()): number {
  return Math.floor(nowMs / 1000 / QR_STEP_SECONDS)
}

// IST calendar date ("2026-11-10") of a QR step.
export function istDateOfStep(step: number): string {
  return new Date(step * QR_STEP_SECONDS * 1000 + 330 * 60 * 1000).toISOString().slice(0, 10)
}

export function dailyQrKey(gymId: string, athleteId: string, istDate: string): Buffer {
  return createHmac('sha256', requireEnv('QR_SECRET')).update(`kq1:${gymId}:${athleteId}:${istDate}`).digest()
}

export function qrSignature(key: Buffer, athleteId: string, step: number): string {
  return createHmac('sha256', key).update(`${athleteId}.${step}`).digest('base64url').slice(0, 22)
}

export function makeQrToken(gymId: string, athleteId: string, nowMs: number = Date.now()): string {
  const step = currentQrStep(nowMs)
  return `${QR_PREFIX}.${athleteId}.${step}.${qrSignature(dailyQrKey(gymId, athleteId, istDateOfStep(step)), athleteId, step)}`
}

export type QrVerifyResult = { ok: true; athleteId: string; step: number } | { ok: false; reason: 'format' | 'expired' | 'signature' }

export function verifyQrToken(token: string, gymId: string, nowMs: number = Date.now()): QrVerifyResult {
  const parts = token.trim().split('.')
  if (parts.length !== 4 || parts[0] !== QR_PREFIX || !/^\d+$/.test(parts[2]) || !parts[1]) return { ok: false, reason: 'format' }
  const [, athleteId, stepText, sig] = parts
  const step = Number(stepText)
  if (Math.abs(currentQrStep(nowMs) - step) > QR_SKEW_STEPS) return { ok: false, reason: 'expired' }
  const expected = qrSignature(dailyQrKey(gymId, athleteId, istDateOfStep(step)), athleteId, step)
  const a = Buffer.from(expected)
  const b = Buffer.from(sig)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: 'signature' }
  return { ok: true, athleteId, step }
}

// Static QR printed at the entrance of a branch. Its URL carries a signature
// so a hand-made URL with another branch id is rejected. Rotating the
// branch's entranceQrSecret invalidates old posters.
export function entranceSignature(branchId: string, entranceQrSecret: string): string {
  return createHmac('sha256', requireEnv('QR_SECRET')).update(`entrance:${branchId}:${entranceQrSecret}`).digest('base64url').slice(0, 16)
}

export function verifyEntranceSignature(branchId: string, entranceQrSecret: string, sig: string | null | undefined): boolean {
  if (!sig) return false
  const a = Buffer.from(entranceSignature(branchId, entranceQrSecret))
  const b = Buffer.from(sig)
  return a.length === b.length && timingSafeEqual(a, b)
}

// Great-circle distance in metres.
export function distanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const rad = (degrees: number) => (degrees * Math.PI) / 180
  const dLat = rad(lat2 - lat1)
  const dLon = rad(lon2 - lon1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

// Inside the geofence? GPS accuracy is added (capped) so a phone indoors
// with a 60 m reading is not wrongly rejected.
export function insideGeofence(branch: { latitude: number; longitude: number; geofenceMeters: number }, position: { lat: number; lng: number; accuracy?: number }): { inside: boolean; distance: number } {
  const distance = distanceMeters(branch.latitude, branch.longitude, position.lat, position.lng)
  const slack = Math.min(Math.max(position.accuracy ?? 0, 0), 100)
  return { inside: distance <= branch.geofenceMeters + slack, distance: Math.round(distance) }
}
