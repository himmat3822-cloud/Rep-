'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import jsQR from 'jsqr'
import { Camera, CameraOff, CheckCircle2, Keyboard, LogOut, Search, XCircle } from 'lucide-react'
import { api, ApiClientError } from '@/lib/api/client'
import { formatInr } from '@/lib/money'

// Front desk check-in: camera QR scanner, USB / Bluetooth scanner input and
// manual search. Only the methods the owner enabled are shown.

interface Summary {
  status: 'checked_in' | 'already_inside' | 'duplicate'
  checkInId: string
  warnings: string[]
  athlete: { id: string; name: string; memberCode: string; streakDays: number; planName: string | null; daysLeft: number | null; duePaise: number }
}

interface Visit {
  id: string
  athleteId: string
  name: string
  memberCode: string
  method: string
  checkedInAt: string
  checkedOutAt: string | null
  inside: boolean
}

type Result = { kind: 'ok'; summary: Summary } | { kind: 'error'; message: string }

const METHOD_LABEL: Record<string, string> = { QR_ROTATING: 'QR', QR_ENTRANCE: 'Self (QR)', GEO_SELF: 'Self (location)', MANUAL: 'Desk', REGISTER: 'Register', BIOMETRIC: 'Biometric' }

function beep(ok: boolean) {
  try {
    const ctx = new AudioContext()
    const osc = ctx.createOscillator()
    osc.frequency.value = ok ? 880 : 220
    osc.connect(ctx.destination)
    osc.start()
    osc.stop(ctx.currentTime + 0.15)
    navigator.vibrate?.(ok ? 80 : [60, 60, 60])
  } catch {
    // sound is optional
  }
}

