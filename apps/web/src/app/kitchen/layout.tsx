import type { Metadata, Viewport } from 'next';

// The kitchen tablet: one full-screen page, never indexed.
export const metadata: Metadata = {
  title: 'Kitchen · Lumio',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function KitchenLayout({ children }: { children: React.ReactNode }) {
  return children;
}
