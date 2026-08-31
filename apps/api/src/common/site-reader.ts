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

export interface SiteText {
  text: string;
  /** Where it came from, for the screen. */
  source: string;
}

export class SiteReadError extends Error {}

const BROWSER_HEADERS = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'accept-language': 'en-US,en;q=0.9,vi;q=0.8',
};

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

  let res = await fetch(clean, { redirect: 'follow', headers: BROWSER_HEADERS }).catch(() => null);
  if (res && !res.ok && [403, 406, 503].includes(res.status)) {
    res = await fetch(clean, {
      redirect: 'follow',
      headers: { 'user-agent': 'LumioBot/1.0 (+https://lumiobooking.com)', accept: 'text/html' },
    }).catch(() => res);
  }
  if (!res || !res.ok) {
    throw new SiteReadError(
      res && [403, 406, 503].includes(res.status)
        ? `Website này chặn đọc tự động (${res.status}). Thử nút đọc từ Fanpage, hoặc mở website → chọn hết chữ (Ctrl+A, Ctrl+C) → dán vào ô mô tả.`
        : `Không tải được trang${res ? ` (${res.status})` : ''}.`,
    );
  }
  const text = htmlToText((await res.text()).slice(0, 400_000));
  if (text.length < 40) throw new SiteReadError('Trang này không có đủ chữ để đọc.');
  return { text, source: `Website ${host}` };
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
