'use client'

import { useState } from 'react'
import { CheckCircle2, Loader2, MapPin, XCircle } from 'lucide-react'
import { api, ApiClientError } from '@/lib/api/client'

// Self check-in: opened from the entrance QR poster (branch + signature in
// the URL) or from the app (location only). Asks for location when the
// owner requires it.

export interface SelfCheckinLabels {
  checkIn: string
  checkInHere: string
  checkingIn: string
  locating: string
  needLocation: string
  success: string
  alreadyInside: string
  scanPoster: string
  pickBranch: string
  streakNow: string
}

function getPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 }))
}

export function SelfCheckin({ slug, branches, presetBranchId, sig, requireLocation, requireEntranceQr, labels }: { slug: string; branches: { id: string; name: string }[]; presetBranchId: string | null; sig: string | null; requireLocation: boolean; requireEntranceQr: boolean; labels: SelfCheckinLabels }) {
  const [branchId, setBranchId] = useState(presetBranchId ?? branches[0]?.id ?? '')
  const [state, setState] = useState<'idle' | 'locating' | 'sending' | 'ok' | 'inside' | 'error'>('idle')
  const [message, setMessage] = useState('')
  const [streak, setStreak] = useState(0)
  const branchName = branches.find((branch) => branch.id === branchId)?.name ?? ''
  const missingPoster = requireEntranceQr && !sig

  async function go() {
    let coords: { lat?: number; lng?: number; accuracy?: number } = {}
    if (requireLocation) {
      if (!('geolocation' in navigator)) {
        setState('error')
        setMessage(labels.needLocation)
        return
      }
      setState('locating')
      try {
        const position = await getPosition()
        coords = { lat: position.coords.latitude, lng: position.coords.longitude, accuracy: position.coords.accuracy }
      } catch {
        setState('error')
        setMessage(labels.needLocation)
        return
      }
    }
    setState('sending')
    try {
      const result = await api<{ status: string; athlete: { streakDays: number } }>(`/api/g/${slug}/checkin`, { method: 'POST', body: { branchId, sig: sig ?? undefined, ...coords }, session: 'athlete' })
      setStreak(result.athlete.streakDays)
      setState(result.status === 'checked_in' ? 'ok' : 'inside')
      navigator.vibrate?.(80)
    } catch (error) {
      setState('error')
      setMessage(error instanceof ApiClientError ? error.message : 'Check-in failed')
    }
  }

  if (missingPoster) {
    return (
      <div className="qr-card">
        <MapPin style={{ margin: '0 auto', display: 'block' }} />
        <p style={{ marginTop: 12 }}>{labels.scanPoster}</p>
      </div>
    )
  }

  return (
    <div className="qr-card">
      {state === 'ok' || state === 'inside' ? (
        <>
          <CheckCircle2 size={56} style={{ margin: '0 auto', display: 'block', color: 'var(--lime-text)' }} />
          <h2>{state === 'ok' ? labels.success : labels.alreadyInside}</h2>
          <p className="muted">{labels.streakNow.replace('{days}', String(streak))}</p>
        </>
      ) : (
        <>
          <p className="kicker">{labels.checkIn.toUpperCase()}</p>
          {!presetBranchId && branches.length > 1 ? (
            <div className="field" style={{ marginTop: 12, textAlign: 'left' }}>
              <label>{labels.pickBranch}</label>
              <select value={branchId} onChange={(event) => setBranchId(event.target.value)}>
                {branches.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          <button className="btn btn-lime auth-submit" style={{ marginTop: 16, height: 56 }} type="button" disabled={state === 'locating' || state === 'sending'} onClick={go}>
            {state === 'locating' || state === 'sending' ? <Loader2 className="animate-spin" /> : <MapPin />}
            {state === 'locating' ? labels.locating : state === 'sending' ? labels.checkingIn : labels.checkInHere.replace('{branch}', branchName)}
          </button>
          {state === 'error' ? (
            <p className="field-error" style={{ marginTop: 12, display: 'flex', gap: 6, justifyContent: 'center' }}>
              <XCircle size={14} /> {message}
            </p>
          ) : null}
        </>
      )}
    </div>
  )
}