export function CheckinDesk({ branches, deskQr, manual, label, base }: { branches: { id: string; name: string }[]; deskQr: boolean; manual: boolean; label: string; base: string }) {
  const [mode, setMode] = useState<'camera' | 'search'>(deskQr ? 'camera' : 'search')
  const [branchId, setBranchId] = useState(branches[0]?.id ?? '')
  const [result, setResult] = useState<Result | null>(null)
  const [visits, setVisits] = useState<Visit[]>([])
  const [cameraOn, setCameraOn] = useState(false)
  const [cameraError, setCameraError] = useState('')
  const [wedge, setWedge] = useState('')
  const [query, setQuery] = useState('')
  const [matches, setMatches] = useState<{ id: string; name: string; memberCode: string; phone: string; planName: string | null }[]>([])
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const lastTokenRef = useRef<{ token: string; at: number } | null>(null)
  const busyRef = useRef(false)

  const loadToday = useCallback(async () => {
    try {
      setVisits(await api<Visit[]>(`/api/gym/attendance/today${branches.length > 1 ? `?branchId=${branchId}` : ''}`))
    } catch {
      // keep the old list
    }
  }, [branchId, branches.length])

  useEffect(() => {
    void loadToday()
    const timer = setInterval(loadToday, 30000)
    return () => clearInterval(timer)
  }, [loadToday])

  const submitToken = useCallback(
    async (token: string) => {
      const now = Date.now()
      if (busyRef.current) return
      if (lastTokenRef.current && lastTokenRef.current.token === token && now - lastTokenRef.current.at < 5000) return
      lastTokenRef.current = { token, at: now }
      busyRef.current = true
      try {
        const summary = await api<Summary>('/api/gym/attendance/scan', { method: 'POST', body: { token, branchId } })
        setResult({ kind: 'ok', summary })
        beep(true)
        void loadToday()
      } catch (error) {
        setResult({ kind: 'error', message: error instanceof ApiClientError ? error.message : 'Scan failed' })
        beep(false)
      } finally {
        busyRef.current = false
      }
    },
    [branchId, loadToday],
  )

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    setCameraOn(false)
  }, [])

  async function startCamera() {
    setCameraError('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 } }, audio: false })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
      }
      setCameraOn(true)
    } catch {
      setCameraError('Camera blocked or not found. Allow camera access, or use a USB scanner / search instead.')
    }
  }

  // Decode a frame every 250 ms while the camera runs.
  useEffect(() => {
    if (!cameraOn) return
    const timer = setInterval(() => {
      const video = videoRef.current
      const canvas = canvasRef.current
      if (!video || !canvas || video.readyState < 2) return
      const width = 480
      const height = Math.round((video.videoHeight / video.videoWidth) * width) || 360
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      if (!ctx) return
      ctx.drawImage(video, 0, 0, width, height)
      const code = jsQR(ctx.getImageData(0, 0, width, height).data, width, height, { inversionAttempts: 'dontInvert' })
      if (code?.data?.startsWith('KQ1.')) void submitToken(code.data)
    }, 250)
    return () => clearInterval(timer)
  }, [cameraOn, submitToken])

  useEffect(() => stopCamera, [stopCamera])

  useEffect(() => {
    if (mode !== 'search' || query.trim().length < 2) {
      setMatches([])
      return
    }
    const timer = setTimeout(() => {
      api<{ rows: { id: string; name: string; memberCode: string; phone: string; planName: string | null }[] }>(`/api/gym/members?q=${encodeURIComponent(query.trim())}`)
        .then((data) => setMatches(data.rows))
        .catch(() => setMatches([]))
    }, 250)
    return () => clearTimeout(timer)
  }, [query, mode])

  async function manualCheckIn(athleteId: string) {
    try {
      const summary = await api<Summary>('/api/gym/attendance/checkin', { method: 'POST', body: { athleteId, branchId } })
      setResult({ kind: 'ok', summary })
      beep(true)
      setQuery('')
      void loadToday()
    } catch (error) {
      setResult({ kind: 'error', message: error instanceof ApiClientError ? error.message : 'Check-in failed' })
      beep(false)
    }
  }

  async function checkout(id: string) {
    await api('/api/gym/attendance/checkout', { method: 'POST', body: { checkInId: id } }).catch(() => null)
    void loadToday()
  }

  const inside = visits.filter((visit) => visit.inside).length

  return (
    <div className="two-col">
      <div className="stack">
        <section className="panel">
          <div className="panel-heading">
            <div>
              <p className="kicker">CHECK IN</p>
              <h2>Front desk</h2>
            </div>
            {branches.length > 1 ? (
              <select className="select-button" value={branchId} onChange={(event) => setBranchId(event.target.value)} aria-label="Branch">
                {branches.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name}
                  </option>
                ))}
              </select>
            ) : null}
          </div>
          <div className="tab-links" style={{ margin: '14px 0' }}>
            {deskQr ? (
              <a role="button" className={mode === 'camera' ? 'active' : ''} onClick={() => setMode('camera')}>
                Scan QR
              </a>
            ) : null}
            {manual ? (
              <a
                role="button"
                className={mode === 'search' ? 'active' : ''}
                onClick={() => {
                  stopCamera()
                  setMode('search')
                }}
              >
                Search {label.toLowerCase()}
              </a>
            ) : null}
          </div>

          {mode === 'camera' && deskQr ? (
            <>
              <div className="scanner-box">
                <video ref={videoRef} playsInline muted />
                <canvas ref={canvasRef} hidden />
                {!cameraOn ? (
                  <div className="scanner-placeholder">
                    <button className="btn btn-lime" type="button" onClick={startCamera}>
                      <Camera /> Start camera
                    </button>
                    <small>Point it at the member&apos;s QR in their Rep+ app.</small>
                  </div>
                ) : (
                  <span className="scanner-frame" />
                )}
              </div>
              {cameraOn ? (
                <button className="btn btn-outline btn-sm" type="button" style={{ marginTop: 8 }} onClick={stopCamera}>
                  <CameraOff /> Stop camera
                </button>
              ) : null}
              {cameraError ? <p className="field-error">{cameraError}</p> : null}
              <form
                className="field"
                style={{ marginTop: 14 }}
                onSubmit={(event) => {
                  event.preventDefault()
                  if (wedge.trim()) void submitToken(wedge.trim())
                  setWedge('')
                }}
              >
                <label htmlFor="wedge">
                  <Keyboard size={12} /> USB / Bluetooth QR scanner (click here, then scan)
                </label>
                <input id="wedge" value={wedge} onChange={(event) => setWedge(event.target.value)} placeholder="Scanned code appears here" autoComplete="off" />
              </form>
            </>
          ) : null}

          {mode === 'search' && manual ? (
            <>
              <div className="field">
                <label htmlFor="desk-search">
                  <Search size={12} /> Name, phone or member ID
                </label>
                <input id="desk-search" autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="e.g. Simran or 98765" />
              </div>
              <div className="list-rows">
                {matches.map((member) => (
                  <div className="list-row" key={member.id}>
                    <span>
                      <strong>{member.name}</strong>
                      <br />
                      <small>
                        {member.memberCode} - {member.phone} - {member.planName ?? 'no plan'}
                      </small>
                    </span>
                    <button className="btn btn-lime btn-sm" type="button" onClick={() => manualCheckIn(member.id)}>
                      <CheckCircle2 /> Check in
                    </button>
                  </div>
                ))}
              </div>
            </>
          ) : null}
        </section>

        {result ? (
          <section className={`checkin-result ${result.kind === 'ok' ? 'ok' : 'bad'}`}>
            {result.kind === 'ok' ? (
              <>
                <CheckCircle2 />
                <div>
                  <strong>{result.summary.athlete.name}</strong>
                  <span>
                    {result.summary.status === 'checked_in' ? 'Checked in' : 'Already inside'} - {result.summary.athlete.memberCode}
                  </span>
                  <span>
                    {result.summary.athlete.planName ?? 'No plan'}
                    {result.summary.athlete.daysLeft !== null ? `, ${result.summary.athlete.daysLeft} days left` : ''} - streak {result.summary.athlete.streakDays}
                  </span>
                  {result.summary.athlete.duePaise > 0 ? <span className="due">Due {formatInr(result.summary.athlete.duePaise)} - collect today</span> : null}
                  {result.summary.warnings.filter((w) => w !== 'Has pending dues').map((warning) => (
                    <span className="due" key={warning}>
                      {warning}
                    </span>
                  ))}
                  <a href={`${base}/members/${result.summary.athlete.id}`}>Open profile</a>
                </div>
              </>
            ) : (
              <>
                <XCircle />
                <div>
                  <strong>Not checked in</strong>
                  <span>{result.message}</span>
                </div>
              </>
            )}
          </section>
        ) : null}
      </div>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="kicker">TODAY</p>
            <h2>
              {visits.length} visits - {inside} inside now
            </h2>
          </div>
          <span className="status-pill">
            <span className="live-dot" /> Live
          </span>
        </div>
        <div className="list-rows">
          {visits.length === 0 ? <p className="muted" style={{ paddingTop: 10 }}>No check-ins yet today.</p> : null}
          {visits.map((visit) => (
            <div className="list-row" key={visit.id}>
              <span>
                <a href={`${base}/members/${visit.athleteId}`}>{visit.name}</a>
                <br />
                <small>
                  {new Date(visit.checkedInAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })} - {METHOD_LABEL[visit.method] ?? visit.method}
                  {visit.checkedOutAt ? ` - out ${new Date(visit.checkedOutAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}` : ''}
                </small>
              </span>
              {visit.inside ? (
                <button className="btn btn-outline btn-sm" type="button" onClick={() => checkout(visit.id)}>
                  <LogOut /> Check out
                </button>
              ) : (
                <span className="badge badge-grey">Left</span>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
