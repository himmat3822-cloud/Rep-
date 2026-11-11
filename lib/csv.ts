// CSV builder with spreadsheet formula-injection protection: a cell that
// starts with = + - @ (or tab/CR) is prefixed with a quote so Excel and
// Google Sheets show it as text instead of running it. E.164 phone numbers
// are left alone.

export interface CsvColumn<T> {
  header: string
  value: (row: T) => string | number | boolean | Date | null | undefined
}

function cell(value: string | number | boolean | Date | null | undefined): string {
  if (value === null || value === undefined) return ''
  let text = value instanceof Date ? value.toISOString() : String(value)
  // Plain phone numbers like +919876543210 and plain numbers like -1250.50
  // are data, not formulas.
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text) && !/^\+\d{6,15}$/.test(text) && !/^-?\d+(\.\d+)?$/.test(text)) text = `'${text}`
  if (/[",\n\r]/.test(text)) text = `"${text.replace(/"/g, '""')}"`
  return text
}

export function toCsv<T>(rows: readonly T[], columns: readonly CsvColumn<T>[]): string {
  const lines = [columns.map((column) => cell(column.header)).join(',')]
  for (const row of rows) lines.push(columns.map((column) => cell(column.value(row))).join(','))
  // BOM so Excel opens UTF-8 (Hindi/Punjabi names) correctly.
  return `\uFEFF${lines.join('\r\n')}\r\n`
}

export function csvResponse(filename: string, body: string): Response {
  return new Response(body, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  })
}
