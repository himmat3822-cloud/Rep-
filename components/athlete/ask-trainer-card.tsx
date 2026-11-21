import Link from 'next/link'
import { ChevronRight, MessageCircleQuestion } from 'lucide-react'
import { translator, type Lang } from '@/lib/i18n'

// Home shortcut to "Ask your trainer", with a badge for unread replies.
export function AskTrainerCard({ slug, lang, unread }: { slug: string; lang: Lang; unread: number }) {
  const t = translator(lang)
  return (
    <Link href={`/g/${slug}/queries`} className="ask-card">
      <span className="ask-icon">
        <MessageCircleQuestion />
      </span>
      <span className="ask-text">
        <strong>{t('qry', 'homeCard')}</strong>
        <small>{unread > 0 ? t('qry', 'homeUnread', { count: unread }) : t('qry', 'homeCardBtn')}</small>
      </span>
      {unread > 0 ? <span className="ask-badge">{unread}</span> : null}
      <ChevronRight className="ask-go" />
    </Link>
  )
}
