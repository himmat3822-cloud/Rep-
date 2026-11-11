import type { Metadata } from 'next'
import { AthleteChrome } from '@/components/athlete/athlete-chrome'
import { MyQr } from '@/components/athlete/my-qr'
import { requireAthletePage } from '@/lib/auth/page'
import { translate } from '@/lib/i18n'

export const metadata: Metadata = { title: 'My QR - Rep+' }

export default async function MyQrPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const { athlete } = await requireAthletePage(slug)
  const t = (key: 'showAtDesk' | 'refreshesIn' | 'offlineOk' | 'qrOff') => translate(athlete.language, 'checkin', key)
  return (
    <AthleteChrome slug={slug} lang={athlete.language}>
      <MyQr slug={slug} name={athlete.name} labels={{ showAtDesk: t('showAtDesk'), refreshesIn: t('refreshesIn'), offlineOk: t('offlineOk'), qrOff: t('qrOff') }} />
    </AthleteChrome>
  )
}
