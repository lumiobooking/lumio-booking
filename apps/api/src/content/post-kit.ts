/**
 * What a new post starts with, so nobody has to type it.
 *
 * THE FAILURE THIS EXISTS TO END
 *
 * One person writes posts for eight salons with eight tabs open. They copy last
 * week's post from salon A, rewrite the caption for salon B — and leave A's
 * phone number, A's Instagram handle and A's address sitting at the bottom.
 * The post goes out publicly, on salon B's Page, telling salon B's customers to
 * ring a shop two hundred miles away.
 *
 * It is not a knowledge problem. The person knows which salon they are writing
 * for; they are looking at the caption, and the contact block at the foot of
 * the post is the part they believe is already right because it was already
 * there. So a warning does not fix it. Two things do:
 *
 *   1. The contact block is BUILT, never typed. Every fact in it comes from this
 *      salon's own record, so the common path produces a correct post with no
 *      opportunity to get it wrong.
 *   2. Anything typed that does NOT match this salon's record is found and named
 *      before the post can be scheduled — see `checkPost` below.
 *
 * WHY THE HASHTAGS ARE HERE TOO
 *
 * Same reason, one step further out. A post with three hashtags typed from
 * memory reaches nobody; the trade's real tags are already in this codebase, in
 * the two places that feed the trends board. Handing them over at the moment a
 * post is created costs the writer nothing and is the difference between a post
 * that circulates and one that does not.
 *
 * WHAT THIS FILE REFUSES TO DO
 *
 * It never invents a fact. A salon with no phone number on file gets a contact
 * block with no phone line and a named gap — not a placeholder, and not a
 * silent omission. A checker that cannot see a field says so, because a check
 * that passes for lack of data is worse than no check: it is a green light
 * nobody earned.
 */

import { queriesFor } from './trends/trend-feed';
import { videoFeeds } from './industry-playbook';

export interface ShopFacts {
  name: string;
  phone?: string | null;
  address?: string | null;
  city?: string | null;
  /** Instagram handle without the '@'. */
  instagram?: string | null;
  /** The shop's own site. This is what the contact block prints. */
  website?: string | null;
  /**
   * The salon's Lumio booking page. NOT printed — checked.
   *
   * Not every shop takes bookings through Lumio, and the ones that do would
   * rather write their own call to action than have a bare link stapled to
   * every post. But a writer who pastes a booking link by hand can paste the
   * WRONG salon's, and that link is unambiguous when it is wrong — so it stays
   * here for the check even though nothing prints it.
   */
  bookingUrl?: string | null;
}

export interface PostKit {
  /** Ready to paste at the foot of a post. Empty when nothing is known. */
  contactBlock: string;
  /** Trade + market hashtags, deduped, '#' included. */
  hashtags: string[];
  /** The whole thing: a blank line, the contact block, then the hashtags. */
  starter: string;
  /** Fields the salon has not filled in, named so the screen can ask for them. */
  missing: ShopFactKey[];
}

export type ShopFactKey = 'phone' | 'address' | 'instagram' | 'website';

const clean = (v: unknown, max = 200) => String(v ?? '').trim().slice(0, max);

/** Digits only, last 10 — how two written phone numbers are compared. */
export function phoneKey(v: unknown): string {
  const d = String(v ?? '').replace(/\D/g, '');
  return d.length >= 9 ? d.slice(-10) : d;
}

/**
 * The block that goes at the foot of the post.
 *
 * Each line is omitted rather than faked when its fact is missing. A line
 * reading "📞 (chưa có số)" would be published exactly as written by somebody
 * in a hurry, and a placeholder in a customer's feed is worse than a gap.
 */
export function contactBlock(shop: ShopFacts): { text: string; missing: ShopFactKey[] } {
  const lines: string[] = [];
  const missing: ShopFactKey[] = [];

  const addr = clean(shop.address);
  if (addr) lines.push(`📍 ${addr}`); else missing.push('address');

  const phone = clean(shop.phone, 40);
  if (phone) lines.push(`📞 ${phone}`); else missing.push('phone');

  const ig = clean(shop.instagram, 60).replace(/^@+/, '');
  if (ig) lines.push(`📷 @${ig}`); else missing.push('instagram');

  // The site, not the booking link. A shop that does not take bookings through
  // Lumio should not carry a Lumio link on every post, and a shop that does
  // would rather write its own call to action than have one stapled on.
  const site = clean(shop.website, 300).replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  if (site) lines.push(`🌐 ${site}`); else missing.push('website');

  return { text: lines.join('\n'), missing };
}

