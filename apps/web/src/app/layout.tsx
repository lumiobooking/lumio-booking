import type { ReactNode } from 'react';
import './globals.css';
import { AuthProvider } from '../lib/auth';
import { LangProvider } from '../lib/i18n';
import { PwaRegister } from '../components/PwaRegister';
import { themeCss } from '../lib/theme';
import { FeedbackToasts } from '../components/FeedbackToasts';
import { NavProgress } from '../components/NavProgress';

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
    <html lang="en-US">
      <head>
        {/* The two palettes. Dark sits on :root with the ORIGINAL hex values,
            so a browser that never runs the boot script renders exactly what
            shipped before this feature existed. */}
        <style dangerouslySetInnerHTML={{ __html: themeCss() }} />
        {/* Runs before paint. Reading localStorage after hydration would show
            a dark flash to every light-mode user on every single page load —
            the kind of flicker people describe as "the app feels broken". */}
        <script dangerouslySetInnerHTML={{ __html:
          `try{var t=localStorage.getItem('lumio.theme');if(t==='light'){document.documentElement.dataset.theme='light';}}catch(e){}`,
        }} />
      </head>
      <body
        style={{
          margin: 0,
          fontFamily:
            'system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif',
          background: 'var(--c0f172a)',
          color: 'var(--ce2e8f0)',
        }}
      >
        <AuthProvider><LangProvider>{children}</LangProvider></AuthProvider>
        <PwaRegister />
        <NavProgress />
        <FeedbackToasts />
      </body>
    </html>
  );
}
