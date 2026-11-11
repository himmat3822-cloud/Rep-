'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { LANGUAGES, translator, type Lang } from '@/lib/i18n'
import type { LoginResponse } from '@/lib/api/types'
import { safeNextPath } from '@/lib/validation/auth'
import { OtpFlow } from './otp-flow'

const LANG_COOKIE = 'k_lang'

function persistLanguage(lang: Lang) {
  document.cookie = `${LANG_COOKIE}=${lang}; path=/; max-age=31536000; samesite=lax`
}

export function AthleteLoginForm({ gymSlug, gymName, athleteLabel, initialLang, next }: { gymSlug: string; gymName: string; athleteLabel: string; initialLang: Lang; next?: string }) {
  const router = useRouter()
  const [lang, setLang] = useState<Lang>(initialLang)
  const t = translator(lang, { label: athleteLabel })

  function done(result: LoginResponse) {
    toast.success(`${gymName}: ${result.user.name.split(' ')[0]}`)
    router.replace(safeNextPath(next, result.redirectTo))
    router.refresh()
  }

  return (
    <div className="auth-card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span className="kicker">{gymName.toUpperCase()}</span>
        <div className="lang-toggle" role="group" aria-label={t('common', 'language')}>
          {LANGUAGES.map((option) => (
            <button
              key={option.code}
              type="button"
              className={lang === option.code ? 'active' : ''}
              onClick={() => {
                setLang(option.code)
                persistLanguage(option.code)
              }}
            >
              {option.code === 'EN' ? 'EN' : option.code === 'HI' ? 'HI' : 'PA'}
            </button>
          ))}
        </div>
      </div>
      <h2>{t('login', 'title')}</h2>
      <p className="muted">{t('login', 'subtitle')}</p>
      <OtpFlow
        key={lang}
        scope="athlete"
        gymSlug={gymSlug}
        onSuccess={done}
        labels={{
          phone: t('login', 'phone'),
          sendCode: t('login', 'sendCode'),
          code: t('login', 'code'),
          verify: t('login', 'verify'),
          sentTo: (masked) => t('login', 'sentTo', { phone: masked }),
          changeNumber: t('login', 'changeNumber'),
          resend: t('login', 'resend'),
        }}
      />
      <p className="auth-foot">{t('login', 'notMember')}</p>
    </div>
  )
}
