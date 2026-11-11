'use client'

import { useState } from 'react'
import { Pencil, Plus } from 'lucide-react'
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

export function EditTemplate({ id, name, goal, days, dietNotes }: { id: string; name: string; goal: string; days: StaffSplitDay[]; dietNotes: string }) {
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
      <StaffSplitEditor initialDays={days} initialDiet={dietNotes} saveUrl={`/api/gym/workout-templates/${id}`} method="PUT" extra={{ name, goal }} onSaved={() => setOpen(false)} saveLabel="Save changes" />
      <button type="button" className="btn btn-outline btn-sm" onClick={() => setOpen(false)}>
        Close
      </button>
    </div>
  )
}
