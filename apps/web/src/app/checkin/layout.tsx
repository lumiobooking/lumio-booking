import type { Metadata, Viewport } from 'next';

// Self check-in kiosk. Same install story as the customer display: Safari →
// Share → Add to Home Screen gives a full-screen app with no browser chrome,
// and iOS Guided Access locks the iPad to this one page.
export const metadata: Metadata = {
  title: 'Check in',
  applicationName: 'Lumio Check-in',
  manifest: '/display.webmanifest',
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'Check in' },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  themeColor: '#0b1120',
};

export default function CheckInLayout({ children }: { children: React.ReactNode }) {
  return children;
}
