import { NextResponse } from 'next/server';

// Never cached: the browser asks this route "which build is live right now?"
export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * Build identity of the running deployment. The client bundle carries the SAME
 * value baked in at build time (NEXT_PUBLIC_BUILD_ID), so a mismatch means the
 * tab is running code from an older deploy and should reload. Without this a
 * long-open admin tab keeps serving yesterday's JavaScript and every fix looks
 * like it "didn't deploy".
 */
export function GET() {
  return NextResponse.json(
    { buildId: process.env.NEXT_PUBLIC_BUILD_ID ?? 'dev', at: new Date().toISOString() },
    { headers: { 'Cache-Control': 'no-store, max-age=0' } },
  );
}
