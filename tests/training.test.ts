import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { scopeToGym } from '@/lib/db/tenant-core'
import { createQuery, openQueryCount, replyToQuery, staffQueries } from '@/lib/queries/service'
import { assignSplit } from '@/lib/trainer/service'
import { coachList, trainingSettings } from '@/lib/trainer/coaches'
import { blankMeals, parseMeals } from '@/lib/trainer/diet'
import { dietMealSchema, trainerSplitSchema } from '@/lib/validation/trainer'
import { queryCreateSchema } from '@/lib/validation/queries'
import { gymAppSettingsSchema } from '@/lib/validation/owner'
import { parseGymSettings } from '@/lib/gym/settings'
import { ownerNav, trainerNav } from '@/lib/nav'
import { purgeGymData } from '@/lib/platform/purge'
import { makeGym, testDb, uniq } from './helpers'

describe('diet by meals (pure)', () => {
  it('reads stored meals safely and drops empty ones', () => {
    expect(parseMeals(null)).toEqual([])
    expect(parseMeals('junk')).toEqual([])
    expect(parseMeals([{ name: 'Meal 1', time: '8 AM', items: 'Poha' }, { name: 'Meal 2', items: '' }, 7, null])).toEqual([{ name: 'Meal 1', time: '8 AM', items: 'Poha' }])
    expect(blankMeals(4).map((m) => m.name)).toEqual(['Meal 1', 'Meal 2', 'Meal 3', 'Meal 4'])
  })

  it('validates meals: needs food, max 8, old saves without meals still work', () => {
    expect(dietMealSchema.safeParse({ name: 'Meal 1', time: '8 AM', items: '2 chilla' }).success).toBe(true)
    expect(dietMealSchema.safeParse({ name: 'Meal 1', items: '' }).success).toBe(false)
    const nine = Array.from({ length: 9 }, (_, i) => ({ name: `Meal ${i + 1}`, items: 'Dal' }))
    expect(trainerSplitSchema.safeParse({ days: [], dietMeals: nine }).success).toBe(false)
    expect(trainerSplitSchema.parse({ days: [], dietNotes: 'More dal' }).dietMeals).toEqual([])
  })
})

describe('owner training settings (pure)', () => {
  it('defaults keep today\'s behaviour', () => {
    const settings = parseGymSettings({})
    expect(settings).toMatchObject({ ownerTrains: false, ownerTrainingView: 'together', queryRouting: 'chosen', planEditors: 'assigned' })
    const form = gymAppSettingsSchema.shape
    expect(form.queryRouting.parse(undefined)).toBe('chosen')
  })

  it('together puts training in the owner menu; separate leaves it out', () => {
    const together = ownerNav(false, 'Members', 0, 0, null, 'together')
    const training = together.find((s) => s.title === 'MY TRAINING')!
    expect(training.items.map((i) => i.href)).toEqual(['/trainer', '/trainer/athletes', '/trainer/workouts', '/trainer/sessions'])
    expect(together.flatMap((s) => s.items).filter((i) => i.href === '/trainer/workouts')).toHaveLength(1)
    const separate = ownerNav(false, 'Members', 0, 0, null, 'separate')
    expect(separate.some((s) => s.title === 'MY TRAINING')).toBe(false)
    expect(trainerNav('Members', 0, false).flatMap((s) => s.items).some((i) => i.href === '/owner')).toBe(false)
  })

  it('a query may name a trainer, "any trainer" (null) or nobody', () => {
    expect(queryCreateSchema.parse({ topic: 'DIET', body: 'New diet please' }).trainerId).toBeUndefined()
    expect(queryCreateSchema.parse({ topic: 'DIET', body: 'New diet please', trainerId: null }).trainerId).toBeNull()
    expect(queryCreateSchema.safeParse({ topic: 'DIET', body: 'New diet please', trainerId: 'x' }).success).toBe(false)
  })
})

