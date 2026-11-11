'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { BellRing, CheckCircle2, Flame, IndianRupee, QrCode } from 'lucide-react'

// The hero's live console: what an owner's phone looks like at 6 PM.
// Demo data only. Every timer stops when the visitor prefers reduced motion
// or the tab is hidden, so it costs nothing in the background.

const EVENTS = [
  { icon: QrCode, who: 'Simran K.', what: 'checked in with QR', tone: 'lime' },
  { icon: IndianRupee, who: 'Arjun S.', what: 'paid Rs 2,500 by UPI', tone: 'lime' },
  { icon: BellRing, who: 'Gurpreet M.', what: 'got a reminder in Punjabi', tone: 'sky' },
  { icon: Flame, who: 'Harleen G.', what: 'hit a 13-day streak', tone: 'orange' },
  { icon: QrCode, who: 'Rohit B.', what: 'checked in at the desk', tone: 'lime' },
  { icon: CheckCircle2, who: 'Neha A.', what: 'confirmed her PT session', tone: 'sky' },
  { icon: QrCode, who: 'Kabir G.', what: 'checked in with QR', tone: 'lime' },
  { icon: IndianRupee, who: 'Priya J.', what: 'renewed 3 months early', tone: 'lime' },
] as const

const CROWD = [42, 46, 51, 55, 58, 54, 49, 45]
const QR_SIZE = 21

// Small deterministic generator so server and client draw the same first QR.
function qrCells(seed: number): boolean[] {
  let x = seed * 2654435761 || 1
  const cells: boolean[] = []
  for (let i = 0; i < QR_SIZE * QR_SIZE; i += 1) {
    x ^= x << 13
    x ^= x >>> 17
    x ^= x << 5
    cells.push((x >>> 0) % 100 < 46)
  }
  // Finder squares in three corners, like a real QR code.
  // Each finder gets a one-cell blank border around it.
  const finder = (r0: number, c0: number) => {
    for (let r = -1; r <= 7; r += 1)
      for (let c = -1; c <= 7; c += 1) {
        const row = r0 + r
        const col = c0 + c
        if (row < 0 || col < 0 || row >= QR_SIZE || col >= QR_SIZE) continue
        const inSquare = r >= 0 && r <= 6 && c >= 0 && c <= 6
        const edge = r === 0 || r === 6 || c === 0 || c === 6
        const core = r >= 2 && r <= 4 && c >= 2 && c <= 4
        cells[row * QR_SIZE + col] = inSquare && (edge || core)
      }
  }
  finder(0, 0)
  finder(0, QR_SIZE - 7)
  finder(QR_SIZE - 7, 0)
  return cells
}

function useLiveTimers(): boolean {
  const [live, setLive] = useState(false)
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setLive(!media.matches && document.visibilityState === 'visible')
    update()
    media.addEventListener('change', update)
    document.addEventListener('visibilitychange', update)
    return () => {
      media.removeEventListener('change', update)
      document.removeEventListener('visibilitychange', update)
    }
  }, [])
  return live
}

export function LiveFloor() {
  const live = useLiveTimers()
  const [tick, setTick] = useState(0)
  const [qrSeed, setQrSeed] = useState(7)
  const [seconds, setSeconds] = useState(15)
  const started = useRef(false)

  useEffect(() => {
    if (!live) return
    started.current = true
    const feed = window.setInterval(() => setTick((t) => t + 1), 2400)
    const clock = window.setInterval(() => {
      setSeconds((s) => {
        if (s <= 1) {
          setQrSeed((q) => q + 1)
          return 15
        }
        return s - 1
      })
    }, 1000)
    return () => {
      window.clearInterval(feed)
      window.clearInterval(clock)
    }
  }, [live])

  const rows = useMemo(() => Array.from({ length: 4 }, (_, i) => ({ key: tick - i, ...EVENTS[(((tick - i) % EVENTS.length) + EVENTS.length) % EVENTS.length] })), [tick])
  const cells = useMemo(() => qrCells(qrSeed), [qrSeed])
  const crowd = CROWD[Math.floor(tick / 2) % CROWD.length]
  const arc = 2 * Math.PI * 52 * 0.75
  const inside = Math.round(crowd * 1.2)
  const checkIns = 186 + tick

  return (
    <div className="lp-console" aria-label="Example of the owner's live view">
      <div className="lp-console-head">
        <span className="lp-pulse" aria-hidden="true" />
        <span>Iron Temple, Zirakpur</span>
        <span className="lp-console-time">6:12 PM</span>
      </div>

      <div className="lp-console-grid">
        <div className="lp-gauge">
          <svg viewBox="0 0 120 120" aria-hidden="true">
            <circle className="lp-gauge-track" cx="60" cy="60" r="52" strokeDasharray={`${arc} ${2 * Math.PI * 52}`} />
            <circle className="lp-gauge-fill" cx="60" cy="60" r="52" strokeDasharray={`${arc} ${2 * Math.PI * 52}`} strokeDashoffset={arc * (1 - crowd / 100)} />
          </svg>
          <div className="lp-gauge-value">
            <strong>{crowd}%</strong>
            <small>full right now</small>
          </div>
          <p className="lp-gauge-note">{inside} people inside</p>
        </div>

        <div className="lp-qr">
          <svg viewBox={`0 0 ${QR_SIZE} ${QR_SIZE}`} shapeRendering="crispEdges" aria-label="Member check-in QR code" key={qrSeed} className="lp-qr-code">
            {cells.map((on, i) => (on ? <rect key={i} x={i % QR_SIZE} y={Math.floor(i / QR_SIZE)} width="1" height="1" /> : null))}
          </svg>
          <span className="lp-qr-scan" aria-hidden="true" key={`scan-${qrSeed}`} />
          <p>
            New code in <strong>{seconds}s</strong>
            <small>Screenshots stop working</small>
          </p>
        </div>
      </div>

      <div className="lp-feed-head">
        <span>Today</span>
        <strong>{checkIns} check-ins</strong>
      </div>
      <ul className="lp-feed" aria-live="off">
        {rows.map((row, i) => (
          <li key={row.key} className={`lp-feed-row tone-${row.tone} ${i === 0 && started.current ? 'is-new' : ''}`}>
            <row.icon aria-hidden="true" />
            <span>
              <strong>{row.who}</strong> {row.what}
            </span>
            <small>{i === 0 ? 'now' : `${i * 2} min`}</small>
          </li>
        ))}
      </ul>
    </div>
  )
}
