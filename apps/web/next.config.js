/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  env: {
    // Base URL of the backend API (defaults to the 8005 dev port).
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8005/api',
  },
  // Clean per-salon URLs: yourdomain.com/<salon-slug> serves the booking page.
  // `afterFiles` runs AFTER real routes, so /salon, /login, /super-admin, /staff,
  // /book, /healthz, /_next, etc. still win; only an otherwise-unmatched single
  // segment (the salon slug) is rewritten to the booking page.
  async rewrites() {
    return {
      afterFiles: [{ source: '/:slug', destination: '/book/:slug' }],
    };
  },
};

module.exports = nextConfig;
