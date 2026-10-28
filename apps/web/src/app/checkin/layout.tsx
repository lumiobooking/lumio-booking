import type { Metadata, Viewport } from 'next';
import { FixedPalette } from '../../components/FixedPalette';

// Self check-in kiosk. Same install story as the customer display: Safari →
// Share → Add to Home Screen gives a full-screen app with no browser chrome,
// and iOS Guided Access locks the iPad to this one page.
export const metadata: Metadata = {
  title: 'Check in',
  applicationName: 'Lumio Check-in',
  // Its OWN manifest: the display one is scoped to /display, so a tablet that
  // installed /checkin through it would relaunch on the customer display.
  manifest: '/checkin.webmanifest',
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'Check in' },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  // Android Chrome lays its keyboard OVER the page by default, so the name
  // field, the heading and Continue sat under the keys. Resize the page with
  // the keyboard instead; the kiosk goes compact when it shrinks (page.tsx).
  interactiveWidget: 'resizes-content',
  // A real colour: a CSS variable is not valid in <meta name="theme-color">.
  themeColor: '#faf9f7',
};

export default function CheckInLayout({ children }: { children: React.ReactNode }) {
  // The customer sees a fixed light design, never the salon's dark/light switch.
  return <><FixedPalette />{children}</>;
}
