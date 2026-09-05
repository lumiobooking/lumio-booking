/**
 * Everything in a draft post that does not belong to THIS salon.
 *
 * A mirror of the server's `post-kit.ts` check, run as the person types so the
 * answer arrives while they can still act on it rather than after they press
 * Schedule. The rule it enforces is the same one, and it is worth stating
 * plainly: the question is "is this ours?", never "whose is it?". The second
 * question would need another tenant's data, and would put one client's phone
 * number on another client's screen to explain itself.
 *
 * Kept out of the page component so it can be tested without React — the same
 * reason `markets.ts` and `ui-currency.ts` sit here.
 */

export interface ShopFacts {
  name: string;
  phone?: string | null;
  address?: string | null;
  city?: string | null;
  instagram?: string | null;
  /** The shop's own site — what the contact block prints. */
  website?: string | null;
  /** The Lumio booking page. Checked, never printed: a writer who pastes a
   *  booking CTA by hand can paste another salon's. */
  bookingUrl?: string | null;
}

export type FindingKind = 'phone' | 'instagram' | 'address' | 'link';
export type FactKey = 'phone' | 'address' | 'instagram' | 'website';

export interface PostFinding {
  kind: FindingKind;
  /** Exactly as written in the draft, so the screen can point at it. */
  found: string;
  /** This salon's own value, for the one-tap fix. Null when there is none. */
  expected: string | null;
}

export interface PostCheck {
  findings: PostFinding[];
  /** Checks that could not run because the salon has not filled the field in. */
  unchecked: FactKey[];
}

const clean = (v: unknown, max = 300) => String(v ?? '').trim().slice(0, max);

/** Digits only, last ten — how two written phone numbers are compared. */
export function phoneKey(v: unknown): string {
  const d = String(v ?? '').replace(/\D/g, '');
  return d.length >= 9 ? d.slice(-10) : d;
}

const PHONE_RE = /(?:\+?\d{1,3}[\s.-]?)?\(?\d{2,4}\)?[\s.-]?\d{3,4}[\s.-]?\d{3,4}/g;
const HANDLE_RE = /@[A-Za-z0-9._]{2,40}/g;
const STREET_RE = /^.*?\b\d{1,6}\b.*?\b(?:st|street|ave|avenue|blvd|boulevard|rd|road|dr|drive|way|ln|lane|hwy|pkwy|đường|duong|phố|pho|q\.?\d+)\b.*$/gim;

export function checkPost(text: string, shop: ShopFacts): PostCheck {
  const body = String(text ?? '');
  const findings: PostFinding[] = [];
  const unchecked: FactKey[] = [];
  const seen = new Set<string>();
  const add = (f: PostFinding) => {
    const k = `${f.kind}:${f.found.toLowerCase()}`;
    if (!seen.has(k)) { seen.add(k); findings.push(f); }
  };

  const mine = phoneKey(shop.phone);
  if (!mine) unchecked.push('phone');
  else {
    for (const m of body.match(PHONE_RE) ?? []) {
      const k = phoneKey(m);
      // Under nine digits is a price, a date or a house number, not a phone.
      if (k.length >= 9 && k !== mine) {
        add({ kind: 'phone', found: m.trim(), expected: clean(shop.phone, 40) });
      }
    }
  }

  const ig = clean(shop.instagram, 60).replace(/^@+/, '').toLowerCase();
  if (!ig) unchecked.push('instagram');
  else {
    for (const m of body.match(HANDLE_RE) ?? []) {
      if (m.slice(1).toLowerCase() !== ig) {
        add({ kind: 'instagram', found: m, expected: `@${clean(shop.instagram, 60).replace(/^@+/, '')}` });
      }
    }
  }

  // Matched by TOWN, not by street. Two shops on Beach Blvd are two different
  // shops, and comparing whole address strings would flag "St" against "Street"
  // until nobody read the warnings any more.
  const city = clean(shop.city, 80).toLowerCase();
  if (!city) unchecked.push('address');
  else {
    for (const m of body.match(STREET_RE) ?? []) {
      if (!m.toLowerCase().includes(city)) {
        add({ kind: 'address', found: m.trim().slice(0, 120), expected: clean(shop.address) || null });
      }
    }
  }

  // Derived from the salon's own slug, so never absent and never reported as
  // unchecked.
  const url = clean(shop.bookingUrl, 300).toLowerCase();
  if (url) {
    const slug = url.split('/').filter(Boolean).pop() ?? '';
    for (const m of body.match(/\blumiobooking\.com\/[^\s)]+/gi) ?? []) {
      if (slug && !m.toLowerCase().includes(slug)) {
        add({ kind: 'link', found: m, expected: clean(shop.bookingUrl, 300) });
      }
    }
  }

  if (!clean(shop.website, 300)) unchecked.push('website');

  return { findings, unchecked };
}

/** Replace one wrong value with this salon's own, in place. */
export function applyFix(text: string, f: PostFinding): string {
  if (!f.expected) return text;
  return text.split(f.found).join(f.expected);
}
