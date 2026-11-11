'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Bell } from 'lucide-react'

// Bell in the staff top bar: new referrals, enquiries, UPI claims, freeze
// requests, disputed PT sessions, follow-ups due. Polls every 2 minutes
// while the tab is visible.

interface Item {
  id: string
  title: string
  body: string
  href: string | null
  readAt: string | null
  createdAt: string
}

function ago(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' })
}

export function StaffBell() {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<Item[]>([])
  const [unread, setUnread] = useState(0)
  const [loaded, setLoaded] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  async function load() {
    const response = await fetch('/api/gym/notifications', { cache: 'no-store' }).catch(() => null)
    if (!response?.ok) return
    const data = (await response.json()) as { items: Item[]; unread: number }
    setItems(data.items)
    setUnread(data.unread)
    setLoaded(true)
  }

  useEffect(() => {
    void load()
    const timer = window.setInterval(() => document.visibilityState === 'visible' && void load(), 120000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === 'Escape' : !box.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', close)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', close)
    }
  }, [open])

  async function markRead() {
    setUnread(0)
    setItems((list) => list.map((item) => ({ ...item, readAt: item.readAt ?? new Date().toISOString() })))
    await fetch('/api/gym/notifications', { method: 'POST' }).catch(() => null)
  }

  return (
    <div className="k-bell" ref={box}>
      <button className="icon-button" type="button" aria-label={`Notifications${unread ? `, ${unread} new` : ''}`} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <Bell />
        {unread ? <span className="k-bell-dot" aria-hidden="true" /> : null}
      </button>
      {open ? (
        <div className="k-bell-pop" role="dialog" aria-label="Notifications">
          <header>
            <span>Notifications</span>
            {unread ? (
              <button type="button" onClick={markRead}>
                Mark all read
              </button>
            ) : null}
          </header>
          {!loaded ? <p className="k-bell-empty">Loading...</p> : null}
          {loaded && items.length === 0 ? <p className="k-bell-empty">Nothing new. Referrals, enquiries, payment claims and follow-ups show up here.</p> : null}
          <ul>
            {items.map((item) => {
              const inner = (
                <>
                  <strong>{item.title}</strong>
                  <small>{item.body}</small>
                  <time dateTime={item.createdAt}>{ago(item.createdAt)}</time>
                </>
              )
              return (
                <li key={item.id} className={item.readAt ? '' : 'unread'}>
                  {item.href ? (
                    <Link href={item.href} onClick={() => setOpen(false)}>
                      {inner}
                    </Link>
                  ) : (
                    <div>{inner}</div>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      ) : null}
    </div>
  )
}
