'use client'

import { Loader2, RefreshCw } from 'lucide-react'
import { api } from '@/lib/api/client'
import { useAction } from './use-action'

interface Summary {
  checked: number
  changed: number
  reminders: number
}

export function BillingRunButton() {
  const { run, pending } = useAction()
  return (
    <button
      className="btn btn-dark"
      type="button"
      disabled={pending}
      onClick={() => run(() => api<Summary>('/api/admin/billing/run', { method: 'POST', session: 'admin' }), (s) => `Checked ${s.checked} gyms: ${s.changed} changed, ${s.reminders} reminder(s) sent`)}
    >
      {pending ? <Loader2 className="animate-spin" /> : <RefreshCw />} Run billing check now
    </button>
  )
}
