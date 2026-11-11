'use client'

import { useEffect, useRef, useState } from 'react'

// "A day at your gym": a real sequence, so the stops are times. As the
// section scrolls through the screen a line fills from the first stop to
// the last and each stop lights up when the line reaches it. With reduced
// motion everything is shown lit, no scroll tracking.

const STOPS = [
  { time: '5:30 AM', title: 'Doors open', text: 'Members show their app QR at the desk or scan the gym QR at the door. No register, no queue.' },
  { time: '10:00 AM', title: 'Dues go out', text: 'Polite WhatsApp reminders in English, Hindi or Punjabi, with a pay link. They stop the moment someone pays.' },
  { time: '6:00 PM', title: 'Peak hour', text: 'Members see how full the gym is before they leave home. You see which hours need a batch or an offer.' },
  { time: '9:00 PM', title: 'Quiet hours', text: 'Nothing is sent to members until 8 AM. Payments and check-ins still work.' },
  { time: '12:05 AM', title: 'Tomorrow is ready', text: 'Memberships renew or expire, streaks update, and the list of members to call is waiting for you.' },
] as const

export function DayTimeline() {
  const ref = useRef<HTMLOListElement>(null)
  const [progress, setProgress] = useState(1)

  useEffect(() => {
    const el = ref.current
    if (!el || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    let frame = 0
    const measure = () => {
      frame = 0
      const rect = el.getBoundingClientRect()
      const view = window.innerHeight
      // 0 when the list's top reaches 80% of the screen, 1 when its bottom reaches 55%.
      const start = view * 0.8
      const end = view * 0.55
      const total = rect.height + (start - end)
      setProgress(Math.min(1, Math.max(0, (start - rect.top) / total)))
    }
    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(measure)
    }
    measure()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      if (frame) window.cancelAnimationFrame(frame)
    }
  }, [])

  return (
    <ol ref={ref} className="lp-day" style={{ ['--p' as string]: progress }}>
      <span className="lp-day-rail" aria-hidden="true">
        <span />
      </span>
      {STOPS.map((stop, i) => {
        const lit = progress >= i / (STOPS.length - 1) - 0.02
        return (
          <li key={stop.time} className={lit ? 'lit' : ''}>
            <span className="lp-day-dot" aria-hidden="true" />
            <time>{stop.time}</time>
            <h3>{stop.title}</h3>
            <p>{stop.text}</p>
          </li>
        )
      })}
    </ol>
  )
}
