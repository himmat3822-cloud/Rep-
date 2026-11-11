import type { Metadata } from 'next'
import { AthleteChrome } from '@/components/athlete/athlete-chrome'
import { SelfCheckin } from '@/components/athlete/self-checkin'
import { requireAthletePage } from '@/lib/auth/page'
import { tenantDb } from '@/lib/db/tenant'
import { loadGymConfig } from '@/lib/gym/context'
import { enabledMethods } from '@/lib/attendance/methods'
import { translate } from '@/lib/i18n'

export const metadata: Metadata = { title: 'Check in - Rep+' }

// Opened by scanning the entrance poster (?b=branch&s=signature) or from the app.
export default async function SelfCheckinPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ b?: string; s?: string }> }) {
  const { slug } = await params
  const { b, s } = await searchParams
  const { athlete, gym } = await requireAthletePage(slug)
  const db = tenantDb(gym.id)
  const [config, branches] = await Promise.all([loadGymConfig(db, gym.id), db.branch.findMany({ where: { archived: false }, orderBy: { createdAt: 'asc' }, select: { id: true, name: true } })])
  const methods = enabledMethods(config.settings.attendance, config.features)
  const lang = athlete.language
  const t = (key: Parameters<typeof translate<'checkin'>>[2]) => translate(lang, 'checkin', key)
  return (
    <AthleteChrome slug={slug} lang={lang}>
      {methods.selfCheckin ? (
        <SelfCheckin
          slug={slug}
          branches={branches}
          presetBranchId={b && branches.some((branch) => branch.id === b) ? b : null}
          sig={s ?? null}
          requireLocation={methods.selfRequireLocation}
          requireEntranceQr={methods.selfRequireEntranceQr}
          labels={{ checkIn: t('checkIn'), checkInHere: t('checkInHere'), checkingIn: t('checkingIn'), locating: t('locating'), needLocation: t('needLocation'), success: t('success'), alreadyInside: t('alreadyInside'), scanPoster: t('scanPoster'), pickBranch: t('pickBranch'), streakNow: t('streakNow') }}
        />
      ) : (
        <div className="qr-card">
          <p>{t('selfOff')}</p>
        </div>
      )}
    </AthleteChrome>
  )
}
