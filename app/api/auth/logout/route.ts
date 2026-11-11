import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { errorResponse } from '@/lib/api/errors'
import { endSession } from '@/lib/auth/session'

const schema = z.object({ as: z.enum(['staff', 'athlete']).default('staff') })

// POST /api/auth/logout?as=staff|athlete  -> revokes the refresh token family
export async function POST(request: NextRequest) {
  try {
    const { as } = schema.parse(Object.fromEntries(request.nextUrl.searchParams.entries()))
    await endSession(as)
    return NextResponse.json({ ok: true })
  } catch (error) {
    return errorResponse(error)
  }
}
