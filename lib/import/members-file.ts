// Member import: turn the file a gym exports from its old software (CSV or
// Excel) into clean rows. Pure functions, used by the browser (to preview
// columns) and by the server (to validate). No database access here.

export const IMPORT_FIELDS = ['name', 'phone', 'email', 'gender', 'dob', 'joined', 'plan', 'start', 'end', 'paid', 'due', 'branch', 'trainer', 'code', 'notes'] as const
export type ImportField = (typeof IMPORT_FIELDS)[number]

export const FIELD_LABEL: Record<ImportField, string> = {
  name: 'Name',
  phone: 'Mobile number',
  email: 'Email',
  gender: 'Gender',
  dob: 'Date of birth',
  joined: 'Joining date',
  plan: 'Plan / package',
  start: 'Plan start date',
  end: 'Plan end / expiry date',
  paid: 'Amount paid',
  due: 'Balance due',
  branch: 'Branch',
  trainer: 'Trainer',
  code: 'Old member ID',
  notes: 'Notes / remarks',
}

// Header words used by common gym software exports (and by hand-made sheets).
const SYNONYMS: Record<ImportField, string[]> = {
  name: ['name', 'member name', 'full name', 'client name', 'customer name', 'member', 'client', 'customer', 'first name'],
  phone: ['phone', 'mobile', 'mobile no', 'mobile number', 'phone number', 'phone no', 'contact', 'contact no', 'contact number', 'whatsapp', 'whatsapp number', 'cell'],
  email: ['email', 'email id', 'e-mail', 'mail'],
  gender: ['gender', 'sex'],
  dob: ['dob', 'date of birth', 'birthday', 'birth date', 'd.o.b'],
  joined: ['joining date', 'join date', 'joined', 'joined on', 'date of joining', 'doj', 'admission date', 'registration date', 'registered on', 'enrollment date'],
  plan: ['plan', 'plan name', 'package', 'package name', 'membership', 'membership plan', 'membership type', 'scheme', 'subscription'],
  start: ['start date', 'plan start', 'membership start', 'start', 'from', 'from date', 'valid from', 'package start', 'renewal date'],
  end: ['end date', 'expiry', 'expiry date', 'expire', 'expires', 'expires on', 'valid till', 'valid upto', 'valid up to', 'valid to', 'membership end', 'plan end', 'to date', 'end', 'package end'],
  paid: ['paid', 'amount paid', 'paid amount', 'fees paid', 'fee paid', 'amount', 'fees', 'total paid'],
  due: ['due', 'balance', 'balance due', 'due amount', 'pending', 'pending amount', 'outstanding', 'balance amount', 'remaining'],
  branch: ['branch', 'branch name', 'location', 'center', 'centre', 'outlet'],
  trainer: ['trainer', 'trainer name', 'coach', 'pt trainer', 'assigned trainer', 'personal trainer'],
  code: ['member id', 'member code', 'id', 'reg no', 'registration no', 'membership no', 'membership id', 'client id', 'customer id', 'roll no', 'sr no', 'code'],
  notes: ['notes', 'note', 'remarks', 'remark', 'comments', 'comment'],
}

const clean = (value: string) => value.toLowerCase().replace(/[_.]/g, ' ').replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim()

// Best column for each field from the header row. Exact synonym matches win
// over partial ones; each column is used at most once.
export function detectColumns(headers: string[]): Record<ImportField, number | null> {
  const result = Object.fromEntries(IMPORT_FIELDS.map((field) => [field, null])) as Record<ImportField, number | null>
  const used = new Set<number>()
  const normalized = headers.map((header) => clean(String(header ?? '')))
  for (const pass of ['exact', 'partial'] as const) {
    for (const field of IMPORT_FIELDS) {
      if (result[field] !== null) continue
      for (const synonym of SYNONYMS[field]) {
        const index = normalized.findIndex((header, i) => !used.has(i) && header !== '' && (pass === 'exact' ? header === synonym : synonym.length > 3 && (header.includes(synonym) || (header.length > 3 && synonym.includes(header)))))
        if (index >= 0) {
          result[field] = index
          used.add(index)
          break
        }
      }
    }
  }
  return result
}