/**
 * The rule above the contact block.
 *
 * Box-drawing characters rather than dashes: a row of hyphens is read by
 * Facebook's composer as an attempt at markdown in some clients, and by a
 * person as a typo in all of them. Short enough to sit inside a phone's line
 * width, which is where nearly every one of these posts is read.
 */
export const DIVIDER = '─────────────';

/**
 * The trade's hashtags, in the order they earn their place.
 *
 * The shop's own name first — it is the only tag that can never be shared with a
 * competitor, and the only one a returning customer searches. Then the city,
 * because a local business is found locally. Then the trade's tags, which are
 * the same ones the trends board watches, so the post and the board are looking
 * at one vocabulary rather than two.
 *
 * Capped, deliberately. Instagram allows thirty; a wall of thirty reads as spam
 * to a person even where the platform permits it, and the tail of that list is
 * tags nobody follows.
 */
export function hashtagsFor(
  industry: string | null | undefined,
  market: string | null | undefined,
  shop: ShopFacts,
  limit = 14,
): string[] {
  const slug = (v: unknown) => clean(v, 40).toLowerCase().normalize('NFD')
    .replace(/[̀-ͯ]/g, '')          // Vietnamese diacritics, so "Đà Nẵng" tags as danang
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9]/g, '');

  const out: string[] = [];
  const push = (t: string) => {
    const v = t.replace(/^#+/, '').trim();
    if (v && !out.some((x) => x.toLowerCase() === `#${v}`.toLowerCase())) out.push(`#${v}`);
  };

  const brand = slug(shop.name);
  if (brand.length >= 3) push(brand);
  const city = slug(shop.city);
  if (city.length >= 3) {
    push(city);
    // "kerrvillenails" — the phrase a person actually types when they want this
    // service in this town, and the one tag most likely to reach a stranger.
    const trade = (queriesFor(industry, market).hashtags[0] ?? '').replace(/[^a-z]/gi, '').toLowerCase();
    if (trade) push(`${city}${trade}`);
  }

  for (const h of queriesFor(industry, market).hashtags) push(h);
  // The short-video tags, which are a different crowd from the photo tags.
  //
  // Only the /tag/ feeds. The same list carries a YouTube SEARCH url whose
  // query is percent-encoded, and taking its tail produced "#20tutorial" — the
  // %20 of a space, published on a real salon's post.
  for (const f of videoFeeds(industry, String(market ?? 'US'))) {
    const m = /\/tag\/([A-Za-z0-9_%]+)\/?$/.exec(f.url ?? '');
    if (m) {
      const tag = decodeURIComponent(m[1]).replace(/[^A-Za-z0-9_]/g, '');
      if (tag) push(tag);
    }
  }

  return out.slice(0, Math.max(1, limit));
}

/** Everything a fresh post should open with. */
export function buildPostKit(
  industry: string | null | undefined,
  market: string | null | undefined,
  shop: ShopFacts,
): PostKit {
  const block = contactBlock(shop);
  const tags = hashtagsFor(industry, market, shop);

  // Caption · rule · contact · blank line · hashtags.
  //
  // The rule is what stops the address reading as the last sentence of the
  // post, and the blank line is what stops the hashtags reading as part of the
  // address. Both matter more than they sound: this block sits under every post
  // the shop publishes, and a wall with no seams is where a writer's eye slides
  // past the one line that is wrong.
  const tail = [block.text, tags.join(' ')].filter(Boolean).join('\n\n');
  return {
    contactBlock: block.text,
    hashtags: tags,
    // Two blank lines below wherever the caption ends: the writer's cursor sits
    // at the top and the block stays visually separate from their words.
    starter: tail ? `\n\n${DIVIDER}\n${tail}` : '',
    missing: block.missing,
  };
}

// ---------------------------------------------------------------------------
// The check
// ---------------------------------------------------------------------------

export type FindingKind = 'phone' | 'instagram' | 'address' | 'link';

export interface PostFinding {
  kind: FindingKind;
  /** Exactly as it appears in the draft, so the screen can point at it. */
  found: string;
  /** This salon's own value, for the one-tap fix. Null when nothing to offer. */
  expected: string | null;
}

