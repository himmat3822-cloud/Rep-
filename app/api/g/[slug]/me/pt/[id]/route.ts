import { ok } from '@/lib/api/guard'
import { athleteRoute } from '@/lib/api/athlete'
import { ptAnswerSchema } from '@/lib/validation/trainer'
import { answerPtSession } from '@/lib/trainer/service'

// POST /api/g/{slug}/me/pt/{id} { action: sign | dispute, note? } - member confirms a PT session
export const POST = athleteRoute({ schema: ptAnswerSchema }, async ({ db, gym, me, params, input }) => ok(await answerPtSession(db, gym.id, me, params.id, input.action, input.note)))
