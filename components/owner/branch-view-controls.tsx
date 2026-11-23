'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Columns2, Loader2, MapPin, SquareStack } from 'lucide-react'
import { toast } from 'sonner'
import { api, ApiClientError } from '@/lib/api/client'

// Owner's dashboard style (two choices) and the branch cards to open one.

type Mode = 'combined' | 'separate'

const STYLES: { mode: Mode; title: string; text: string; Icon: typeof Columns2 }[] = [
  { mode: 'combined', title: 'All branches together', text: 'Every page shows all branches at once. The overview puts your branches side by side, and lists can be filtered by branch.', Icon: Columns2 },
  { mode: 'separate', title: 'One branch at a time', text: 'Pick a branch first. Every page then shows only that branch until you switch.', Icon: SquareStack },
]

function failMessage(error: unknown) {
  return error instanceof ApiClientError ? error.message : 'Could not save. Check your internet and try again.'
}

export function DashboardStylePicker({ mode }: { mode: Mode }) {
  const router = useRouter()
  const [busy, setBusy] = useState<Mode | null>(null)
  const choose = async (next: Mode) => {
    if (next === mode || busy) return
    setBusy(next)
    try {
      await api('/api/gym/branch-view', { method: 'PATCH', body: { mode: next } })
      toast.success(next === 'separate' ? 'Now pick a branch to open' : 'Showing all branches together')
      router.refresh()
    } catch (error) {
      toast.error(failMessage(error))
    } finally {
      setBusy(null)
    }
  }
  return (
    <div className="bv-styles" role="radiogroup" aria-label="Dashboard style">
      {STYLES.map(({ mode: value, title, text, Icon }) => (
        <button key={value} type="button" role="radio" aria-checked={mode === value} className={`bv-style ${mode === value ? 'on' : ''}`} onClick={() => choose(value)} disabled={Boolean(busy)}>
          <span className="bv-style-icon">{busy === value ? <Loader2 className="spin" /> : <Icon />}</span>
          <span className="bv-style-text">
            <strong>{title}</strong>
            <span>{text}</span>
          </span>
        </button>
      ))}
    </div>
  )
}

export function OpenBranchButton({ branchId, label, current }: { branchId: string; label: string; current: boolean }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const open = async () => {
    if (busy) return
    setBusy(true)
    try {
      await api('/api/gym/branch-view', { method: 'POST', body: { branchId } })
      router.push('/owner')
      router.refresh()
    } catch (error) {
      toast.error(failMessage(error))
      setBusy(false)
    }
  }
  return (
    <button type="button" className={current ? 'btn btn-outline btn-block' : 'btn btn-lime btn-block'} onClick={open} disabled={busy}>
      {busy ? <Loader2 className="spin" /> : <MapPin />} {current ? `Open ${label} again` : `Open ${label}`}
    </button>
  )
}
