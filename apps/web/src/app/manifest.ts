import type { MetadataRoute } from 'next';

// Web App Manifest -> served at /manifest.webmanifest. Makes Lumio installable
// on a phone home screen and run full-screen like a native app.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Lumio Booking',
    short_name: 'Lumio',
    description: 'Manage your salon and customer bookings',
    start_url: '/salon',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#0f172a',
    theme_color: '#6366f1',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
