import { gymRoute } from '@/lib/api/guard'
import { errors } from '@/lib/api/errors'
import { hasPermission } from '@/lib/auth/permissions'
import { renderInvoicePdf } from '@/lib/invoice-pdf'
import { parseGymSettings } from '@/lib/gym/settings'

// GET /api/gym/invoices/{id}/pdf - staff with payments.read, or the member
// the invoice belongs to (athlete app "download invoice").
export const GET = gymRoute({ allow: ['staff', 'athlete'] }, async ({ db, params, staff, athlete }) => {
  const invoice = await db.invoice.findFirst({ where: { id: params.id } })
  if (!invoice) throw errors.notFound('Invoice')
  if (staff && !hasPermission(staff.perms, 'payments.read')) throw errors.forbidden()
  if (athlete && invoice.athleteId !== athlete.sub) throw errors.notFound('Invoice')

  const [gymRow, member, payment] = await Promise.all([
    db.gym.findFirst(),
    db.athlete.findFirst({ where: { id: invoice.athleteId }, select: { name: true, phone: true, memberCode: true } }),
    db.payment.findFirst({ where: { id: invoice.paymentId }, select: { method: true, note: true } }),
  ])
  if (!gymRow || !member) throw errors.notFound('Invoice')
  const settings = parseGymSettings(gymRow.settings)
  const pdf = await renderInvoicePdf({
    gym: { name: gymRow.name, address: gymRow.address, city: gymRow.city, gstNumber: gymRow.gstNumber, phone: gymRow.phone, email: gymRow.email, footer: settings.invoiceFooter },
    member,
    invoice: { ...invoice, lineItems: invoice.lineItems as { description: string; sac: string; gstPercent?: number; amountPaise: number }[] },
    payment: { method: payment?.method ?? 'CASH', reference: payment?.note || null },
  })
  return new Response(Buffer.from(pdf), {
    headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${invoice.number.replace(/\//g, '-')}.pdf"`, 'Cache-Control': 'private, no-store' },
  })
})
