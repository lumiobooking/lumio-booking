// Server component layout for the public booking page. Adds crawler- & AI-visible
// SEO: server-rendered <title>/description/Open Graph (generateMetadata) plus
// schema.org JSON-LD structured data (NailSalon, HairSalon, DaySpa, Restaurant…
// by the shop's trade — lib/booking-seo.ts). This is what lets a salon or restaurant show up in
// Google rich results and in AI assistants (ChatGPT/Gemini) — something the
// generic booking competitors don't do.
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { adsInlineSnippet } from '../../../lib/ads-tag';
import { cancelLine, hoursRows, priceLabel, uses12h, type SeoPolicy } from '../../../lib/static-menu';
import { seoText } from '../../../lib/booking-seo';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8005/api';
/** Just the scheme + host of the API, for the preconnect hint. */
function apiOrigin(): string {
  try { return new URL(API_URL).origin; } catch { return API_URL; }
}
const WEB_URL = (process.env.NEXT_PUBLIC_WEB_URL ?? 'https://lumiobooking.com').replace(/\/$/, '');

interface Seo {
  name: string;
  slug: string;
  businessType?: string;
  /** The trade the link preview names (api public/seo-trade.ts; older API builds do not send it). */
  trade?: string | null;
  timezone: string;
  contactPhone: string | null;
  contactEmail: string | null;
  address: string | null;
  website: string | null;
  accentColor: string;
  logoUrl: string | null;
  currency: string;
  priceFromCents: number | null;
  hours: { day: number; closed: boolean; open: string; close: string; intervals?: { open: string; close: string }[] }[];
  rating: { value: number; count: number } | null;
  analytics?: { ga4Id?: string; gtmId?: string; mode?: string; adsId?: string } | null;
  /** The bookable menu, for the server-rendered first paint (see StaticMenu). */
  menu?: { id: string; name: string; priceCents: number; priceFrom: boolean; durationMinutes: number; category: string | null }[];
  /** The salon's cancellation rule (older API builds do not send it). */
  policy?: SeoPolicy | null;
}

async function getSeo(slug: string): Promise<Seo | null> {
  try {
    const res = await fetch(`${API_URL}/public/salons/${encodeURIComponent(slug)}/seo`, { next: { revalidate: 3600 } });
    if (!res.ok) return null;
    return (await res.json()) as Seo;
  } catch {
    return null;
  }
}

/** Prices in the page's SEO description. Runs on the server, so the locale
 *  stays fixed; what must not stay fixed is the divide — the đồng has no
 *  sub-unit, so 250000 is 250,000₫ and dividing would advertise a hundredth of
 *  the price in search results. */
function money(minorUnits: number, currency: string): string {
  const code = currency || 'USD';
  try {
    const nf = new Intl.NumberFormat('en-US', { style: 'currency', currency: code, maximumFractionDigits: 0 });
    const zeroDecimal = new Intl.NumberFormat('en-US', { style: 'currency', currency: code })
      .resolvedOptions().maximumFractionDigits === 0;
    return nf.format(zeroDecimal ? minorUnits : minorUnits / 100);
  } catch {
    return `$${Math.round(minorUnits / 100)}`;
  }
}

