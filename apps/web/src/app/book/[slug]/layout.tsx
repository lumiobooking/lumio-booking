// Server component layout for the public booking page. Adds crawler- & AI-visible
// SEO: server-rendered <title>/description/Open Graph (generateMetadata) plus
// schema.org JSON-LD structured data (NailSalon or Restaurant depending on the
// tenant's businessType). This is what lets a salon or restaurant show up in
// Google rich results and in AI assistants (ChatGPT/Gemini) — something the
// generic booking competitors don't do.
import type { Metadata } from 'next';
import type { ReactNode } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8005/api';
const WEB_URL = (process.env.NEXT_PUBLIC_WEB_URL ?? 'https://lumiobooking.com').replace(/\/$/, '');

interface Seo {
  name: string;
  slug: string;
  businessType?: string;
  timezone: string;
  contactPhone: string | null;
  contactEmail: string | null;
  address: string | null;
  website: string | null;
  accentColor: string;
  logoUrl: string | null;
  currency: string;
  priceFromCents: number | null;
  hours: { day: number; closed: boolean; open: string; close: string }[];
  rating: { value: number; count: number } | null;
  analytics?: { ga4Id?: string; gtmId?: string; mode?: string } | null;
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

function money(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'USD', maximumFractionDigits: 0 }).format(cents / 100);
  } catch {
    return `$${Math.round(cents / 100)}`;
  }
}

function buildDescription(s: Seo): string {
  if (s.businessType === 'RESTAURANT') {
    const parts: string[] = [`Reserve a table at ${s.name} online`];
    if (s.address) parts.push(`Located in ${s.address}`);
    parts.push('Fast, easy 24/7 online reservations — pick your party size, date and time.');
    return parts.join('. ').slice(0, 300);
  }
  const parts: string[] = [`Book your nail appointment at ${s.name} online`];
  if (s.address) parts.push(`Located in ${s.address}`);
  if (s.priceFromCents) parts.push(`Services from ${money(s.priceFromCents, s.currency)}`);
  parts.push('Fast, easy 24/7 online booking — pick your service, technician and time.');
  return parts.join('. ').slice(0, 300);
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function buildJsonLd(s: Seo): Record<string, unknown> {
  const url = `${WEB_URL}/${s.slug}`;
  const isRestaurant = s.businessType === 'RESTAURANT';
  const openingHoursSpecification = (s.hours ?? [])
    .filter((h) => !h.closed)
    .map((h) => ({ '@type': 'OpeningHoursSpecification', dayOfWeek: DAY_NAMES[h.day], opens: h.open, closes: h.close }));
  return {
    '@context': 'https://schema.org',
    '@type': isRestaurant ? 'Restaurant' : 'NailSalon',
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
    ...(s.rating ? { aggregateRating: { '@type': 'AggregateRating', ratingValue: s.rating.value, reviewCount: s.rating.count } } : {}),
  };
}

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const s = await getSeo(params.slug);
  if (!s) return { title: 'Book online' };
  const title = s.businessType === 'RESTAURANT'
    ? `${s.name} — Book a Table Online`
    : `${s.name} — Book a Nail Appointment Online`;
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
  return (
    <>
      {/* The booking page is the only thing a customer ever sees of the salon —
          it gets a real typeface, not the OS default. Plus Jakarta Sans is
          geometric, friendly and (unlike Poppins) ships a Vietnamese subset, so
          salon names with dấu render correctly. */}
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
      {ga4Id && (
        // eslint-disable-next-line react/no-danger
        <script dangerouslySetInnerHTML={{ __html: `(function(){try{if(window.self!==window.top)return}catch(e){return}var s=document.createElement('script');s.async=true;s.src='https://www.googletagmanager.com/gtag/js?id=${ga4Id}';document.head.appendChild(s);window.dataLayer=window.dataLayer||[];window.gtag=function(){dataLayer.push(arguments)};window.gtag('js',new Date());window.gtag('config','${ga4Id}');})();` }} />
      )}
      {gtmId && (
        // eslint-disable-next-line react/no-danger
        <script dangerouslySetInnerHTML={{ __html: `(function(){try{if(window.self!==window.top)return}catch(e){return}(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${gtmId}');})();` }} />
      )}
      {children}
    </>
  );
}
