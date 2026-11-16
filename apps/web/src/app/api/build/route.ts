import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * KEPT ONLY TO KEEP OLD TABS QUIET. Tabs opened before 16/11/2026 run code
 * that asks this route for the live build id and shows "Đã có bản cập nhật"
 * whenever it differs from their own. The owner deploys several times a day
 * and customers must not be told each time, so this route no longer names a
 * build: the old code reads "no buildId" as "nothing to do". Those tabs pick
 * the new build up on their next full load (and a missing chunk reloads them
 * by itself — lib/stale-build). Current code asks /api/version instead.
 */
export function GET() {
  return NextResponse.json(
    { at: new Date().toISOString() },
    { headers: { 'Cache-Control': 'no-store, max-age=0' } },
  );
}
