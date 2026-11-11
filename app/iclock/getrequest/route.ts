import { prisma } from '@/lib/db/client'
import { admsText } from '@/lib/attendance/adms'

// ADMS heartbeat: the device asks for commands. We have none.
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const serial = new URL(request.url).searchParams.get('SN') ?? ''
  if (serial) await prisma.attendanceDevice.updateMany({ where: { serialNumber: serial }, data: { lastSeenAt: new Date() } })
  return admsText('OK')
}
