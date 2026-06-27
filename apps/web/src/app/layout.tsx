import type { ReactNode } from 'react';
import './globals.css';
import { AuthProvider } from '../lib/auth';
import { LangProvider } from '../lib/i18n';
import { PwaRegister } from '../components/PwaRegister';

export const metadata = {
  title: 'Lumio Booking',
  description: 'Multi-tenant booking platform for nail salons',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    title: 'Lumio',
    statusBarStyle: 'black-translucent' as const,
  },
  icons: {
    icon: '/icons/icon-192.png',
    apple: '/icons/apple-touch-icon.png',
  },
};

// Critical for mobile: scale to device width + app theme color.
export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  themeColor: '#6366f1',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          fontFamily:
            'system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif',
          background: '#0f172a',
          color: '#e2e8f0',
        }}
      >
        <AuthProvider><LangProvider>{children}</LangProvider></AuthProvider>
        <PwaRegister />
      </body>
    </html>
  );
}
