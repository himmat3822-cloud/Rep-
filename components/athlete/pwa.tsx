'use client'

import { useEffect, useState } from 'react'
import { Bell, BellOff, Download, Share, Smartphone, WifiOff } from 'lucide-react'
import { toast } from 'sonner'
import { api, ApiClientError } from '@/lib/api/client'

// PWA plumbing for the athlete app: service worker registration, install
// prompt, offline banner, web push opt-in, and saving today's workout for
// the offline page.

interface InstallPrompt extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

declare global {
  interface Window {
    __kasratInstall?: InstallPrompt | null
  }
}

const INSTALL_EVENT = 'kasrat-install-ready'

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true
}

function isIos(): boolean {
  if (typeof navigator === 'undefined') return false
  return /iphone|ipad|ipod/i.test(navigator.userAgent)
}

export function PwaBoot({ slug, offlineLabel }: { slug: string; offlineLabel: string }) {
  const [offline, setOffline] = useState(false)

  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register(`/g/${slug}/sw.js`, { scope: `/g/${slug}/` }).catch(() => null)
    }
    const onPrompt = (event: Event) => {
      event.preventDefault()
      window.__kasratInstall = event as InstallPrompt
      window.dispatchEvent(new Event(INSTALL_EVENT))
    }
    const update = () => setOffline(!navigator.onLine)
    update()
    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }, [slug])

  return offline ? (
    <div className="offline-bar">
      <WifiOff /> {offlineLabel}
    </div>
  ) : null
}

export function clearOfflineCache() {
  try {
    navigator.serviceWorker?.controller?.postMessage('logout')
    for (const key of Object.keys(window.localStorage)) if (key.startsWith('kasrat-')) window.localStorage.removeItem(key)
  } catch {
    // nothing cached
  }
}

export function InstallCard({ labels }: { labels: { title: string; note: string; install: string; ios: string; installed: string } }) {
  const [ready, setReady] = useState(false)
  const [installed, setInstalled] = useState(false)
  const [ios, setIos] = useState(false)

  useEffect(() => {
    setInstalled(isStandalone())
    setIos(isIos())
    setReady(Boolean(window.__kasratInstall))
    const onReady = () => setReady(true)
    window.addEventListener(INSTALL_EVENT, onReady)
    return () => window.removeEventListener(INSTALL_EVENT, onReady)
  }, [])

  async function install() {
    const prompt = window.__kasratInstall
    if (!prompt) return
    await prompt.prompt()
    const choice = await prompt.userChoice
    if (choice.outcome === 'accepted') setInstalled(true)
    window.__kasratInstall = null
    setReady(false)
  }

  return (
    <section className="a-card">
      <h3>
        <Smartphone /> {labels.title}
      </h3>
      {installed ? (
        <p className="muted">{labels.installed}</p>
      ) : (
        <>
          <p className="muted">{labels.note}</p>
          {ready ? (
            <button type="button" className="btn btn-lime btn-block" onClick={install}>
              <Download /> {labels.install}
            </button>
          ) : ios ? (
            <p className="tip">
              <Share /> {labels.ios}
            </p>
          ) : null}
        </>
      )}
    </section>
  )
}

function base64ToUint8(base64: string): Uint8Array<ArrayBuffer> {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/')
  const raw = window.atob(padded)
  const out = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i)
  return out
}

type PushState = 'loading' | 'unsupported' | 'ios-install' | 'blocked' | 'off' | 'on'

export function PushToggle({ slug, labels }: { slug: string; labels: { title: string; on: string; off: string; enabled: string; blocked: string; unsupported: string; ios: string; done: string } }) {
  const [state, setState] = useState<PushState>('loading')
  const [busy, setBusy] = useState(false)
  const vapid = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? ''

  useEffect(() => {
    async function check() {
      if (isIos() && !isStandalone()) return setState('ios-install')
      if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window) || !vapid) return setState('unsupported')
      if (Notification.permission === 'denied') return setState('blocked')
      const registration = await navigator.serviceWorker.getRegistration(`/g/${slug}/`)
      const existing = await registration?.pushManager.getSubscription()
      setState(existing ? 'on' : 'off')
    }
    check().catch(() => setState('unsupported'))
  }, [slug, vapid])

  async function turnOn() {
    setBusy(true)
    try {
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        setState(permission === 'denied' ? 'blocked' : 'off')
        return
      }
      const registration = (await navigator.serviceWorker.getRegistration(`/g/${slug}/`)) ?? (await navigator.serviceWorker.register(`/g/${slug}/sw.js`, { scope: `/g/${slug}/` }))
      await navigator.serviceWorker.ready
      const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64ToUint8(vapid) })
      const json = subscription.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } }
      await api(`/api/g/${slug}/me/push`, { method: 'POST', body: { endpoint: json.endpoint, keys: json.keys }, session: 'athlete' })
      setState('on')
      toast.success(labels.done)
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : labels.unsupported)
    } finally {
      setBusy(false)
    }
  }

  async function turnOff() {
    setBusy(true)
    try {
      const registration = await navigator.serviceWorker.getRegistration(`/g/${slug}/`)
      const subscription = await registration?.pushManager.getSubscription()
      if (subscription) {
        await api(`/api/g/${slug}/me/push`, { method: 'DELETE', body: { endpoint: subscription.endpoint }, session: 'athlete' }).catch(() => null)
        await subscription.unsubscribe()
      }
      setState('off')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="a-card">
      <h3>
        <Bell /> {labels.title}
      </h3>
      {state === 'on' ? (
        <div className="row-between">
          <p className="muted">{labels.enabled}</p>
          <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={turnOff}>
            <BellOff /> {labels.off}
          </button>
        </div>
      ) : state === 'off' ? (
        <button type="button" className="btn btn-dark btn-block" disabled={busy} onClick={turnOn}>
          <Bell /> {labels.on}
        </button>
      ) : state === 'ios-install' ? (
        <p className="tip">
          <Share /> {labels.ios}
        </p>
      ) : state === 'blocked' ? (
        <p className="muted">{labels.blocked}</p>
      ) : state === 'unsupported' ? (
        <p className="muted">{labels.unsupported}</p>
      ) : null}
    </section>
  )
}

// Keeps a copy of today's workout on the phone for the offline page.
export function SaveToday({ slug, workout }: { slug: string; workout: unknown }) {
  useEffect(() => {
    try {
      window.localStorage.setItem(`kasrat-today:${slug}`, JSON.stringify({ savedAt: new Date().toISOString(), workout }))
    } catch {
      // storage blocked: offline page shows the QR link only
    }
  }, [slug, workout])
  return null
}
