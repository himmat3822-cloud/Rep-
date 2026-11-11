import type { Metadata } from 'next'
import { AttendanceView } from '@/components/attendance/views'
import { requireStaffPage } from '@/lib/auth/page'

export const metadata: Metadata = { title: 'Attendance - Rep+' }

export default async function OwnerAttendancePage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const ctx = await requireStaffPage(['OWNER'])
  const { tab } = await searchParams
  return <AttendanceView ctx={ctx} basePath="/owner/attendance" tab={tab ?? 'insights'} title="Attendance" />
}
