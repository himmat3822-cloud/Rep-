'use client'

import { useState } from 'react'
import { Check, Loader2, X } from 'lucide-react'
import { api } from '@/lib/api/client'
import { useAction } from '@/components/admin/use-action'

// Confirm / reject buttons for member UPI claims and freeze requests.
export function ClaimActions({ id }: { id: string }) {
  const { run, pending } = useAction()
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState('Payment not found in the bank account')
  if (rejecting) {
    return (
      <div className="reject-box">
        <input value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} aria-label="Reason" />
        <button type="button" className="btn btn-outline btn-sm" disabled={pending} onClick={() => setRejecting(false)}>
          Back
        </button>
        <button type="button" className="btn btn-dark btn-sm" disabled={pending || reason.trim().length < 3} onClick={() => run(() => api(`/api/gym/claims/${id}/reject`, { method: 'POST', body: { reason } }), 'Member told the payment was not found')}>
          Reject
        </button>
      </div>
    )
  }
  return (
    <div className="row-actions">
      <button type="button" className="btn btn-lime btn-sm" disabled={pending} title="The money is in your bank: record the payment and send the invoice" onClick={() => run(() => api(`/api/gym/claims/${id}/approve`, { method: 'POST' }), 'Payment recorded, invoice sent to the member')}>
        {pending ? <Loader2 className="spin" /> : <Check />} Confirm
      </button>
      <button type="button" className="btn btn-outline btn-sm" disabled={pending} onClick={() => setRejecting(true)}>
        <X /> Not received
      </button>
    </div>
  )
}

export function FreezeActions({ id }: { id: string }) {
  const { run, pending } = useAction()
  return (
    <div className="row-actions">
      <button type="button" className="btn btn-dark btn-sm" disabled={pending} onClick={() => run(() => api(`/api/gym/freeze-requests/${id}/approve`, { method: 'POST' }), 'Freeze approved, end date moved')}>
        {pending ? <Loader2 className="spin" /> : <Check />} Approve
      </button>
      <button type="button" className="btn btn-outline btn-sm" disabled={pending} onClick={() => run(() => api(`/api/gym/freeze-requests/${id}/reject`, { method: 'POST' }), 'Request declined')}>
        <X /> Decline
      </button>
    </div>
  )
}
