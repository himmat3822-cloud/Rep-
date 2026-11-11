import { Analytics } from '@vercel/analytics/next'
import type { Metadata, Viewport } from 'next'
import { Toaster } from 'sonner'
import { Suspense } from 'react'
import './globals.css'
import './theme.css'
import './motion.css'
import '@fontsource-variable/big-shoulders-display'
import { THEME_SCRIPT, ThemeToggle } from '@/components/theme/theme-toggle'
import { MotionLayer } from '@/components/motion/motion-layer'

export const metadata: Metadata = {
  title: 'Rep+ - Strength in every day',
  description: 'The operating system for modern Indian gyms and the members who show up.',
  applicationName: 'Rep+',
  icons: {
    icon: [
      {
        url: '/icon-light-32x32.png',
        media: '(prefers-color-scheme: light)',
      },
      {
        url: '/icon-dark-32x32.png',
        media: '(prefers-color-scheme: dark)',
      },
      {
        url: '/icon.svg',
        type: 'image/svg+xml',
      },
    ],
    apple: '/apple-icon.png',
  },
}

export const viewport: Viewport = {
  colorScheme: 'light dark',
  themeColor: '#18211e',
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="antialiased">
        {children}
        <Suspense fallback={null}>
          <MotionLayer />
        </Suspense>
        <ThemeToggle floating />
        <Toaster position="top-center" richColors closeButton />
        {process.env.NODE_ENV === 'production' && <Analytics />}
      </body>
    </html>
  )
}
