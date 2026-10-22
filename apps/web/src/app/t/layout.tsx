import type { Metadata, Viewport } from 'next';

// The guest's table page — opened by scanning the QR code on a restaurant
// table. Light, phone-first, nothing to install, never indexed.
export const metadata: Metadata = {
  title: 'Menu',
  robots: { index: false, follow: false },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#fffaf5',
};

export default function TableLayout({ children }: { children: React.ReactNode }) {
  return children;
}
