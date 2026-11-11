// Phone numbers are stored in E.164. Rep+ is India-first, so a bare
// 10-digit mobile number (starting 6-9) is treated as +91.

const INDIAN_MOBILE = /^[6-9]\d{9}$/

export function toE164(input: string): string | null {
  const trimmed = input.trim()
  const hasPlus = trimmed.startsWith('+')
  const digits = trimmed.replace(/\D/g, '')

  if (hasPlus) {
    if (digits.startsWith('91')) {
      const local = digits.slice(2)
      return INDIAN_MOBILE.test(local) ? `+91${local}` : null
    }
    return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null
  }

  if (INDIAN_MOBILE.test(digits)) return `+91${digits}`
  if (digits.length === 11 && digits.startsWith('0') && INDIAN_MOBILE.test(digits.slice(1))) return `+91${digits.slice(1)}`
  if (digits.length === 12 && digits.startsWith('91') && INDIAN_MOBILE.test(digits.slice(2))) return `+${digits}`
  return null
}

export function maskPhone(e164: string): string {
  if (e164.length < 6) return e164
  return `${e164.slice(0, 3)} *****${e164.slice(-4)}`
}

// WhatsApp Cloud API wants the number without the plus sign.
export function toWhatsAppId(e164: string): string {
  return e164.replace(/^\+/, '')
}
