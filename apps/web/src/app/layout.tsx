import type { ReactNode } from 'react';
import { Be_Vietnam_Pro } from 'next/font/google';
import './globals.css';
import { AuthProvider } from '../lib/auth';
import { LangProvider } from '../lib/i18n';
import { PwaRegister } from '../components/PwaRegister';
import { themeCss } from '../lib/theme';
import { FeedbackToasts } from '../components/FeedbackToasts';
import { NavProgress } from '../components/NavProgress';
import { NativeBridge } from '../components/NativeBridge';

/**
 * THE TYPEFACE.
 *
 * The app ran on `system-ui`, which is not one typeface but three: Segoe UI on
 * Windows, SF Pro on an iPhone, Roboto on Android. Three shops looking at the
 * same screen saw three different screens, and the one that suffered most was
 * Vietnamese — Segoe UI sets the stacked marks (ẫ, ợ, ễ) high and loose, so a
 * list of customer names looked ragged for no reason anybody could name.
 *
 * Be Vietnam Pro was drawn for Vietnamese: the marks sit tight to the letter
 * and the tone marks are spaced for it. next/font downloads it at BUILD time
 * and serves it from our own domain, so there is no request to Google from a
 * customer's browser and no flash of a different face on load.
 */
const appFont = Be_Vietnam_Pro({
  subsets: ['latin', 'vietnamese'],
  weight: ['400', '500', '600', '700', '800'],
  display: 'swap',
  variable: '--font-app',
  // Metric-matched fallback: if the font is still arriving, the substitute is
  // scaled to occupy the same space, so nothing on the page shifts when it
  // lands. Without this a whole inbox jumps once per cold load.
  adjustFontFallback: true,
});

export const metadata = {
  title: 'Lumio Booking',
  description: 'Multi-tenant booking platform for nail salons',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    title: 'Lumio',
    // 'default' = iOS draws its own opaque status bar and the app starts
    // BELOW it. 'black-translucent' laid the page under the clock and notch,
    // and nothing on the ~100 screens pads for that, so an installed app's
    // header sat behind the status bar.
    statusBarStyle: 'default' as const,
  },
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: '48x48' },
      { url: '/icons/favicon-16.png', sizes: '16x16', type: 'image/png' },
      { url: '/icons/favicon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
    ],
    shortcut: '/favicon.ico',
    apple: '/icons/apple-touch-icon.png',
  },
};

// Critical for mobile: scale to device width + app theme color.
export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  // Lets env(safe-area-inset-*) report the iPhone home indicator and the
  // landscape notch, so the bottom tab bar and page edges can pad for them
  // (MobileTabBar, SalonShell, StaffShell and globals.css already do).
  viewportFit: 'cover' as const,
  // The brand blue of the mark, so the phone's status bar and the install
  // splash match the icon on the home screen.
  themeColor: '#0a80f5',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-US" className={appFont.variable}>
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
            'var(--font-app), system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif',
          background: 'var(--c0f172a)',
          color: 'var(--ce2e8f0)',
        }}
      >
        <AuthProvider><LangProvider>{children}<PwaRegister /><NativeBridge /></LangProvider></AuthProvider>
        <NavProgress />
        <FeedbackToasts />
      </body>
    </html>
  );
}
