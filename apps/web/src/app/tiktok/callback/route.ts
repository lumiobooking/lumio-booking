import { NextResponse, type NextRequest } from 'next/server';

/**
 * TikTok's OAuth callback, landed on the WEB domain and passed to the API.
 *
 * WHY IT IS NOT ON THE API DIRECTLY
 *
 * TikTok only accepts a redirect URI that sits under a URL property you have
 * verified in its developer portal, and its DNS check on a Cloudflare zone
 * can refuse a TXT record that is demonstrably correct and public. The other
 * way to verify a property is a signature file at the site root, and the site
 * root is this Next.js app (apps/web/public serves it). So the callback is
 * registered here, under the same origin that carries the file, and this
 * route hands the code straight on to the API that holds the client secret.
 *
 * Nothing is read or stored here: `code` and `state` travel through
 * untouched, and the API answers with the redirect the browser ends on. The
 * API's token exchange sends this exact URL as `redirect_uri`, which is what
 * TikTok compares against — a browser hop does not change that string.
 */
export const dynamic = 'force-dynamic';

export function GET(req: NextRequest) {
  const api = (process.env.NEXT_PUBLIC_API_URL ?? '').replace(/\/+$/, '');
  const qs = req.nextUrl.search;
  if (!api) {
    // Nothing to forward to. Say so on a page a person can read, rather than
    // dropping them on a blank screen with the code in the address bar.
    return NextResponse.redirect(new URL('/salon/channels?tiktok=error&msg=api_url_not_set', req.nextUrl.origin));
  }
  return NextResponse.redirect(`${api}/tiktok/callback${qs}`);
}
