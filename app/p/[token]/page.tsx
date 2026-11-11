import type { Metadata } from 'next'
import QRCode from 'qrcode'
import { CheckCircle2, ShieldCheck, Smartphone } from 'lucide-react'
import { Brand } from '@/components/brand'
import { loadPayPage } from '@/lib/messaging/pay-page'
import { upiLink } from '@/lib/platform/payment-details'
import { translator } from '@/lib/i18n'
import { formatInr } from '@/lib/money'
import { formatIstDate } from '@/lib/time'

export const metadata: Metadata = { title: 'Payment - Rep+', robots: { index: false, follow: false } }
export const dynamic = 'force-dynamic'

// Public pay page linked from WhatsApp dues reminders.
export default async function PayPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const data = await loadPayPage(token)
  const t = translator(data?.language ?? 'EN')

  if (!data) {
    return (
      <main className="pay-page">
        <div className="pay-card">
          <Brand />
          <p className="pay-msg">{t('pay', 'invalid')}</p>
        </div>
      </main>
    )
  }

  const upi = data.status === 'OPEN' && data.upiId ? upiLink(data.upiId, data.gymName, data.amountPaise, `${data.memberCode} dues`) : null
  const qrSvg = upi ? await QRCode.toString(upi, { type: 'svg', margin: 1, width: 220, color: { dark: '#18211e', light: '#ffffff' } }) : null

  return (
    <main className="pay-page">
      <div className="pay-card">
        <Brand />
        <p className="kicker" style={{ marginTop: 18 }}>
          {data.gymName.toUpperCase()} - {data.gymCity.toUpperCase()}
        </p>
        <h1>{data.status === 'OPEN' ? t('pay', 'title') : t('pay', 'hello', { name: data.firstName })}</h1>

        {data.status === 'OPEN' ? (
          <>
            <p className="muted">{t('pay', 'hello', { name: data.firstName })}</p>
            <div className="pay-amount">
              <small>{t('pay', 'amountDue')}</small>
              <strong>{formatInr(data.amountPaise)}</strong>
              <small>{t('pay', 'dueOn', { date: formatIstDate(data.dueDate, { day: 'numeric', month: 'short', year: 'numeric' }) })}</small>
            </div>
            {upi ? (
              <>
                <a className="btn btn-lime btn-block" href={upi}>
                  <Smartphone /> {t('pay', 'payUpi')}
                </a>
                <p className="muted" style={{ marginTop: 16 }}>
                  {t('pay', 'scan')}
                </p>
                {qrSvg ? <div className="pay-qr" dangerouslySetInnerHTML={{ __html: qrSvg }} /> : null}
                <p className="muted">
                  {t('pay', 'upiId')}: <strong>{data.upiId}</strong>
                </p>
                <p className="pay-msg">{t('pay', 'afterPay', { gym: data.gymName })}</p>
              </>
            ) : (
              <p className="pay-msg">{t('pay', 'noUpi')}</p>
            )}
          </>
        ) : (
          <p className="pay-msg pay-done">
            <CheckCircle2 /> {t('pay', 'paid')}
          </p>
        )}
        <p className="pay-foot">
          <ShieldCheck /> {t('pay', 'poweredBy')}
        </p>
      </div>
    </main>
  )
}
