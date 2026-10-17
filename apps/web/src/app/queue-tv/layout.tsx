import type { Metadata, Viewport } from 'next';

// The waiting-area TV: the queue for customers, readable across the room.
// Sign in once on that device as the owner or the front desk.
export const metadata: Metadata = {
  title: 'Lumio — Queue',
  applicationName: 'Lumio Queue',
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'Queue' },
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

export default function QueueTvLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
