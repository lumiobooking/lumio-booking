/**
 * Read a business's own website or Facebook Page, as text.
 *
 * This was written once, inside the Messenger bot's fact importer, and is now
 * needed a second time by the content engine — which asks the business what it
 * is, when the business had already published the answer on its own website.
 * Rather than a second copy that drifts, both call this.
 *
 * The parts that are load-bearing and easy to lose in a rewrite:
 *
 *   - THE BROWSER IDENTITY. Template sites for restaurants and estate agencies
 *     sit behind bot walls that 403 anything announcing itself as a crawler.
 *     The owner of the site is our own customer asking us to read it, so the
 *     request presents as the browser they would use themselves, then falls
 *     back to a plainer identity before giving up.
 *   - THE ADDRESS CHECK. This fetch runs from OUR server, so an attacker who
 *     could set the URL could otherwise point it at internal addresses and read
 *     the private network back through the response. Loopback, link-local and
 *     every private range are refused before a request is made.
 *   - THE BLOCKED-SITE MESSAGE. When a site refuses, the useful reply is not
 *     "error 403" but the two things the person can actually do instead.
 */

import { browserHeaders, urlVariants, wallMessage } from './browser-headers';
import { composeSiteText, internalLinks, pickPages, type PageRead } from './site-extract';

export interface SiteText {
  text: string;
  /** Where it came from, for the screen. */
  source: string;
}

export class SiteReadError extends Error {}

// The header set, the host variants and the wording all live in
// common/browser-headers.ts — see that file for why a Chrome user-agent alone
// was not enough to get past a bot wall.

/**
 * True when a hostname must never be fetched from the server.
 *
 * Deliberately a denylist of address SHAPES rather than a list of names: the
 * risk is a URL resolving inside our own network, and that is a property of the
 * address, not of anything a name check could catch.
 */
export function isForbiddenHost(host: string): boolean {
  if (!host) return true;
  if (host.includes(':')) return true; // raw IPv6 / explicit port
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return true; // bare IPv4
  return /^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host);
}

/** Strip a page down to readable words. */
export function htmlToText(html: string, max = 20000): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

export async function readWebsite(url: string): Promise<SiteText> {
  const clean = String(url || '').trim();
  if (!/^https?:\/\//i.test(clean)) {
    throw new SiteReadError('Cần địa chỉ đầy đủ, bắt đầu bằng https://');
  }
  const host = (() => { try { return new URL(clean).hostname; } catch { return ''; } })();
  if (isForbiddenHost(host)) throw new SiteReadError('Địa chỉ này không đọc được.');

  // Try the address as given, then its www twin. The old code retried a 403
  // as "LumioBot/1.0" — a self-declared crawler, which no wall that just
  // refused a suspicious browser is going to admit. Trying the other host
  // fixes a real class of failure; confessing to being a robot fixes none.
  const headers = browserHeaders();
  let res: Response | null = null;
  let lastStatus: number | null = null;
  for (const candidate of urlVariants(clean)) {
    const r = await fetch(candidate, { redirect: 'follow', headers, signal: AbortSignal.timeout(20_000) }).catch(() => null);
    if (r && r.ok) { res = r; break; }
    if (r) lastStatus = r.status;
    // A wall answers the same way on both hosts; a 404 might not. Either way
    // the loop is two requests at most.
  }
  if (!res || !res.ok) {
    throw new SiteReadError(wallMessage(lastStatus, true));
  }
  const homeUrl = res.url || clean;
  const homeHtml = (await res.text()).slice(0, 400_000);

  // A home page is a poster. What the business DOES lives on /services, what
  // it charges on /pricing, who it is on /about — so read up to three more,
  // one per kind, behind one overall deadline. A site that answers slowly
  // costs the reader a few seconds, never the whole import.
  const pages: PageRead[] = [{ url: homeUrl, html: homeHtml }];
  const extra = pickPages(internalLinks(homeHtml, homeUrl), homeUrl, 3);
  const deadline = Date.now() + 15_000;
  for (const link of extra) {
    if (Date.now() >= deadline) break;
    const r = await fetch(link, {
      redirect: 'follow',
      headers,
      signal: AbortSignal.timeout(Math.max(1_000, deadline - Date.now())),
    }).catch(() => null);
    if (!r || !r.ok) continue;   // one page refusing is not the site refusing
    pages.push({ url: r.url || link, html: (await r.text().catch(() => '')).slice(0, 400_000) });
  }

  const text = composeSiteText(pages);
  if (text.length < 40) throw new SiteReadError('Trang này không có đủ chữ để đọc.');
  const more = pages.length > 1 ? ` (+${pages.length - 1} trang)` : '';
  return { text, source: `Website ${host}${more}` };
}

export async function readFacebookPage(pageId: string, pageToken: string): Promise<SiteText> {
  const info = (await fetch(
    `https://graph.facebook.com/v21.0/${pageId}?fields=name,about,description,category,website,phone,emails,single_line_address,hours&access_token=${encodeURIComponent(pageToken)}`,
  ).then((r) => r.json()).catch(() => null)) as (Record<string, unknown> & { error?: { message?: string } }) | null;
  if (!info || info.error) {
    throw new SiteReadError(`Meta: ${info?.error?.message || 'không đọc được trang'}`);
  }
  const feed = (await fetch(
    `https://graph.facebook.com/v21.0/${pageId}/feed?limit=10&fields=message&access_token=${encodeURIComponent(pageToken)}`,
  ).then((r) => r.json()).catch(() => null)) as { data?: { message?: string }[] } | null;
  const posts = (feed?.data || []).map((p) => p.message).filter(Boolean).slice(0, 10);
  const text = JSON.stringify({ pageInfo: info, recentPosts: posts }).slice(0, 20_000);
  if (text.length < 40) throw new SiteReadError('Trang Facebook chưa có đủ thông tin.');
  return { text, source: `Fanpage ${String(info.name ?? pageId)}` };
}
