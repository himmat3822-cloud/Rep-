import { ok } from '@/lib/api/guard'
import { athleteRoute } from '@/lib/api/athlete'
import { ApiError, errors } from '@/lib/api/errors'
import { cloudinaryConfigured, destroyImage, IMAGE_TYPES, MAX_IMAGE_BYTES, uploadImage } from '@/lib/integrations/cloudinary'
import { istDateOnly } from '@/lib/time'
import { randomCode } from '@/lib/crypto'

// POST   /api/g/{slug}/me/photos (multipart: file, pose) - private progress photo
// DELETE /api/g/{slug}/me/photos                          - delete ALL my photos
export const POST = athleteRoute({ feature: 'progress_tracking' }, async ({ request, db, gym, me }) => {
  if (!cloudinaryConfigured()) throw new ApiError(503, 'DELIVERY_FAILED', 'Photo upload is not set up at this gym yet.')
  const form = await request.formData().catch(() => null)
  const file = form?.get('file')
  const pose = String(form?.get('pose') ?? 'front')
  if (!(file instanceof Blob)) throw errors.validation('Pick a photo')
  if (!IMAGE_TYPES.has(file.type)) throw errors.validation('Use a JPG, PNG, WEBP or HEIC photo')
  if (file.size > MAX_IMAGE_BYTES) throw errors.validation('Photo is too big (max 8 MB)')
  if (!['front', 'side', 'back'].includes(pose)) throw errors.validation('Pick front, side or back')
  const count = await db.progressPhoto.count({ where: { athleteId: me.id } })
  if (count >= 200) throw errors.validation('You have 200 photos. Delete some old ones first.')
  // Private ("authenticated") delivery: only signed URLs can show it.
  const uploaded = await uploadImage(file, { folder: `kasrat/${gym.id}/progress/${me.id}`, publicId: randomCode(16), type: 'authenticated' })
  const photo = await db.progressPhoto.create({ data: { gymId: gym.id, athleteId: me.id, publicId: uploaded.publicId, takenOn: istDateOnly(), pose } })
  return ok({ id: photo.id }, { status: 201 })
})

export const DELETE = athleteRoute({}, async ({ db, me }) => {
  const photos = await db.progressPhoto.findMany({ where: { athleteId: me.id } })
  for (const photo of photos) {
    await destroyImage(photo.publicId, 'authenticated').catch((error) => console.error('[photos] cloudinary delete failed', photo.id, error))
  }
  const removed = await db.progressPhoto.deleteMany({ where: { athleteId: me.id } })
  return ok({ deleted: removed.count })
})
