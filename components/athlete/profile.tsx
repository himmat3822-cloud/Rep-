'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCheck, Copy, Download, Gift, Loader2, MessageSquareWarning, Send, Shield, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { api, ApiClientError } from '@/lib/api/client'
import { translator, type Lang } from '@/lib/i18n'
import { feedbackKinds } from '@/lib/validation/athlete'
import { InstallCard, PushToggle } from './pwa'

// Profile tab: install + notifications, refer a friend, privacy controls,
// feedback / broken equipment, download my data, delete my photos.

interface Privacy {
  shareProgressWithTrainer: boolean
  sharePhotosWithTrainer: boolean
  shareHealthWithTrainer: boolean
  hideFromLeaderboard: boolean
}

export function ProfileView(props: {
  slug: string
  lang: Lang
  gymName: string
  name: string
  memberCode: string
  since: string
  referral: { code: string; link: string; rewardDays: number; joined: number; earnedDays: number }
  privacy: Privacy
  photoCount: number
}) {
  const { slug, lang } = props
  const t = translator(lang)
  const router = useRouter()
  const [privacy, setPrivacy] = useState(props.privacy)
  const [copied, setCopied] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const shareText = t('me', 'shareText', { gym: props.gymName, code: props.referral.code, link: props.referral.link })

  async function togglePrivacy(key: keyof Privacy) {
    const next = { ...privacy, [key]: !privacy[key] }
    setPrivacy(next)
    try {
      await api(`/api/g/${slug}/me/privacy`, { method: 'PATCH', body: next, session: 'athlete' })
      toast.success(t('me', 'privacySaved'))
    } catch (error) {
      setPrivacy(privacy)
      toast.error(error instanceof ApiClientError ? error.message : 'Could not save')
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(props.referral.link)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      window.prompt(t('me', 'copyLink'), props.referral.link)
    }
  }

  async function deleteAllPhotos() {
    if (!window.confirm(t('me', 'deletePhotosConfirm'))) return
    setDeleting(true)
    try {
      const result = await api<{ deleted: number }>(`/api/g/${slug}/me/photos`, { method: 'DELETE', session: 'athlete' })
      toast.success(t('me', 'photosDeleted', { count: result.deleted }))
      router.refresh()
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : 'Could not delete')
    } finally {
      setDeleting(false)
    }
  }

  const toggles: { key: keyof Privacy; label: string }[] = [
    { key: 'shareProgressWithTrainer', label: t('me', 'shareProgress') },
    { key: 'sharePhotosWithTrainer', label: t('me', 'sharePhotos') },
    { key: 'hideFromLeaderboard', label: t('me', 'hideLeaderboard') },
  ]

  return (
    <div className="a-page">
      <section className="a-card profile-hero">
        <div className="avatar">{props.name.split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('')}</div>
        <div>
          <h2>{props.name}</h2>
          <small>
            {t('me', 'member', { code: props.memberCode })} - {t('me', 'since', { date: props.since })}
          </small>
        </div>
      </section>

      <InstallCard labels={{ title: t('me', 'installTitle'), note: t('me', 'installNote', { gym: props.gymName }), install: t('me', 'install'), ios: t('me', 'installIos'), installed: t('me', 'installed') }} />
      <PushToggle
        slug={slug}
        labels={{ title: t('me', 'notifications'), on: t('me', 'pushOn'), off: t('me', 'pushOff'), enabled: t('me', 'pushEnabled'), blocked: t('me', 'pushBlocked'), unsupported: t('me', 'pushUnsupported'), ios: t('me', 'pushIos'), done: t('me', 'pushTest') }}
      />

      <section className="a-card refer-card">
        <h3>
          <Gift /> {t('me', 'referTitle')}
        </h3>
        <p className="muted">{t('me', 'referNote', { days: props.referral.rewardDays })}</p>
        <div className="refer-code">
          <small>{t('me', 'yourCode')}</small>
          <strong>{props.referral.code}</strong>
        </div>
        <div className="pay-actions">
          <a className="btn btn-lime" href={`https://wa.me/?text=${encodeURIComponent(shareText)}`} target="_blank" rel="noreferrer">
            <Send /> {t('me', 'shareWa')}
          </a>
          <button type="button" className="btn btn-outline" onClick={copy}>
            {copied ? <CheckCheck /> : <Copy />} {copied ? t('me', 'copied') : t('me', 'copyLink')}
          </button>
        </div>
        <p className="hint">{t('me', 'referStats', { count: props.referral.joined, days: props.referral.earnedDays })}</p>
      </section>

      <section className="a-card">
        <h3>
          <Shield /> {t('me', 'privacyTitle')}
        </h3>
        <div className="toggle-list single">
          {toggles.map((toggle) => (
            <label key={toggle.key} className="toggle-row">
              <input type="checkbox" checked={privacy[toggle.key]} onChange={() => togglePrivacy(toggle.key)} />
              <span>
                <strong>{toggle.label}</strong>
              </span>
            </label>
          ))}
        </div>
        <div className="pay-actions" style={{ marginTop: 12 }}>
          <a className="btn btn-outline" href={`/api/g/${slug}/me/export`}>
            <Download /> {t('me', 'downloadData')}
          </a>
          {props.photoCount > 0 ? (
            <button type="button" className="btn btn-outline danger" disabled={deleting} onClick={deleteAllPhotos}>
              {deleting ? <Loader2 className="spin" /> : <Trash2 />} {t('me', 'deletePhotos')}
            </button>
          ) : null}
        </div>
      </section>

      <FeedbackForm slug={slug} lang={lang} />
    </div>
  )
}

