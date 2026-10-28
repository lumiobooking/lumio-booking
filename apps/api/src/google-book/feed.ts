/**
 * THE FEEDS GOOGLE READS TO SHOW A SALON'S "BOOK ONLINE" BUTTON.
 *
 * Actions Center › Appointments Redirect takes three daily JSON files from a
 * partner: an Entity feed (each salon: name, phone, website, where it is), a
 * Services feed (each bookable service: name, group, price, length, the link
 * that opens it pre-selected) and an Action feed (each salon's "book" link).
 * Google matches every entity to its Maps listing, and the button appears on
 * that listing. A descriptor file per feed names the data files.
 *
 * This file is pure: it turns a list of salons — already read, already
 * scoped, already linted — into those four shapes. Nothing here touches a
 * database or the network; the service does the reading, the spec pins the
 * shapes. One salon is one tenant and nothing else: `entity_id` and
 * `merchant_id` are the tenant id, immutable, never the slug (a slug can be
 * renamed, and Google keeps history by id).
 *
 * References (2026): entity-feed, services-feed, action-feed under
 * developers.google.com/actions-center/verticals/appointments/redirect/reference/feeds/.
 */

export interface FeedAddress { country: string; locality: string; region?: string | null; postalCode: string; street: string }

export interface FeedService {
  id: string;
  name: string;
  description?: string | null;
  priceCents: number;
  /** "from $35" — Google's STARTS_AT. */
  priceFrom?: boolean;
  durationMinutes: number;
  category?: string | null;
  isActive?: boolean;
  walkInOnly?: boolean;
}

export interface FeedTenant {
  id: string;
  slug: string;
  name: string;
  /** The name on the salon's Google Maps listing, when linked — what the Entity feed sends, so Google matches it. */
  listingName?: string | null;
  phone?: string | null;
  website?: string | null;
  address?: FeedAddress | null;
  /** Fallback when the address was never structured. */
  unstructuredAddress?: string | null;
  lat?: number | null;
  lng?: number | null;
  currency: string;
  /** The salon's language, BCP 47 (en, vi, fr). */
  locale?: string;
  /** Hours a customer must cancel before; 0 = no stated policy. */
  cancelNoticeHours?: number;
  /** A deposit is taken on every online booking. */
  depositRequired?: boolean;
  services: FeedService[];
}

/** Currencies with no sub-unit: the stored amount IS the currency, not hundredths. */
const ZERO_DECIMAL = new Set(['VND', 'JPY', 'KRW', 'CLP', 'ISK', 'HUF', 'TWD', 'UGX', 'XAF', 'XOF', 'PYG', 'RWF', 'VUV', 'XPF']);

/** Google's price_micros: 1 unit = 1,000,000. 3500 cents USD → 35,000,000; 250000 ₫ → 250,000,000,000. */
export function priceMicros(minorUnits: number, currency: string): number {
  const c = (currency || 'USD').toUpperCase();
  const units = ZERO_DECIMAL.has(c) ? minorUnits : minorUnits / 100;
  return Math.round(units * 1_000_000);
}

export function bookingUrl(webUrl: string, slug: string, serviceId?: string): string {
  const base = `${webUrl.replace(/\/$/, '')}/${encodeURIComponent(slug)}/gbp`;
  return serviceId ? `${base}?service=${encodeURIComponent(serviceId)}` : base;
}

/** The services a feed carries: active, bookable online, priced and timed. */
export function feedableServices(t: FeedTenant): FeedService[] {
  return t.services.filter((s) => s.isActive !== false && !s.walkInOnly && s.priceCents > 0 && s.durationMinutes > 0);
}

function text(value: string, locale: string) {
  return { value, localized_value: [{ locale, value }] };
}

function cancelPolicy(t: FeedTenant, locale: string) {
  const h = t.cancelNoticeHours ?? 0;
  if (!h) return null;
  const vi = locale.startsWith('vi');
  const body = vi ? `Vui lòng huỷ hoặc dời lịch trước ít nhất ${h} giờ.` : `Please cancel or reschedule at least ${h} hours in advance.`;
  return { id: `cancel-${h}h`, name: text(vi ? 'Chính sách huỷ' : 'Cancellation policy', locale), text_content: text(body, locale) };
}

function bookability(t: FeedTenant) {
  return { is_online_bookable: true, payment_required: Boolean(t.depositRequired), card_on_file_required: false, otp_required: false, sign_in_required: false };
}

