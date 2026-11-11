import { adminRoute } from '@/lib/api/guard'
import { errors } from '@/lib/api/errors'
import { prisma } from '@/lib/db/client'
import { audit } from '@/lib/audit'
import { csvResponse, toCsv } from '@/lib/csv'
import { listGyms } from '@/lib/platform/gyms'

const rupees = (paise: number | null | undefined) => (paise === null || paise === undefined ? '' : (paise / 100).toFixed(2))
const today = () => new Date().toISOString().slice(0, 10)

// GET /api/admin/export/{gyms|payments|plans|audit} -> CSV download
export const GET = adminRoute({}, async ({ params, admin, meta }) => {
  const kind = params.kind
  let body: string
  if (kind === 'gyms') {
    const { rows } = await listGyms(prisma, { pageSize: 100000 })
    body = toCsv(rows, [
      { header: 'Gym', value: (r) => r.name },
      { header: 'Link', value: (r) => r.slug },
      { header: 'City', value: (r) => r.city },
      { header: 'Owner', value: (r) => r.ownerName },
      { header: 'Owner phone', value: (r) => r.ownerPhone },
      { header: 'Plan', value: (r) => r.planName },
      { header: 'Status', value: (r) => r.status },
      { header: 'Members', value: (r) => r.members },
      { header: 'Branches', value: (r) => r.branches },
      { header: 'MRR (INR)', value: (r) => rupees(r.mrrPaise) },
      { header: 'Last paid', value: (r) => r.lastPaidAt },
      { header: 'Next due', value: (r) => r.nextDueAt },
      { header: 'WhatsApp used', value: (r) => r.whatsappUsed },
      { header: 'WhatsApp quota', value: (r) => r.whatsappQuota },
      { header: 'Created', value: (r) => r.createdAt },
    ])
  } else if (kind === 'payments') {
    const invoices = await prisma.platformInvoice.findMany({ orderBy: { createdAt: 'desc' }, include: { subscription: { include: { gym: { select: { name: true, slug: true } }, plan: { select: { name: true } } } } } })
    body = toCsv(invoices, [
      { header: 'Invoice', value: (r) => r.number },
      { header: 'Gym', value: (r) => r.subscription.gym.name },
      { header: 'Link', value: (r) => r.subscription.gym.slug },
      { header: 'Plan', value: (r) => r.subscription.plan.name },
      { header: 'Status', value: (r) => r.status },
      { header: 'Amount (INR)', value: (r) => rupees(r.amountPaise) },
      { header: 'GST (INR)', value: (r) => rupees(r.gstPaise) },
      { header: 'Total (INR)', value: (r) => rupees(r.amountPaise + r.gstPaise) },
      { header: 'Period start', value: (r) => r.periodStart },
      { header: 'Period end', value: (r) => r.periodEnd },
      { header: 'Paid at', value: (r) => r.paidAt },
      { header: 'Razorpay payment', value: (r) => r.razorpayPaymentId },
    ])
  } else if (kind === 'plans') {
    const plans = await prisma.platformPlan.findMany({ orderBy: { sortOrder: 'asc' }, include: { _count: { select: { subscriptions: true } } } })
    body = toCsv(plans, [
      { header: 'Code', value: (r) => r.code },
      { header: 'Name', value: (r) => r.name },
      { header: 'Monthly (INR)', value: (r) => rupees(r.monthlyPricePaise) },
      { header: 'Annual (INR)', value: (r) => rupees(r.annualPricePaise) },
      { header: 'Member limit', value: (r) => r.memberLimit ?? 'unlimited' },
      { header: 'Branch limit', value: (r) => r.branchLimit },
      { header: 'Extra branch (INR)', value: (r) => rupees(r.extraBranchPaise) },
      { header: 'Staff limit', value: (r) => r.staffLimit ?? 'unlimited' },
      { header: 'WhatsApp quota', value: (r) => r.whatsappQuota },
      { header: 'Features', value: (r) => r.features.join(' ') },
      { header: 'Archived', value: (r) => r.archived },
      { header: 'Subscribers', value: (r) => r._count.subscriptions },
    ])
  } else if (kind === 'audit') {
    const rows = await prisma.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 20000 })
    body = toCsv(rows, [
      { header: 'When', value: (r) => r.createdAt },
      { header: 'Actor type', value: (r) => r.actorType },
      { header: 'Actor', value: (r) => r.actorId },
      { header: 'Action', value: (r) => r.action },
      { header: 'Entity', value: (r) => r.entity },
      { header: 'Entity id', value: (r) => r.entityId },
      { header: 'Gym', value: (r) => r.gymId },
      { header: 'Reason', value: (r) => r.reason },
      { header: 'IP', value: (r) => r.ip },
      { header: 'Details', value: (r) => (r.meta ? JSON.stringify(r.meta) : '') },
    ])
  } else {
    throw errors.notFound('Export')
  }
  await audit({ actorType: 'ADMIN', actorId: admin.sub, adminUserId: admin.sub, action: `export.${kind}`, entity: 'Platform', ip: meta.ip })
  return csvResponse(`kasrat-${kind}-${today()}.csv`, body)
})
