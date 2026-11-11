import type { Metadata } from 'next'
import { AttendanceView } from '@/components/attendance/views'
import { requireStaffPage } from '@/lib/auth/page'

export const metadata: Metadata = { title: 'Check-in - Rep+' }

export default async function DeskScannerPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const ctx = await requireStaffPage(['DESK', 'OWNER'])
  const { tab } = await searchParams
  return <AttendanceView ctx={ctx} basePath="/desk/scanner" tab={tab ?? 'desk'} title="Check-in" />
}
