import type { Metadata } from 'next'
import { Gift } from 'lucide-react'
import { Brand } from '@/components/brand'
import { JoinForm } from '@/components/athlete/join-form'
import { loadInvite } from '@/lib/athlete/join'
import { translator } from '@/lib/i18n'

export const metadata: Metadata = { title: 'You are invited - Rep+', robots: { index: false, follow: false } }
export const dynamic = 'force-dynamic'

// Public "refer a friend" landing page: /g/{slug}/join?ref=CODE
export default async function JoinPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ ref?: string }> }) {
  const { slug } = await params
  const invite = await loadInvite(slug, (await searchParams).ref)
  const t = translator(invite?.language ?? 'EN')
  return (
    <main className="pay-page">
      <div className="pay-card">
        <Brand />
        {invite ? (
          <>
            <div className="join-gift">
              <Gift />
            </div>
            <h1>{t('join', 'title', { friend: invite.friend, gym: invite.gymName })}</h1>
            <p className="muted">
              {invite.gymName} - {invite.city}
            </p>
            <p className="pay-msg">{t('join', 'note')}</p>
            <JoinForm
              slug={slug}
              code={invite.code}
              labels={{ name: t('join', 'name'), phone: t('join', 'phone'), submit: t('join', 'submit'), done: t('join', 'done', { gym: invite.gymName, code: invite.code }) }}
            />
          </>
        ) : (
          <p className="pay-msg">{t('join', 'invalid')}</p>
        )}
      </div>
    </main>
  )
}
