import { describe, expect, it } from 'vitest'
import { READY_PLANS } from '@/lib/trainer/ready-plans'
import { templateSchema, trainerSplitSchema } from '@/lib/validation/trainer'
import { ownerNav, trainerNav } from '@/lib/nav'

describe('Rep+ ready plans', () => {
  it('every ready plan saves as a gym plan and as a member plan', () => {
    expect(READY_PLANS.length).toBeGreaterThanOrEqual(6)
    for (const plan of READY_PLANS) {
      const asTemplate = templateSchema.safeParse({ name: plan.name, goal: plan.goal, days: plan.days, dietNotes: plan.dietNotes, dietMeals: plan.dietMeals })
      expect(asTemplate.success, `${plan.key}: ${asTemplate.success ? '' : JSON.stringify(asTemplate.error.issues)}`).toBe(true)
      expect(trainerSplitSchema.safeParse({ days: plan.days, dietNotes: plan.dietNotes, dietMeals: plan.dietMeals }).success, plan.key).toBe(true)
    }
  })

  it('keys and names are unique, text is plain ASCII', () => {
    expect(new Set(READY_PLANS.map((p) => p.key)).size).toBe(READY_PLANS.length)
    expect(new Set(READY_PLANS.map((p) => p.name.toLowerCase())).size).toBe(READY_PLANS.length)
    expect(/[^\x00-\x7F]/.test(JSON.stringify(READY_PLANS))).toBe(false)
  })

  it('every ready diet is split into 3 to 6 meals with times', () => {
    for (const plan of READY_PLANS) {
      expect(plan.dietMeals.length, plan.key).toBeGreaterThanOrEqual(3)
      expect(plan.dietMeals.length, plan.key).toBeLessThanOrEqual(6)
      expect(plan.dietMeals.every((meal) => meal.name && meal.time && meal.items), plan.key).toBe(true)
    }
  })

  it('diet notes stay general: no supplements or crash diets', () => {
    for (const plan of READY_PLANS) {
      expect([plan.dietNotes, ...plan.dietMeals.map((m) => m.items)].join(' ').toLowerCase(), plan.key).not.toMatch(/steroid|fat burner|starv|kcal|calorie target|skip meals/)
    }
  })

  it('owners reach workout plans and can get back from the trainer pages', () => {
    const owner = ownerNav(false, 'Members', 0, 0).flatMap((s) => s.items)
    expect(owner.some((i) => i.href === '/trainer/workouts')).toBe(true)
    expect(trainerNav('Members', 0, true)[0].items[0]).toMatchObject({ href: '/owner' })
    expect(trainerNav('Members', 0).flatMap((s) => s.items).some((i) => i.href === '/owner')).toBe(false)
  })
})
