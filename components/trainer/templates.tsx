'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Pencil, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { api, ApiClientError } from '@/lib/api/client'
import { READY_PLANS } from '@/lib/trainer/ready-plans'
import type { DietMeal } from '@/lib/trainer/diet'
import { StaffSplitEditor, type StaffSplitDay } from './actions'

// New-plan / edit-plan toggles on the Workout plans page.
export function NewTemplate() {
  const [open, setOpen] = useState(false)
  if (!open) {
    return (
      <button type="button" className="btn btn-dark" onClick={() => setOpen(true)}>
        <Plus /> New plan
      </button>
    )
  }
  return (
    <section className="panel" style={{ marginBottom: 14 }}>
      <p className="kicker">NEW PLAN</p>
      <StaffSplitEditor initialDays={[]} initialDiet="" saveUrl="/api/gym/workout-templates" method="POST" extra={{ name: '', goal: '' }} onSaved={() => setOpen(false)} saveLabel="Save plan" />
    </section>
  )
}

export function EditTemplate({ id, name, goal, days, dietNotes, dietMeals }: { id: string; name: string; goal: string; days: StaffSplitDay[]; dietNotes: string; dietMeals: DietMeal[] }) {
  const [open, setOpen] = useState(false)
  if (!open) {
    return (
      <button type="button" className="btn btn-outline btn-sm" onClick={() => setOpen(true)}>
        <Pencil /> Edit
      </button>
    )
  }
  return (
    <div className="template-edit">
      <StaffSplitEditor initialDays={days} initialDiet={dietNotes} initialMeals={dietMeals} saveUrl={`/api/gym/workout-templates/${id}`} method="PUT" extra={{ name, goal }} onSaved={() => setOpen(false)} saveLabel="Save changes" />
      <button type="button" className="btn btn-outline btn-sm" onClick={() => setOpen(false)}>
        Close
      </button>
    </div>
  )
}

// Copies a Rep+ ready plan into this gym's plans, so it can be edited and
// given to many members at once.
export function AddReadyPlan({ planKey }: { planKey: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const plan = READY_PLANS.find((item) => item.key === planKey)
  if (!plan) return null
  const add = async () => {
    setBusy(true)
    try {
      await api('/api/gym/workout-templates', { method: 'POST', body: { name: plan.name, goal: plan.goal, days: plan.days, dietNotes: plan.dietNotes, dietMeals: plan.dietMeals } })
      toast.success(`"${plan.name}" added to your gym's plans`)
      router.refresh()
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : 'Could not add the plan')
      setBusy(false)
    }
  }
  return (
    <button type="button" className="btn btn-outline btn-sm" onClick={add} disabled={busy}>
      {busy ? <Loader2 className="spin" /> : <Plus />} Add to gym plans
    </button>
  )
}
