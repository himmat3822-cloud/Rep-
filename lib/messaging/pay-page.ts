import 'server-only'
import { prisma } from '@/lib/db/client'
import { scopeToGym } from '@/lib/db/tenant-core'
import { parseGymSettings } from '@/lib/gym/settings'
import { verifyPayToken } from './pay-link'

// Data for the public pay page (/p/<token>). The signed token names the due;
// after that every read is scoped to the due's gym. Only the first name,
// amount and due date are shown - dues stay private to the member.

export interface PayPageData {
  status: 'OPEN' | 'PAID' | 'WAIVED'
  gymName: string
  gymCity: string
  firstName: string
  language: 'EN' | 'HI' | 'PA'
  amountPaise: number
  dueDate: Date
  memberCode: string
  upiId: string | null
}

export async function loadPayPage(token: string): Promise<PayPageData | null> {
  const dueId = verifyPayToken(token)
  if (!dueId) return null
  const found = await prisma.due.findUnique({ where: { id: dueId }, select: { gymId: true } })
  if (!found) return null
  const db = scopeToGym(prisma, found.gymId)
  const due = await db.due.findFirst({ where: { id: dueId } })
  if (!due) return null
  const [gym, athlete] = await Promise.all([
    db.gym.findFirst({ select: { name: true, city: true, settings: true } }),
    db.athlete.findFirst({ where: { id: due.athleteId }, select: { name: true, language: true, memberCode: true } }),
  ])
  if (!gym || !athlete) return null
  return {
    status: due.status,
    gymName: gym.name,
    gymCity: gym.city,
    firstName: athlete.name.trim().split(/\s+/)[0],
    language: athlete.language,
    amountPaise: due.amountPaise,
    dueDate: due.dueDate,
    memberCode: athlete.memberCode,
    upiId: parseGymSettings(gym.settings).memberUpiId ?? null,
  }
}
