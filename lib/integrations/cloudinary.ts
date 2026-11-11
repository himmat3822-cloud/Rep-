import { createHash } from 'node:crypto'
import { optionalEnv, requireEnv } from '@/lib/env'

// Cloudinary uploads without the SDK (signed REST call).
// - Logos: type "upload" (public, CDN cached).
// - Progress photos (Phase 6): type "authenticated" + signed delivery URLs.

export function cloudinaryConfigured(): boolean {
  return Boolean(optionalEnv('CLOUDINARY_CLOUD_NAME') && optionalEnv('CLOUDINARY_API_KEY') && optionalEnv('CLOUDINARY_API_SECRET'))
}

function sign(params: Record<string, string>, secret: string): string {
  const payload = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join('&')
  return createHash('sha1').update(payload + secret).digest('hex')
}

export interface UploadResult {
  publicId: string
  secureUrl: string
  width: number
  height: number
}

export async function uploadImage(file: Blob, options: { folder: string; publicId: string; type: 'upload' | 'authenticated' }): Promise<UploadResult> {
  const cloud = requireEnv('CLOUDINARY_CLOUD_NAME')
  const params: Record<string, string> = {
    folder: options.folder,
    public_id: options.publicId,
    overwrite: 'true',
    timestamp: String(Math.floor(Date.now() / 1000)),
    type: options.type,
  }
  const form = new FormData()
  for (const [key, value] of Object.entries(params)) form.set(key, value)
  form.set('api_key', requireEnv('CLOUDINARY_API_KEY'))
  form.set('signature', sign(params, requireEnv('CLOUDINARY_API_SECRET')))
  form.set('file', file)
  const response = await fetch(`https://api.cloudinary.com/v1_1/${cloud}/image/upload`, { method: 'POST', body: form })
  const data = (await response.json().catch(() => ({}))) as { public_id?: string; secure_url?: string; width?: number; height?: number; error?: { message?: string } }
  if (!response.ok || !data.public_id) throw new Error(`Cloudinary upload failed: ${data.error?.message ?? response.statusText}`)
  return { publicId: data.public_id, secureUrl: data.secure_url ?? '', width: data.width ?? 0, height: data.height ?? 0 }
}

export function logoUrl(publicId: string | null | undefined, size = 160): string | null {
  const cloud = optionalEnv('CLOUDINARY_CLOUD_NAME')
  if (!publicId || !cloud) return null
  return `https://res.cloudinary.com/${cloud}/image/upload/c_fill,f_auto,q_auto,w_${size},h_${size}/${publicId}`
}

// Signed delivery URL for a private ("authenticated") image. The signature
// covers the transformation + public id, so the URL cannot be changed to
// fetch another photo. Only ever handed to the photo's owner (or a trainer
// the member allowed).
export function privateImageUrl(publicId: string, transformation = 'c_limit,w_900,q_auto,f_auto'): string | null {
  const cloud = optionalEnv('CLOUDINARY_CLOUD_NAME')
  const secret = optionalEnv('CLOUDINARY_API_SECRET')
  if (!cloud || !secret) return null
  const toSign = `${transformation}/${publicId}`
  const signature = createHash('sha1').update(toSign + secret).digest('base64').replace(/\+/g, '-').replace(/\//g, '_').slice(0, 8)
  return `https://res.cloudinary.com/${cloud}/image/authenticated/s--${signature}--/${toSign}`
}

export async function destroyImage(publicId: string, type: 'upload' | 'authenticated'): Promise<void> {
  if (!cloudinaryConfigured()) return
  const cloud = requireEnv('CLOUDINARY_CLOUD_NAME')
  const params: Record<string, string> = { public_id: publicId, timestamp: String(Math.floor(Date.now() / 1000)), type, invalidate: 'true' }
  const form = new FormData()
  for (const [key, value] of Object.entries(params)) form.set(key, value)
  form.set('api_key', requireEnv('CLOUDINARY_API_KEY'))
  form.set('signature', sign(params, requireEnv('CLOUDINARY_API_SECRET')))
  const response = await fetch(`https://api.cloudinary.com/v1_1/${cloud}/image/destroy`, { method: 'POST', body: form })
  if (!response.ok) throw new Error(`Cloudinary delete failed: ${response.statusText}`)
}

export const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024
