import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import { I18nProvider } from '@/components/I18nProvider'
import { SyncProvider } from '@/components/SyncProvider'
import { VaultProvider } from '@/components/VaultContext'
import { SessionProvider } from '@/components/SessionProvider'

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' })
import BrowserZoomGuard from '@/components/BrowserZoomGuard'
import PWAInstallPrompt from '@/components/PWAInstallPrompt'
import ServiceWorkerRegister from '@/components/ServiceWorkerRegister'
import SoftReload from '@/components/SoftReload'
import 'react-pdf/dist/Page/AnnotationLayer.css'
import 'react-pdf/dist/Page/TextLayer.css'
import './globals.css'

export const metadata: Metadata = {
  title: 'Kişisel Kütüphane',
  description: 'Not, çizim, çeviri ve kelime kütüphanesi olan kişisel PDF okuyucu',
  manifest: '/manifest.json',
  icons: {
    icon: [
      { url: '/favicon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [
      { url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
    ],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black',
    title: 'Kütüphane',
  },
}

export const viewport: Viewport = {
  themeColor: '#0f172a',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="tr" className={inter.variable}>
      <head>
        <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
        <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png" />
      </head>
      <body className="bg-slate-900 text-white min-h-screen">
        <VaultProvider>
          <SessionProvider>
            <I18nProvider>
              <SyncProvider>
                {children}
                <ServiceWorkerRegister />
                <PWAInstallPrompt />
                <BrowserZoomGuard />
                <SoftReload />
              </SyncProvider>
            </I18nProvider>
          </SessionProvider>
        </VaultProvider>
      </body>
    </html>
  )
}
