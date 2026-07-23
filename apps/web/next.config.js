/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Keep `next build` within the free instance's memory budget: we already run
  // `tsc --noEmit` before every deploy, so skip the redundant in-build type
  // check and lint (both fork extra memory-hungry processes), and don't emit
  // browser source maps.
  typescript: { ignoreBuildErrors: true },
  eslint: { ignoreDuringBuilds: true },
  productionBrowserSourceMaps: false,
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
      afterFiles: [
        // Short Google Business Profile link — same booking page, source stamped
        // client-side before any tag runs (see book/[slug]/layout.tsx).
        { source: '/:slug/gbp', destination: '/book/:slug/gbp' },
        { source: '/:slug', destination: '/book/:slug' },
      ],
    };
  },
};

module.exports = nextConfig;
