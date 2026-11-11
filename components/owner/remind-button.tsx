'use client'

import { Loader2, Send } from 'lucide-react'
import { api } from '@/lib/api/client'
import { useAction } from '@/components/admin/use-action'

// "Remind now" on the dues list - one WhatsApp reminder per due per day.
export function RemindButton({ dueId, disabled, reason }: { dueId: string; disabled?: boolean; reason?: string }) {
  const { run, pending } = useAction()
  return (
    <button
      type="button"
      className="btn btn-outline btn-sm"
      disabled={pending || disabled}
      title={reason ?? 'Send a WhatsApp reminder with the pay link now'}
      onClick={() => run(() => api(`/api/gym/dues/${dueId}/remind`, { method: 'POST' }), 'Reminder sent on WhatsApp')}
    >
      {pending ? <Loader2 className="spin" /> : <Send />} Remind
    </button>
  )
}
