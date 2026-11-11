import { gymRoute, ok } from '@/lib/api/guard'
import { ApiError, errors } from '@/lib/api/errors'
import { cloudinaryConfigured, logoUrl, uploadImage } from '@/lib/integrations/cloudinary'

const MAX_BYTES = 2 * 1024 * 1024
const TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'])

// POST /api/gym/settings/logo (multipart, field "file") - public logo on Cloudinary
export const POST = gymRoute({ permission: 'settings.manage' }, async ({ db, gym, request }) => {
  if (!cloudinaryConfigured()) throw new ApiError(503, 'DELIVERY_FAILED', 'Logo upload is not set up yet (Cloudinary keys missing).')
  const form = await request.formData().catch(() => null)
  const file = form?.get('file')
  if (!(file instanceof Blob)) throw errors.validation('Choose an image file')
  if (!TYPES.has(file.type)) throw errors.validation('Use a PNG, JPG, WEBP or SVG image')
  if (file.size > MAX_BYTES) throw errors.validation('Logo must be under 2 MB')
  const result = await uploadImage(file, { folder: `kasrat/${gym.id}`, publicId: 'logo', type: 'upload' })
  await db.gym.update({ where: { id: gym.id }, data: { logoPublicId: result.publicId } })
  return ok({ publicId: result.publicId, url: logoUrl(result.publicId) })
})
