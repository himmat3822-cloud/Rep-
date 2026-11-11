import { gymRoute } from '@/lib/api/guard'
import { errors } from '@/lib/api/errors'
import { REPORT_KINDS, reportQuerySchema, type ReportKind } from '@/lib/validation/growth'
import { csvResponse, toCsv } from '@/lib/csv'
import { getGymFeatures } from '@/lib/gym/features'
import { attendanceReport, duesReport, leadsReport, membersReport, profitReport, ptReport, revenueReport } from '@/lib/owner/reports'
import { istDateOnly } from '@/lib/time'
import { audit } from '@/lib/audit'

// GET /api/gym/reports/{kind}.csv?months=6 - opens in Excel / Google Sheets.
// Amounts are in rupees (2 decimals) so the sheet can sum them.
const rupees = (paise: number) => (paise / 100).toFixed(2)

export const GET = gymRoute({ permission: ['reports.read', 'reports.export'], feature: 'basic_reports', schema: reportQuerySchema }, async ({ db, gym, params, input, staff, meta }) => {
  const kind = params.kind.replace(/\.csv$/, '') as ReportKind
  if (!REPORT_KINDS.includes(kind)) throw errors.notFound('Report')
  if (kind === 'expenses' && !(await getGymFeatures(gym.id)).includes('expenses_profit')) throw errors.featureLocked('expenses_profit')
  const months = input.months
  let body: string
  switch (kind) {
    case 'revenue':
      body = toCsv(await revenueReport(db, months), [
        { header: 'Month', value: (r) => r.month },
        { header: 'Cash (Rs)', value: (r) => rupees(r.cash) },
        { header: 'UPI (Rs)', value: (r) => rupees(r.upi) },
        { header: 'Card (Rs)', value: (r) => rupees(r.card) },
        { header: 'Bank (Rs)', value: (r) => rupees(r.bank) },
        { header: 'Total (Rs)', value: (r) => rupees(r.total) },
        { header: 'GST in invoices (Rs)', value: (r) => rupees(r.gst) },
        { header: 'Payments', value: (r) => r.payments },
      ])
      break
    case 'members':
      body = toCsv(await membersReport(db, months), [
        { header: 'Month', value: (r) => r.month },
        { header: 'Joined', value: (r) => r.joined },
        { header: 'Renewed', value: (r) => r.renewed },
        { header: 'Expired', value: (r) => r.expired },
        { header: 'Active at month end', value: (r) => r.activeAtEnd },
        { header: 'Churn %', value: (r) => r.churnPct },
      ])
      break
    case 'attendance':
      body = toCsv((await attendanceReport(db, months)).months, [
        { header: 'Month', value: (r) => r.month },
        { header: 'Visits', value: (r) => r.visits },
        { header: 'Members who came', value: (r) => r.members },
        { header: 'Visits per day', value: (r) => r.perDay },
      ])
      break
    case 'dues':
      body = toCsv((await duesReport(db)).rows, [
        { header: 'Member', value: (r) => r.member },
        { header: 'Member code', value: (r) => r.memberCode },
        { header: 'Phone', value: (r) => r.phone },
        { header: 'Amount (Rs)', value: (r) => rupees(r.amountPaise) },
        { header: 'Due date', value: (r) => r.dueDate },
        { header: 'Days late', value: (r) => r.daysLate },
        { header: 'Reminders sent', value: (r) => r.reminderStage },
      ])
      break
    case 'leads': {
      const report = await leadsReport(db, months)
      body = toCsv(report.funnel, [
        { header: 'Source', value: (r) => r.source },
        { header: 'Leads', value: (r) => r.total },
        { header: 'In trial', value: (r) => r.trial },
        { header: 'Joined', value: (r) => r.joined },
        { header: 'Lost', value: (r) => r.lost },
        { header: 'Conversion %', value: (r) => r.conversion },
      ])
      break
    }
    case 'pt':
      body = toCsv(await ptReport(db, months), [
        { header: 'Month', value: (r) => r.month },
        { header: 'Trainer', value: (r) => r.trainer },
        { header: 'Sessions logged', value: (r) => r.sessions },
        { header: 'Confirmed by member', value: (r) => r.confirmed },
        { header: 'Commission (Rs)', value: (r) => rupees(r.commissionPaise) },
      ])
      break
    case 'expenses':
      body = toCsv(await profitReport(db, months), [
        { header: 'Month', value: (r) => r.month },
        { header: 'Revenue ex-GST (Rs)', value: (r) => rupees(r.revenue) },
        { header: 'Expenses (Rs)', value: (r) => rupees(r.expenses) },
        { header: 'PT commission (Rs)', value: (r) => rupees(r.commission) },
        { header: 'Profit (Rs)', value: (r) => rupees(r.profit) },
      ])
      break
  }
  await audit({ gymId: gym.id, actorType: 'STAFF', actorId: staff!.sub, impersonatedBy: staff!.imp ?? null, action: 'report.export', entity: 'Report', entityId: kind, meta: { months }, ip: meta.ip })
  return csvResponse(`${gym.slug}-${kind}-${istDateOnly().toISOString().slice(0, 10)}.csv`, body)
})
