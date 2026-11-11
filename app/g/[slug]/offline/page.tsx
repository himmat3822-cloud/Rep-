import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { OfflineView } from '@/components/athlete/offline'
import { translator, type Lang } from '@/lib/i18n'

export const metadata: Metadata = { title: 'Offline - Rep+' }

// Cached by the service worker; shown when there is no network.
export default async function OfflinePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const stored = (await cookies()).get('k_lang')?.value
  const lang: Lang = stored === 'HI' || stored === 'PA' ? stored : 'EN'
  const t = translator(lang)
  return <OfflineView slug={slug} labels={{ title: t('offline', 'title'), note: t('offline', 'note'), openQr: t('offline', 'openQr'), today: t('offline', 'today'), retry: t('offline', 'retry') }} />
}
