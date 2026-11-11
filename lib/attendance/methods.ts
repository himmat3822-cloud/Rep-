import type { FeatureKey } from '@/lib/features'
import type { AttendanceSettings } from '@/lib/gym/settings'
import { ApiError } from '@/lib/api/errors'

// What a gym can actually use = what the owner switched on AND what the
// Rep+ plan includes. Owners pick the methods that match their gym:
// QR at the desk, self check-in (entrance QR and/or location), biometric /
// turnstile devices, and the manual register.

export interface EnabledMethods {
  deskQr: boolean
  selfCheckin: boolean
  biometric: boolean
  manual: boolean
  selfRequireEntranceQr: boolean
  selfRequireLocation: boolean
  manualAllowWithoutPlan: boolean
}

export function enabledMethods(settings: AttendanceSettings, features: readonly FeatureKey[]): EnabledMethods {
  const qr = features.includes('qr_attendance')
  return {
    deskQr: settings.deskQr && qr,
    selfCheckin: settings.selfCheckin && qr,
    biometric: settings.biometric && features.includes('biometric_integration'),
    manual: settings.manual,
    selfRequireEntranceQr: settings.selfRequireEntranceQr,
    selfRequireLocation: settings.selfRequireLocation,
    manualAllowWithoutPlan: settings.manualAllowWithoutPlan,
  }
}

export function requireMethod(enabled: boolean, label: string): void {
  if (!enabled) throw new ApiError(403, 'METHOD_DISABLED', `${label} is switched off for this gym. The owner can turn it on in Settings > Attendance.`)
}
