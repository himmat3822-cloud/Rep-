import { ok } from '@/lib/api/guard'
import { athleteRoute } from '@/lib/api/athlete'
import { errors } from '@/lib/api/errors'
import { feedbackSchema } from '@/lib/validation/athlete'
import { cloudinaryConfigured, IMAGE_TYPES, MAX_IMAGE_BYTES, uploadImage } from '@/lib/integrations/cloudinary'
import { notifyStaff } from '@/lib/athlete/notify'
import { hitRateLimit } from '@/lib/rate-limit'
import { prisma } from '@/lib/db/client'
import { randomCode } from '@/lib/crypto'

// POST /api/g/{slug}/me/feedback (multipart: kind, title, body, photo?) - feedback or broken equipment
export const POST = athleteRoute({}, async ({ request, db, gym, me }) => {
  const limit = await hitRateLimit(prisma, `feedback:${me.id}`, 6, 3600)
  if (!limit.ok) throw errors.rateLimited(limit.retryAfterSeconds)
  const form = await request.formData().catch(() => null)
  if (!form) throw errors.validation('Send the form')
  const parsed = feedbackSchema.safeParse({ kind: form.get('kind'), title: form.get('title'), body: form.get('body') ?? '' })
  if (!parsed.success) throw errors.validation(parsed.error.issues[0]?.message ?? 'Check the form', parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })))
  const photo = form.get('photo')
  let photoPublicId: string | null = null
  if (photo instanceof Blob && photo.size > 0) {
    if (!IMAGE_TYPES.has(photo.type)) throw errors.validation('Use a JPG, PNG, WEBP or HEIC photo')
    if (photo.size > MAX_IMAGE_BYTES) throw errors.validation('Photo is too big (max 8 MB)')
    if (cloudinaryConfigured()) {
      const uploaded = await uploadImage(photo, { folder: `kasrat/${gym.id}/complaints`, publicId: randomCode(16), type: 'authenticated' })
      photoPublicId = uploaded.publicId
    }
  }
  const complaint = await db.complaint.create({
    data: { gymId: gym.id, branchId: me.homeBranchId, athleteId: me.id, kind: parsed.data.kind, title: parsed.data.title, body: parsed.data.body, photoPublicId },
  })
  const label = parsed.data.kind === 'EQUIPMENT' ? 'Broken equipment' : parsed.data.kind === 'FEEDBACK' ? 'Feedback' : parsed.data.kind.charAt(0) + parsed.data.kind.slice(1).toLowerCase()
  await notifyStaff(db, gym.id, { title: `${label}: ${parsed.data.title}`, body: `From ${me.name}. ${parsed.data.body}`.slice(0, 280), href: `/owner/members/${me.id}` })
  return ok({ id: complaint.id }, { status: 201 })
})
