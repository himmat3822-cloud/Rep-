import type { StaffClaims } from '@/lib/auth/jwt'
import type { RequestMeta } from '@/lib/auth/session'
import { errors } from '@/lib/api/errors'
import type { Actor } from './money'

// Who is acting, for audit logs. When a super admin impersonates, the
// admin id is recorded as well.
export function actorFrom(staff: StaffClaims | null, meta: RequestMeta): Actor {
  if (!staff) throw errors.forbidden()
  return { staffId: staff.sub, impersonatedBy: staff.imp ?? null, ip: meta.ip ?? null }
}
