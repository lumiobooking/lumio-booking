import type { Metadata, Viewport } from 'next';

// The customer's "how was your visit?" page — opened from a text message or
// the QR on a receipt. Light, phone-first, nothing to install.
export const metadata: Metadata = {
  title: 'How was your visit?',
  robots: { index: false, follow: false },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#faf9f7',
};

export default function FeedbackLayout({ children }: { children: React.ReactNode }) {
  return children;
}
