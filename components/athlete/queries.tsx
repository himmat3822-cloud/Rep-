'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, MessageCircleQuestion, Send } from 'lucide-react'
import { toast } from 'sonner'
import { api, ApiClientError } from '@/lib/api/client'
import { translator, type Lang } from '@/lib/i18n'

// Member side of "Ask your trainer": a short chat per query.

const TOPICS = ['DIET', 'WORKOUT', 'PLAN', 'PT', 'OTHER'] as const
type Topic = (typeof TOPICS)[number]

export interface MemberThread {
  id: string
  topic: Topic
  status: 'OPEN' | 'ANSWERED' | 'CLOSED'
  unread: boolean
  when: string
  messages: { id: string; mine: boolean; who: string; body: string; when: string }[]
}

export function MemberQueries({ slug, lang, trainer, threads }: { slug: string; lang: Lang; trainer: string | null; threads: MemberThread[] }) {
  const t = translator(lang)
  const router = useRouter()
  const [topic, setTopic] = useState<Topic>('DIET')
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)

  async function ask() {
    if (body.trim().length < 3) return
    setBusy(true)
    try {
      await api(`/api/g/${slug}/me/queries`, { method: 'POST', body: { topic, body }, session: 'athlete' })
      setBody('')
      toast.success(t('qry', 'sent'))
      router.refresh()
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : 'Could not send')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="a-page">
      <div className="a-head">
        <h1>{t('qry', 'title')}</h1>
        <p className="muted">{t('qry', 'subtitle')}</p>
      </div>

      <section className="a-card q-compose">
        <span className="q-to">
          <MessageCircleQuestion /> {trainer ? t('qry', 'to', { name: trainer }) : t('qry', 'toOwner')}
        </span>
        <p className="q-label">{t('qry', 'topic')}</p>
        <div className="q-topics" role="radiogroup" aria-label={t('qry', 'topic')}>
          {TOPICS.map((key) => (
            <button key={key} type="button" role="radio" aria-checked={topic === key} className={topic === key ? 'on' : ''} onClick={() => setTopic(key)}>
              {t('qry', key)}
            </button>
          ))}
        </div>
        <textarea className="q-input" rows={3} maxLength={1000} value={body} placeholder={t('qry', 'placeholder')} onChange={(event) => setBody(event.target.value)} />
        <button type="button" className="btn btn-lime q-send" disabled={busy || body.trim().length < 3} onClick={ask}>
          {busy ? <Loader2 className="spin" /> : <Send />} {t('qry', 'send')}
        </button>
        <small className="muted">{t('qry', 'complaintHint')}</small>
      </section>

      <h3 className="q-section">{t('qry', 'mine')}</h3>
      {threads.length === 0 ? <p className="muted">{t('qry', 'empty')}</p> : threads.map((thread) => <Thread key={thread.id} slug={slug} lang={lang} thread={thread} />)}
    </div>
  )
}

function Thread({ slug, lang, thread }: { slug: string; lang: Lang; thread: MemberThread }) {
  const t = translator(lang)
  const router = useRouter()
  const [reply, setReply] = useState('')
  const [busy, setBusy] = useState(false)

  async function send() {
    if (!reply.trim()) return
    setBusy(true)
    try {
      await api(`/api/g/${slug}/me/queries/${thread.id}`, { method: 'POST', body: { body: reply }, session: 'athlete' })
      setReply('')
      router.refresh()
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : 'Could not send')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className={`a-card q-thread ${thread.unread ? 'unread' : ''}`}>
      <div className="q-thread-head">
        <strong>{t('qry', thread.topic)}</strong>
        <span className={`q-status ${thread.status.toLowerCase()}`}>{thread.unread ? t('qry', 'newReply') : t('qry', thread.status)}</span>
      </div>
      <ol className="q-messages">
        {thread.messages.map((message) => (
          <li key={message.id} className={message.mine ? 'mine' : 'theirs'}>
            <span className="q-who">{message.mine ? t('qry', 'you') : message.who}</span>
            <p>{message.body}</p>
            <time>{message.when}</time>
          </li>
        ))}
      </ol>
      <div className="q-reply">
        <input value={reply} maxLength={1000} placeholder={t('qry', 'replyPlaceholder')} onChange={(event) => setReply(event.target.value)} onKeyDown={(event) => (event.key === 'Enter' ? send() : undefined)} />
        <button type="button" className="btn btn-dark btn-sm" disabled={busy || !reply.trim()} onClick={send} aria-label={t('qry', 'reply')}>
          {busy ? <Loader2 className="spin" /> : <Send />}
        </button>
      </div>
    </section>
  )
}
