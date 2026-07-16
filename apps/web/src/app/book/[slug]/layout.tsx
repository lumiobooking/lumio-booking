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
      {children}
    </>
  );
}
