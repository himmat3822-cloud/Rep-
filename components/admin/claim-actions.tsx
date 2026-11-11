'use client'

import { Check, X } from 'lucide-react'
import { api } from '@/lib/api/client'
import { useAction } from './use-action'

export function ClaimActions({ claimId }: { claimId: string }) {
  const { run, pending } = useAction()
  function decide(action: 'approve' | 'reject') {
    const reason = window.prompt(action === 'approve' ? 'Note (e.g. "Seen in HDFC statement")' : 'Why reject? The owner will see this.')
    if (!reason || reason.trim().length < 3) return
    void run(() => api<{ status: string; invoiceNumber?: string }>(`/api/admin/claims/${claimId}`, { method: 'POST', body: { action, reason }, session: 'admin' }), (r) => (r.status === 'APPROVED' ? `Approved, invoice ${r.invoiceNumber}` : 'Rejected'))
  }
  return (
    <span className="toolbar">
      <button className="btn btn-lime btn-sm" type="button" disabled={pending} onClick={() => decide('approve')}>
        <Check /> Approve
      </button>
      <button className="btn btn-outline btn-sm" type="button" disabled={pending} onClick={() => decide('reject')}>
        <X /> Reject
      </button>
    </span>
  )
}
