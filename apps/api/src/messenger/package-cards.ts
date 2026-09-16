/**
 * WHICH PACKAGE THE CUSTOMER TAPPED — and why nobody could tell.
 *
 * WHAT WENT WRONG
 *
 * The sales carousel sent three cards — Starter, Boost, Growth Map — and gave
 * all three the SAME button title: "Tư vấn gói này". The payload underneath
 * did carry the package name, so the bot could read it. Nothing else could.
 *
 * Messenger renders a tapped button in the thread as its TITLE. So Meta's own
 * Page inbox showed three identical grey bubbles saying "Tư vấn gói này", and
 * the salesperson reading that thread had no way to know whether the customer
 * had asked about the $99 package or the $279 one. Neither did the thread
 * history a colleague would read the next morning. A lead that names its own
 * price bracket is the most valuable thing in the inbox, and it was being
 * thrown away at the last step.
 *
 * WHAT A TITLE HAS TO SURVIVE
 *
 * Messenger truncates a button title at 20 characters. "Tư vấn gói Growth Map
 * $279/tháng" is 31 and would arrive cut mid-word. So the title has to be
 * SHORTENED deliberately rather than by accident — and, above all, it has to
 * stay DIFFERENT from its neighbours, because two cards that shorten to the
 * same string put us back where we started.
 */

/** Messenger's hard limit on a button title. Longer is silently truncated. */
export const BUTTON_TITLE_MAX = 20;

/** The prefix a package postback carries, so the handler can recognise it. */
export const PKG_PREFIX = 'ASK_PKG:';

/**
 * The distinctive part of a package label.
 *
 * "Gói Growth Map $279/th" is mostly boilerplate: every package starts with
 * "Gói" and ends with "/tháng". What tells them apart is the name and the
 * price, so those are what survive.
 */
export function packageShortName(label: string): string {
  let s = String(label ?? '').trim();
  // "Gói Boost" -> "Boost", and a bare "Gói" -> "" so the caller can fall back.
  s = s.replace(/^g[oó]i\b\s*/i, '');
  // Longest alternative FIRST: with "th" before "tháng" the regex matched the
  // "th" and left "áng" glued to the price — "Boost $179áng" on a live card.
  s = s.replace(/\s*\/\s*(?:tháng|thang|month|mo|th)\.?\s*$/i, '');
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

/**
 * The button title for one card: as much of the package as fits in twenty
 * characters, name first and price second, because the name is what a person
 * says out loud and the price is what they remember.
 *
 * No "Tư vấn" prefix: it cost seven of the twenty characters and said the same
 * thing on every card. The card itself already says what the button is for.
 */
export function buttonTitleFor(label: string): string {
  const short = packageShortName(label);
  if (!short) return 'Xem gói này';
  if (short.length <= BUTTON_TITLE_MAX) return short;

  // Too long: keep the name and the price, drop the words in between.
  const price = short.match(/\$\s?[\d.,]+/)?.[0]?.replace(/\s/g, '') ?? '';
  const name = short.replace(/\$\s?[\d.,]+/, '').replace(/\s+/g, ' ').trim();
  if (price) {
    const room = BUTTON_TITLE_MAX - price.length - 1;
    if (room >= 3) return `${cut(name, room)} ${price}`;
    return price.slice(0, BUTTON_TITLE_MAX);
  }
  return cut(short, BUTTON_TITLE_MAX);
}

/** Trim to n characters without leaving a half-word or a trailing space. */
function cut(s: string, n: number): string {
  const t = s.trim();
  if (t.length <= n) return t;
  const hard = t.slice(0, n);
  const space = hard.lastIndexOf(' ');
  return (space >= 3 ? hard.slice(0, space) : hard).trim();
}

/**
 * Titles for a whole carousel, guaranteed different from one another.
 *
 * This is the property that actually matters and the one the old code had no
 * way to state: after shortening, two packages may collide ("Gói Boost 3
 * tháng" and "Gói Boost 6 tháng" both end at "Boost"). A collision is the
 * original bug wearing a different hat, so the last characters are given back
 * to whatever tells them apart, and failing that a numeral is appended. Three
 * buttons on one carousel are never allowed to read the same.
 */
export function carouselTitles(labels: string[]): string[] {
  const out: string[] = [];
  const seen = new Map<string, number>();
  for (const label of labels) {
    let title = buttonTitleFor(label);
    if (seen.has(title.toLowerCase())) {
      // Try the fuller name first — a suffix that was cut may be the difference.
      const full = packageShortName(label);
      const alt = cut(full, BUTTON_TITLE_MAX);
      if (alt && !seen.has(alt.toLowerCase())) {
        title = alt;
      } else {
        const n = (seen.get(title.toLowerCase()) ?? 1) + 1;
        seen.set(title.toLowerCase(), n);
        title = `${cut(title, BUTTON_TITLE_MAX - 2)} ${n}`;
      }
    }
    seen.set(title.toLowerCase(), seen.get(title.toLowerCase()) ?? 1);
    out.push(title);
  }
  return out;
}

/** The postback payload for a card. The payload stays the FULL label — it is what the bot reads. */
export function packagePayload(label: string): string {
  return `${PKG_PREFIX}${String(label ?? '').slice(0, 900)}`;
}

/** The package name out of a payload, or null when it is not a package tap. */
export function packageFromPayload(payload: string): string | null {
  const p = String(payload ?? '');
  if (!p.startsWith(PKG_PREFIX)) return null;
  const name = p.slice(PKG_PREFIX.length).trim();
  return name || null;
}

/**
 * What the thread records when somebody taps a card.
 *
 * Written as the CUSTOMER's line, in the first person, because that is what
 * they meant and it is what the next person to open the thread needs to read.
 * "Tư vấn gói này" told them nothing; this names the package and the price.
 */
export function tapAsCustomerLine(label: string): string {
  const short = packageShortName(label) || String(label ?? '').trim();
  return `Tôi muốn tư vấn gói ${short}`;
}
