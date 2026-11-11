import { optionalEnv } from '@/lib/env'

// How gym owners pay Rep+ while there is no payment gateway:
// UPI (deep link + QR) or bank transfer, then they submit the UTR.

export interface KasratPaymentDetails {
  upiId: string | null
  upiName: string
  bankDetails: string | null
  supportWhatsApp: string | null
}

export function kasratPaymentDetails(): KasratPaymentDetails {
  return {
    upiId: optionalEnv('KASRAT_UPI_ID') ?? null,
    upiName: optionalEnv('KASRAT_UPI_NAME') ?? 'Rep+',
    bankDetails: optionalEnv('KASRAT_BANK_DETAILS')?.replace(/\\n/g, '\n') ?? null,
    supportWhatsApp: optionalEnv('KASRAT_SUPPORT_WHATSAPP') ?? null,
  }
}

export function upiLink(upiId: string, name: string, amountPaise: number, note: string): string {
  const params = new URLSearchParams({ pa: upiId, pn: name, am: (amountPaise / 100).toFixed(2), cu: 'INR', tn: note.slice(0, 50) })
  return `upi://pay?${params.toString()}`
}

export function whatsappLink(number: string, text: string): string {
  return `https://wa.me/${number.replace(/\D/g, '')}?text=${encodeURIComponent(text)}`
}
