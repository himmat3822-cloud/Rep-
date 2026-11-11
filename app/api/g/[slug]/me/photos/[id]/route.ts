import { ok } from '@/lib/api/guard'
import { athleteRoute } from '@/lib/api/athlete'
import { errors } from '@/lib/api/errors'
import { destroyImage } from '@/lib/integrations/cloudinary'

// DELETE /api/g/{slug}/me/photos/{id}
export const DELETE = athleteRoute({}, async ({ db, me, params }) => {
  const photo = await db.progressPhoto.findFirst({ where: { id: params.id, athleteId: me.id } })
  if (!photo) throw errors.notFound('Photo')
  await destroyImage(photo.publicId, 'authenticated').catch((error) => console.error('[photos] cloudinary delete failed', photo.id, error))
  await db.progressPhoto.delete({ where: { id: photo.id } })
  return ok({ ok: true })
})
