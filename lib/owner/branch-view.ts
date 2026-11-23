import 'server-only'
import { cache } from 'react'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/db/client'
import { scopeToBranch, tenantDb, type TenantDb } from '@/lib/db/tenant'
import { getGymFeatures } from '@/lib/gym/features'
import { parseGymSettings } from '@/lib/gym/settings'

// How the owner sees a multi-branch gym.
//   combined - everything together (default; the overview has a branch switch)
//   separate - pick a branch first; every owner page then shows only that
//              branch until the owner switches.
// The chosen branch lives in a cookie per browser, so two owners (or two
// phones) can look at different branches at the same time.

export const BRANCH_COOKIE = 'k_branch'

export interface BranchView {
  // Gym has 2+ branches and the multi-branch dashboard in its plan.
  multi: boolean
  mode: 'combined' | 'separate'
  branches: { id: string; name: string }[]
  // Separate mode only: the branch being looked at (null = not chosen yet).
  branchId: string | null
  branchName: string | null
}

export function parseBranchCookie(value: string | undefined, gymId: string): string | null {
  if (!value) return null
  const [gym, branch] = value.split(':')
  return gym === gymId && branch ? branch : null
}

// Cached per request: the layout, the page and the nav all ask.
export const getBranchView = cache(async (gymId: string, isOwner: boolean): Promise<BranchView> => {
  const db = tenantDb(gymId)
  const [gym, branches, features] = await Promise.all([
    db.gym.findFirst({ select: { settings: true } }),
    db.branch.findMany({ where: { archived: false }, orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }], select: { id: true, name: true } }),
    getGymFeatures(gymId),
  ])
  const multi = branches.length > 1 && features.includes('multi_branch')
  const mode = multi && isOwner ? parseGymSettings(gym?.settings).ownerView : 'combined'
  if (mode !== 'separate') return { multi, mode: 'combined', branches, branchId: null, branchName: null }
  const chosen = parseBranchCookie((await cookies()).get(BRANCH_COOKIE)?.value, gymId)
  const branch = branches.find((b) => b.id === chosen) ?? null
  return { multi, mode, branches, branchId: branch?.id ?? null, branchName: branch?.name ?? null }
})

const branchAthletes = cache(async (gymId: string, branchId: string): Promise<string[]> => {
  const rows = await tenantDb(gymId).athlete.findMany({ where: { homeBranchId: branchId }, select: { id: true } })
  return rows.map((row) => row.id)
})

// The database an owner page should read from: one branch in separate mode
// (once chosen), the whole gym otherwise. Staff other than owners always
// get the whole gym, exactly as before.
export async function viewDb(gymId: string, isOwner: boolean): Promise<TenantDb> {
  const view = await getBranchView(gymId, isOwner)
  if (view.mode !== 'separate' || !view.branchId) return tenantDb(gymId)
  return scopeToBranch(prisma, gymId, view.branchId, await branchAthletes(gymId, view.branchId))
}

// Nav entry for owners of a multi-branch gym (null for everyone else).
export function branchNavItem(view: BranchView): { label: string } | null {
  if (!view.multi) return null
  if (view.mode === 'separate') return { label: view.branchName ?? 'Pick a branch' }
  return { label: 'All branches' }
}

// Shortcut for staff pages: owners get the branch view, other staff the gym.
export function pageDb(ctx: { gym: { id: string }; user: { kind: string } }): Promise<TenantDb> {
  return viewDb(ctx.gym.id, ctx.user.kind === 'OWNER')
}
