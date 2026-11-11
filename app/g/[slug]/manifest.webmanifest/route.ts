import { prisma } from '@/lib/db/client'
import { logoUrl } from '@/lib/integrations/cloudinary'

// GET /g/{slug}/manifest.webmanifest - per-gym install manifest, so the app
// on the home screen carries the gym's name (and logo when uploaded).
export const dynamic = 'force-dynamic'

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const gym = await prisma.gym.findUnique({ where: { slug }, select: { name: true, logoPublicId: true } })
  if (!gym) return new Response('Not found', { status: 404 })
  const base = `/g/${slug}`
  const logo192 = logoUrl(gym.logoPublicId, 192)
  const logo512 = logoUrl(gym.logoPublicId, 512)
  const manifest = {
    id: base,
    name: `${gym.name} - Rep+`,
    short_name: gym.name.length > 12 ? gym.name.split(' ')[0] : gym.name,
    description: `Your ${gym.name} app: check-in QR, workouts, slots and plans.`,
    start_url: `${base}?source=pwa`,
    scope: `${base}/`,
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#f3f5ee',
    theme_color: '#18211e',
    icons: [
      ...(logo192 && logo512
        ? [
            { src: logo192, sizes: '192x192', type: 'image/png', purpose: 'any' },
            { src: logo512, sizes: '512x512', type: 'image/png', purpose: 'any' },
          ]
        : [
            { src: '/pwa/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
            { src: '/pwa/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          ]),
      { src: '/pwa/icon-192-maskable.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/pwa/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      { name: 'My QR', url: `${base}/qr`, icons: [{ src: '/pwa/icon-192.png', sizes: '192x192' }] },
      { name: 'Book a slot', url: `${base}/schedule`, icons: [{ src: '/pwa/icon-192.png', sizes: '192x192' }] },
    ],
  }
  return new Response(JSON.stringify(manifest), { headers: { 'Content-Type': 'application/manifest+json', 'Cache-Control': 'public, max-age=3600' } })
}
