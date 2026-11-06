// Public page: how a salon (merchant) leaves the "Book online" button on Google.
//
// Google Actions Center requires every partner brand to have an Opt-out URL
// "where a merchant can opt out of being included in your data feed", and the
// reviewers open it. It must be public, say what is shared, how to opt out,
// how fast, and how to come back. The switch itself is the per-salon
// `google_book.enabled` setting (support/google-book toggle): a salon that is
// off is left out of the next daily feed (lintTenant → status 'off').
import type { Metadata } from 'next';
import Link from 'next/link';
import { COMPANY, officeLine } from '../../lib/company-info';

export const metadata: Metadata = {
  title: 'Opt out of booking on Google — Lumio Booking',
  description: 'How a salon that uses Lumio Booking can remove its "Book online" button on Google Search and Maps, or turn it back on.',
};

export default function GoogleOptOutPage() {
  const subject = encodeURIComponent('Opt out of booking on Google');
  const body = encodeURIComponent('Salon name:\nSalon address:\nYour name and role (owner / manager):\n\nPlease remove our salon from the Lumio Booking feed to Google.');
  return (
    <main style={wrap}>
      <div style={card}>
        <div style={{ textAlign: 'center', marginBottom: 6 }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#0f172a', letterSpacing: -0.5 }}>
            Lumio<span style={{ color: INDIGO }}>Booking</span>
          </div>
          <h1 style={h1}>Opt out of booking on Google</h1>
          <p style={muted}>For salons (merchants) that use Lumio Booking.</p>
        </div>

        <h2 style={h2}>What we share with Google</h2>
        <p style={p}>
          When a salon uses Lumio Booking, we can send Google the information needed to show a <strong>Book online</strong> button
          on the salon&rsquo;s Google Search and Maps listing: the salon&rsquo;s business name, address and phone number, its
          service menu with prices and durations, and the link to its Lumio booking page. Clients who press the button book on
          the salon&rsquo;s own Lumio booking page. We do not send Google any client personal information.
        </p>

        <h2 style={h2}>How to opt out</h2>
        <p style={p}>Any salon can leave at any time, free of charge, and keep using Lumio Booking as before.</p>
        <ul style={ul}>
          <li>
            <strong>Email us</strong> from the owner or manager email on your Lumio account:{' '}
            <a href={`mailto:${COMPANY.supportEmail}?subject=${subject}&body=${body}`} style={a}>{COMPANY.supportEmail}</a>, with
            the subject &ldquo;Opt out of booking on Google&rdquo;, your salon name and address.
          </li>
          <li>
            <strong>Or call</strong> <a href={COMPANY.phoneHref} style={a}>{COMPANY.phone}</a> and ask to turn off booking on Google.
          </li>
        </ul>
        <p style={p}>
          We confirm within {COMPANY.replyTime} and remove your salon from the next daily update we send to Google. Google
          usually takes the button down within a few days after that. Your Google Business Profile itself is not changed, and
          appointments already booked stay in your Lumio calendar.
        </p>

        <h2 style={h2}>Turning it back on</h2>
        <p style={p}>
          Email or call us the same way and ask to turn booking on Google back on. Your salon is included again from the next
          daily update.
        </p>

        <h2 style={h2}>Questions</h2>
        <p style={p}>
          {COMPANY.legalName} · {officeLine()}<br />
          Email: <a href={`mailto:${COMPANY.supportEmail}`} style={a}>{COMPANY.supportEmail}</a> · Phone:{' '}
          <a href={COMPANY.phoneHref} style={a}>{COMPANY.phone}</a>
        </p>

        <p style={{ ...muted, marginTop: 22 }}>
          See also our <Link href="/merchant-terms" style={a}>Merchant agreement</Link>,{' '}
          <Link href="/privacy" style={a}>Privacy policy</Link> and <Link href="/support" style={a}>Support</Link>.
        </p>
      </div>
    </main>
  );
}

const INDIGO = '#6366f1';
const wrap: React.CSSProperties = { minHeight: '100vh', background: '#f8fafc', padding: '32px 16px', fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif' };
const card: React.CSSProperties = { maxWidth: 680, margin: '0 auto', background: '#fff', borderRadius: 16, padding: '28px 24px', boxShadow: '0 8px 30px rgba(15,23,42,0.08)', color: '#1e293b' };
const h1: React.CSSProperties = { fontSize: 24, margin: '12px 0 4px', color: '#0f172a' };
const h2: React.CSSProperties = { fontSize: 17, margin: '24px 0 8px', color: '#0f172a' };
const p: React.CSSProperties = { fontSize: 14.5, lineHeight: 1.65, color: '#334155', margin: '0 0 10px' };
const ul: React.CSSProperties = { fontSize: 14.5, lineHeight: 1.7, color: '#334155', margin: '0 0 10px', paddingLeft: 20 };
const muted: React.CSSProperties = { fontSize: 13, color: '#64748b', margin: 0 };
const a: React.CSSProperties = { color: INDIGO, textDecoration: 'none' };
