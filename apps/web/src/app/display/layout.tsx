import type { Metadata, Viewport } from 'next';

// Makes the customer display installable as a full-screen "app" on the iPad:
// Safari → Share → Add to Home Screen → launches with NO browser chrome
// (address bar / tabs gone), edge-to-edge. Combine with iOS Guided Access to
// lock the iPad to this one screen (kiosk mode).
export const metadata: Metadata = {
  title: 'Lumio — Customer Display',
  applicationName: 'Lumio Display',
  // Android/Chrome: a display-scoped manifest with "display: fullscreen" so the
  // installed app hides the status bar too (true edge-to-edge), without changing
  // the app-wide manifest used by the loyalty/home-screen app.
  manifest: '/display.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Lumio Display',
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover', // draw under the notch / rounded corners, truly full-bleed
  themeColor: '#0f172a',
};

export default function DisplayLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
