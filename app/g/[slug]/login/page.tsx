import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { notFound } from 'next/navigation'
import { Brand } from '@/components/brand'
import { AthleteLoginForm } from '@/components/auth/athlete-login-form'
import { prisma } from '@/lib/db/client'
import type { Lang } from '@/lib/i18n'

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const gym = await prisma.gym.findUnique({ where: { slug }, select: { name: true } })
  return { title: gym ? `${gym.name} - Rep+` : 'Rep+' }
}

export default async function AthleteLoginPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ next?: string }> }) {
  const { slug } = await params
  const { next } = await searchParams
  const gym = await prisma.gym.findUnique({ where: { slug }, select: { name: true, athleteLabel: true, defaultLanguage: true } })
  if (!gym) notFound()

  const saved = (await cookies()).get('k_lang')?.value
  const initialLang: Lang = saved === 'HI' || saved === 'PA' || saved === 'EN' ? saved : gym.defaultLanguage

  return (
    <main className="athlete-app" style={{ paddingBottom: 0 }}>
      <div className="athlete-top">
        <Brand />
      </div>
      <div style={{ display: 'grid', placeItems: 'center', padding: '40px 16px' }}>
        <AthleteLoginForm gymSlug={slug} gymName={gym.name} athleteLabel={gym.athleteLabel} initialLang={initialLang} next={next} />
      </div>
    </main>
  )
}
