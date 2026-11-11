'use client'

import { useEffect, useState } from 'react'
import { Moon, Sun } from 'lucide-react'

// Day / night switch. The choice is kept in localStorage; until someone
// picks, Rep+ follows the phone or computer setting. THEME_SCRIPT runs
// before the page paints, so there is no white flash at night.
//
// <ThemeToggle /> sits in the dashboard and member-app top bars.
// <ThemeToggle floating /> is mounted once in the root layout and shows
// bottom-right on pages without a top bar (landing, login, pay links).

export const THEME_KEY = 'kasrat-theme'

export const THEME_SCRIPT = `(function(){try{var s=localStorage.getItem('${THEME_KEY}');var d=s?s==='dark':window.matchMedia('(prefers-color-scheme: dark)').matches;document.documentElement.dataset.theme=d?'dark':'light';}catch(e){document.documentElement.dataset.theme='light';}})();`

type Theme = 'light' | 'dark'

export function preferredTheme(): Theme {
  try {
    const saved = localStorage.getItem(THEME_KEY)
    if (saved === 'dark' || saved === 'light') return saved
  } catch {
    // fall through to the system setting
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

// React can re-create <html> (for example after recovering from an error)
// and drop the attribute; put it back whenever that happens.
export function useThemeGuard() {
  useEffect(() => {
    const root = document.documentElement
    const fix = () => {
      const want = preferredTheme()
      if (root.dataset.theme !== want) root.dataset.theme = want
    }
    fix()
    const observer = new MutationObserver(fix)
    observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] })
    return () => observer.disconnect()
  }, [])
}

function current(): Theme {
  return typeof document !== 'undefined' && document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'
}

export function ThemeToggle({ floating = false }: { floating?: boolean }) {
  const [theme, setTheme] = useState<Theme>('light')

  useEffect(() => {
    setTheme(current())
    // Follow the system setting live, unless the person picked a theme.
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => {
      try {
        if (localStorage.getItem(THEME_KEY)) return
      } catch {
        return
      }
      document.documentElement.dataset.theme = media.matches ? 'dark' : 'light'
    }
    media.addEventListener('change', onChange)
    // Stay in sync with the other switch on the page and the guard.
    const observer = new MutationObserver(() => setTheme(current()))
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => {
      media.removeEventListener('change', onChange)
      observer.disconnect()
    }
  }, [])

  function toggle() {
    const next: Theme = current() === 'dark' ? 'light' : 'dark'
    const root = document.documentElement
    // A short cross-fade while every colour changes at once.
    root.classList.add('k-theme-switching')
    try {
      localStorage.setItem(THEME_KEY, next)
    } catch {
      // private mode: the switch still works for this visit
    }
    root.dataset.theme = next
    window.setTimeout(() => root.classList.remove('k-theme-switching'), 450)
    setTheme(next)
  }

  const dark = theme === 'dark'
  return (
    <button
      type="button"
      role="switch"
      aria-checked={dark}
      className={`k-switch ${dark ? 'is-dark' : ''} ${floating ? 'k-switch-floating' : ''}`}
      onClick={toggle}
      aria-label="Night mode"
      title={dark ? 'Switch to day mode' : 'Switch to night mode'}
    >
      <span className="k-switch-track" aria-hidden="true">
        <Sun className="k-switch-sun" />
        <Moon className="k-switch-moon" />
        <span className="k-switch-knob" />
      </span>
      <span className="k-switch-label" aria-hidden="true">
        {dark ? 'Night' : 'Day'}
      </span>
    </button>
  )
}
