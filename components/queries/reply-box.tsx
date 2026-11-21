'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCheck, Loader2, Send } from 'lucide-react'
import { toast } from 'sonner'
import { api, ApiClientError } from '@/lib/api/client'

// Staff reply to a member query: answer, or answer and mark done.
export function QueryReplyBox({ id, closed }: { id: string; closed: boolean }) {
  const router = useRouter()
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState<'reply' | 'close' | null>(null)

  async function send(close: boolean) {
    setBusy(close ? 'close' : 'reply')
    try {
      await api(`/api/gym/queries/${id}`, { method: 'POST', body: { body, close } })
      setBody('')
      toast.success(close ? (body ? 'Replied and marked done' : 'Marked done') : 'Reply sent. The member gets a notification.')
      router.refresh()
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : 'Could not send the reply')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="q-staff-reply">
      <textarea className="q-input" rows={2} maxLength={1000} value={body} placeholder={closed ? 'Reopen with a reply' : 'Reply to the member (they see it in their app)'} onChange={(event) => setBody(event.target.value)} />
      <div className="q-staff-actions">
        <button type="button" className="button-link dark small-button" disabled={busy !== null || !body.trim()} onClick={() => send(false)}>
          {busy === 'reply' ? <Loader2 className="spin" /> : <Send />} Reply
        </button>
        {closed ? null : (
          <button type="button" className="button-link outline small-button" disabled={busy !== null} onClick={() => send(true)}>
            {busy === 'close' ? <Loader2 className="spin" /> : <CheckCheck />} {body.trim() ? 'Reply and mark done' : 'Mark done'}
          </button>
        )}
      </div>
    </div>
  )
}
