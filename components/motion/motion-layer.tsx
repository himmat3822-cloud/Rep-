'use client'

import { useEffect, useRef } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { useThemeGuard } from '@/components/theme/theme-toggle'

// Global motion behaviours for every page, wired with event delegation so no
// page has to opt in:
//   1. a lime progress bar while a link navigation is loading
//   2. a cursor spotlight on cards (sets --mx / --my, adds .k-spot)
//   3. numbers in stat cards count up the first time they are on screen
//   4. a ripple where a button is pressed
// All of it is skipped when the visitor prefers reduced motion.

const SPOT = '.panel, .metric-card, .a-card, .price-card, .lead-card, .risk-card, .roster-card, .template-card, .slot-tile, .badge-tile, .pr-tile, .photo-tile, .method-card, .plan-option, .hero-card, .lp-console'
const COUNT = '.metric-copy strong, .pulse-number, .stat-grid strong, .aging-grid strong, .mini-stats strong, .sum-strip strong, .a-card .score, .panel-heading h2, .pay-amount, .price-card .amount, .lp-gauge-value strong'
const RIPPLE = '.btn, .button-link, .lp-btn, .icon-button, .icon-btn, .tabbar a, .nudge-option'

function reducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

// "Rs 1,23,450" / "42%" / "12 days" / "Rs 6,138 this month so far": animate the
// first number, keep everything around it. Times, dates and ranges are left
// alone ("6:00 PM", "12/30", "3-5").
function setupCount(el: HTMLElement) {
  if (el.dataset.kCount) return
  el.dataset.kCount = 'seen'
  if (el.children.length > 1) return
  const text = el.textContent ?? ''
  if (/\d\s*[:/]\s*\d|\d\s*-\s*\d/.test(text)) return
  const match = text.match(/(\d[\d,]*)(\.\d+)?/)
  if (!match || match.index === undefined) return
  const raw = match[1].replace(/,/g, '')
  const target = Number(raw + (match[2] ?? ''))
  if (!Number.isFinite(target) || target < 2) return
  const decimals = match[2] ? match[2].length - 1 : 0
  const grouped = match[1].includes(',')
  const before = text.slice(0, match.index)
  const after = text.slice(match.index + match[0].length)
  const textNode = el.childNodes.length === 1 && el.firstChild?.nodeType === Node.TEXT_NODE ? (el.firstChild as Text) : null
  if (!textNode) return
  const format = (n: number) => (grouped ? n.toLocaleString('en-IN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) : n.toFixed(decimals))
  const duration = Math.min(1400, 600 + Math.log10(target + 1) * 180)
  const start = performance.now()
  const step = (now: number) => {
    const t = Math.min(1, (now - start) / duration)
    const eased = 1 - Math.pow(1 - t, 3)
    textNode.data = `${before}${format(target * eased)}${after}`
    if (t < 1) requestAnimationFrame(step)
    else textNode.data = text
  }
  requestAnimationFrame(step)
}

export function MotionLayer() {
  const pathname = usePathname()
  const search = useSearchParams()
  const bar = useRef<HTMLDivElement>(null)
  const loading = useRef(false)
  useThemeGuard()

  // 1. Route progress: start on internal link clicks, finish when the URL changes.
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      const link = (event.target as Element | null)?.closest('a')
      if (!link || link.target === '_blank' || link.hasAttribute('download')) return
      const href = link.getAttribute('href')
      if (!href || !href.startsWith('/') || href.startsWith('/api/')) return
      const url = new URL(href, window.location.href)
      if (url.pathname === window.location.pathname && url.search === window.location.search) return
      loading.current = true
      bar.current?.classList.remove('is-done')
      bar.current?.classList.add('is-loading')
    }
    document.addEventListener('click', onClick)
    return () => document.removeEventListener('click', onClick)
  }, [])

  useEffect(() => {
    if (!loading.current || !bar.current) return
    loading.current = false
    const el = bar.current
    el.classList.remove('is-loading')
    el.classList.add('is-done')
    const timer = window.setTimeout(() => el.classList.remove('is-done'), 600)
    return () => window.clearTimeout(timer)
  }, [pathname, search])

  // 2 + 4. Spotlight and ripple, by delegation.
  useEffect(() => {
    if (reducedMotion() || !window.matchMedia('(hover: hover)').matches) return
    let frame = 0
    let last: { el: HTMLElement; x: number; y: number } | null = null
    const onMove = (event: PointerEvent) => {
      const card = (event.target as Element | null)?.closest<HTMLElement>(SPOT)
      if (!card) return
      if (!card.classList.contains('k-spot')) card.classList.add('k-spot')
      const rect = card.getBoundingClientRect()
      last = { el: card, x: event.clientX - rect.left, y: event.clientY - rect.top }
      if (!frame)
        frame = requestAnimationFrame(() => {
          frame = 0
          if (!last) return
          last.el.style.setProperty('--mx', `${last.x}px`)
          last.el.style.setProperty('--my', `${last.y}px`)
        })
    }
    document.addEventListener('pointermove', onMove, { passive: true })
    return () => {
      document.removeEventListener('pointermove', onMove)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [])

  useEffect(() => {
    if (reducedMotion()) return
    const onDown = (event: PointerEvent) => {
      const target = (event.target as Element | null)?.closest<HTMLElement>(RIPPLE)
      if (!target || (target as HTMLButtonElement).disabled) return
      const rect = target.getBoundingClientRect()
      const ripple = document.createElement('span')
      ripple.className = 'k-ripple'
      ripple.style.left = `${event.clientX - rect.left}px`
      ripple.style.top = `${event.clientY - rect.top}px`
      target.appendChild(ripple)
      window.setTimeout(() => ripple.remove(), 650)
    }
    document.addEventListener('pointerdown', onDown, { passive: true })
    return () => document.removeEventListener('pointerdown', onDown)
  }, [])

  // 3. Count-up for numbers on each page, once they scroll into view.
  useEffect(() => {
    if (reducedMotion() || !('IntersectionObserver' in window)) return
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          observer.unobserve(entry.target)
          setupCount(entry.target as HTMLElement)
        }
      },
      { threshold: 0.4 },
    )
    const scan = () => document.querySelectorAll<HTMLElement>(COUNT).forEach((el) => !el.dataset.kCount && observer.observe(el))
    const first = window.setTimeout(scan, 60)
    // Pages that load more content later (tabs, filters) get scanned again.
    let pending = 0
    const mutations = new MutationObserver(() => {
      if (!pending) pending = requestAnimationFrame(() => {
        pending = 0
        scan()
      })
    })
    mutations.observe(document.body, { childList: true, subtree: true })
    return () => {
      window.clearTimeout(first)
      if (pending) cancelAnimationFrame(pending)
      mutations.disconnect()
      observer.disconnect()
    }
  }, [pathname])

  return <div ref={bar} className="k-progress" aria-hidden="true" />
}
