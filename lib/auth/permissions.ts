// Permission-based RBAC. Roles are just bundles of these keys. Route handlers
// check permissions, never role names.

export const PERMISSIONS = [
  'dashboard.view',
  'members.read',
  'members.write',
  'members.delete',
  'attendance.read',
  'attendance.checkin',
  'payments.read',
  'payments.collect',
  'payments.refund',
  'invoices.issue',
  'dues.manage',
  'reminders.manage',
  'plans.manage',
  'staff.manage',
  'settings.manage',
  'billing.manage',
  'reports.read',
  'reports.export',
  'leads.manage',
  'risk.manage',
  'workouts.manage',
  'pt.log',
  'progress.read',
  'announcements.manage',
  'challenges.manage',
  'complaints.manage',
  'expenses.manage',
  'slots.manage',
  'freeze.approve',
  'audit.read',
] as const

export type Permission = (typeof PERMISSIONS)[number]

const PERMISSION_SET: ReadonlySet<string> = new Set(PERMISSIONS)

export function isPermission(value: string): value is Permission {
  return PERMISSION_SET.has(value)
}

export const SYSTEM_ROLES: Record<'OWNER' | 'DESK' | 'TRAINER', { name: string; permissions: Permission[] }> = {
  OWNER: {
    name: 'Owner',
    permissions: [...PERMISSIONS],
  },
  DESK: {
    name: 'Front desk',
    permissions: [
      'dashboard.view',
      'members.read',
      'members.write',
      'attendance.read',
      'attendance.checkin',
      'payments.read',
      'payments.collect',
      'invoices.issue',
      'dues.manage',
      'leads.manage',
      'complaints.manage',
      'freeze.approve',
    ],
  },
  TRAINER: {
    name: 'Trainer',
    permissions: ['dashboard.view', 'members.read', 'attendance.read', 'workouts.manage', 'pt.log', 'progress.read'],
  },
}

// Final permissions = role bundle + per-user grants - per-user denies.
// Unknown keys are dropped so a typo in the DB can never grant anything.
export function resolvePermissions(rolePermissions: readonly string[], grants: readonly string[] = [], denies: readonly string[] = []): Permission[] {
  const result = new Set<Permission>()
  for (const key of [...rolePermissions, ...grants]) {
    if (isPermission(key)) result.add(key)
  }
  for (const key of denies) {
    if (isPermission(key)) result.delete(key)
  }
  return [...result].sort()
}

export function hasPermission(granted: readonly string[], needed: Permission | readonly Permission[]): boolean {
  const list = Array.isArray(needed) ? needed : [needed as Permission]
  return list.every((permission) => granted.includes(permission))
}
