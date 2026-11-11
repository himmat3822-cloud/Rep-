import type { Metadata } from 'next'
import { CollectView } from '@/components/members/views'
import { requireStaffPage } from '@/lib/auth/page'

export const metadata: Metadata = { title: 'Collect payment - Rep+' }

export default async function CollectPage() {
  const ctx = await requireStaffPage(['DESK', 'OWNER'])
  return <CollectView ctx={ctx} base="/desk" />
}
