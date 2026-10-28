/**
 * The feeds for Google's "Book online" button: the exact shapes Google reads,
 * built from each salon's own data, with the salons that would be refused
 * held back — and never a salon that is not on the list.
 */
import { buildActionFeed, buildEntityFeed, buildServicesFeed, buildUpload, bookingUrl, descriptor, feedFileNames, priceMicros, type FeedTenant } from './feed';
import { cleanForFeed, isAllCaps, lintService, lintTenant, titleCase } from './feed-lint';

const WEB = 'https://lumiobooking.com';
const salon = (o: Partial<FeedTenant> = {}): FeedTenant => ({
  id: 't-1', slug: 'mt-hawthorn-nail-spa', name: 'Mt. Hawthorn Nail Spa', phone: '+61892345678', website: 'https://mthawthornnails.com.au',
  address: { country: 'AU', locality: 'Mount Hawthorn', region: 'WA', postalCode: '6016', street: '12 Scarborough Beach Rd' },
  lat: -31.92, lng: 115.83, currency: 'AUD', locale: 'en', cancelNoticeHours: 24, depositRequired: false,
  services: [
    { id: 's-gel', name: 'Gel Manicure', description: 'Shellac colour, 3 weeks of shine.', priceCents: 3500, durationMinutes: 40, category: 'Manicure' },
    { id: 's-pedi', name: 'Spa Pedicure', priceCents: 4500, durationMinutes: 50, category: 'Pedicure', priceFrom: true },
    { id: 's-walk', name: 'Take Off Only', priceCents: 1000, durationMinutes: 15, walkInOnly: true },
    { id: 's-free', name: 'Consultation', priceCents: 0, durationMinutes: 10 },
  ],
  ...o,
});

describe('money and links', () => {
  it('price_micros: cents for USD/AUD, whole units for the đồng', () => {
    expect(priceMicros(3500, 'AUD')).toBe(35_000_000);
    expect(priceMicros(250000, 'VND')).toBe(250_000_000_000);
  });
  it('the book link is the /gbp route, with the service pre-selected when given', () => {
    expect(bookingUrl(WEB, 'mt-hawthorn-nail-spa')).toBe('https://lumiobooking.com/mt-hawthorn-nail-spa/gbp');
    expect(bookingUrl(`${WEB}/`, 'a b', 's 1')).toBe('https://lumiobooking.com/a%20b/gbp?service=s%201');
  });
});