// Small RFC 4180 CSV reader. Detects comma, semicolon or tab separators and
// handles quoted cells with commas and line breaks.
export function parseCsv(text: string): string[][] {
  const input = text.replace(/^\uFEFF/, '')
  const firstLine = input.split(/\r?\n/, 1)[0] ?? ''
  const counts = [',', ';', '\t'].map((sep) => [sep, firstLine.split(sep).length] as const)
  const sep = counts.reduce((best, item) => (item[1] > best[1] ? item : best))[0]
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < input.length; i += 1) {
    const char = input[i]
    if (quoted) {
      if (char === '"' && input[i + 1] === '"') {
        cell += '"'
        i += 1
      } else if (char === '"') quoted = false
      else cell += char
      continue
    }
    if (char === '"' && cell === '') quoted = true
    else if (char === sep) {
      row.push(cell)
      cell = ''
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && input[i + 1] === '\n') i += 1
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else cell += char
  }
  if (cell !== '' || row.length) {
    row.push(cell)
    rows.push(row)
  }
  return rows.filter((r) => r.some((value) => value.trim() !== ''))
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

function ymd(year: number, month: number, day: number): string | null {
  if (year < 100) year += year < 70 ? 2000 : 1900
  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 1920 || year > 2100) return null
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCMonth() !== month - 1) return null
  return date.toISOString().slice(0, 10)
}

// Dates as Indian software writes them: 21/11/2026, 21-11-26, 21.11.2026,
// 2026-11-21, 21 Nov 2026, 21-Nov-26, or an Excel serial number (46347).
// Slashes are read day first (Indian format), never month first.
export function parseDate(raw: string | null | undefined): string | null {
  const value = String(raw ?? '').trim()
  if (!value) return null
  if (/^\d{5}(\.\d+)?$/.test(value)) {
    const serial = Math.floor(Number(value))
    if (serial > 20000 && serial < 80000) return new Date(Date.UTC(1899, 11, 30) + serial * 86400000).toISOString().slice(0, 10)
  }
  let match = value.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/)
  if (match) return ymd(Number(match[1]), Number(match[2]), Number(match[3]))
  match = value.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/)
  if (match) return ymd(Number(match[3]), Number(match[2]), Number(match[1]))
  match = value.match(/^(\d{1,2})[\s-]*([A-Za-z]{3,9})[\s,-]*(\d{2,4})$/)
  if (match) {
    const month = MONTHS.indexOf(match[2].slice(0, 3).toLowerCase())
    if (month >= 0) return ymd(Number(match[3]), month + 1, Number(match[1]))
  }
  match = value.match(/^([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})$/)
  if (match) {
    const month = MONTHS.indexOf(match[1].slice(0, 3).toLowerCase())
    if (month >= 0) return ymd(Number(match[3]), month + 1, Number(match[2]))
  }
  return null
}

// "Rs. 1,500", "\u20B91500.00", "1500/-" -> 150000 paise. Empty -> null.
export function parseMoney(raw: string | null | undefined): number | null {
  const value = String(raw ?? '').trim()
  if (!value) return null
  const digits = value.replace(/\u20B9|rs\.?|inr|\/-|,|\s/gi, '')
  if (!/^-?\d+(\.\d{1,2})?$/.test(digits)) return null
  const rupees = Number(digits)
  if (!Number.isFinite(rupees) || rupees < 0 || rupees > 10000000) return null
  return Math.round(rupees * 100)
}

// Stored the same way as the member form: M, F or O.
export function parseGender(raw: string | null | undefined): 'M' | 'F' | 'O' | null {
  const value = String(raw ?? '').trim().toLowerCase()
  if (!value) return null
  if (['m', 'male', 'man', 'boy', 'gents'].includes(value)) return 'M'
  if (['f', 'female', 'woman', 'girl', 'ladies'].includes(value)) return 'F'
  return 'O'
}

export type RawImportRow = Partial<Record<ImportField, string>>

// Header row + data rows -> objects keyed by field, using the chosen mapping.
export function mapRows(rows: string[][], mapping: Record<ImportField, number | null>, hasHeader = true): RawImportRow[] {
  const body = hasHeader ? rows.slice(1) : rows
  return body.map((row) => {
    const out: RawImportRow = {}
    for (const field of IMPORT_FIELDS) {
      const index = mapping[field]
      if (index === null || index === undefined) continue
      const value = String(row[index] ?? '').trim()
      if (value) out[field] = value
    }
    return out
  })
}
