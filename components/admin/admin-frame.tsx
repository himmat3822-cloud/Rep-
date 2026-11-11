import type { ReactNode } from 'react'
import { AppShell } from '@/components/shell/app-shell'
import { requireAdminPage } from '@/lib/auth/page'
import { adminNav } from '@/lib/nav'

// Every /admin page renders inside this frame (separate admin session).
export async function AdminFrame({ title, kicker = 'Rep+ platform', children }: { title: string; kicker?: string; children: ReactNode }) {
  const { admin } = await requireAdminPage()
  return (
    <AppShell workspace="SUPER ADMIN" kicker={kicker} title={title} sections={adminNav()} profile={{ name: admin.name, subtitle: `Admin - ${admin.adminId}` }} logout="admin">
      {children}
    </AppShell>
  )
}
