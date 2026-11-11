import type { TenantDb } from '@/lib/db/tenant-core'
import { ApiError } from '@/lib/api/errors'
import { createMember } from './members'
import { formatIstDate } from '@/lib/time'
import type { LeadOutput } from '@/lib/validation/growth'

// Leads CRM: walk-ins, Instagram, Google, referrals and the website form.
// Stages New -> Trial -> Follow-up -> Joined / Lost, with follow-up dates.
// Converting creates the member in one click (referral code carried over).

export async function createLead(db: TenantDb, gymId: string, input: LeadOutput, extra: { referrerId?: string | null } = {}) {
  const member = await db.athlete.findFirst({ where: { phone: input.phone, archived: false }, select: { id: true, name: true } })
  if (member) throw new ApiError(409, 'CONFLICT', `${member.name} is already a member with this number`, { athleteId: member.id })
  const open = await db.lead.findFirst({ where: { phone: input.phone, stage: { notIn: ['JOINED', 'LOST'] } }, select: { id: true, name: true } })
  if (open) throw new ApiError(409, 'CONFLICT', `${open.name} is already in your leads`, { leadId: open.id })
  if (input.assignedToId) await assertStaff(db, input.assignedToId)
  return db.lead.create({
    data: {
      gymId,
      name: input.name,
      phone: input.phone,
      source: input.source,
      interest: input.interest,
      nextFollowUpAt: input.nextFollowUpAt ?? new Date(Date.now() + 86400000),
      assignedToId: input.assignedToId ?? null,
      branchId: input.branchId ?? null,
      notes: input.notes,
      referrerId: extra.referrerId ?? null,
    },
  })
}

async function assertStaff(db: TenantDb, staffId: string) {
  const staff = await db.gymUser.findFirst({ where: { id: staffId, active: true }, select: { id: true } })
  if (!staff) throw new ApiError(422, 'VALIDATION_ERROR', 'Pick an active staff member')
}

export async function updateLead(db: TenantDb, leadId: string, patch: { stage?: 'NEW' | 'TRIAL' | 'FOLLOW_UP' | 'JOINED' | 'LOST'; nextFollowUpAt?: Date | null; assignedToId?: string | null; interest?: string; lostReason?: string }) {
  const lead = await db.lead.findFirst({ where: { id: leadId } })
  if (!lead) throw new ApiError(404, 'NOT_FOUND', 'Lead not found')
  if (patch.stage === 'JOINED' && !lead.convertedAthleteId) throw new ApiError(422, 'VALIDATION_ERROR', 'Use "Convert to member" to mark a lead as joined')
  if (patch.assignedToId) await assertStaff(db, patch.assignedToId)
  return db.lead.update({
    where: { id: lead.id },
    data: {
      ...(patch.stage ? { stage: patch.stage } : {}),
      ...(patch.nextFollowUpAt !== undefined ? { nextFollowUpAt: patch.nextFollowUpAt } : {}),
      ...(patch.assignedToId !== undefined ? { assignedToId: patch.assignedToId } : {}),
      ...(patch.interest !== undefined ? { interest: patch.interest } : {}),
      ...(patch.stage === 'LOST' ? { lostReason: patch.lostReason ?? null, nextFollowUpAt: null } : {}),
    },
  })
}

// "Called, coming for a trial on Saturday" -> appended to the notes.
export async function logLeadContact(db: TenantDb, leadId: string, by: string, input: { note: string; nextFollowUpAt?: Date; stage?: 'NEW' | 'TRIAL' | 'FOLLOW_UP' }) {
  const lead = await db.lead.findFirst({ where: { id: leadId } })
  if (!lead) throw new ApiError(404, 'NOT_FOUND', 'Lead not found')
  if (lead.stage === 'JOINED' || lead.stage === 'LOST') throw new ApiError(409, 'CONFLICT', 'This lead is closed')
  const line = `${formatIstDate(new Date(), { day: 'numeric', month: 'short' })} (${by}): ${input.note}`
  return db.lead.update({
    where: { id: lead.id },
    data: {
      notes: lead.notes ? `${line}\n${lead.notes}` : line,
      lastContactAt: new Date(),
      nextFollowUpAt: input.nextFollowUpAt ?? lead.nextFollowUpAt,
      stage: input.stage ?? (lead.stage === 'NEW' ? 'FOLLOW_UP' : lead.stage),
    },
  })
}

export async function convertLead(db: TenantDb, gym: { id: string; name: string; settings: unknown }, leadId: string, homeBranchId: string) {
  const lead = await db.lead.findFirst({ where: { id: leadId } })
  if (!lead) throw new ApiError(404, 'NOT_FOUND', 'Lead not found')
  if (lead.convertedAthleteId) throw new ApiError(409, 'CONFLICT', 'This lead is already a member', { athleteId: lead.convertedAthleteId })
  const referrer = lead.referrerId ? await db.athlete.findFirst({ where: { id: lead.referrerId }, select: { referralCode: true } }) : null
  const athlete = await createMember(db, gym, {
    name: lead.name,
    phone: lead.phone,
    email: '',
    gender: '',
    homeBranchId,
    language: 'EN',
    emergencyContact: '',
    medicalNotes: '',
    notes: [lead.interest ? `Interest: ${lead.interest}` : '', `From ${lead.source.toLowerCase().replace('_', ' ')} lead`].filter(Boolean).join('. '),
    referralCode: referrer?.referralCode ?? '',
    biometricId: '',
  })
  await db.lead.update({ where: { id: lead.id }, data: { stage: 'JOINED', convertedAthleteId: athlete.id, nextFollowUpAt: null } })
  return { athleteId: athlete.id }
}

export interface Funnel {
  source: string
  total: number
  trial: number
  joined: number
  lost: number
  conversion: number
}

export async function leadFunnel(db: TenantDb, since: Date): Promise<Funnel[]> {
  const leads = await db.lead.findMany({ where: { createdAt: { gte: since } }, select: { source: true, stage: true } })
  const map = new Map<string, Funnel>()
  for (const lead of leads) {
    const row = map.get(lead.source) ?? { source: lead.source, total: 0, trial: 0, joined: 0, lost: 0, conversion: 0 }
    row.total += 1
    if (lead.stage === 'TRIAL') row.trial += 1
    if (lead.stage === 'JOINED') row.joined += 1
    if (lead.stage === 'LOST') row.lost += 1
    map.set(lead.source, row)
  }
  return [...map.values()].map((row) => ({ ...row, conversion: row.total ? Math.round((row.joined / row.total) * 100) : 0 })).sort((a, b) => b.total - a.total)
}
