'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Archive, ArchiveRestore, Search } from 'lucide-react'
import { api, ApiClientError } from '@/lib/api/client'
import { useAction } from '@/components/admin/use-action'
import { formatInr } from '@/lib/money'

export function ArchiveButton({ memberId, archived }: { memberId: string; archived: boolean }) {
  const { run, pending } = useAction()
  return (
    <button
      className={archived ? 'btn btn-outline' : 'btn btn-danger'}
      type="button"
      disabled={pending}
      onClick={() => {
        if (!archived && !window.confirm('Archive this member? They will not count toward your plan limit and cannot log in. You can restore them later.')) return
        void run(() => api(`/api/gym/members/${memberId}/archive`, { method: 'POST', body: { archived: !archived } }), archived ? 'Member restored' : 'Member archived')
      }}
    >
      {archived ? <ArchiveRestore /> : <Archive />} {archived ? 'Restore' : 'Archive'}
    </button>
  )
}

interface SearchRow {
  id: string
  name: string
  phone: string
  memberCode: string
  status: string
  planName: string | null
  endsAt: string | null
  duePaise: number
}

// Live search for the "Collect payment" counter screen.
export function MemberSearch({ base, label }: { base: string; label: string }) {
  const [q, setQ] = useState('')
  const [rows, setRows] = useState<SearchRow[]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    if (q.trim().length < 2) {
      setRows([])
      return
    }
    const timer = setTimeout(() => {
      api<{ rows: SearchRow[] }>(`/api/gym/members?q=${encodeURIComponent(q.trim())}`)
        .then((result) => {
          setRows(result.rows)
          setError('')
        })
        .catch((err) => setError(err instanceof ApiClientError ? err.message : 'Search failed'))
    }, 250)
    return () => clearTimeout(timer)
  }, [q])

  return (
    <section className="panel">
      <div className="field" style={{ marginBottom: 0 }}>
        <label htmlFor="member-search">
          <Search size={12} /> Find {label.toLowerCase()} by name, phone or member ID
        </label>
        <input id="member-search" autoFocus value={q} onChange={(event) => setQ(event.target.value)} placeholder="e.g. Arjun or 98765 or FF1001" />
      </div>
      {error ? <p className="field-error">{error}</p> : null}
      <div className="search-results">
        {rows.map((row) => (
          <Link key={row.id} href={`${base}/members/${row.id}?sell=1`}>
            <span>
              <strong>{row.name}</strong>
              <br />
              <small>
                {row.memberCode} - {row.phone} - {row.planName ?? 'no plan'}
                {row.endsAt ? ` till ${new Date(row.endsAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}` : ''}
              </small>
            </span>
            {row.duePaise > 0 ? <span className="badge badge-orange">Due {formatInr(row.duePaise)}</span> : <span className="badge badge-lime">No dues</span>}
          </Link>
        ))}
        {q.trim().length >= 2 && rows.length === 0 && !error ? <p className="muted">No match. Use Quick add for a new person.</p> : null}
      </div>
    </section>
  )
}
