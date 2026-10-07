import type { Metadata, Viewport } from 'next';

// The break-room TV: the rotation, big enough to read from across the room.
// Same install story as the customer display (Add to Home Screen → no browser
// chrome). Sign in once on that device as the owner or the front desk.
export const metadata: Metadata = {
  title: 'Lumio — Turns',
  applicationName: 'Lumio Turns',
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'Turns' },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  themeColor: 'var(--c0b1120)',
};

export default function TurnsTvLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