function buildDescription(s: Seo): string {
  // The words follow the shop's trade (lib/booking-seo.ts) — a hair salon's
  // link no longer previews as "Book your nail appointment".
  const t = seoText(s);
  const parts: string[] = [t.lead];
  if (s.address) parts.push(`${t.vi ? 'Địa chỉ' : 'Located in'} ${s.address}`);
  if (s.priceFromCents && !t.table) parts.push(`${t.vi ? 'Dịch vụ từ' : 'Services from'} ${money(s.priceFromCents, s.currency)}`);
  parts.push(t.how);
  return parts.join('. ').replace(/\.\./g, '.').slice(0, 300);
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function buildJsonLd(s: Seo): Record<string, unknown> {
  const url = `${WEB_URL}/${s.slug}`;
  const isRestaurant = s.businessType === 'RESTAURANT';
  const words = seoText(s);
  const openingHoursSpecification = (s.hours ?? [])
    .filter((h) => !h.closed)
    .flatMap((h) => {
      const ivs = h.intervals && h.intervals.length ? h.intervals : [{ open: h.open, close: h.close }];
      return ivs.map((iv) => ({ '@type': 'OpeningHoursSpecification', dayOfWeek: DAY_NAMES[h.day], opens: iv.open, closes: iv.close }));
    });
  return {
    '@context': 'https://schema.org',
    '@type': words.schema,
    name: s.name,
    url,
    ...(s.contactPhone ? { telephone: s.contactPhone } : {}),
    ...(s.contactEmail ? { email: s.contactEmail } : {}),
    ...(s.website ? { sameAs: [s.website] } : {}),
    ...(s.address ? { address: { '@type': 'PostalAddress', streetAddress: s.address } } : {}),
    ...(s.logoUrl && s.logoUrl.startsWith('http') ? { image: s.logoUrl, logo: s.logoUrl } : {}),
    priceRange: s.priceFromCents ? `${money(s.priceFromCents, s.currency)}+` : '$$',
    ...(isRestaurant ? { acceptsReservations: true } : {}),
    ...(openingHoursSpecification.length ? { openingHoursSpecification } : {}),
    potentialAction: { '@type': 'ReserveAction', name: isRestaurant ? 'Reserve a table' : 'Book an appointment', target: url },
    ...((s.menu ?? []).length && !isRestaurant ? {
      hasOfferCatalog: {
        '@type': 'OfferCatalog', name: 'Services',
        itemListElement: (s.menu ?? []).slice(0, 40).map((m) => ({
          '@type': 'Offer', itemOffered: { '@type': 'Service', name: m.name }, price: money(m.priceCents, s.currency).replace(/[^0-9.,]/g, ''), priceCurrency: s.currency || 'USD',
        })),
      },
    } : {}),
    ...(s.rating ? { aggregateRating: { '@type': 'AggregateRating', ratingValue: s.rating.value, reviewCount: s.rating.count } } : {}),
  };
}

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const s = await getSeo(params.slug);
  if (!s) return { title: 'Book online' };
  const title = seoText(s).title;
  const description = buildDescription(s);
  const url = `${WEB_URL}/${s.slug}`;
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: { title, description, url, type: 'website', siteName: s.name, ...(s.logoUrl && s.logoUrl.startsWith('http') ? { images: [{ url: s.logoUrl }] } : {}) },
    twitter: { card: 'summary', title, description },
    robots: { index: true, follow: true },
  };
}

/**
 * THE PAGE A CRAWLER SEES.
 *
 * The booking page is a client app: until its script runs, the HTML held only
 * the <head>. Google's business-link check and the Actions Center review open
 * the link with a crawler and judge what is in the HTML — an empty page is "a
 * link where the customer cannot complete the action", and the "Book online"
 * button never shows. So the salon's menu is rendered here, on the server, as
 * plain HTML: name, address, hours, every bookable service with length and
 * price, and a button into the form — inside <noscript>, so a visitor whose
 * browser runs the app never sees it (no flash of a second page), while a
 * crawler without JavaScript reads the full menu. Same facts for everyone —
 * nothing is served to crawlers only.
 */
