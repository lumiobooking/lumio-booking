/**
 * THE WORDS AND THE MENU OF THIS SALON'S LINE OF BUSINESS.
 *
 * Lumio was written for nail salons, and every screen says "thợ", "tiệm",
 * "lịch hẹn", "technician", "salon". A dental clinic, a restaurant or a real
 * estate office reads the same words. The salon's INDUSTRY (chosen by Super
 * Admin or by the owner in Settings, see api common/industry.ts) now decides:
 *
 *   - the words: `ind(text)` rewrites a finished label — "Thợ rảnh" becomes
 *     "Bác sĩ rảnh" for a clinic, "Nhân viên rảnh" for a restaurant. tr() and
 *     the pages' own L()/T() helpers pass every label through it, so a screen
 *     needs no edit to speak its salon's language;
 *   - the menu: screens that make no sense in a line of business (the turn
 *     board for a clinic, Chairs for a restaurant) leave the menu;
 *   - a few icons (the nail-polish bottle on Services).
 *
 * NAIL is the identity: no rule, nothing hidden, every nail salon sees exactly
 * what it saw before. Module-level like ui-currency/ui-market, cached in
 * localStorage so the first paint is already right.
 */

export type IndustryKey = 'NAIL' | 'LASH' | 'HAIR' | 'SPA' | 'MASSAGE' | 'DENTAL' | 'RESTAURANT' | 'FAST_FOOD' | 'CAFE' | 'REAL_ESTATE' | 'SERVICE';

export interface IndustryOption { key: IndustryKey; vi: string; en: string; group: 'beauty' | 'health' | 'food' | 'other'; businessType: 'SALON' | 'RESTAURANT' | 'REAL_ESTATE' | 'SERVICE' }

/** Same list as the server (api common/industry.ts INDUSTRIES). */
export const INDUSTRY_OPTIONS: IndustryOption[] = [
  { key: 'NAIL', vi: 'Nail', en: 'Nail salon', group: 'beauty', businessType: 'SALON' },
  { key: 'LASH', vi: 'Mi / Chân mày', en: 'Lash & brow', group: 'beauty', businessType: 'SALON' },
  { key: 'HAIR', vi: 'Tóc', en: 'Hair salon', group: 'beauty', businessType: 'SALON' },
  { key: 'SPA', vi: 'Spa', en: 'Spa', group: 'beauty', businessType: 'SALON' },
  { key: 'MASSAGE', vi: 'Massage', en: 'Massage', group: 'beauty', businessType: 'SALON' },
  { key: 'DENTAL', vi: 'Nha khoa / Phòng khám', en: 'Dental / Clinic', group: 'health', businessType: 'SERVICE' },
  { key: 'RESTAURANT', vi: 'Nhà hàng', en: 'Restaurant', group: 'food', businessType: 'RESTAURANT' },
  { key: 'FAST_FOOD', vi: 'Quán ăn', en: 'Eatery / Takeaway', group: 'food', businessType: 'RESTAURANT' },
  { key: 'CAFE', vi: 'Cà phê', en: 'Café', group: 'food', businessType: 'RESTAURANT' },
  { key: 'REAL_ESTATE', vi: 'Bất động sản', en: 'Real estate', group: 'other', businessType: 'REAL_ESTATE' },
  { key: 'SERVICE', vi: 'Dịch vụ khác', en: 'Other services', group: 'other', businessType: 'SERVICE' },
];
export const INDUSTRY_GROUPS: { id: IndustryOption['group']; vi: string; en: string }[] = [
  { id: 'beauty', vi: 'Làm đẹp', en: 'Beauty' },
  { id: 'health', vi: 'Sức khoẻ', en: 'Health' },
  { id: 'food', vi: 'Ăn uống', en: 'Food & drink' },
  { id: 'other', vi: 'Khác', en: 'Other' },
];

const KNOWN = new Set(INDUSTRY_OPTIONS.map((o) => o.key));
export function isIndustryKey(v: unknown): v is IndustryKey { return typeof v === 'string' && KNOWN.has(v as IndustryKey); }

// --------------------------------------------------------------- vocabulary

type Pair = [from: string, to: string];

/** The words every non-nail trade swaps, given its own nouns. */
function nouns(o: { staffVi: string; venueVi: string; staffEn: string; staffsEn: string; venueEn: string; venuesEn: string }): Pair[] {
  return [
    ['tiệm nail', o.venueVi], ['thợ nail', o.staffVi], ['đội thợ', `đội ${o.staffVi}`], ['thợ', o.staffVi], ['tiệm', o.venueVi],
    ['nail salons', o.venuesEn], ['nail salon', o.venueEn], ['nail technicians', o.staffsEn], ['nail technician', o.staffEn],
    ['nail techs', o.staffsEn], ['nail tech', o.staffEn],
    ['technicians', o.staffsEn], ['technician', o.staffEn], ['techs', o.staffsEn], ['tech', o.staffEn],
    ['salons', o.venuesEn], ['salon', o.venueEn],
  ];
}
const food = (venueVi: string, venueEn: string, venuesEn: string): Pair[] => [
  ...nouns({ staffVi: 'nhân viên', venueVi, staffEn: 'staff member', staffsEn: 'staff', venueEn, venuesEn }),
  ['đặt lịch', 'đặt bàn'], ['lịch hẹn', 'lịch đặt bàn'], ['appointments', 'reservations'], ['appointment', 'reservation'],
];

