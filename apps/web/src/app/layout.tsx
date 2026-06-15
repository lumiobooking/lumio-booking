import type { ReactNode } from 'react';
import './globals.css';
import { AuthProvider } from '../lib/auth';

export const metadata = {
  title: 'Lumio Booking - Admin',
  description: 'Multi-tenant booking platform for nail salons',
};

// Critical for mobile: makes the page scale to the device width.
export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          fontFamily:
            'system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif',
          background: '#0f172a',
          color: '#e2e8f0',
        }}
      >
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
