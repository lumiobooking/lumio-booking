/**
 * GETTING THE WHOLE BUSINESS OFF A WEBSITE, NOT JUST THE HOME PAGE'S WORDS.
 *
 * WHAT THE OLD READER DID
 *
 * One fetch of one page, then every tag stripped and the result glued into a
 * single line. Three things went wrong with that, and all three showed up as
 * "the bot does not know much about us":
 *
 *   1. The facts a bot actually needs — phone, address, opening hours, the
 *      business's own name — are usually NOT in the prose. They sit in the
 *      page's structured data (schema.org JSON-LD) and its meta tags, which
 *      tag-stripping threw away along with the tags.
 *   2. Stripping every tag glues the navigation menu, the cookie banner and
 *      the footer's legal text into the same paragraph as the real content.
 *      The model then has to guess which words are the business and which are
 *      furniture.
 *   3. A home page is a poster. What the business DOES lives on /services,
 *      what it charges on /pricing, who it is on /about. Reading only the
 *      front page is reading the cover of the brochure.
 *
 * So: structured data first (it is machine-written and unambiguous), then
 * readable text that keeps its headings, then the two or three pages most
 * likely to hold the rest.
 *
 * Pure string work — no network, no clock. site-reader.ts does the fetching.
 */

/** A fact lifted from structured data. Label and value, both already trimmed. */
export interface SiteFact { label: string; value: string }

const clean = (s: unknown, max = 300): string =>
  String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

// ---- structured data ---------------------------------------------------------

/** Every JSON-LD block on the page, parsed. Junk blocks are skipped, never thrown. */
export function jsonLdBlocks(html: string): unknown[] {
  const out: unknown[] = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(String(html ?? ''))) !== null) {
    const raw = m[1].trim();
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw) as unknown;
      // A @graph holds several entities in one block.
      const graph = (parsed as { '@graph'?: unknown })?.['@graph'];
      if (Array.isArray(graph)) out.push(...graph);
      else if (Array.isArray(parsed)) out.push(...parsed);
      else out.push(parsed);
    } catch { /* a malformed block is not a reason to lose the good ones */ }
    if (out.length > 60) break;
  }
  return out;
}

const asText = (v: unknown): string => {
  if (typeof v === 'string' || typeof v === 'number') return clean(v);
  if (Array.isArray(v)) return clean(v.map(asText).filter(Boolean).join(', '));
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    // schema.org wraps values in objects: {"@type":"PostalAddress", ...}
    const parts = ['streetAddress', 'addressLocality', 'addressRegion', 'postalCode']
      .map((k) => clean(o[k])).filter(Boolean);
    if (parts.length) return parts.join(', ');
    if (o.name !== undefined) return asText(o.name);
    if (o['@value'] !== undefined) return asText(o['@value']);
  }
  return '';
};

/** Opening hours in schema's own shape, turned into one readable line. */
function hoursLine(v: unknown): string {
  const rows = Array.isArray(v) ? v : [v];
  const lines = rows.map((r) => {
    if (typeof r === 'string') return clean(r);
    const o = (r ?? {}) as Record<string, unknown>;
    const days = asText(o.dayOfWeek).replace(/https?:\/\/schema\.org\//g, '');
    const open = clean(o.opens); const close = clean(o.closes);
    if (!days && !open) return '';
    return `${days}${days ? ': ' : ''}${open}${close ? `–${close}` : ''}`.trim();
  }).filter(Boolean);
  return clean(lines.join(' · '), 400);
}

/**
 * The business facts a bot needs, lifted from JSON-LD and meta tags.
 *
 * Ordered so the most identifying come first — a model reading a truncated
 * block still gets the name and the phone.
 */
export function structuredFacts(html: string): SiteFact[] {
  const facts: SiteFact[] = [];
  const seen = new Set<string>();
  const add = (label: string, value: string) => {
    const v = clean(value, 400);
    if (!v || seen.has(label.toLowerCase())) return;
    seen.add(label.toLowerCase());
    facts.push({ label, value: v });
  };

  for (const node of jsonLdBlocks(html)) {
    const o = (node ?? {}) as Record<string, unknown>;
    const type = asText(o['@type']).toLowerCase();
    // Only entities that describe the BUSINESS. A BreadcrumbList or a
    // WebSite entry is structure, not facts about the shop.
    if (!/business|organization|store|restaurant|salon|professionalservice|realestate|person|place|dentist|medical/.test(type)) continue;
    add('Tên', asText(o.name));
    add('Loại hình', asText(o['@type']));
    add('Điện thoại', asText(o.telephone));
    add('Email', asText(o.email));
    add('Địa chỉ', asText(o.address));
    add('Giờ mở cửa', hoursLine(o.openingHoursSpecification ?? o.openingHours));
    add('Khoảng giá', asText(o.priceRange));
    add('Mô tả', asText(o.description));
    add('Khu vực phục vụ', asText(o.areaServed));
    add('Trang liên kết', asText(o.sameAs));
  }

  // Meta tags fill what JSON-LD did not say.
  const meta = (name: string): string => {
    const re = new RegExp(`<meta[^>]+(?:name|property)=["']${name}["'][^>]*content=["']([^"']*)["']`, 'i');
    const m = re.exec(html) ?? new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:name|property)=["']${name}["']`, 'i').exec(html);
    return m ? clean(m[1], 400) : '';
  };
  add('Tên', meta('og:site_name'));
  add('Mô tả', meta('description') || meta('og:description'));
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  add('Tiêu đề trang', clean(title));
  return facts;
}

// ---- readable text -------------------------------------------------------------

/** Blocks that are furniture on every page and content on none. */
const FURNITURE = /<(nav|header|footer|aside|form|script|style|svg|noscript|iframe|template)\b[^>]*>[\s\S]*?<\/\1>/gi;

/**
 * Page text that keeps its shape.
 *
 * Headings become "## " lines and list items "- " lines, so the model can see
 * that "Services" is a heading and the six lines under it are its list. The
 * old reader flattened all of that into one paragraph, which is the same
 * information with the structure — the part that says what groups with what —
 * removed.
 */
export function readableText(html: string, max = 12000): string {
  let s = String(html ?? '');
  s = s.replace(/<!--[\s\S]*?-->/g, ' ');
  s = s.replace(FURNITURE, ' ');
  // Mark the structure BEFORE the tags go.
  s = s.replace(/<\/(h[1-6])>/gi, '\n');
  s = s.replace(/<(h[1-6])\b[^>]*>/gi, '\n## ');
  s = s.replace(/<li\b[^>]*>/gi, '\n- ');
  s = s.replace(/<\/(p|div|section|article|tr|ul|ol|table|br)>/gi, '\n');
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<[^>]+>/g, ' ');
  s = decodeEntities(s);
  // Tidy: collapse runs of spaces, drop empty bullets, cap blank lines at one.
  s = s.replace(/[ \t ]+/g, ' ')
    .split('\n')
    .map((l) => l.trim())
    .filter((l, i, a) => l !== '' || (a[i - 1] ?? '') !== '')
    .filter((l) => l !== '-' && l !== '##')
    .join('\n');
  return s.trim().slice(0, max);
}

