import { admsText } from '@/lib/attendance/adms'

// ADMS command results (not used).
export const dynamic = 'force-dynamic'

export async function POST() {
  return admsText('OK')
}
