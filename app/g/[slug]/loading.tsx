'use client'

import { useParams, usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { AthleteChrome } from '@/components/athlete/athlete-chrome'
import type { Lang } from '@/lib/i18n'

// Shown the instant a tab is tapped: the member frame with skeleton cards,
// so the app never looks frozen while the next screen loads.
const BARE = new Set(['login', 'join', 'enquire', 'checkin', 'offline'])

function Cards() {
  return (
    <div className="a-page" aria-busy="true" aria-label="Loading">
      <div className="k-skel" style={{ height: 120, marginBottom: 14 }} />
      <div className="k-skel" style={{ height: 180, marginBottom: 14 }} />
      <div className="k-skel" style={{ height: 90, marginBottom: 14 }} />
      <div className="k-skel" style={{ height: 90 }} />
    </div>
  )
}

export default function Loading() {
  const params = useParams<{ slug: string }>()
  const pathname = usePathname()
  const [lang, setLang] = useState<Lang>('EN')
  useEffect(() => {
    const match = document.cookie.match(/(?:^|; )k_lang=(EN|HI|PA)/)
    if (match) setLang(match[1] as Lang)
  }, [])
  const segment = pathname.split('/')[3] ?? ''
  if (BARE.has(segment) || !params.slug) return <Cards />
  return (
    <AthleteChrome key={lang} slug={params.slug} lang={lang}>
      <Cards />
    </AthleteChrome>
  )
}
