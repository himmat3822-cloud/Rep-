'use client'

import { useState } from 'react'
import { CheckCircle2, Loader2, PhoneCall } from 'lucide-react'
import { api, ApiClientError } from '@/lib/api/client'

export function JoinForm({ slug, code, labels }: { slug: string; code: string; labels: { name: string; phone: string; submit: string; done: string } }) {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle')
  const [error, setError] = useState('')

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setState('busy')
    setError('')
    try {
      await api(`/api/g/${slug}/join`, { method: 'POST', body: { name, phone, ref: code } })
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
        <input value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={60} autoComplete="name" />
      </label>
      <label className="field">
        <span>{labels.phone}</span>
        <input value={phone} onChange={(e) => setPhone(e.target.value)} required inputMode="tel" placeholder="98765 43210" autoComplete="tel" />
      </label>
      {error ? <p className="field-error">{error}</p> : null}
      <button className="btn btn-lime btn-block" disabled={state === 'busy'}>
        {state === 'busy' ? <Loader2 className="spin" /> : <PhoneCall />} {labels.submit}
      </button>
    </form>
  )
}
