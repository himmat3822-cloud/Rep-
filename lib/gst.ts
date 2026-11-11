// GST maths for gym membership invoices (SAC 999723 - health and fitness
// centres, 18%). All values in paise. Intra-state supply splits into CGST +
// SGST; inter-state uses IGST.

export interface GstBreakdown {
  taxablePaise: number
  cgstPaise: number
  sgstPaise: number
  igstPaise: number
  taxPaise: number
  totalPaise: number
}

export function splitGst(amountPaise: number, gstPercent: number, inclusive: boolean, interState = false): GstBreakdown {
  const amount = Math.max(0, Math.round(amountPaise))
  let taxablePaise: number
  let taxPaise: number
  if (gstPercent <= 0) {
    taxablePaise = amount
    taxPaise = 0
  } else if (inclusive) {
    taxablePaise = Math.round((amount * 100) / (100 + gstPercent))
    taxPaise = amount - taxablePaise
  } else {
    taxablePaise = amount
    taxPaise = Math.round((amount * gstPercent) / 100)
  }
  const cgstPaise = interState ? 0 : Math.floor(taxPaise / 2)
  const sgstPaise = interState ? 0 : taxPaise - cgstPaise
  return { taxablePaise, cgstPaise, sgstPaise, igstPaise: interState ? taxPaise : 0, taxPaise, totalPaise: taxablePaise + taxPaise }
}

// Indian financial year (April to March) of an instant, in IST. "2026-27".
export function financialYearOf(date: Date): string {
  const ist = new Date(date.getTime() + 330 * 60 * 1000)
  const year = ist.getUTCMonth() >= 3 ? ist.getUTCFullYear() : ist.getUTCFullYear() - 1
  return `${year}-${String((year + 1) % 100).padStart(2, '0')}`
}

// GST invoice numbers must be unique per FY and at most 16 characters.
// Format: PREFIX/26-27/0001 (prefix up to 4 chars).
export function formatInvoiceNumber(prefix: string, financialYear: string, sequence: number): string {
  const shortFy = `${financialYear.slice(2, 4)}-${financialYear.slice(5, 7)}`
  return `${prefix.slice(0, 4).toUpperCase()}/${shortFy}/${String(sequence).padStart(4, '0')}`
}

export function invoicePrefixFor(name: string): string {
  const letters = name
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word[0])
    .join('')
    .replace(/[^A-Za-z]/g, '')
    .toUpperCase()
  return (letters || 'KG').slice(0, 4)
}

export const GYM_SAC_CODE = '999723'