describe('the three feeds', () => {
  const t = salon();
  it('entity: one per salon, keyed by tenant id, with address, coordinates and the cancel policy', () => {
    const e = buildEntityFeed([t], WEB).data[0] as Record<string, unknown>;
    expect(e.entity_id).toBe('t-1');
    expect(e.name).toBe('Mt. Hawthorn Nail Spa');
    expect(e.telephone).toBe('+61892345678');
    expect(e.url).toBe('https://mthawthornnails.com.au');
    expect(e.location).toEqual({ latitude: -31.92, longitude: 115.83, address: { country: 'AU', locality: 'Mount Hawthorn', region: 'WA', postal_code: '6016', street_address: '12 Scarborough Beach Rd' } });
    expect(e.bookability_info).toEqual({ is_online_bookable: true, payment_required: false, card_on_file_required: false, otp_required: false, sign_in_required: false });
    expect((e.policy_info as { policies: { text_content: { value: string } }[] }).policies[0].text_content.value).toMatch(/24 hours/);
  });
  it('entity without a website or structured address falls back to the booking page and the text address', () => {
    const e = buildEntityFeed([salon({ website: null, address: null, unstructuredAddress: '12 Scarborough Beach Rd, Mount Hawthorn WA' })], WEB).data[0] as Record<string, unknown>;
    expect(e.url).toBe('https://lumiobooking.com/mt-hawthorn-nail-spa');
    expect((e.location as { unstructured_address: string }).unstructured_address).toMatch(/Mount Hawthorn/);
  });
  it('services: only the online-bookable ones, priced in micros, timed in seconds, each with its own deep link', () => {
    const rows = buildServicesFeed([t], WEB).data as Record<string, unknown>[];
    expect(rows.map((r) => r.service_id)).toEqual(['s-gel', 's-pedi']); // walk-in-only and the free one are out
    const gel = rows[0];
    expect(gel.merchant_id).toBe('t-1');
    expect(gel.localized_service_name).toEqual({ value: 'Gel Manicure', localized_value: [{ locale: 'en', value: 'Gel Manicure' }] });
    expect(gel.localized_service_category).toEqual({ value: 'Manicure', localized_value: [{ locale: 'en', value: 'Manicure' }] });
    expect(gel.service_price).toEqual({ price_interpretation: 'INTERPRETATION_EXACT', min_price: { price_micros: 35_000_000, currency_code: 'AUD' } });
    expect(gel.service_duration).toEqual({ duration_interpretation: 'INTERPRETATION_EXACT', min_duration_sec: 2400 });
    expect(gel.action_link).toEqual([{ url: 'https://lumiobooking.com/mt-hawthorn-nail-spa/gbp?service=s-gel' }]);
    expect((rows[1].service_price as { price_interpretation: string }).price_interpretation).toBe('INTERPRETATION_STARTS_AT');
    expect((rows[1].localized_service_category as { value: string }).value).toBe('Pedicure');
  });
  it('action: the salon-level book link', () => {
    expect(buildActionFeed([t], WEB).data).toEqual([{ entity_id: 't-1', link_id: 't-1-book', url: 'https://lumiobooking.com/mt-hawthorn-nail-spa/gbp', actions: [{ appointment_info: {} }] }]);
  });
  it('descriptor and file names carry the generation timestamp and the feed name Google expects', () => {
    const at = new Date('2026-10-16T10:00:00Z');
    expect(feedFileNames('service', at)).toEqual({ data: 'service_1792144800.json', descriptor: 'glam.service.v0-1792144800.filesetdesc.json' });
    expect(descriptor('entity', at, ['entity_1792144800.json'])).toEqual({ generation_timestamp: 1792144800, name: 'reservewithgoogle.entity', data_file: ['entity_1792144800.json'] });
    const files = buildUpload([t], WEB, at);
    expect(files.map((f) => f.name)).toEqual(['entity_1792144800.json', 'reservewithgoogle.entity-1792144800.filesetdesc.json', 'service_1792144800.json', 'glam.service.v0-1792144800.filesetdesc.json', 'action_1792144800.json', 'reservewithgoogle.action.v2-1792144800.filesetdesc.json']);
    expect(JSON.parse(files[3].body).name).toBe('glam.service.v0');
    expect(JSON.parse(files[5].body).name).toBe('reservewithgoogle.action.v2');
  });
  it('a salon that is not on the list is not in any feed — the list is the scope', () => {
    const other = salon({ id: 't-2', slug: 'other' });
    expect(buildEntityFeed([t], WEB).data.map((e) => (e as { entity_id: string }).entity_id)).toEqual(['t-1']);
    expect(buildServicesFeed([other], WEB).data.every((r) => (r as { merchant_id: string }).merchant_id === 't-2')).toBe(true);
  });
});

