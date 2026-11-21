import type { Metadata } from 'next'
import { StaffShell } from '@/components/staff/staff-shell'
import { ImportWizard } from '@/components/members/import-wizard'
import { requireStaffPage } from '@/lib/auth/page'
import { tenantDb } from '@/lib/db/tenant'
import { hasPermission } from '@/lib/auth/permissions'

export const metadata: Metadata = { title: 'Import members - Rep+' }

export default async function ImportMembersPage() {
  const ctx = await requireStaffPage(['OWNER'])
  const branches = await tenantDb(ctx.gym.id).branch.findMany({ where: { archived: false }, orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }], select: { id: true, name: true } })
  return (
    <StaffShell ctx={ctx} title={`Import ${ctx.gym.athleteLabelPlural.toLowerCase()}`}>
      {hasPermission(ctx.claims.perms, 'members.write') ? <ImportWizard branches={branches} membersHref="/owner/members" /> : <p className="muted">You need permission to add members.</p>}
    </StaffShell>
  )
}