export interface PostCheck {
  findings: PostFinding[];
  /**
   * Fields that could not be checked because the salon has not filled them in.
   *
   * Reported rather than skipped. A checker that stays silent for lack of data
   * reads exactly like a checker that found nothing wrong, and the person
   * trusting it has no way to tell the two apart — which is how a shop with no
   * phone number on file publishes a competitor's number for a year.
   */
  unchecked: ShopFactKey[];
}

/** Phone-shaped runs of digits: (830) 257-8888, 830.257.8888, 0912 345 678. */
const PHONE_RE = /(?:\+?\d{1,3}[\s.-]?)?\(?\d{2,4}\)?[\s.-]?\d{3,4}[\s.-]?\d{3,4}/g;
const HANDLE_RE = /@[A-Za-z0-9._]{2,40}/g;
/** A street line: a house number, then words, then a street-type word. */
const STREET_RE = /^.*?\b\d{1,6}\b.*?\b(?:st|street|ave|avenue|blvd|boulevard|rd|road|dr|drive|way|ln|lane|hwy|pkwy|đường|duong|phố|pho|q\.?\d+)\b.*$/gim;

/**
 * Everything in this draft that does not belong to this salon.
 *
 * Compared against ONE salon's record — this one. No other tenant is read, and
 * none needs to be: the question is not "whose number is this?" but "is this
 * ours?", and the second question is answerable without touching anybody else's
 * data. That keeps one client's details out of another client's screen, which
 * a "this belongs to Rose Nails" message would not.
 */
export function checkPost(text: string, shop: ShopFacts): PostCheck {
  const body = String(text ?? '');
  const findings: PostFinding[] = [];
  const unchecked: ShopFactKey[] = [];
  const seen = new Set<string>();
  const add = (f: PostFinding) => {
    const k = `${f.kind}:${f.found.toLowerCase()}`;
    if (!seen.has(k)) { seen.add(k); findings.push(f); }
  };

  // ---- phone ----
  const mine = phoneKey(shop.phone);
  if (!mine) unchecked.push('phone');
  else {
    for (const m of body.match(PHONE_RE) ?? []) {
      const k = phoneKey(m);
      // Under nine digits is a price, a date or a house number, not a phone.
      if (k.length >= 9 && k !== mine) add({ kind: 'phone', found: m.trim(), expected: clean(shop.phone, 40) });
    }
  }

  // ---- instagram ----
  const ig = clean(shop.instagram, 60).replace(/^@+/, '').toLowerCase();
  if (!ig) unchecked.push('instagram');
  else {
    for (const m of body.match(HANDLE_RE) ?? []) {
      if (m.slice(1).toLowerCase() !== ig) add({ kind: 'instagram', found: m, expected: `@${clean(shop.instagram, 60).replace(/^@+/, '')}` });
    }
  }

  // ---- address ----
  //
  // Matched by TOWN, not by street. Two shops on Beach Blvd are two different
  // shops; a street name alone cannot tell them apart, and comparing whole
  // address strings would flag every abbreviation ("St" vs "Street") as an
  // error until nobody read the warnings any more.
  const city = clean(shop.city, 80).toLowerCase();
  if (!city) unchecked.push('address');
  else {
    for (const m of body.match(STREET_RE) ?? []) {
      if (!m.toLowerCase().includes(city)) {
        add({ kind: 'address', found: m.trim().slice(0, 120), expected: clean(shop.address) || null });
      }
    }
  }

  // ---- booking link ----
  // The booking link is never absent — it is derived from the salon's own slug
  // — so it is not reported as unchecked. A pasted link belonging to another
  // salon is unambiguous, which is why this check survives the block no longer
  // printing one.
  const url = clean(shop.bookingUrl, 300).toLowerCase();
  if (url) {
    const slug = url.split('/').filter(Boolean).pop() ?? '';
    for (const m of body.match(/\blumiobooking\.com\/[^\s)]+/gi) ?? []) {
      if (slug && !m.toLowerCase().includes(slug)) {
        add({ kind: 'link', found: m, expected: clean(shop.bookingUrl, 300) });
      }
    }
  }

  // The site is what the contact block prints, so a blank one is a gap worth
  // naming even though nothing in a draft is compared against it.
  if (!clean(shop.website, 300)) unchecked.push('website');

  return { findings, unchecked };
}
