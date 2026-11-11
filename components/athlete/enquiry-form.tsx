'use client'

import { useState } from 'react'
import { CheckCircle2, Loader2, PhoneCall } from 'lucide-react'
import { api, ApiClientError } from '@/lib/api/client'

// Public enquiry form (/g/{slug}/enquire). The hidden "website" field is a
// honeypot: people never see it, bots fill it.
export function EnquiryForm({ slug, labels }: { slug: string; labels: { name: string; phone: string; interest: string; interestHint: string; message: string; submit: string; done: string } }) {
  const [form, setForm] = useState({ name: '', phone: '', interest: '', message: '', website: '' })
  const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle')
  const [error, setError] = useState('')
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [key]: e.target.value }))

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setState('busy')
    setError('')
    try {
      await api(`/api/g/${slug}/enquire`, { method: 'POST', body: form })
      setState('done')
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Something went wrong')
      setState('idle')
    }
  }

  if (state === 'done') {
    return (
      <p className="pay-msg pay-done">
        <CheckCircle2 /> {labels.done}
      </p>
    )
  }
  return (
    <form className="join-form" onSubmit={submit}>
      <label className="field">
        <span>{labels.name}</span>
        <input value={form.name} onChange={set('name')} required minLength={2} maxLength={80} autoComplete="name" />
      </label>
      <label className="field">
        <span>{labels.phone}</span>
        <input value={form.phone} onChange={set('phone')} required inputMode="tel" placeholder="98765 43210" autoComplete="tel" />
      </label>
      <label className="field">
        <span>{labels.interest}</span>
        <input value={form.interest} onChange={set('interest')} maxLength={120} placeholder={labels.interestHint} />
      </label>
      <label className="field">
        <span>{labels.message}</span>
        <textarea value={form.message} onChange={set('message')} maxLength={500} rows={2} />
      </label>
      <label className="hp-field" aria-hidden="true">
        Website
        <input tabIndex={-1} autoComplete="off" value={form.website} onChange={set('website')} />
      </label>
      {error ? <p className="field-error">{error}</p> : null}
      <button className="btn btn-lime btn-block" disabled={state === 'busy'}>
        {state === 'busy' ? <Loader2 className="spin" /> : <PhoneCall />} {labels.submit}
      </button>
    </form>
  )
}
