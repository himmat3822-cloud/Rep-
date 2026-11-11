import type { Metadata } from 'next'
import Link from 'next/link'
import { Dumbbell } from 'lucide-react'
import { Brand } from '@/components/brand'
import { EnquiryForm } from '@/components/athlete/enquiry-form'
import { prisma } from '@/lib/db/client'
import { getGymFeatures } from '@/lib/gym/features'
import { LANGUAGES, translator, type Lang } from '@/lib/i18n'

export const dynamic = 'force-dynamic'

async function loadGym(slug: string) {
  const gym = await prisma.gym.findUnique({ where: { slug }, select: { id: true, name: true, city: true, subscriptionStatus: true, defaultLanguage: true } })
  if (!gym || !['TRIAL', 'ACTIVE', 'PAST_DUE'].includes(gym.subscriptionStatus)) return null
  if (!(await getGymFeatures(gym.id)).includes('leads_crm')) return null
  return gym
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const gym = await loadGym((await params).slug)
  return { title: gym ? `Join ${gym.name}, ${gym.city}` : 'Rep+', description: gym ? `Free trial at ${gym.name}, ${gym.city}. Leave your number and the gym will call you.` : undefined }
}

// Public enquiry page: /g/{slug}/enquire?lang=hi - the gym links it from
// Instagram bio, Google Business profile or its website.
export default async function EnquirePage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ lang?: string }> }) {
  const { slug } = await params
  const gym = await loadGym(slug)
  const asked = (await searchParams).lang?.toUpperCase()
  const lang: Lang = LANGUAGES.some((l) => l.code === asked) ? (asked as Lang) : (gym?.defaultLanguage ?? 'EN')
  const t = translator(lang)
  return (
    <main className="pay-page">
      <div className="pay-card">
        <Brand />
        {gym ? (
          <>
            <div className="join-gift">
              <Dumbbell />
            </div>
            <h1>{t('enq', 'title', { gym: gym.name })}</h1>
            <p className="muted">{gym.city}</p>
            <p className="pay-msg">{t('enq', 'sub')}</p>
            <EnquiryForm
              slug={slug}
              labels={{ name: t('enq', 'name'), phone: t('enq', 'phone'), interest: t('enq', 'interest'), interestHint: t('enq', 'interestHint'), message: t('enq', 'message'), submit: t('enq', 'submit'), done: t('enq', 'done', { gym: gym.name }) }}
            />
            <nav className="lang-links" aria-label={t('enq', 'lang')}>
              {LANGUAGES.map((l) => (
                <Link key={l.code} className={l.code === lang ? 'on' : ''} href={`/g/${slug}/enquire?lang=${l.code.toLowerCase()}`}>{l.label}</Link>
              ))}
            </nav>
          </>
        ) : (
          <p className="pay-msg">{t('enq', 'invalid')}</p>
        )}
      </div>
    </main>
  )
}
