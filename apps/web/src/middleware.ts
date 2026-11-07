/**
 * The Google partner host (e.g. book.lumiobooking.com).
 *
 * Why it exists (7/11/2026): the Actions Center brand domain decides which
 * booking links Google treats as "booked through partner Lumio". Putting the
 * MAIN domain there sent every salon's Maps "Book online" button through
 * Google's own reserve page, which failed (500) while Lumio was not launched.
 * Google's partner links therefore live on their own host, and the salons'
 * everyday links (lumiobooking.com/<salon>, /gbp, their websites) are never
 * touched by anything configured for Google.
 *
 * On that host only booking pages are served — the same pages, the same
 * salon data — and they are kept out of search results (the main domain is
 * the canonical one). Everything else (sign-in, the salon admin, the agency,
 * the home page) goes back to the main domain.
 *
 * Off unless NEXT_PUBLIC_RWG_LINK_HOST is set: with it unset this does nothing.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { partnerHostVerdict } from './lib/partner-host';

export function middleware(req: NextRequest) {
  const v = partnerHostVerdict(req.headers.get('host'), req.nextUrl.pathname, process.env.NEXT_PUBLIC_RWG_LINK_HOST, process.env.NEXT_PUBLIC_WEB_URL);
  if (v.kind === 'pass') return NextResponse.next();
  if (v.kind === 'redirect') return NextResponse.redirect(`${v.to}${req.nextUrl.search}`, 308);
  const res = NextResponse.next();
  res.headers.set('X-Robots-Tag', 'noindex, nofollow');
  return res;
}

export const config = {
  // Static build files never need the check.
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
