import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import QRCode from 'qrcode'
import { Brand } from '@/components/brand'
import { PrintButton } from '@/components/attendance/print-button'
import { requireStaffPage } from '@/lib/auth/page'
import { tenantDb } from '@/lib/db/tenant'
import { entranceSignature } from '@/lib/attendance/qr'
import { appUrl } from '@/lib/env'
import { translate } from '@/lib/i18n'

export const metadata: Metadata = { title: 'Entrance QR poster - Rep+' }

// Printable A4 poster for self check-in at the entrance. The QR is a link,
// so members scan it with their normal phone camera.
export default async function PosterPage({ params }: { params: Promise<{ branchId: string }> }) {
  const ctx = await requireStaffPage(['OWNER'])
  const { branchId } = await params
  const branch = await tenantDb(ctx.gym.id).branch.findFirst({ where: { id: branchId } })
  if (!branch) notFound()
  const url = `${appUrl()}/g/${ctx.gym.slug}/checkin?b=${branch.id}&s=${entranceSignature(branch.id, branch.entranceQrSecret)}`
  const svg = await QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#18211e', light: '#ffffff' } })
  return (
    <main style={{ padding: 20 }}>
      <div className="no-print" style={{ textAlign: 'center' }}>
        <PrintButton />
      </div>
      <div className="poster">
        <Brand />
        <h1>{translate('EN', 'checkin', 'posterTitle')}</h1>
        <p>
          <strong>{ctx.gym.name}</strong> - {branch.name}
        </p>
        <div className="qr" dangerouslySetInnerHTML={{ __html: svg }} />
        <div className="langs">
          <p>{translate('EN', 'checkin', 'posterSteps')}</p>
          <p>{translate('HI', 'checkin', 'posterSteps')}</p>
          <p>{translate('PA', 'checkin', 'posterSteps')}</p>
        </div>
      </div>
    </main>
  )
}
