import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib'

// Server-side GST invoice PDF (A4) with pdf-lib, no headless browser.
// Standard PDF fonts only cover Latin text, so anything else (e.g. a name
// typed in Gurmukhi) is transliterated to '?' - the invoice stays valid.

export interface InvoicePdfData {
  gym: { name: string; address: string; city: string; gstNumber: string | null; phone: string | null; email: string | null; footer?: string }
  member: { name: string; phone: string; memberCode: string }
  invoice: { number: string; issuedAt: Date; taxablePaise: number; cgstPaise: number; sgstPaise: number; igstPaise: number; totalPaise: number; lineItems: { description: string; sac: string; gstPercent?: number; amountPaise: number }[] }
  payment: { method: string; reference?: string | null }
}

const INK = rgb(0.094, 0.129, 0.118)
const MUTED = rgb(0.47, 0.51, 0.48)
const LIME = rgb(0.835, 0.953, 0.416)
const LINE = rgb(0.875, 0.898, 0.847)

function latin(text: string): string {
  return text.normalize('NFKD').replace(/[^\x20-\x7E]/g, '?')
}

function money(paise: number): string {
  return `Rs. ${new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(paise / 100)}`
}

function istDate(date: Date): string {
  return new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }).format(date)
}

function rightText(page: PDFPage, text: string, x: number, y: number, size: number, font: PDFFont, color = INK) {
  page.drawText(text, { x: x - font.widthOfTextAtSize(text, size), y, size, font, color })
}

export async function renderInvoicePdf(data: InvoicePdfData): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  pdf.setTitle(`Invoice ${data.invoice.number}`)
  pdf.setAuthor(latin(data.gym.name))
  pdf.setProducer('Rep+')
  const page = pdf.addPage([595.28, 841.89])
  const regular = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const left = 48
  const right = 547
  let y = 790

  // Header band
  page.drawRectangle({ x: 0, y: 760, width: 595.28, height: 82, color: INK })
  page.drawText(latin(data.gym.name), { x: left, y: 800, size: 20, font: bold, color: rgb(1, 1, 1) })
  page.drawText('TAX INVOICE', { x: left, y: 780, size: 9, font: bold, color: LIME })
  rightText(page, latin(data.invoice.number), right, 800, 12, bold, rgb(1, 1, 1))
  rightText(page, istDate(data.invoice.issuedAt), right, 782, 9, regular, rgb(0.8, 0.85, 0.8))

  y = 730
  page.drawText('FROM', { x: left, y, size: 8, font: bold, color: MUTED })
  page.drawText('BILLED TO', { x: 320, y, size: 8, font: bold, color: MUTED })
  y -= 16
  const fromLines = [latin(data.gym.name), latin(data.gym.address || data.gym.city), data.gym.gstNumber ? `GSTIN: ${data.gym.gstNumber}` : 'GSTIN: not registered', [data.gym.phone, data.gym.email].filter(Boolean).join('  ')]
  const toLines = [latin(data.member.name), `Member ID: ${latin(data.member.memberCode)}`, data.member.phone]
  fromLines.forEach((line, index) => page.drawText(line, { x: left, y: y - index * 14, size: index === 0 ? 11 : 9, font: index === 0 ? bold : regular, color: INK, maxWidth: 250 }))
  toLines.forEach((line, index) => page.drawText(line, { x: 320, y: y - index * 14, size: index === 0 ? 11 : 9, font: index === 0 ? bold : regular, color: INK }))

  // Line items
  y = 630
  page.drawRectangle({ x: left, y: y - 6, width: right - left, height: 22, color: rgb(0.953, 0.961, 0.933) })
  page.drawText('DESCRIPTION', { x: left + 8, y, size: 8, font: bold, color: MUTED })
  page.drawText('SAC', { x: 340, y, size: 8, font: bold, color: MUTED })
  page.drawText('GST', { x: 400, y, size: 8, font: bold, color: MUTED })
  rightText(page, 'AMOUNT', right - 8, y, 8, bold, MUTED)
  y -= 28
  for (const item of data.invoice.lineItems) {
    page.drawText(latin(item.description), { x: left + 8, y, size: 10, font: regular, color: INK, maxWidth: 280 })
    page.drawText(item.sac, { x: 340, y, size: 10, font: regular, color: INK })
    page.drawText(`${item.gstPercent ?? 18}%`, { x: 400, y, size: 10, font: regular, color: INK })
    rightText(page, money(item.amountPaise), right - 8, y, 10, regular)
    y -= 22
  }
  page.drawLine({ start: { x: left, y: y + 8 }, end: { x: right, y: y + 8 }, thickness: 1, color: LINE })

  // Totals
  y -= 14
  const rows: [string, number][] = [['Taxable value', data.invoice.taxablePaise]]
  if (data.invoice.igstPaise > 0) rows.push(['IGST', data.invoice.igstPaise])
  else rows.push(['CGST', data.invoice.cgstPaise], ['SGST', data.invoice.sgstPaise])
  for (const [label, value] of rows) {
    page.drawText(label, { x: 360, y, size: 10, font: regular, color: MUTED })
    rightText(page, money(value), right - 8, y, 10, regular)
    y -= 18
  }
  page.drawRectangle({ x: 350, y: y - 10, width: right - 350, height: 28, color: LIME })
  page.drawText('Total paid', { x: 360, y: y - 1, size: 11, font: bold, color: INK })
  rightText(page, money(data.invoice.totalPaise), right - 8, y - 1, 11, bold)
  y -= 44
  page.drawText(`Paid by ${data.payment.method.toLowerCase()}${data.payment.reference ? ` - ref ${latin(data.payment.reference)}` : ''}`, { x: left, y, size: 9, font: regular, color: MUTED })

  // Footer
  page.drawLine({ start: { x: left, y: 90 }, end: { x: right, y: 90 }, thickness: 1, color: LINE })
  page.drawText(latin(data.gym.footer || 'Thank you for training with us. This is a computer-generated invoice and needs no signature.'), { x: left, y: 72, size: 8, font: regular, color: MUTED, maxWidth: right - left })
  page.drawText('Powered by Rep+', { x: left, y: 56, size: 8, font: bold, color: MUTED })

  return pdf.save()
}
