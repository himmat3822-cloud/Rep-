import type { Metadata } from 'next'
import { AthleteChrome } from '@/components/athlete/athlete-chrome'
import { ScheduleView } from '@/components/athlete/schedule'
import { requireAthletePage } from '@/lib/auth/page'
import { tenantDb } from '@/lib/db/tenant'
import { getGymFeatures } from '@/lib/gym/features'
import { bookableBranchIds, listSlots, myBookings, weekDates } from '@/lib/athlete/slots'
import type { WorkoutDay } from '@/lib/athlete/home'
import { istDateOnly } from '@/lib/time'

export const metadata: Metadata = { title: 'Schedule - Rep+' }

export default async function SchedulePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const { athlete, gym } = await requireAthletePage(slug)
  const db = tenantDb(gym.id)
  const features = await getGymFeatures(gym.id)
  const slotsOn = features.includes('slot_booking')
  const [split, branchIds, bookings] = await Promise.all([
    db.workoutSplit.findFirst({ where: { athleteId: athlete.id, active: true }, orderBy: { updatedAt: 'desc' } }),
    bookableBranchIds(db, athlete, features.includes('cross_branch_access')),
    slotsOn ? myBookings(db, athlete.id) : Promise.resolve([]),
  ])
  const branches = await db.branch.findMany({ where: { id: { in: branchIds } }, select: { id: true, name: true } })
  const trainer = split?.createdById ? await db.gymUser.findFirst({ where: { id: split.createdById }, select: { name: true } }) : null
  const today = istDateOnly()
  const initialSlots = slotsOn ? await listSlots(db, athlete.id, athlete.homeBranchId, today) : []

  return (
    <AthleteChrome slug={slug} lang={athlete.language}>
      <ScheduleView
        slug={slug}
        lang={athlete.language}
        days={weekDates().map((d) => d.toISOString().slice(0, 10))}
        restDays={athlete.restDays}
        split={((split?.days as { days?: WorkoutDay[] } | null)?.days ?? []) as WorkoutDay[]}
        dietNotes={split?.dietNotes ?? null}
        trainerName={trainer?.name ?? null}
        slotsEnabled={slotsOn}
        branches={branches}
        homeBranchId={athlete.homeBranchId}
        initialSlots={initialSlots}
        initialBookings={bookings}
      />
    </AthleteChrome>
  )
}
