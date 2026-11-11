// Money is stored in paise (integer). Display with Intl, never hand-built strings.

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 })
const inrExact = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 })
const inrCompact = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', notation: 'compact', maximumFractionDigits: 2 })

export function formatInr(paise: number): string {
  return inr.format(paise / 100)
}

export function formatInrExact(paise: number): string {
  return inrExact.format(paise / 100)
}

export function formatInrCompact(paise: number): string {
  return inrCompact.format(paise / 100)
}

export function rupeesToPaise(rupees: number): number {
  return Math.round(rupees * 100)
}
