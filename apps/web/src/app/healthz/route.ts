import { NextResponse } from 'next/server';

// Lightweight liveness endpoint used by the keep-alive pinger to wake/keep the
// web service warm without rendering a full page. Always 200, no caching.
export const dynamic = 'force-dynamic';

export function GET() {
  return NextResponse.json(
    { status: 'ok', service: 'lumio-booking-web', timestamp: new Date().toISOString() },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
