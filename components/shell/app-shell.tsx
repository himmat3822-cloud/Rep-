'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState, type ReactNode } from 'react'
import { AlertTriangle, LogOut, Menu, Search, Sparkles, X } from 'lucide-react'
import { toast } from 'sonner'
import { Brand, initials } from '@/components/brand'
import { NAV_ICONS, type NavIconKey } from './nav-icons'
import { StaffBell } from './staff-bell'
import { ThemeToggle } from '@/components/theme/theme-toggle'
import { GymBackdrop } from '@/components/theme/gym-backdrop'

export interface NavItem {
  label: string
  href: string
  icon: NavIconKey
  ready: boolean
  count?: number
}

export interface NavSection {
  title?: string
  items: NavItem[]
}

export interface AppShellProps {
  workspace: string
  kicker: string
  title: string
  sections: NavSection[]
  bottom?: NavItem[]
  profile: { name: string; subtitle: string }
  logout: 'staff' | 'admin'
  banner?: { tone: 'warning' | 'trial'; text: string } | null
  impersonation?: { adminName: string; mode: 'read' | 'write' } | null
  children: ReactNode
}

function NavLink({ item, active, onNavigate }: { item: NavItem; active: boolean; onNavigate: () => void }) {
  const Icon = NAV_ICONS[item.icon]
  if (!item.ready) {
    return (
      <a className="nav-soon" aria-disabled="true" title="Coming in a later phase">
        <Icon />
        {item.label}
        <span className="nav-count">soon</span>
      </a>
    )
  }
  return (
    <Link href={item.href} className={active ? 'nav-active' : ''} onClick={onNavigate}>
      <Icon />
      {item.label}
      {item.count ? <span className="nav-count">{item.count}</span> : null}
    </Link>
  )
}

// Search goes to the people list of the current workspace.
function searchHref(pathname: string): string {
  if (pathname.startsWith('/admin')) return '/admin/gyms'
  if (pathname.startsWith('/trainer')) return '/trainer/athletes'
  if (pathname.startsWith('/desk')) return '/desk/members'
  return '/owner/members'
}

export function AppShell({ workspace, kicker, title, sections, bottom = [], profile, logout, banner, impersonation, children }: AppShellProps) {
  const pathname = usePathname()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [leaving, setLeaving] = useState(false)

  // Mobile drawer: lock the page behind it and close on Escape.
  useEffect(() => {
    if (!open) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = previous
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  async function signOut() {
    setLeaving(true)
    const url = logout === 'admin' ? '/api/admin/auth/logout' : '/api/auth/logout?as=staff'
    const response = await fetch(url, { method: 'POST' }).catch(() => null)
    if (!response?.ok) {
      setLeaving(false)
      toast.error('Could not log out. Check your connection and try again.')
      return
    }
    toast.success('Logged out')
    router.replace(logout === 'admin' ? '/admin/login' : '/login')
    router.refresh()
  }

  async function exitImpersonation() {
    const response = await fetch('/api/admin/impersonate/stop', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).catch(() => null)
    const data = response?.ok ? ((await response.json()) as { redirectTo: string }) : null
    router.replace(data?.redirectTo ?? '/admin/login')
    router.refresh()
  }

  // Section roots (/owner, /admin ...) are only active on their exact path.
  const isActive = (href: string) => pathname === href || (href.split('/').filter(Boolean).length > 1 && pathname.startsWith(`${href}/`))

  return (
    <main className="kasrat-app">
      {open ? <button type="button" className="sidebar-scrim" aria-label="Close menu" onClick={() => setOpen(false)} /> : null}
      <aside className={`sidebar ${open ? 'sidebar-open' : ''}`}>
        <Brand />
        <div className="workspace-label">{workspace}</div>
        {sections.map((section, index) => (
          <div key={section.title ?? index}>
            {section.title ? <div className="nav-section">{section.title}</div> : null}
            <nav>
              {section.items.map((item) => (
                <NavLink key={item.href} item={item} active={isActive(item.href)} onNavigate={() => setOpen(false)} />
              ))}
            </nav>
          </div>
        ))}
        <div className="sidebar-bottom">
          {bottom.map((item) => (
            <NavLink key={item.href} item={item} active={isActive(item.href)} onNavigate={() => setOpen(false)} />
          ))}
          <div className="profile">
            <div className="profile-avatar">{initials(profile.name)}</div>
            <div>
              <strong>{profile.name}</strong>
              <span>{profile.subtitle}</span>
            </div>
            <button type="button" onClick={signOut} disabled={leaving} aria-label="Log out" title="Log out">
              <LogOut />
            </button>
          </div>
        </div>
      </aside>
      <div className="app-main">
        <GymBackdrop />
        <header className="topbar">
          <button className="mobile-menu" type="button" onClick={() => setOpen(!open)} aria-label="Toggle menu">
            {open ? <X /> : <Menu />}
          </button>
          <div>
            <p className="top-kicker">{kicker}</p>
            <h2>{title}</h2>
          </div>
          <div className="top-actions">
            <Link className="icon-button" href={searchHref(pathname)} aria-label="Find a person" title="Find a person">
              <Search />
            </Link>
            <ThemeToggle />
            {logout === 'admin' ? null : <StaffBell />}
            <div className="top-avatar">{initials(profile.name)}</div>
          </div>
        </header>
        {impersonation ? (
          <div className="impersonation-bar">
            <span>
              <strong>{impersonation.adminName}</strong> is viewing as {profile.name} - {impersonation.mode === 'read' ? 'read-only' : 'write mode, every change is logged'}
            </span>
            <button type="button" onClick={exitImpersonation}>
              Exit impersonation
            </button>
          </div>
        ) : null}
        {banner ? (
          <div className={`status-banner ${banner.tone === 'trial' ? 'trial' : ''}`}>
            {banner.tone === 'trial' ? <Sparkles /> : <AlertTriangle />}
            {banner.text}
          </div>
        ) : null}
        <div className="content-wrap">{children}</div>
      </div>
    </main>
  )
}