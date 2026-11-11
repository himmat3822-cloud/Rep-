import { prisma } from '@/lib/db/client'
import { parseAdmsAttlog } from '@/lib/attendance/devices'
import { acceptPunches } from '@/lib/attendance/device-auth'
import { admsOptions, admsText } from '@/lib/attendance/adms'

// ZKTeco / eSSL ADMS ("Cloud server") push endpoint.
// On the device: Menu > Comm > Cloud Server Setting > server = your domain, port 443, HTTPS on.
// GET  /iclock/cdata?SN=XXXX&options=all  -> handshake
// POST /iclock/cdata?SN=XXXX&table=ATTLOG -> punches, one per line
// Devices are identified by serial number (register it in Settings > Attendance).
// We always answer 200 so a device never gets stuck retrying.

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const serial = new URL(request.url).searchParams.get('SN') ?? ''
  const device = serial ? await prisma.attendanceDevice.findUnique({ where: { serialNumber: serial } }) : null
  if (!device) return admsText('OK')
  await prisma.attendanceDevice.update({ where: { id: device.id }, data: { lastSeenAt: new Date() } })
  return admsText(admsOptions(serial))
}

export async function POST(request: Request) {
  const url = new URL(request.url)
  const serial = url.searchParams.get('SN') ?? ''
  const table = (url.searchParams.get('table') ?? '').toUpperCase()
  const body = await request.text()
  const device = serial ? await prisma.attendanceDevice.findUnique({ where: { serialNumber: serial } }) : null
  if (!device) {
    console.warn('[adms] unknown device serial', serial)
    return admsText('OK')
  }
  if (table !== 'ATTLOG') {
    await prisma.attendanceDevice.update({ where: { id: device.id }, data: { lastSeenAt: new Date() } })
    return admsText('OK')
  }
  const punches = parseAdmsAttlog(body)
  const outcome = await acceptPunches(device, request, punches)
  if (!outcome.ok) console.warn('[adms] rejected', serial, outcome.message)
  return admsText(`OK: ${punches.length}`)
}
