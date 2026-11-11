import { athleteRoute } from '@/lib/api/athlete'
import { buildDataExport } from '@/lib/athlete/export'

// GET /api/g/{slug}/me/export - everything Rep+ holds about me, as JSON
export const GET = athleteRoute({}, async ({ db, gym, me }) => {
  const data = await buildDataExport(db, gym, me.id)
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="kasrat-${gym.slug}-${me.memberCode}.json"`,
      'Cache-Control': 'private, no-store',
    },
  })
})