const RULES: Record<IndustryKey, Pair[]> = {
  NAIL: [],
  LASH: [['tiệm nail', 'tiệm mi'], ['thợ nail', 'thợ mi'], ['nail salons', 'lash studios'], ['nail salon', 'lash studio'], ['nail techs', 'lash artists'], ['nail tech', 'lash artist']],
  HAIR: [['tiệm nail', 'tiệm tóc'], ['thợ nail', 'thợ tóc'], ['nail salons', 'hair salons'], ['nail salon', 'hair salon'],
    ['nail techs', 'stylists'], ['nail tech', 'stylist'], ['technicians', 'stylists'], ['technician', 'stylist'], ['techs', 'stylists'], ['tech', 'stylist']],
  SPA: [...nouns({ staffVi: 'kỹ thuật viên', venueVi: 'spa', staffEn: 'therapist', staffsEn: 'therapists', venueEn: 'spa', venuesEn: 'spas' }),
    ['ghế', 'phòng'], ['chairs', 'rooms'], ['chair', 'room']],
  MASSAGE: [...nouns({ staffVi: 'kỹ thuật viên', venueVi: 'tiệm', staffEn: 'therapist', staffsEn: 'therapists', venueEn: 'studio', venuesEn: 'studios' }).filter(([f]) => f !== 'tiệm'),
    ['ghế', 'phòng'], ['chairs', 'rooms'], ['chair', 'room']],
  DENTAL: [...nouns({ staffVi: 'bác sĩ', venueVi: 'phòng khám', staffEn: 'dentist', staffsEn: 'dentists', venueEn: 'clinic', venuesEn: 'clinics' }),
    ['khách vãng lai', 'bệnh nhân không hẹn'], ['khách hàng', 'bệnh nhân'], ['khách', 'bệnh nhân'], ['lịch hẹn', 'lịch khám'],
    ['customers', 'patients'], ['customer', 'patient'], ['clients', 'patients'], ['client', 'patient']],
  RESTAURANT: food('nhà hàng', 'restaurant', 'restaurants'),
  FAST_FOOD: food('quán', 'eatery', 'eateries'),
  CAFE: food('quán', 'café', 'cafés'),
  REAL_ESTATE: [...nouns({ staffVi: 'môi giới', venueVi: 'văn phòng', staffEn: 'agent', staffsEn: 'agents', venueEn: 'office', venuesEn: 'offices' }),
    ['lịch hẹn', 'lịch tư vấn'], ['appointments', 'consultations'], ['appointment', 'consultation']],
  SERVICE: nouns({ staffVi: 'nhân viên', venueVi: 'cửa hàng', staffEn: 'staff member', staffsEn: 'staff', venueEn: 'business', venuesEn: 'businesses' }),
};

/** Screens that make no sense in a line of business: out of the menu. */
const HIDDEN: Record<IndustryKey, string[]> = {
  NAIL: [], LASH: [], HAIR: [], SPA: [], MASSAGE: [], SERVICE: [],
  // A clinic does not rotate doctors by turns.
  DENTAL: ['/salon/walkins'],
  // Restaurants seat at tables (their own screen), not chairs in turn.
  RESTAURANT: ['/salon/walkins', '/salon/stations'],
  FAST_FOOD: ['/salon/walkins', '/salon/stations'],
  CAFE: ['/salon/walkins', '/salon/stations'],
  // An office books consultations; no floor, no retail counter.
  REAL_ESTATE: ['/salon/walkins', '/salon/stations', '/salon/waitlist', '/salon/products', '/salon/gift-cards', '/salon/inventory', '/salon/payment-terminals', '/salon/card-transactions', '/salon/pos/shifts'],
};

/** Icons that name the trade. */
const ICONS: Partial<Record<IndustryKey, Record<string, string>>> = {
  LASH: { nailPolish: 'sparkle' }, SPA: { nailPolish: 'sparkle' }, MASSAGE: { nailPolish: 'sparkle' },
  HAIR: { nailPolish: 'scissors' },
  DENTAL: { nailPolish: 'tooth' },
  RESTAURANT: { nailPolish: 'bowl' }, FAST_FOOD: { nailPolish: 'bowl' }, CAFE: { nailPolish: 'bowl' },
  REAL_ESTATE: { nailPolish: 'store' }, SERVICE: { nailPolish: 'clipboard' },
};