function StaticMenu({ s }: { s: Seo }) {
  const menu = s.menu ?? [];
  if (!menu.length) return null;
  const accent = /^#[0-9a-f]{6}$/i.test(s.accentColor || '') ? s.accentColor : '#4f46e5';
  const groups = new Map<string, typeof menu>();
  for (const m of menu) { const k = m.category ?? ''; groups.set(k, [...(groups.get(k) ?? []), m]); }
  const hours = hoursRows(s.hours, uses12h(s.currency));
  const muted = '#475569';
  return (
    <section id="lumio-ssr-menu" aria-label={`${s.name} services`} style={{ maxWidth: 760, margin: '0 auto', padding: '20px 16px 32px', fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", color: '#0f172a', lineHeight: 1.5 }}>
      <h1 style={{ fontSize: 24, margin: '0 0 4px' }}>{s.name}</h1>
      <p style={{ margin: '0 0 12px', color: muted, fontSize: 14 }}>
        {s.address ? <span>{s.address}</span> : null}
        {s.contactPhone ? <span>{s.address ? ' · ' : ''}<a href={`tel:${s.contactPhone}`} style={{ color: '#0f172a' }}>{s.contactPhone}</a></span> : null}
      </p>
      <a href="#book" style={{ display: 'inline-block', background: accent, color: '#ffffff', borderRadius: 10, padding: '10px 18px', fontWeight: 700, textDecoration: 'none', fontSize: 15 }}>Book an appointment</a>

      <h2 style={{ fontSize: 17, margin: '20px 0 8px' }}>Services &amp; prices</h2>
      {[...groups.entries()].map(([cat, items]) => (
        <div key={cat || '_'} style={{ marginBottom: 12 }}>
          {cat ? <h3 style={{ fontSize: 14, margin: '8px 0 4px', color: muted, textTransform: 'uppercase', letterSpacing: 0.5 }}>{cat}</h3> : null}
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {items.map((m) => (
              <li key={m.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '7px 0', borderBottom: '1px solid #e5e7eb', fontSize: 14 }}>
                <a href={`?service=${encodeURIComponent(m.id)}#book`} style={{ color: '#0f172a', textDecoration: 'none', flex: 1 }}>{m.name}{m.durationMinutes ? <span style={{ color: '#64748b' }}> · {m.durationMinutes} min</span> : null}</a>
                <b>{priceLabel(m.priceCents, m.priceFrom, s.currency)}</b>
              </li>
            ))}
          </ul>
        </div>
      ))}
      <p style={{ margin: '4px 0 0', fontSize: 13, color: '#64748b' }}>Prices are set by the salon. Tips are not included.</p>

      {hours.length > 0 && (
        <>
          <h2 style={{ fontSize: 17, margin: '20px 0 8px' }}>Opening hours</h2>
          <table style={{ borderCollapse: 'collapse', fontSize: 14 }}>
            <tbody>
              {hours.map((h) => (
                <tr key={h.day}>
                  <td style={{ padding: '3px 16px 3px 0', color: muted }}>{h.day}</td>
                  <td style={{ padding: '3px 0' }}>{h.text}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <h2 style={{ fontSize: 17, margin: '20px 0 8px' }}>Cancellation policy</h2>
      <p style={{ margin: 0, fontSize: 14 }}>{cancelLine(s.policy, s.contactPhone)}</p>

      <p style={{ margin: '28px 0 0', paddingTop: 14, borderTop: '1px solid #e5e7eb', fontSize: 12.5, color: '#64748b' }}>
        Online booking for {s.name} is provided by <a href={WEB_URL} style={{ color: '#4338ca' }}>Lumio Booking</a>, operated by Lumio Agency LLC.
        {' '}<a href={`${WEB_URL}/privacy`} style={{ color: '#4338ca' }}>Privacy policy</a> · <a href={`${WEB_URL}/terms`} style={{ color: '#4338ca' }}>Terms</a> · <a href={`${WEB_URL}/booking-policy`} style={{ color: '#4338ca' }}>Booking policy</a>
      </p>
    </section>
  );
}

export default async function BookSlugLayout({ children, params }: { children: ReactNode; params: { slug: string } }) {
  const s = await getSeo(params.slug);
  const jsonLd = s ? buildJsonLd(s) : null;
  // Validate the shape before it ever reaches the page — belt & suspenders XSS guard.
  const ga4IdRaw = /^G-[A-Z0-9]{4,20}$/i.test(s?.analytics?.ga4Id ?? '') ? s!.analytics!.ga4Id! : '';
  const gtmIdRaw = /^GTM-[A-Z0-9]{4,12}$/i.test(s?.analytics?.gtmId ?? '') ? s!.analytics!.gtmId! : '';
  // Exactly ONE tracking method per salon. Explicit mode wins; the legacy
  // '' (auto) prefers GTM when present — a GTM container usually already
  // includes the Google Tag, so loading GA4 alongside would double-count.
  const mode = s?.analytics?.mode ?? '';
  const effective = mode === 'none' ? 'none'
    : mode === 'ga4' ? (ga4IdRaw ? 'ga4' : 'none')
    : mode === 'gtm' ? (gtmIdRaw ? 'gtm' : 'none')
    : gtmIdRaw ? 'gtm' : ga4IdRaw ? 'ga4' : 'none';
  const ga4Id = effective === 'ga4' ? ga4IdRaw : '';
  const gtmId = effective === 'gtm' ? gtmIdRaw : '';
  // The salon's Google Ads tag, in the HTML (see adsInlineSnippet). '' unless
  // the stored id is well-formed — nothing else can reach the page.
  const adsSnippet = adsInlineSnippet(s?.analytics?.adsId ?? '');
  return (
    <>
      {/* The booking page is the only thing a customer ever sees of the salon —
          it gets a real typeface, not the OS default. Plus Jakarta Sans is
          geometric, friendly and (unlike Poppins) ships a Vietnamese subset, so
          salon names with dấu render correctly. */}
      {/* The API is on another origin: open its connection while the HTML
          is still parsing, so the first data request does not pay DNS + TLS
          on top of everything else. */}
      <link rel="preconnect" href={apiOrigin()} crossOrigin="anonymous" />
      <link rel="dns-prefetch" href={apiOrigin()} />
      {/* And start THE data request itself with the HTML. The page's own
          fetch of /bootstrap could only begin once its script had downloaded
          and run — a second or more after the HTML arrived, then another
          second for the request. Preloaded here, the answer is already in the
          browser when the script asks for it (same URL, same credentials
          mode, so the browser hands over the preloaded response). */}
      <link rel="preload" href={`${API_URL}/public/salons/${encodeURIComponent(params.slug)}/bootstrap`} as="fetch" crossOrigin="anonymous" />
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Nunito:wght@600;700;800&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap"
      />
      {jsonLd && (
        // eslint-disable-next-line react/no-danger
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }} />
      )}
      {/* Per-salon web analytics. Only well-formed IDs are injected (validated here and
          server-side) so a stored value can never smuggle in script. Each salon loads
          only its OWN GA4 / GTM, so measurement never mixes between shops. */}
      {/* Analytics run ONLY when this page is the top window (direct/GBP/ads
          traffic). Inside an IFRAME (form embedded on the salon's website) we
          stay silent: the parent site's own GTM/GA4 measures the session, and
          the booking conversion reaches it via postMessage — one session, one
          source, zero double-counting. */}
      {/* The /gbp campaign stamp used to live here as an inline <script>. It was
          in the page — you could find it in the DOM — and it never once ran:
          this is a nested layout, so React INSERTS its markup rather than the
          browser parsing it, and an inserted <script> element does not execute.
          Every Google Maps booking arrived with no campaign and was filed as an
          untagged hosted link for months.

          It now lives in the booking page's own effect, which is guaranteed to
          run — and the booking's attribution no longer depends on it at all:
          see gbp-source.ts, where the PATH is the evidence. */}
      {/* Consent Mode v2 defaults are pushed BEFORE any Google tag loads (US/CA
          market default = granted; an EU salon needs a CMP that calls
          window.lumioConsentUpdate). The __lumioTag guard hard-reloads if a
          client-side navigation ever lands on a DIFFERENT salon's tag id, so
          one document can never mix two tenants' containers. */}
      {ga4Id && (
        // eslint-disable-next-line react/no-danger
        <script dangerouslySetInnerHTML={{ __html: `(function(){try{if(window.self!==window.top)return}catch(e){return}if(window.__lumioTag&&window.__lumioTag!=='${ga4Id}'){location.reload();return}window.__lumioTag='${ga4Id}';window.dataLayer=window.dataLayer||[];window.gtag=window.gtag||function(){dataLayer.push(arguments)};window.gtag('consent','default',{ad_storage:'granted',ad_user_data:'granted',ad_personalization:'granted',analytics_storage:'granted',wait_for_update:500});window.lumioConsentUpdate=function(c){window.gtag('consent','update',c)};var s=document.createElement('script');s.async=true;s.src='https://www.googletagmanager.com/gtag/js?id=${ga4Id}';document.head.appendChild(s);window.gtag('js',new Date());window.gtag('config','${ga4Id}');})();` }} />
      )}
      {gtmId && (
        // eslint-disable-next-line react/no-danger
        <script dangerouslySetInnerHTML={{ __html: `(function(){try{if(window.self!==window.top)return}catch(e){return}if(window.__lumioTag&&window.__lumioTag!=='${gtmId}'){location.reload();return}window.__lumioTag='${gtmId}';window.dataLayer=window.dataLayer||[];function g(){dataLayer.push(arguments)}g('consent','default',{ad_storage:'granted',ad_user_data:'granted',ad_personalization:'granted',analytics_storage:'granted',wait_for_update:500});window.lumioConsentUpdate=function(c){g('consent','update',c)};(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${gtmId}');})();` }} />
      )}
      {/* This salon's Google Ads tag — after the GA4/GTM snippet, so it reuses
          their gtag.js and consent. The page's effect still calls loadAdsTag
          and finds __lumioAds already set. */}
      {adsSnippet && (
        // eslint-disable-next-line react/no-danger
        <script dangerouslySetInnerHTML={{ __html: adsSnippet }} />
      )}
      {/* Inside <noscript>: a browser running the app never shows it (no flash,
          nothing to remove), a crawler that runs no JavaScript gets the whole
          menu; one that does run JavaScript sees the real page. Same facts
          either way. */}
      {s && <noscript><StaticMenu s={s} /></noscript>}
      <div id="book">{children}</div>
    </>
  );
}