function FeedbackForm({ slug, lang }: { slug: string; lang: Lang }) {
  const t = translator(lang)
  const [kind, setKind] = useState<(typeof feedbackKinds)[number]>('EQUIPMENT')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const labels: Record<(typeof feedbackKinds)[number], string> = { FEEDBACK: t('me', 'kindFeedback'), EQUIPMENT: t('me', 'kindEquipment'), CLEANLINESS: t('me', 'kindCleanliness'), STAFF: t('me', 'kindStaff'), OTHER: t('me', 'kindOther') }

  async function send(event: React.FormEvent) {
    event.preventDefault()
    setSending(true)
    try {
      const form = new FormData()
      form.set('kind', kind)
      form.set('title', title)
      form.set('body', body)
      const file = fileRef.current?.files?.[0]
      if (file) form.set('photo', file)
      const response = await fetch(`/api/g/${slug}/me/feedback`, { method: 'POST', body: form })
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: { message?: string } }
        throw new Error(data.error?.message ?? 'Could not send')
      }
      toast.success(t('me', 'feedbackSent'))
      setTitle('')
      setBody('')
      if (fileRef.current) fileRef.current.value = ''
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not send')
    } finally {
      setSending(false)
    }
  }

  return (
    <form className="a-card" onSubmit={send}>
      <h3>
        <MessageSquareWarning /> {t('me', 'feedbackTitle')}
      </h3>
      <label className="field">
        <span>{t('me', 'kind')}</span>
        <select value={kind} onChange={(e) => setKind(e.target.value as (typeof feedbackKinds)[number])}>
          {feedbackKinds.map((value) => (
            <option key={value} value={value}>
              {labels[value]}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>{t('me', 'subject')}</span>
        <input value={title} maxLength={80} minLength={3} required onChange={(e) => setTitle(e.target.value)} placeholder="Treadmill 3" />
      </label>
      <label className="field">
        <span>{t('me', 'details')}</span>
        <textarea value={body} maxLength={1000} rows={3} onChange={(e) => setBody(e.target.value)} />
      </label>
      <label className="field">
        <span>{t('me', 'photo')}</span>
        <input ref={fileRef} type="file" accept="image/*" />
      </label>
      <button className="btn btn-dark btn-block" disabled={sending || title.trim().length < 3}>
        {sending ? <Loader2 className="spin" /> : <Send />} {t('me', 'send')}
      </button>
    </form>
  )
}

export function MarkAllRead({ slug, label }: { slug: string; label: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  return (
    <button
      type="button"
      className="btn btn-outline btn-sm"
      disabled={busy}
      onClick={async () => {
        setBusy(true)
        await api(`/api/g/${slug}/me/notifications`, { method: 'POST', session: 'athlete' }).catch(() => null)
        setBusy(false)
        router.refresh()
      }}
    >
      <CheckCheck /> {label}
    </button>
  )
}
