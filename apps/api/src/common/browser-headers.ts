/**
 * LOOKING LIKE A BROWSER WELL ENOUGH TO BE LET IN.
 *
 * THE 403 THIS FIXES
 *
 * "Read website" returned 403 on sites the salon opens fine in Chrome. The
 * reader was already sending a Chrome user-agent, so the obvious explanation —
 * "it announces itself as a bot" — was wrong. The real one is worse and more
 * interesting:
 *
 *   A request that CLAIMS to be Chrome but carries none of Chrome's other
 *   headers is more suspicious than one that claims nothing at all.
 *
 * Every modern Chrome request carries `sec-ch-ua`, `sec-fetch-mode`,
 * `sec-fetch-site`, `sec-fetch-dest`, `upgrade-insecure-requests` and an
 * `accept-encoding`. A WAF (Cloudflare, Akamai, the big real-estate CMSs)
 * checks that set against the user-agent string. A user-agent saying
 * "Chrome/126" with no client hints and no Sec-Fetch headers matches nothing
 * any real Chrome has ever sent, and that MISMATCH is the signature it blocks.
 *
 * The stale version compounded it: the reader claimed Chrome 126 while the
 * world was on 153 — roughly two years behind, which is by itself a flag.
 *
 * And the old retry made things worse, not better: on a 403 it tried again as
 * `LumioBot/1.0 (+https://...)`, a self-declared crawler. Nothing that blocks
 * a suspicious browser lets a confessed robot through. That retry is gone.
 */

/**
 * The Chrome version the headers claim. ONE constant, because a user-agent and
 * its `sec-ch-ua` must agree — two places drifting apart is the exact mismatch
 * described above. Bump this every few months; a version two years old is a
 * signal on its own.
 */
export const CHROME_MAJOR = 153;

/**
 * The full header set one real Chrome sends for a typed-in address.
 *
 * No `referer`: Chrome sends none when a person types a URL, and inventing one
 * is another inconsistency to be caught by.
 */
export function browserHeaders(): Record<string, string> {
  const v = String(CHROME_MAJOR);
  return {
    'user-agent': `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${v}.0.0.0 Safari/537.36`,
    accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'accept-language': 'en-US,en;q=0.9',
    'accept-encoding': 'gzip, deflate, br',
    'sec-ch-ua': `"Chromium";v="${v}", "Google Chrome";v="${v}", "Not=A?Brand";v="24"`,
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'sec-fetch-dest': 'document',
    'sec-fetch-mode': 'navigate',
    'sec-fetch-site': 'none',
    'sec-fetch-user': '?1',
    'upgrade-insecure-requests': '1',
    'cache-control': 'max-age=0',
  };
}

/**
 * The addresses worth trying, in order.
 *
 * A surprising share of "the site blocks us" is really a host mismatch: the
 * certificate, the WAF rule or the redirect chain is configured for one of
 * `example.com` / `www.example.com` and hostile to the other. A person's
 * browser followed a redirect months ago and never mentioned it. Trying both
 * costs one request and fixes a whole class of report.
 *
 * Never more than two, and always the given address first — a site that works
 * must not be made slower by guesses.
 */
export function urlVariants(url: string): string[] {
  const raw = String(url ?? '').trim();
  let u: URL;
  try { u = new URL(raw); } catch { return raw ? [raw] : []; }
  const out = [u.toString()];
  const host = u.hostname;
  const other = host.startsWith('www.') ? host.slice(4) : `www.${host}`;
  // Only for a plain registrable name: adding "www." to a deep subdomain
  // produces an address that has never existed.
  if (host.split('.').length <= (host.startsWith('www.') ? 3 : 2)) {
    const alt = new URL(u.toString());
    alt.hostname = other;
    out.push(alt.toString());
  }
  return out;
}

/** Statuses that mean "a wall", as opposed to "no such page". */
export const WALL_STATUSES = [401, 403, 406, 409, 429, 503];

export const isWall = (status: number): boolean => WALL_STATUSES.includes(status);

/**
 * What to tell the person, in their own language, when the wall wins.
 *
 * Names the site's behaviour rather than an HTTP number, and gives the two
 * things they can actually do. A person who reads "error 403" learns nothing;
 * a person who reads "this website blocks automated readers" knows it is not
 * their fault and knows what to try.
 */
export function wallMessage(status: number | null, vi = true): string {
  if (status !== null && isWall(status)) {
    return vi
      ? `Website này chặn máy chủ đọc tự động (lỗi ${status}) — trình duyệt của anh/chị vẫn vào được bình thường, đây là tường chống bot của họ. Cách nhanh nhất: mở website → Ctrl+A → Ctrl+C → dán vào ô bên dưới rồi bấm "Phân loại tự động". Hoặc dùng nút "Đọc từ Fanpage".`
      : `This website blocks automated readers (${status}) — your own browser is fine; this is their bot wall. Quickest way: open the site, press Ctrl+A then Ctrl+C, paste it in the box below and press "Sort it out". Or use "Read from Fanpage".`;
  }
  if (status === 404) {
    return vi ? 'Không tìm thấy trang này — kiểm tra lại địa chỉ giúp em.' : 'That page was not found — please check the address.';
  }
  return vi
    ? `Không tải được trang${status ? ` (lỗi ${status})` : ''}. Thử lại sau ít phút, hoặc dán nội dung vào ô bên dưới.`
    : `Could not load the page${status ? ` (${status})` : ''}. Try again shortly, or paste the text into the box below.`;
}