const BOUND = '[\\p{L}\\p{M}\\p{N}]';
const compiled = new Map<IndustryKey, { re: RegExp; map: Map<string, string> } | null>();
function compile(k: IndustryKey) {
  if (compiled.has(k)) return compiled.get(k)!;
  const pairs = RULES[k] ?? [];
  if (!pairs.length) { compiled.set(k, null); return null; }
  const map = new Map(pairs.map(([f, t]) => [f.toLowerCase(), t]));
  const alts = [...map.keys()].sort((a, b) => b.length - a.length).map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  // No lookbehind: Safari before 16.4 (older salon iPads) cannot parse it, and
  // a regex that fails to compile would take every screen down with it. The
  // character before the word is captured instead and put back.
  const c = { re: new RegExp(`(^|[^${BOUND.slice(1, -1)}])(${alts.join('|')})(?!${BOUND})`, 'giu'), map };
  compiled.set(k, c);
  return c;
}

/**
 * Rewrite one label into an industry's words. Pure; exported for tests.
 *
 * Two things are never touched: {placeholders} ("{salon}" is a slot the page
 * fills, not a word), and proper names — the business's own name. "Lumio
 * Salon" is a name; a clinic called that is still called that.
 */
export function industryText(text: string, k: IndustryKey, names: string[] = []): string {
  if (!text || k === 'NAIL') return text;
  const c = compile(k);
  if (!c) return text;
  const keep = keepPattern(names);
  return text.split(keep).map((part, i) => (i % 2 === 1 ? part : rewrite(part, c))).join('');
}

const keepCache = new Map<string, RegExp>();
function keepPattern(names: string[]): RegExp {
  const clean = [...new Set(names.map((n) => String(n ?? '').trim()).filter((n) => n.length >= 2))].sort((a, b) => b.length - a.length);
  const key = clean.join('\u0001');
  let re = keepCache.get(key);
  if (!re) {
    const alts = ['\\{[^{}]*\\}', ...clean.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))];
    re = new RegExp(`(${alts.join('|')})`, 'giu');
    keepCache.set(key, re);
  }
  re.lastIndex = 0;
  return re;
}

function rewrite(text: string, c: { re: RegExp; map: Map<string, string> }): string {
  return text.replace(c.re, (_all, pre: string, m: string) => {
    const to = c.map.get(m.toLowerCase()) ?? m;
    if (m.length > 1 && m === m.toUpperCase() && m !== m.toLowerCase()) return pre + to.toUpperCase();
    const first = m.charAt(0);
    return pre + (first !== first.toLowerCase() ? to.charAt(0).toUpperCase() + to.slice(1) : to);
  });
}

export function hiddenHrefsFor(k: IndustryKey): string[] { return HIDDEN[k] ?? []; }
export function iconFor(name: string, k: IndustryKey): string { return ICONS[k]?.[name] ?? name; }

// --------------------------------------------------------------- the current salon

const STORE = 'lumio_industry';
let current: IndustryKey = 'NAIL';
/** Names that are never re-worded: the business's own name. */
let names: string[] = [];
let loaded = false;
const listeners = new Set<() => void>();
const cache = new Map<string, string>();

function load(): void {
  if (loaded) return;
  loaded = true;
  try {
    const v = typeof window !== 'undefined' ? window.localStorage.getItem(STORE) : null;
    if (isIndustryKey(v)) current = v;
  } catch { /* storage refused: the network answer arrives a moment later */ }
}

export function uiIndustry(): IndustryKey { load(); return current; }

/** Called when the salon's own record loads (and after the owner changes it). */
export function setUiIndustry(next: unknown): void {
  load();
  const v = String(next ?? '').toUpperCase();
  if (!isIndustryKey(v) || v === current) return;
  current = v;
  cache.clear();
  try { window.localStorage.setItem(STORE, v); } catch { /* ignore */ }
  for (const fn of listeners) { try { fn(); } catch { /* next */ } }
}

/** The business's own name(s), kept as written inside re-worded labels. */
export function setUiIndustryNames(next: (string | null | undefined)[]): void {
  const v = next.map((n) => String(n ?? '').trim()).filter(Boolean);
  if (v.join('\u0001') === names.join('\u0001')) return;
  names = v;
  cache.clear();
  for (const fn of listeners) { try { fn(); } catch { /* next */ } }
}

export function onUiIndustryChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** A label in THIS salon's words. Identity for a nail salon. */
export function ind(text: string): string {
  const k = uiIndustry();
  if (k === 'NAIL' || !text) return text;
  const hit = cache.get(text);
  if (hit !== undefined) return hit;
  const out = industryText(text, k, names);
  if (cache.size > 5000) cache.clear();
  cache.set(text, out);
  return out;
}
