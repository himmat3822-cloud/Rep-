'use client'

import Link from 'next/link'
import { ThemeToggle } from '@/components/theme/theme-toggle'
import { GymBackdrop } from '@/components/theme/gym-backdrop'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState, type ReactNode } from 'react'
import { Bell, CalendarDays, Home, LineChart, LogOut, User, Wallet } from 'lucide-react'
import { toast } from 'sonner'
import { Brand } from '@/components/brand'
import { api, ApiClientError } from '@/lib/api/client'
import { LANGUAGES, translate, type Lang } from '@/lib/i18n'
import { PwaBoot, clearOfflineCache } from './pwa'

// Athlete app frame: top bar (language, notifications, logout) + bottom tabs.
const TABS = [
  { key: 'home', icon: Home, path: '' },
  { key: 'schedule', icon: CalendarDays, path: '/schedule' },
  { key: 'progress', icon: LineChart, path: '/progress' },
  { key: 'pay', icon: Wallet, path: '/pay' },
  { key: 'profile', icon: User, path: '/profile' },
] as const

export function AthleteChrome({ slug, lang, children }: { slug: string; lang: Lang; children: ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const [current, setCurrent] = useState<Lang>(lang)
  const [unread, setUnread] = useState(0)
  const base = `/g/${slug}`

  useEffect(() => {
    api<{ unread: number }>(`/api/g/${slug}/me/notifications`, { session: 'athlete' })
      .then((data) => setUnread(data.unread))
      .catch(() => null)
  }, [slug, pathname])

  async function changeLanguage(next: Lang) {
    const previous = current
    setCurrent(next)
    try {
      await api(`/api/g/${slug}/me/language`, { method: 'PATCH', body: { language: next }, session: 'athlete' })
      document.cookie = `k_lang=${next}; path=/; max-age=31536000; samesite=lax`
      router.refresh()
    } catch (error) {
      setCurrent(previous)
      toast.error(error instanceof ApiClientError ? error.message : 'Could not change language')
    }
  }

  async function logout() {
    clearOfflineCache()
    await fetch('/api/auth/logout?as=athlete', { method: 'POST' }).catch(() => null)
    router.replace(`${base}/login`)
    router.refresh()
  }

  return (
    <div className="athlete-app">
      <GymBackdrop variant="member" />
      <PwaBoot slug={slug} offlineLabel={translate(current, 'nav', 'offline')} />
      <div className="athlete-top">
        <Link href={base} aria-label="Home">
          <Brand />
        </Link>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <div className="lang-toggle" role="group" aria-label="Language">
            {LANGUAGES.map((option) => (
              <button key={option.code} type="button" className={current === option.code ? 'active' : ''} onClick={() => changeLanguage(option.code)} title={option.label}>
                {option.code}
              </button>
            ))}
          </div>
          <ThemeToggle />
          <Link href={`${base}/notifications`} className="icon-button bell" aria-label={translate(current, 'nav', 'notifications')}>
            <Bell />
            {unread > 0 ? <span className="bell-count">{unread > 9 ? '9+' : unread}</span> : null}
          </Link>
          <button type="button" className="icon-button" onClick={logout} aria-label="Log out">
            <LogOut />
          </button>
        </div>
      </div>
      <div className="athlete-content">{children}</div>
      <nav className="tabbar" aria-label="Main">
        {TABS.map((tab) => {
          const Icon = tab.icon
          const href = `${base}${tab.path}`
          const active = tab.path === '' ? pathname === base : pathname.startsWith(href)
          return (
            <Link key={tab.key} href={href} className={active ? 'tab-active' : ''}>
              <Icon />
              {translate(current, 'nav', tab.key)}
            </Link>
          )
        })}
      </nav>
    </div>
  )
}