export function buildEntityFeed(tenants: FeedTenant[], webUrl: string) {
  return {
    data: tenants.map((t) => {
      const locale = t.locale || 'en';
      const policy = cancelPolicy(t, locale);
      const location: Record<string, unknown> = {};
      if (typeof t.lat === 'number' && typeof t.lng === 'number') { location.latitude = t.lat; location.longitude = t.lng; }
      if (t.address) {
        location.address = {
          country: t.address.country, locality: t.address.locality, ...(t.address.region ? { region: t.address.region } : {}),
          postal_code: t.address.postalCode, street_address: t.address.street,
        };
      } else if (t.unstructuredAddress) location.unstructured_address = t.unstructuredAddress;
      return {
        entity_id: t.id,
        name: (t.listingName || t.name).trim(),
        ...(t.phone ? { telephone: t.phone } : {}),
        url: t.website || bookingUrl(webUrl, t.slug).replace(/\/gbp$/, ''),
        location,
        bookability_info: bookability(t),
        ...(policy ? { policy_info: { policies: [policy] } } : {}),
      };
    }),
  };
}

export function buildServicesFeed(tenants: FeedTenant[], webUrl: string) {
  const data: unknown[] = [];
  for (const t of tenants) {
    const locale = t.locale || 'en';
    const policy = cancelPolicy(t, locale);
    feedableServices(t).forEach((s, i) => {
      data.push({
        merchant_id: t.id,
        service_id: s.id,
        localized_service_name: text(s.name.trim(), locale),
        localized_service_category: text((s.category ?? '').trim() || (locale.startsWith('vi') ? 'Dịch vụ' : 'Services'), locale),
        ...(s.description?.trim() ? { localized_service_description: text(s.description.trim().slice(0, 2000), locale) } : {}),
        service_price: {
          price_interpretation: s.priceFrom ? 'INTERPRETATION_STARTS_AT' : 'INTERPRETATION_EXACT',
          min_price: { price_micros: priceMicros(s.priceCents, t.currency), currency_code: (t.currency || 'USD').toUpperCase() },
        },
        action_link: [{ url: bookingUrl(webUrl, t.slug, s.id) }],
        service_duration: { duration_interpretation: 'INTERPRETATION_EXACT', min_duration_sec: s.durationMinutes * 60 },
        ranking_hint: { score: i },
        bookability_info: bookability(t),
        ...(policy ? { policy_info: { policies: [policy] } } : {}),
      });
    });
  }
  return { data };
}

export function buildActionFeed(tenants: FeedTenant[], webUrl: string) {
  return {
    data: tenants.map((t) => ({
      entity_id: t.id,
      link_id: `${t.id}-book`,
      url: bookingUrl(webUrl, t.slug),
      actions: [{ appointment_info: {} }],
    })),
  };
}

export const FEED_NAMES = {
  entity: 'reservewithgoogle.entity',
  service: 'glam.service.v0',
  action: 'reservewithgoogle.action.v2',
} as const;
export type FeedKind = keyof typeof FEED_NAMES;

/**
 * The file names of one upload: `<kind>_<ts>.json` and its descriptor,
 * named the way Google's feed guide says a descriptor must be:
 * `<feed_name>-<generation_timestamp>.filesetdesc.json`
 * (e.g. `reservewithgoogle.entity-1792144800.filesetdesc.json`).
 */
export function feedFileNames(kind: FeedKind, generatedAt: Date): { data: string; descriptor: string } {
  const ts = Math.floor(generatedAt.getTime() / 1000);
  return { data: `${kind}_${ts}.json`, descriptor: `${FEED_NAMES[kind]}-${ts}.filesetdesc.json` };
}

export function descriptor(kind: FeedKind, generatedAt: Date, dataFiles: string[]) {
  return { generation_timestamp: Math.floor(generatedAt.getTime() / 1000), name: FEED_NAMES[kind], data_file: dataFiles };
}

/** Everything one daily upload consists of: six files, ready to write. */
export function buildUpload(tenants: FeedTenant[], webUrl: string, generatedAt: Date): { name: string; body: string }[] {
  const out: { name: string; body: string }[] = [];
  const feeds: Record<FeedKind, unknown> = {
    entity: buildEntityFeed(tenants, webUrl),
    service: buildServicesFeed(tenants, webUrl),
    action: buildActionFeed(tenants, webUrl),
  };
  for (const kind of Object.keys(feeds) as FeedKind[]) {
    const names = feedFileNames(kind, generatedAt);
    out.push({ name: names.data, body: JSON.stringify(feeds[kind]) });
    out.push({ name: names.descriptor, body: JSON.stringify(descriptor(kind, generatedAt, [names.data])) });
  }
  return out;
}
