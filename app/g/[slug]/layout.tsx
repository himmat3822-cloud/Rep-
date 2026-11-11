import type { Metadata, Viewport } from 'next'
import type { ReactNode } from 'react'

// Athlete PWA: per-gym manifest + iOS home-screen settings.
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  return {
    manifest: `/g/${slug}/manifest.webmanifest`,
    appleWebApp: { capable: true, title: 'Rep+', statusBarStyle: 'default' },
    icons: { apple: '/pwa/apple-touch-icon.png' },
    formatDetection: { telephone: false },
  }
}

export const viewport: Viewport = {
  themeColor: '#18211e',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
}

export default function AthleteLayout({ children }: { children: ReactNode }) {
  return children
}
