import { NextResponse } from 'next/server';

// Never cached: the browser asks this route "which build is live right now?"
export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * Build identity of the running deployment, for PwaRegister's SILENT move to
 * a new build (never a bar — see components/PwaRegister). The client bundle
 * carries the same value baked in at build time (NEXT_PUBLIC_BUILD_ID).
 *
 * This is a new address on purpose: /api/build is what the tabs opened BEFORE
 * 16/11/2026 ask, and their code answers a new build id with the "Đã có bản
 * cập nhật" bar. That route now names no build, so those tabs stay quiet.
 */
export function GET() {
  return NextResponse.json(
    { buildId: process.env.NEXT_PUBLIC_BUILD_ID ?? 'dev', at: new Date().toISOString() },
    { headers: { 'Cache-Control': 'no-store, max-age=0' } },
  );
}