describe('lint — what Google would refuse', () => {
  it('shouting, emoji, prices and contacts in a service name; a free or untimed service', () => {
    expect(isAllCaps('GEL MANICURE')).toBe(true);
    expect(isAllCaps('SNS Dip')).toBe(false);
    expect(titleCase('MT. HAWTHORN NAIL SPA')).toBe('Mt. Hawthorn Nail Spa');
    const codes = (s: Parameters<typeof lintService>[0]) => lintService(s).map((i) => i.code);
    expect(codes({ id: 'a', name: 'GEL MANICURE', priceCents: 3500, durationMinutes: 30 })).toContain('svc_caps');
    expect(codes({ id: 'a', name: 'Gel Manicure 💅', priceCents: 3500, durationMinutes: 30 })).toContain('svc_emoji');
    expect(codes({ id: 'a', name: 'Gel Manicure $35', priceCents: 3500, durationMinutes: 30 })).toContain('svc_price_in_name');
    expect(codes({ id: 'a', name: 'Call 512-886-8189 Gel', priceCents: 3500, durationMinutes: 30 })).toContain('svc_contact_in_name');
    expect(codes({ id: 'a', name: 'Gel Manicure', priceCents: 0, durationMinutes: 0 })).toEqual(expect.arrayContaining(['svc_no_price', 'svc_no_duration']));
    expect(codes({ id: 'a', name: 'Gel Manicure', description: 'Book now at www.site.com', priceCents: 3500, durationMinutes: 30 })).toContain('svc_desc_contact');
    expect(codes({ id: 'a', name: 'Gel Manicure', priceCents: 3500, durationMinutes: 30 })).toEqual([]);
  });
  it('a salon is ready only with a real name, a Google link and bookable services; warnings do not hold it back', () => {
    const ok = lintTenant(salon(), { googleLinked: true, enabled: true });
    expect(ok.status).toBe('ready');
    expect(ok.feedable).toBe(2);
    const shouting = lintTenant(salon({ name: 'MT. HAWTHORN NAIL SPA' }), { googleLinked: true, enabled: true });
    expect(shouting.status).toBe('fix');
    expect(shouting.issues.map((i) => i.code)).toContain('name_caps');
    const unlinked = lintTenant(salon(), { googleLinked: false, enabled: true });
    expect(unlinked.issues.map((i) => i.code)).toContain('google_not_linked');
    expect(unlinked.status).toBe('fix');
    const noPolicy = lintTenant(salon({ cancelNoticeHours: 0, phone: null }), { googleLinked: true, enabled: true });
    expect(noPolicy.status).toBe('ready');
    expect(noPolicy.issues.map((i) => i.level)).toEqual(['warn', 'warn']);
    expect(lintTenant(salon(), { googleLinked: true, enabled: false }).status).toBe('off');
  });

  it('one bad service never holds a salon back: shouted names are rewritten, contact-laden descriptions dropped, priced names left out', () => {
    const t = salon({ services: [
      { id: 'a', name: 'GEL MANICURE', priceCents: 3500, durationMinutes: 30 },
      { id: 'b', name: 'Spa Pedicure', description: 'Call 512-886-8189 to book', priceCents: 4500, durationMinutes: 50 },
      { id: 'c', name: 'Full Set $45', priceCents: 4500, durationMinutes: 60 },
    ] });
    const lint = lintTenant(t, { googleLinked: true, enabled: true });
    expect(lint.status).toBe('ready');
    expect(lint.feedable).toBe(2);
    expect(lint.issues.every((i) => i.level === 'warn')).toBe(true);
    const { tenant } = cleanForFeed(t);
    expect(tenant.services.map((s) => [s.id, s.name, s.description ?? null])).toEqual([['a', 'Gel Manicure', null], ['b', 'Spa Pedicure', null]]);
    const feed = buildServicesFeed([tenant], WEB) as { data: { service_id: string; localized_service_name: { value: string } }[] };
    expect(feed.data.map((d) => d.localized_service_name.value)).toEqual(['Gel Manicure', 'Spa Pedicure']);
    // Every service bad → still held back.
    const allBad = lintTenant(salon({ services: [{ id: 'c', name: 'Full Set $45', priceCents: 4500, durationMinutes: 60 }] }), { googleLinked: true, enabled: true });
    expect(allBad.status).toBe('fix');
    expect(allBad.issues.map((i) => i.code)).toContain('no_clean_services');
  });

  it('the Maps listing name is what Google matches; restaurants and real estate are not appointments; promo in the name is refused', () => {
    const viaListing = lintTenant(salon({ name: 'MT. HAWTHORN NAIL SPA', listingName: 'Mt Hawthorn Nail Spa' }), { googleLinked: true, enabled: true });
    expect(viaListing.status).toBe('ready');
    const entity = buildEntityFeed([salon({ name: 'MT. HAWTHORN NAIL SPA', listingName: 'Mt Hawthorn Nail Spa' })], WEB) as { data: { name: string }[] };
    expect(entity.data[0].name).toBe('Mt Hawthorn Nail Spa');
    expect(lintTenant(salon(), { googleLinked: true, enabled: true, notAppointments: true }).status).toBe('off');
    expect(lintTenant(salon({ name: 'Foot Massage &Head Spa 35%off' }), { googleLinked: true, enabled: true }).issues.map((i) => i.code)).toContain('name_extra');
    expect(titleCase('ZEN SHIATSU HEALING CENTER LLC')).toBe('Zen Shiatsu Healing Center LLC');
    expect(titleCase('NAILS FOR US')).toBe('Nails For Us');
  });
});
