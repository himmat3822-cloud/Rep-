'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createContext, useContext, useEffect, useLayoutEffect, useState, type ReactNode } from 'react'
import { AlertTriangle, LogOut, Menu, Search, Sparkles, X, ArrowLeftRight } from 'lucide-react'
import { toast } from 'sonner'
import { Brand, initials } from '@/components/brand'
import { NAV_ICONS, type NavIconKey } from './nav-icons'
import { StaffBell } from './staff-bell'
import { ThemeToggle } from '@/components/theme/theme-toggle'
import { GymBackdrop } from '@/components/theme/gym-backdrop'

// The staff/admin frame (sidebar, top bar, animated backdrop).
//
// Speed: app/owner, app/desk and app/trainer each have a layout.tsx that
// renders <ShellFrame> once. Layouts stay mounted while you move between
// pages, so a click only swaps the page content (the loading.tsx skeleton
// shows instantly, then the real page). Pages still render <AppShell ...>;
// inside a frame it only reports its title and nav to the frame and renders
// the content. Outside a frame (admin pages) it renders the whole frame
// itself, exactly as before.

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
  // Owner who also trains, with separate dashboards: one tap to the other.
  switchTo?: { label: string; short: string; href: string } | null
  banner?: { tone: 'warning' | 'trial'; text: string } | null
  impersonation?: { adminName: string; mode: 'read' | 'write' } | null
  children: ReactNode
}

export type FrameProps = Omit<AppShellProps, 'children' | 'banner' | 'impersonation'>

type Reported = { path: string; props: FrameProps }
const FrameContext = createContext<{ report: (value: Reported) => void } | null>(null)

// Printable pages render without the frame.
const BARE_PATHS = [/\/poster\//]

function NavLink({ item, active, onNavigate }: { item: NavItem; active: boolean; onNavigate: () => void }) {
  const Icon = NAV_ICONS[item.icon]
  if (!item.ready) {
    return (
      <a className="nav-soon" aria-disabled="true" title="Coming soon">
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

// Section roots (/owner, /admin ...) are only active on their exact path.
function isActiveFor(pathname: string, href: string): boolean {
  return pathname === href || (href.split('/').filter(Boolean).length > 1 && pathname.startsWith(`${href}/`))
}

// While a page is still loading, the top bar shows the nav label of the
// link that was clicked, so the title changes the moment you click.
function navTitle(pathname: string, props: FrameProps): string | null {
  const items = [...props.sections.flatMap((section) => section.items), ...(props.bottom ?? [])]
  let best: NavItem | null = null
  for (const item of items) {
    if (!isActiveFor(pathname, item.href)) continue
    if (!best || item.href.length > best.href.length) best = item
  }
  return best?.label ?? null
}

export function ShellFrame({ initial, children }: { initial: FrameProps; children: ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const [reported, setReported] = useState<Reported | null>(null)
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

  if (BARE_PATHS.some((pattern) => pattern.test(pathname))) {
    return <FrameContext.Provider value={{ report: () => undefined }}>{children}</FrameContext.Provider>
  }

  const props = reported?.props ?? initial
  const current = reported?.path === pathname
  const title = current ? props.title : (navTitle(pathname, props) ?? props.title)
  const kicker = current ? props.kicker : initial.kicker
  const { workspace, sections, bottom = [], profile, logout, switchTo = null } = props

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

  const close = () => setOpen(false)

  return (
    <FrameContext.Provider value={{ report: setReported }}>
      <main className="kasrat-app">
        {open ? <button type="button" className="sidebar-scrim" aria-label="Close menu" onClick={close} /> : null}
        <aside className={`sidebar ${open ? 'sidebar-open' : ''}`}>
          <Brand />
          <div className="workspace-label">{workspace}</div>
          {switchTo ? (
            <Link className="switch-side" href={switchTo.href} onClick={close}>
              <ArrowLeftRight /> Switch to {switchTo.label}
            </Link>
          ) : null}
          {sections.map((section, index) => (
            <div key={section.title ?? index}>
              {section.title ? <div className="nav-section">{section.title}</div> : null}
              <nav>
                {section.items.map((item) => (
                  <NavLink key={item.href} item={item} active={isActiveFor(pathname, item.href)} onNavigate={close} />
                ))}
              </nav>
            </div>
          ))}
          <div className="sidebar-bottom">
            {bottom.map((item) => (
              <NavLink key={item.href} item={item} active={isActiveFor(pathname, item.href)} onNavigate={close} />
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
              <h2 key={title}>{title}</h2>
            </div>
            <div className="top-actions">
              {switchTo ? (
                <Link className="switch-pill" href={switchTo.href} aria-label={`Switch to ${switchTo.label}`} title={`Switch to ${switchTo.label}`}>
                  <ArrowLeftRight />
                  <span className="switch-long">{switchTo.label}</span>
                  <span className="switch-short">{switchTo.short}</span>
                </Link>
              ) : null}
              <Link className="icon-button" href={searchHref(pathname)} aria-label="Find a person" title="Find a person">
                <Search />
              </Link>
              <ThemeToggle />
              {logout === 'admin' ? null : <StaffBell />}
              <div className="top-avatar">{initials(profile.name)}</div>
            </div>
          </header>
          {children}
        </div>
      </main>
    </FrameContext.Provider>
  )
}

function PageBars({ banner, impersonation, profileName }: { banner?: AppShellProps['banner']; impersonation?: AppShellProps['impersonation']; profileName: string }) {
  const router = useRouter()
  async function exitImpersonation() {
    const response = await fetch('/api/admin/impersonate/stop', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).catch(() => null)
    const data = response?.ok ? ((await response.json()) as { redirectTo: string }) : null
    router.replace(data?.redirectTo ?? '/admin/login')
    router.refresh()
  }
  return (
    <>
      {impersonation ? (
        <div className="impersonation-bar">
          <span>
            <strong>{impersonation.adminName}</strong> is viewing as {profileName} - {impersonation.mode === 'read' ? 'read-only' : 'write mode, every change is logged'}
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
    </>
  )
}

function FramedPage({ props, report }: { props: AppShellProps; report: (value: Reported) => void }) {
  const pathname = usePathname()
  const { children, banner, impersonation, ...frame } = props
  const key = JSON.stringify(frame)
  useLayoutEffect(() => {
    report({ path: pathname, props: JSON.parse(key) as FrameProps })
  }, [pathname, key, report])
  return (
    <>
      <PageBars banner={banner} impersonation={impersonation} profileName={frame.profile.name} />
      <div className="content-wrap">{children}</div>
    </>
  )
}

export function AppShell(props: AppShellProps) {
  const frame = useContext(FrameContext)
  if (frame) return <FramedPage props={props} report={frame.report} />
  const { children, banner, impersonation, ...initial } = props
  void children
  void banner
  void impersonation
  return (
    <ShellFrame initial={initial}>
      <AppShell {...props} />
    </ShellFrame>
  )
}

// Skeleton shown by loading.tsx inside a frame while the next page loads.
export function PageSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="content-wrap" aria-busy="true" aria-label="Loading">
      <div className="k-skel-grid">
        <div className="k-skel k-skel-hero" />
        <div className="k-skel k-skel-side" />
      </div>
      <div className="k-skel-row">
        <div className="k-skel k-skel-card" />
        <div className="k-skel k-skel-card" />
        <div className="k-skel k-skel-card" />
      </div>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="k-skel k-skel-line" />
      ))}
    </div>
  )
}