const NAMED: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—',
  hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', middot: '·', bull: '•',
};

export function decodeEntities(s: string): string {
  return String(s ?? '')
    .replace(/&#(\d+);/g, (_, d) => codePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => codePoint(parseInt(h, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => NAMED[String(n).toLowerCase()] ?? m);
}

function codePoint(n: number): string {
  return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : ' ';
}

// ---- which other pages are worth reading -----------------------------------------

/** What each extra page is likely to add, most valuable first. */
const WANTED: { key: string; re: RegExp }[] = [
  { key: 'services', re: /(service|dich-vu|dịch vụ|what-we-do|treatment|menu)/i },
  { key: 'pricing', re: /(pricing|price|bang-gia|bảng giá|rate|cost|plan)/i },
  { key: 'about', re: /(about|gioi-thieu|giới thiệu|our-story|who-we-are|team)/i },
  { key: 'contact', re: /(contact|lien-he|liên hệ|location|hours|book)/i },
];

/** Every same-site link on the page, absolute and de-duplicated. */
export function internalLinks(html: string, baseUrl: string): string[] {
  let base: URL;
  try { base = new URL(baseUrl); } catch { return []; }
  const out = new Set<string>();
  const re = /<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(String(html ?? ''))) !== null) {
    let u: URL;
    try { u = new URL(m[1], base); } catch { continue; }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') continue;
    if (u.hostname.replace(/^www\./, '') !== base.hostname.replace(/^www\./, '')) continue;
    if (/\.(jpg|jpeg|png|gif|webp|svg|pdf|zip|mp4|css|js)$/i.test(u.pathname)) continue;
    u.hash = '';
    out.add(u.toString());
    if (out.size > 300) break;
  }
  return Array.from(out);
}

/**
 * The handful of pages worth a second and third request.
 *
 * One per category at most, so a site with forty service pages does not spend
 * the whole budget on services and never reach the contact page. The home
 * page's own URL is excluded — it has already been read.
 */
export function pickPages(links: string[], homeUrl: string, limit = 3): string[] {
  const home = normalise(homeUrl);
  const picked: string[] = [];
  const used = new Set<string>([home]);
  for (const { re } of WANTED) {
    if (picked.length >= limit) break;
    const hit = links.find((l) => {
      const n = normalise(l);
      if (used.has(n)) return false;
      // Match on the PATH only: a link whose query string happens to contain
      // "about" is not an about page.
      try { return re.test(new URL(l).pathname); } catch { return false; }
    });
    if (hit) { picked.push(hit); used.add(normalise(hit)); }
  }
  return picked;
}

const normalise = (u: string): string => {
  try {
    const x = new URL(u);
    return `${x.hostname.replace(/^www\./, '')}${x.pathname.replace(/\/+$/, '')}`.toLowerCase();
  } catch { return String(u ?? '').toLowerCase(); }
};

// ---- putting one site together -----------------------------------------------------

export interface PageRead { url: string; html: string }

/**
 * Everything read from a site, as one block for the model.
 *
 * Facts go FIRST and are labelled, because they are the part that must not be
 * guessed at; the prose follows as context. Each page is named so the model
 * can tell the pricing page's numbers from the home page's slogan.
 */
export function composeSiteText(pages: PageRead[], max = 30000): string {
  const parts: string[] = [];
  const facts = pages.length ? structuredFacts(pages[0].html) : [];
  if (facts.length) {
    parts.push(`THÔNG TIN DOANH NGHIỆP (lấy từ dữ liệu có cấu trúc của website — chính xác, không suy đoán):\n${
      facts.map((f) => `- ${f.label}: ${f.value}`).join('\n')}`);
  }
  for (const p of pages) {
    const body = readableText(p.html);
    if (body.length < 30) continue;
    let path = p.url;
    try { path = new URL(p.url).pathname || '/'; } catch { /* keep the raw url */ }
    parts.push(`--- Trang ${path} ---\n${body}`);
  }
  return parts.join('\n\n').slice(0, max);
}