describe('member picks a trainer; owner decides who sees it (database)', () => {
  const base = testDb()
  let G: Awaited<ReturnType<typeof makeGym>>
  let db: ReturnType<typeof scopeToGym>
  let inder: { id: string; name: string }
  let daniel: { id: string; name: string }
  const gymRef = () => ({ id: G.gym.id, slug: G.gym.slug })
  const me = () => ({ id: G.athlete.id, name: G.athlete.name, homeBranchId: G.branch.id })
  const setSettings = async (patch: Record<string, string | boolean>) => {
    const gym = await db.gym.findFirstOrThrow({ select: { settings: true } })
    await db.gym.update({ where: { id: G.gym.id }, data: { settings: { ...((gym.settings as Record<string, string | boolean>) ?? {}), ...(patch as Record<string, string | boolean>) } } })
  }

  beforeAll(async () => {
    G = await makeGym(base, 'Coach')
    db = scopeToGym(base, G.gym.id)
    const role = await db.role.create({ data: { gymId: G.gym.id, key: 'TRAINER', name: 'Trainer', permissions: ['workouts.manage'], isSystem: true } })
    inder = await db.gymUser.create({ data: { gymId: G.gym.id, roleId: role.id, kind: 'TRAINER', name: 'Inder', phone: `+9193${Math.floor(10000000 + Math.random() * 89999999)}` } })
    daniel = await db.gymUser.create({ data: { gymId: G.gym.id, roleId: role.id, kind: 'TRAINER', name: 'Daniel', phone: `+9192${Math.floor(10000000 + Math.random() * 89999999)}` } })
    // Inder is the member's trainer; the member asks Daniel because he is free.
    await db.athlete.update({ where: { id: G.athlete.id }, data: { trainerId: inder.id } })
    await setSettings({ queryRouting: 'chosen', ownerTrains: false })
  })
  afterAll(async () => {
    await purgeGymData(base, G.gym.id)
  })

  it('only the picked trainer (and the owner) see it when the owner chose "picked trainer"', async () => {
    const query = await createQuery(db, gymRef(), me(), { topic: 'WORKOUT', body: 'Need a new 5 day split', trainerId: daniel.id })
    expect(query.trainerId).toBe(daniel.id)
    expect(await openQueryCount(db, { id: daniel.id, kind: 'TRAINER' })).toBe(1)
    expect(await openQueryCount(db, { id: inder.id, kind: 'TRAINER' })).toBe(0)
    expect(await openQueryCount(db, { id: G.owner.id, kind: 'OWNER' })).toBe(1)
    const [thread] = await staffQueries(db, { id: daniel.id, kind: 'TRAINER' }, 'open')
    expect(thread.trainer).toMatchObject({ id: daniel.id, name: 'Daniel' })
    await expect(replyToQuery(db, gymRef(), { id: inder.id, name: 'Inder', kind: 'TRAINER' }, query.id, { body: 'Hi', close: false })).rejects.toThrow(/another trainer/)
    const notified = (await db.notification.findMany({ where: { recipientType: 'STAFF' } })).map((n) => n.recipientId).sort()
    expect(notified).toEqual([G.owner.id, daniel.id].sort())
  })

  it('"only their own trainer": Daniel cannot change Inder\'s member; Inder and the owner can', async () => {
    await setSettings({ planEditors: 'assigned' })
    const day = [{ weekday: 1, title: 'Push', focus: '', minutes: 60, exercises: [{ name: 'Bench', sets: 4, reps: '8' }] }]
    await expect(assignSplit(db, gymRef(), { sub: daniel.id, kind: 'TRAINER', name: 'Daniel' }, G.athlete.id, { days: day, dietNotes: '' })).rejects.toThrow(/Only their own trainer/)
    const byInder = await assignSplit(db, gymRef(), { sub: inder.id, kind: 'TRAINER', name: 'Inder' }, G.athlete.id, { days: day, dietNotes: '' })
    expect(byInder.createdById).toBe(inder.id)
    const byOwner = await assignSplit(db, gymRef(), { sub: G.owner.id, kind: 'OWNER', name: 'Owner' }, G.athlete.id, { days: day, dietNotes: '' })
    expect(byOwner.createdById).toBe(G.owner.id)
  })

  it('"any trainer": Daniel updates the split and meal-wise diet, shown as his, and Inder is told', async () => {
    await setSettings({ planEditors: 'any' })
    const split = await assignSplit(db, gymRef(), { sub: daniel.id, kind: 'TRAINER', name: 'Daniel' }, G.athlete.id, {
      days: [{ weekday: 1, title: 'Push', focus: '', minutes: 60, exercises: [{ name: 'Bench', sets: 4, reps: '8' }] }],
      dietNotes: '3 litres water',
      dietMeals: [{ name: 'Meal 1', time: '8 AM', items: 'Poha and curd' }, { name: 'Meal 2', time: '1 PM', items: '' }],
    })
    expect(split.createdById).toBe(daniel.id)
    expect(parseMeals(split.dietMeals)).toEqual([{ name: 'Meal 1', time: '8 AM', items: 'Poha and curd' }])
    expect(await db.workoutSplit.count({ where: { athleteId: G.athlete.id, active: true } })).toBe(1)
    const told = await db.notification.findFirst({ where: { recipientId: inder.id, title: { contains: 'Daniel updated' } } })
    expect(told?.href).toContain(G.athlete.id)
    await setSettings({ planEditors: 'assigned' })
  })

  it('"all trainers see queries": everyone sees it, with who it was sent to, and anyone can answer', async () => {
    await setSettings({ queryRouting: 'all' })
    const query = await createQuery(db, gymRef(), me(), { topic: 'DIET', body: 'Diet for fat loss please', trainerId: inder.id })
    const danielBoard = await staffQueries(db, { id: daniel.id, kind: 'TRAINER' }, 'open')
    const seen = danielBoard.find((q) => q.id === query.id)
    expect(seen?.trainer?.name).toBe('Inder')
    await replyToQuery(db, gymRef(), { id: daniel.id, name: 'Daniel', kind: 'TRAINER' }, query.id, { body: 'Check your Schedule', close: false })
    expect((await db.memberQuery.findFirstOrThrow({ where: { id: query.id } })).status).toBe('ANSWERED')
    await setSettings({ queryRouting: 'chosen' })
  })

  it('the owner is a trainer choice only when the owner trains; strangers are refused', async () => {
    expect((await coachList(db)).map((c) => c.id)).not.toContain(G.owner.id)
    await expect(createQuery(db, gymRef(), me(), { topic: 'OTHER', body: 'Question for the owner', trainerId: G.owner.id })).rejects.toThrow(/Pick a trainer/)
    await setSettings({ ownerTrains: true })
    expect((await trainingSettings(db)).ownerTrains).toBe(true)
    const query = await createQuery(db, gymRef(), me(), { topic: 'OTHER', body: 'Question for the owner', trainerId: G.owner.id })
    expect(query.trainerId).toBe(G.owner.id)
    await expect(createQuery(db, gymRef(), me(), { topic: 'OTHER', body: 'Who is this', trainerId: uniq('fake-trainer-id') })).rejects.toThrow(/Pick a trainer/)
  })

  it('an owner with members assigned counts as training until the setting is saved', async () => {
    const gym = await db.gym.findFirstOrThrow({ select: { settings: true } })
    const { ownerTrains: _drop, ...rest } = gym.settings as Record<string, unknown>
    void _drop
    await db.gym.update({ where: { id: G.gym.id }, data: { settings: rest as object } })
    expect((await trainingSettings(db)).ownerTrains).toBe(false)
    const extra = await db.athlete.create({ data: { gymId: G.gym.id, homeBranchId: G.branch.id, memberCode: uniq('M'), name: 'Owner Member', phone: `+9190${Math.floor(10000000 + Math.random() * 89999999)}`, referralCode: uniq('R'), trainerId: G.owner.id } })
    expect((await trainingSettings(db)).ownerTrains).toBe(true)
    await db.athlete.update({ where: { id: extra.id }, data: { archived: true } })
  })
})
