import { NextResponse } from 'next/server'
import { errorResponse } from '@/lib/api/errors'
import { endSession, readAdminSession } from '@/lib/auth/session'
import { audit } from '@/lib/audit'

export async function POST() {
  try {
    const admin = await readAdminSession()
    await endSession('admin')
    if (admin) await audit({ actorType: 'ADMIN', actorId: admin.sub, adminUserId: admin.sub, action: 'admin.logout', entity: 'AdminUser', entityId: admin.sub })
    return NextResponse.json({ ok: true })
  } catch (error) {
    return errorResponse(error)
  }
}
