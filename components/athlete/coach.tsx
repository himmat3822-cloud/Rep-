'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, ClipboardCheck, Loader2, MessageSquareQuote, X } from 'lucide-react'
import { toast } from 'sonner'
import { api, ApiClientError } from '@/lib/api/client'
import { translator, type Lang } from '@/lib/i18n'

// Home cards from the member's trainer: latest note, PT sessions to confirm.

export function CoachCards({ slug, lang, trainer, note, sessions }: { slug: string; lang: Lang; trainer: string | null; note: { body: string; by: string; date: string } | null; sessions: { id: string; trainer: string; minutes: number; date: string }[] }) {
  const t = translator(lang)
  if (!note && sessions.length === 0) return null
  return (
    <div className="coach-cards">
      {sessions.slice(0, 1).map((session) => (
        <PtConfirm key={session.id} slug={slug} lang={lang} session={session} more={sessions.length - 1} />
      ))}
      {note ? (
        <section className="a-card coach-note">
          <h3>
            <MessageSquareQuote /> {t('coach', 'noteFrom', { name: note.by })}
          </h3>
          <p>{note.body}</p>
          <small className="muted">
            {note.date}
            {trainer ? ` - ${t('coach', 'yourTrainer', { name: trainer })}` : ''}
          </small>
        </section>
      ) : null}
    </div>
  )
}

function PtConfirm({ slug, lang, session, more }: { slug: string; lang: Lang; session: { id: string; trainer: string; minutes: number; date: string }; more: number }) {
  const t = translator(lang)
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [disputing, setDisputing] = useState(false)
  const [note, setNote] = useState('')

  async function answer(action: 'sign' | 'dispute') {
    setBusy(true)
    try {
      await api(`/api/g/${slug}/me/pt/${session.id}`, { method: 'POST', body: { action, note: action === 'dispute' ? note : undefined }, session: 'athlete' })
      toast.success(action === 'sign' ? t('coach', 'confirmed') : t('coach', 'disputed'))
      router.refresh()
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : 'Could not send')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="a-card pt-confirm">
      <h3>
        <ClipboardCheck /> {t('coach', 'ptConfirmTitle')}
        {more > 0 ? <span className="pill">+{more}</span> : null}
      </h3>
      <p className="muted">{t('coach', 'ptConfirmBody', { trainer: session.trainer, minutes: session.minutes, date: session.date })}</p>
      {disputing ? (
        <div className="pt-dispute">
          <input value={note} maxLength={200} placeholder={t('coach', 'disputePlaceholder')} onChange={(e) => setNote(e.target.value)} />
          <button type="button" className="btn btn-dark btn-sm" disabled={busy} onClick={() => answer('dispute')}>
            {busy ? <Loader2 className="spin" /> : t('coach', 'sendNote')}
          </button>
        </div>
      ) : (
        <div className="pay-actions">
          <button type="button" className="btn btn-lime" disabled={busy} onClick={() => answer('sign')}>
            {busy ? <Loader2 className="spin" /> : <Check />} {t('coach', 'confirm')}
          </button>
          <button type="button" className="btn btn-outline" disabled={busy} onClick={() => setDisputing(true)}>
            <X /> {t('coach', 'dispute')}
          </button>
        </div>
      )}
    </section>
  )
}
