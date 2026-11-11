'use client'

import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import type { z } from 'zod'
import { Loader2, Send } from 'lucide-react'
import { api } from '@/lib/api/client'
import { announcementSchema } from '@/lib/validation/admin'
import { useAction } from './use-action'

type Input = z.input<typeof announcementSchema>
type Output = z.output<typeof announcementSchema>

export function AnnouncementForm() {
  const { run, pending } = useAction()
  const form = useForm<Input, unknown, Output>({ resolver: zodResolver(announcementSchema), defaultValues: { title: '', body: '', audience: 'ALL', sendEmail: false, sendWhatsapp: false } })
  const { errors } = form.formState

  async function submit(values: Output) {
    if (!window.confirm('Send this announcement to every matching gym owner?')) return
    const result = await run(() => api<{ recipients: number }>('/api/admin/announcements', { method: 'POST', body: values, session: 'admin' }), (r) => `Sent to ${r.recipients} owner(s)`)
    if (result) form.reset()
  }

  return (
    <form className="panel" onSubmit={form.handleSubmit(submit)} noValidate>
      <p className="kicker">NEW</p>
      <h2>Announce to gym owners</h2>
      <div className="field" style={{ marginTop: 14 }}>
        <label htmlFor="a-title">Title</label>
        <input id="a-title" {...form.register('title')} placeholder="New: UPI autopay for renewals" />
        {errors.title ? <span className="field-error">{errors.title.message}</span> : null}
      </div>
      <div className="field">
        <label htmlFor="a-body">Message</label>
        <textarea id="a-body" {...form.register('body')} />
        {errors.body ? <span className="field-error">{errors.body.message}</span> : null}
      </div>
      <div className="field">
        <label htmlFor="a-audience">Send to</label>
        <select id="a-audience" {...form.register('audience')}>
          <option value="ALL">All gyms (except cancelled)</option>
          <option value="TRIAL">Gyms on trial</option>
          <option value="ACTIVE">Paying gyms</option>
          <option value="PAST_DUE">Past-due gyms</option>
        </select>
      </div>
      <label className="check-row">
        <input type="checkbox" {...form.register('sendEmail')} /> Also email (Brevo)
      </label>
      <label className="check-row">
        <input type="checkbox" {...form.register('sendWhatsapp')} /> Also WhatsApp (template kasrat_platform_announcement)
      </label>
      <p className="muted">Every owner always gets it in-app. Rep+ announcements do not use the gym's WhatsApp quota.</p>
      <div className="actions">
        <button className="btn btn-lime" type="submit" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : <Send />} Send announcement
        </button>
      </div>
    </form>
  )
}
