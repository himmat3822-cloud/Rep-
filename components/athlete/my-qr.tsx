'use client'

import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { api, ApiClientError } from '@/lib/api/client'
import { computeQrToken, istDateNow, QR_STEP_SECONDS } from '@/lib/attendance/qr-client'

// Rotating check-in QR. Daily keys are cached on the phone, so the QR keeps
// working with no internet for today and tomorrow.

interface KeySet {
  athleteId: string
  keys: { date: string; key: string }[]
}

const STORAGE = 'kasrat-qr-keys'

function readCache(slug: string): KeySet | null {
  try {
    const raw = window.localStorage.getItem(`${STORAGE}:${slug}`)
    return raw ? (JSON.parse(raw) as KeySet) : null
  } catch {
    return null
  }
}

export function MyQr({ slug, name, labels }: { slug: string; name: string; labels: { showAtDesk: string; refreshesIn: string; offlineOk: string; qrOff: string } }) {
  const [keys, setKeys] = useState<KeySet | null>(null)
  const [image, setImage] = useState('')
  const [seconds, setSeconds] = useState(QR_STEP_SECONDS)
  const [error, setError] = useState('')
  const lastStep = useRef(-1)

  useEffect(() => {
    const cached = readCache(slug)
    if (cached) setKeys(cached)
    api<KeySet>(`/api/g/${slug}/me/qr-key`, { session: 'athlete' })
      .then((fresh) => {
        setKeys(fresh)
        try {
          window.localStorage.setItem(`${STORAGE}:${slug}`, JSON.stringify(fresh))
        } catch {
          // storage may be blocked; the QR still works while the page is open
        }
      })
      .catch((err) => {
        if (err instanceof ApiClientError && err.code === 'METHOD_DISABLED') setError(labels.qrOff)
        else if (!cached) setError(err instanceof ApiClientError ? err.message : 'Could not load your QR')
      })
  }, [slug, labels.qrOff])

  useEffect(() => {
    if (!keys) return
    let alive = true
    async function tick() {
      const today = keys!.keys.find((item) => item.date === istDateNow())
      if (!today) {
        setError('Open the app with internet once to refresh your QR.')
        return
      }
      const { token, step, secondsLeft } = await computeQrToken(today.key, keys!.athleteId)
      if (!alive) return
      setSeconds(secondsLeft)
      if (step !== lastStep.current) {
        lastStep.current = step
        setImage(await QRCode.toDataURL(token, { margin: 1, width: 600, errorCorrectionLevel: 'M', color: { dark: '#18211e', light: '#ffffff' } }))
      }
    }
    void tick()
    const timer = setInterval(tick, 1000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [keys])

  return (
    <div className="qr-card">
      <p className="kicker">KASRAT CHECK-IN</p>
      <h2>{name}</h2>
      <p className="muted">{labels.showAtDesk}</p>
      {error ? <p className="field-error" style={{ marginTop: 16 }}>{error}</p> : image ? <img className="qr-img" src={image} alt="Check-in QR code" /> : <div className="qr-img" style={{ background: 'var(--soft)', borderRadius: 12 }} />}
      {!error ? (
        <>
          <div className="qr-ring">
            <span style={{ width: `${(seconds / QR_STEP_SECONDS) * 100}%` }} />
          </div>
          <small className="muted">
            {labels.refreshesIn.replace('{seconds}', String(seconds))} - {labels.offlineOk}
          </small>
        </>
      ) : null}
    </div>
  )
}
