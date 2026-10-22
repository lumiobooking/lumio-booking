'use client';

/**
 * lumiobooking.com — the public home page.
 *
 * WHO READS THIS PAGE, AND WHY IT IS WRITTEN THE WAY IT IS
 *
 * Salon owners deciding whether to try us, and — just as often — a reviewer at
 * Google (Actions Center), Meta, TikTok or an SMS carrier deciding whether
 * Lumio is a real software company. Both are put off by the same things: a
 * gradient hero, emoji for icons, five stars nobody gave us. So this page says
 * only what can be checked: what the product does, what it costs, how a client
 * books and cancels, who runs it and where, and how to reach a person.
 *
 * Company facts come from lib/company-info so this page, /company and the
 * legal pages can never disagree with each other.
 */

import { Fragment, useEffect, useRef, useState, CSSProperties, ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { homeFor, useAuth } from '../lib/auth';
import { useIsMobile } from '../lib/responsive';
import { uiLocale } from '../lib/datetime';
import { COMPANY, officeLine } from '../lib/company-info';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8005/api';

// One small palette. Ink does the work; indigo is the brand mark and the links.
const INK = '#0f172a';
const BODY = '#475569';
const MUTED = '#64748b';
const LINE = '#e2e8f0';
const WASH = '#f8fafc';
const BRAND = '#4f46e5';
const LINK = '#4338ca';

interface PublicPlan {
  id: string; name: string; tagline: string | null; description: string | null; currency: string;
  priceMonthlyCents: number; priceYearlyCents: number; trialDays: number;
  features: string[]; highlighted: boolean;
  providers: { stripe: boolean; paypal: boolean };
}

const money = (cents: number, currency = 'USD') =>
  new Intl.NumberFormat(uiLocale(), { style: 'currency', currency, maximumFractionDigits: 0 }).format(cents / 100);

// Shown until the plans in the database load (or if they never do).
const STATIC_PLANS = [
  { name: 'Starter', tag: 'For small and new salons', monthly: 29, yearly: 290, hi: false,
    bullets: ['Booking page and calendar', 'Client list', 'Email confirmations and reminders', '100 text messages a month'] },
  { name: 'Pro', tag: 'For full-service salons', monthly: 69, yearly: 690, hi: true,
    bullets: ['Everything in Starter', 'Checkout, walk-ins and waitlist', 'Deposits, payroll and tips', 'Messenger and Instagram inbox', '500 text messages a month'] },
  { name: 'Premium', tag: 'For salons with several locations', monthly: 149, yearly: 1490, hi: false,
    bullets: ['Everything in Pro', 'Several locations and combined reports', 'Phone assistant, 300 minutes', 'Priority phone support', '1,500 text messages a month'] },
];

const COMPARE: [string, [string, string, string, string][]][] = [
  ['Booking and scheduling', [
    ['Online booking page', '✓', '✓', '✓'], ['Calendar and appointment statuses', '✓', '✓', '✓'],
    ['Email confirmations and reminders', '✓', '✓', '✓'], ['Deposits for no-show protection', '—', '✓', '✓'],
    ['Waitlist', '—', '✓', '✓'], ['Walk-in queue', '—', '✓', '✓'],
  ]],
  ['Checkout', [
    ['Checkout and receipts', '—', '✓', '✓'], ['Gift cards', '—', '✓', '✓'],
    ['Tips', '—', '✓', '✓'], ['Offline mode and receipt printing', '—', '✓', '✓'],
  ]],
  ['Clients and staff', [
    ['Client list', '✓', '✓', '✓'], ['Services and categories', '✓', '✓', '✓'],
    ['Staff accounts and roles', '✓', '✓', '✓'], ['Payroll, tips and CSV export', '—', '✓', '✓'],
  ]],
  ['Marketing', [
    ['Google review requests', '✓', '✓', '✓'], ['Review replies and leaderboard', '—', '✓', '✓'],
    ['Loyalty points', 'Basic', '✓', '✓'], ['Referrals', '—', '✓', '✓'],
    ['Birthday and email/text campaigns', '—', '✓', '✓'], ['Messenger and Instagram inbox with assistant', '—', '✓', '✓'],
    ['Scheduled posts to TikTok, Facebook and Instagram', '—', '✓', '✓'],
  ]],
  ['Messages and calls', [
    ['Email notifications', '✓', '✓', '✓'], ['Text messages included per month', '100', '500', '1,500'],
    ['Extra text message', '$0.03', '$0.03', '$0.02'], ['Phone assistant', '—', 'Add-on', '✓'],
    ['Phone assistant minutes per month', '—', '150*', '300'], ['Extra minute', '—', '$0.25', '$0.20'],
  ]],
  ['Operations and support', [
    ['Inventory', '—', '✓', '✓'], ['Several locations and combined reports', '—', '—', '✓'],
    ['WordPress plugin', '✓', '✓', '✓'], ['Client-facing display (iPad or second screen)', '—', '✓', '✓'],
    ['Sales and payroll reports', 'Basic', '✓', '✓'], ['Support', 'Email', 'Email and phone', 'Priority phone'],
  ]],
];

const cCell = (v: string) => v === '✓'
  ? <span style={{ color: INK, fontWeight: 700 }} aria-label="Included">✓</span>
  : v === '—' ? <span style={{ color: '#94a3b8' }} aria-label="Not included">—</span>
  : <span style={{ color: INK, fontSize: 13.5 }}>{v}</span>;

function ComparisonTable() {
  const th: CSSProperties = { padding: '12px 14px', fontSize: 14, fontWeight: 700, textAlign: 'center', borderBottom: `1px solid ${INK}` };
  const cat: CSSProperties = { padding: '18px 14px 8px', fontSize: 13, fontWeight: 700, letterSpacing: 0.5, color: MUTED, textTransform: 'uppercase' };
  const feat: CSSProperties = { padding: '10px 14px', fontSize: 14.5, color: '#334155', borderBottom: `1px solid ${LINE}` };
  const val: CSSProperties = { padding: '10px 14px', fontSize: 14.5, textAlign: 'center', borderBottom: `1px solid ${LINE}` };
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
        <thead>
          <tr>
            <th style={{ ...th, textAlign: 'left' }}>Feature</th>
            <th style={th}>Starter</th>
            <th style={th}>Pro</th>
            <th style={th}>Premium</th>
          </tr>
        </thead>
        <tbody>
          {COMPARE.map(([c, rows]) => (
            <Fragment key={c}>
              <tr><td colSpan={4} style={cat}>{c}</td></tr>
              {rows.map((r) => (
                <tr key={r[0]}>
                  <td style={feat}>{r[0]}</td>
                  <td style={val}>{cCell(r[1])}</td>
                  <td style={val}>{cCell(r[2])}</td>
                  <td style={val}>{cCell(r[3])}</td>
                </tr>
              ))}
            </Fragment>
          ))}
        </tbody>
      </table>
      <p style={{ color: MUTED, fontSize: 13, margin: '14px 0 0' }}>
        * On Pro the phone assistant is an add-on (about $39 a month for 150 minutes). Premium includes 300 minutes.
      </p>
    </div>
  );
}

/** A thin brand mark. Kept as SVG so it is crisp everywhere and needs no request. */
function Mark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" aria-hidden="true" style={{ display: 'block', flexShrink: 0 }}>
      <rect width="28" height="28" rx="7" fill={BRAND} />
      <path d="M10 7v14h9" fill="none" stroke="#ffffff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={LINK} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
  );
}

const FEATURES: { title: string; desc: string; icon: ReactNode }[] = [
  { title: 'Booking page', icon: <><rect x="3" y="4" width="18" height="17" rx="2" /><path d="M3 9h18M8 2v4M16 2v4M8 14h3" /></>,
    desc: 'A page at lumiobooking.com/your-salon with services, prices, technicians and live availability. It can be added to the salon’s website and Google Business Profile.' },
  { title: 'Calendar and staff', icon: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5M16 4.5a3.5 3.5 0 0 1 0 7M18 14.8c2 .8 3.2 2.6 3.5 5.2" /></>,
    desc: 'One calendar for the whole team, with working hours, time off, a break between appointments, and a walk-in queue.' },
  { title: 'Checkout', icon: <><path d="M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2z" /><path d="M9 8h6M9 12h6" /></>,
    desc: 'Ring up services and retail at the front desk, record tips, and print or text the receipt.' },
  { title: 'Confirmations and reminders', icon: <><path d="M18 8a6 6 0 1 0-12 0c0 7-3 8-3 8h18s-3-1-3-8" /><path d="M10.3 20a2 2 0 0 0 3.4 0" /></>,
    desc: 'By email, and by text message for clients who agree to receive texts. Each salon chooses when reminders go out.' },
  { title: 'Deposits and payments', icon: <><rect x="2.5" y="5" width="19" height="14" rx="2" /><path d="M2.5 10h19M6 15h4" /></>,
    desc: 'Optional deposits are charged through the salon’s own Stripe, Square, PayPal or Clover account. Money goes straight to the salon.' },
  { title: 'Messages in one place', icon: <path d="M21 12a8 8 0 0 1-11.8 7L4 20.5l1.5-4.6A8 8 0 1 1 21 12z" />,
    desc: 'Facebook Messenger, Instagram and website chat in a single inbox, with an optional assistant that answers booking questions.' },
  // NAMED ON PURPOSE. TikTok's app reviewer reads this page to decide whether
  // Lumio is a product other businesses use or an internal tool, and an
  // integration a product never mentions in public reads as the latter. Our
  // first submission was refused on exactly that reading. Every social network
  // a salon can connect is named here, where it can be checked.
  { title: 'Scheduled social posts', icon: <><rect x="3" y="3" width="18" height="18" rx="3" /><path d="M8 12h8M12 8v8" /></>,
    desc: 'Each salon connects its own TikTok, Facebook and Instagram accounts, plans posts, approves them, and Lumio publishes them at the time the salon picked.' },
  { title: 'Works with your website', icon: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></>,
    desc: 'Add the booking form to an existing site with our WordPress plugin or a short embed code, connected by the salon’s own key.' },
];

const STEPS = [
  { title: 'Choose a service', desc: 'From the salon’s booking page, its website, or its Google Business Profile.' },
  { title: 'Pick a time', desc: 'Only times the salon has open are shown, with the salon’s own prices and durations.' },
  { title: 'Get a confirmation', desc: 'By email, and by text message if the client agrees to receive texts. No account is needed.' },
  { title: 'Change or cancel', desc: 'Every confirmation links to a page where the client can reschedule or cancel, under the salon’s policy.' },
];

export default function HomePage() {
  const { user, ready } = useAuth();
  const mobile = useIsMobile();
  const router = useRouter();
  const [plans, setPlans] = useState<PublicPlan[]>([]);
  const [yearly, setYearly] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    fetch(`${API_URL}/public/plans`).then((r) => r.json()).then((d) => Array.isArray(d) && setPlans(d)).catch(() => {});
  }, []);

  // Every role goes to ITS OWN door. Sending SUPPORT to /salon looked
  // harmless until the app redirect met SalonShell's guard: /salon bounced a
  // support account back to /, which redirected to /salon, forever - Safari
  // kills the app at 100 history writes in 10 seconds.
  const dashHref = homeFor(user);

  // Opened as the INSTALLED app (home-screen icon)? Then this marketing page
  // is the wrong room: the person tapped the icon to run their salon, not to
  // read the pitch. Phones that installed the icon while the manifest was
  // broken saved THIS page as the app's start page, so the redirect is what
  // heals every existing install without asking anyone to re-add the icon.
  const sentAway = useRef(false);
  useEffect(() => {
    if (!ready) return; // wait until we know who is signed in, or we'd bounce an owner to /login
    if (sentAway.current) return; // ONE redirect per visit: if a guard bounces us back, stay - a loop is worse than the pitch
    try {
      const standalone = window.matchMedia?.('(display-mode: standalone)')?.matches
        || (navigator as unknown as { standalone?: boolean }).standalone === true;
      if (standalone) {
        sentAway.current = true;
        router.replace(user ? dashHref : '/login');
      }
    } catch { /* an odd browser reads the page as usual */ }
  }, [ready, router, user, dashHref]);

  const pad = mobile ? 20 : 32;
  const wrap: CSSProperties = { maxWidth: 1200, margin: '0 auto', paddingLeft: pad, paddingRight: pad, boxSizing: 'border-box' };
  const h2: CSSProperties = { margin: 0, fontSize: mobile ? 28 : 38, lineHeight: 1.15, fontWeight: 700, letterSpacing: mobile ? -0.5 : -0.8, color: INK };
  const lead: CSSProperties = { margin: 0, fontSize: mobile ? 16.5 : 18, color: BODY, lineHeight: 1.6 };
  const sectionY = mobile ? 64 : 104;
  const navLinks: [string, string][] = [['Product', '/#product'], ['For clients', '/#clients'], ['Pricing', '/#pricing'], ['Company', '/company'], ['Support', '/support']];

  return (
    <div style={{ background: '#ffffff', color: INK, minHeight: '100vh', fontFamily: 'inherit', fontSize: 16, lineHeight: 1.6 }}>
      {/* ---------------- Nav ---------------- */}
      <header style={{ position: 'sticky', top: 'env(safe-area-inset-top, 0px)', zIndex: 50, background: '#ffffff', borderBottom: `1px solid ${LINE}` }}>
        <nav aria-label="Main" style={{ ...wrap, minHeight: mobile ? 64 : 72, display: 'flex', alignItems: 'center', gap: mobile ? 12 : 32 }}>
          <Link href="/" style={{ display: 'inline-flex', alignItems: 'center', gap: 10, fontSize: mobile ? 17 : 18, fontWeight: 700, color: INK, textDecoration: 'none', letterSpacing: -0.2 }}>
            <Mark size={mobile ? 26 : 28} />Lumio Booking
          </Link>
          {!mobile && (
            <div style={{ display: 'flex', gap: 28, fontSize: 15 }}>
              {navLinks.map(([t, h]) => <Link key={t} href={h} style={navLink}>{t}</Link>)}
            </div>
          )}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: mobile ? 4 : 20, alignItems: 'center' }}>
            {ready && user ? (
              <Link href={dashHref} style={darkBtn}>{mobile ? 'Dashboard' : 'Go to dashboard'}</Link>
            ) : (
              <>
                <Link href="/login" style={{ ...navLink, color: INK, fontWeight: 600, padding: '10px 4px' }}>Sign in</Link>
                {!mobile && <a href="#pricing" style={darkBtn}>Start free trial</a>}
              </>
            )}
            {mobile && (
              <button type="button" onClick={() => setMenuOpen((v) => !v)} aria-label={menuOpen ? 'Close menu' : 'Open menu'} aria-expanded={menuOpen}
                style={{ width: 44, height: 44, border: 'none', background: 'transparent', display: 'grid', placeItems: 'center', cursor: 'pointer' }}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={INK} strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                  {menuOpen ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
                </svg>
              </button>
            )}
          </div>
        </nav>
        {mobile && menuOpen && (
          <div style={{ borderTop: `1px solid ${LINE}`, padding: '8px 20px 16px', display: 'flex', flexDirection: 'column' }}>
            {navLinks.map(([t, h]) => (
              <Link key={t} href={h} onClick={() => setMenuOpen(false)} style={{ ...navLink, color: INK, fontSize: 16, padding: '12px 0', borderBottom: `1px solid ${LINE}` }}>{t}</Link>
            ))}
            {!(ready && user) && <a href="#pricing" onClick={() => setMenuOpen(false)} style={{ ...darkBtn, marginTop: 14, justifyContent: 'center' }}>Start free trial</a>}
          </div>
        )}
      </header>

      {/* ---------------- Hero ---------------- */}
      <section style={{ ...wrap, paddingTop: mobile ? 40 : 88, paddingBottom: mobile ? 48 : 80, display: 'flex', flexWrap: 'wrap', gap: mobile ? 36 : 64, alignItems: 'center' }}>
        <div style={{ flex: '1 1 460px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: mobile ? 18 : 24 }}>
          <div style={{ fontSize: mobile ? 13 : 14, fontWeight: 600, color: LINK }}>Booking and point-of-sale software for salons</div>
          <h1 style={{ margin: 0, fontSize: mobile ? 33 : 52, lineHeight: 1.08, fontWeight: 700, letterSpacing: mobile ? -0.8 : -1.4 }}>
            Online booking and front-desk software for nail and beauty salons.
          </h1>
          <p style={{ ...lead, fontSize: mobile ? 16.5 : 19, maxWidth: 560 }}>
            Each salon gets its own booking page, one calendar for the whole team, checkout at the front desk, and automatic
            appointment reminders. Lumio Booking is used by independent salons in the United States and Canada.
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: mobile ? 8 : 24, flexWrap: 'wrap', flexDirection: mobile ? 'column' : 'row' }}>
            <a href="#pricing" style={{ ...darkBtn, minHeight: 52, padding: '0 24px', fontSize: 16, width: mobile ? '100%' : 'auto', justifyContent: 'center', boxSizing: 'border-box' }}>Start 14-day free trial</a>
            <Link href="/book/lumio-salon" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minHeight: 44, color: INK, textDecoration: 'none', fontSize: 16, fontWeight: 600 }}>
              View a sample booking page
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={INK} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
            </Link>
          </div>
          <div style={{ fontSize: 14, color: MUTED, textAlign: mobile ? 'center' : 'left' }}>No setup fee · Cancel any time · Plans from $29 a month</div>
        </div>
        <BookingPreview mobile={mobile} />
      </section>

      {/* ---------------- Facts that can be checked ---------------- */}
      <section aria-label="At a glance" style={{ borderTop: `1px solid ${LINE}`, borderBottom: `1px solid ${LINE}`, background: WASH }}>
        <div style={{ ...wrap, paddingTop: mobile ? 24 : 32, paddingBottom: mobile ? 24 : 32, display: 'grid', gridTemplateColumns: mobile ? 'repeat(2, minmax(0, 1fr))' : 'repeat(4, minmax(0, 1fr))', gap: mobile ? '20px 16px' : 32 }}>
          {[
            ['14 days', 'Free trial, no card required'],
            ['From $29 / month', 'Published prices, no setup fee'],
            [COMPANY.replyTime, 'Support reply time'],
            ['US & Canada', 'Where our salons operate'],
          ].map(([big, small]) => (
            <div key={big} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontSize: mobile ? 18 : 22, fontWeight: 700 }}>{big}</span>
              <span style={{ fontSize: mobile ? 13 : 14, color: BODY }}>{small}</span>
            </div>
          ))}
        </div>
      </section>

      {/* ---------------- Product ---------------- */}
      <section id="product" style={{ ...wrap, paddingTop: sectionY, paddingBottom: mobile ? 40 : 56, display: 'flex', flexDirection: 'column', gap: mobile ? 32 : 56, scrollMarginTop: 80 }}>
        <div style={{ maxWidth: 720, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <h2 style={h2}>What a salon gets</h2>
          <p style={lead}>One account covers the booking page clients see and the tools the front desk uses every day. Each salon’s data is kept separate and belongs to the salon.</p>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: mobile ? 28 : '48px 40px' }}>
          {FEATURES.map((f) => (
            <div key={f.title} style={{ display: 'flex', flexDirection: 'column', gap: 10, borderTop: `1px solid ${INK}`, paddingTop: 20 }}>
              <Icon>{f.icon}</Icon>
              <h3 style={{ margin: 0, fontSize: mobile ? 17 : 19, fontWeight: 700 }}>{f.title}</h3>
              <p style={{ margin: 0, color: BODY, fontSize: mobile ? 15 : 16 }}>{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <section aria-label="Calendar preview" style={{ ...wrap, paddingBottom: sectionY }}>
        <CalendarPreview />
      </section>

      {/* ---------------- How clients book ---------------- */}
      <section id="clients" style={{ background: WASH, borderTop: `1px solid ${LINE}`, borderBottom: `1px solid ${LINE}`, scrollMarginTop: 80 }}>
        <div style={{ ...wrap, paddingTop: sectionY, paddingBottom: sectionY, display: 'flex', flexDirection: 'column', gap: mobile ? 32 : 48 }}>
          <div style={{ maxWidth: 720, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <h2 style={h2}>How clients book with a Lumio salon</h2>
            <p style={lead}>Clients book directly with the salon. Lumio Booking provides the software; the salon sets its own services, prices, hours and cancellation policy.</p>
          </div>
          <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: mobile ? 24 : 32 }}>
            {STEPS.map((s, i) => (
              <li key={s.title} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: LINK }}>{String(i + 1).padStart(2, '0')}</span>
                <span style={{ fontSize: 18, fontWeight: 700 }}>{s.title}</span>
                <span style={{ color: BODY }}>{s.desc}</span>
              </li>
            ))}
          </ol>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '20px 48px', alignItems: 'center', padding: mobile ? 20 : '24px 28px', border: `1px solid ${LINE}`, borderRadius: 12, background: '#ffffff' }}>
            <div style={{ flex: '1 1 420px', minWidth: 0 }}>
              <div style={{ fontWeight: 700 }}>Questions about an appointment?</div>
              <div style={{ color: BODY }}>
                Contact the salon directly. Its phone number is on the booking page and in every confirmation. For help with the
                booking page itself, write to <a href={`mailto:${COMPANY.supportEmail}`} style={linkStyle}>{COMPANY.supportEmail}</a>.
              </div>
            </div>
            <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', fontWeight: 600, fontSize: 15 }}>
              <Link href="/booking-policy" style={linkStyle}>Cancellation policy</Link>
              <Link href="/privacy" style={linkStyle}>Privacy policy</Link>
            </div>
          </div>
        </div>
      </section>

      {/* ---------------- Pricing ---------------- */}
      <section id="pricing" style={{ ...wrap, paddingTop: sectionY, paddingBottom: sectionY, display: 'flex', flexDirection: 'column', gap: mobile ? 28 : 40, scrollMarginTop: 80 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'flex-end', justifyContent: 'space-between' }}>
          <div style={{ maxWidth: 720, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <h2 style={h2}>Pricing</h2>
            <p style={lead}>Prices are in US dollars, per salon location. Every plan starts with a 14-day free trial. Yearly billing costs the same as 10 months.</p>
          </div>
          <div role="group" aria-label="Billing period" style={{ display: 'inline-flex', border: `1px solid ${LINE}`, borderRadius: 8, padding: 3 }}>
            <button type="button" onClick={() => setYearly(false)} aria-pressed={!yearly} style={toggleBtn(!yearly)}>Monthly</button>
            <button type="button" onClick={() => setYearly(true)} aria-pressed={yearly} style={toggleBtn(yearly)}>Yearly</button>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(270px, 1fr))', gap: 24, alignItems: 'stretch' }}>
          {plans.length === 0
            ? STATIC_PLANS.map((p) => (
              <PlanCard key={p.name} name={p.name} tag={p.tag} hi={p.hi}
                price={`$${yearly ? p.yearly : p.monthly}`} per={yearly ? '/ year' : '/ month'}
                note="14-day free trial" bullets={p.bullets} href="/signup" />
            ))
            : plans.map((p) => (
              <PlanCard key={p.id} name={p.name} tag={p.tagline ?? ''} hi={p.highlighted}
                price={money(yearly ? p.priceYearlyCents : p.priceMonthlyCents, p.currency)} per={yearly ? '/ year' : '/ month'}
                note={[
                  yearly && p.priceMonthlyCents > 0 ? `About ${money(Math.round(p.priceYearlyCents / 12), p.currency)} a month, billed yearly` : '',
                  p.trialDays > 0 ? `${p.trialDays}-day free trial` : '',
                ].filter(Boolean).join(' · ')}
                bullets={p.features.length ? p.features : ['Online booking page', 'Email confirmations and reminders']}
                href={`/signup?plan=${p.id}&interval=${yearly ? 'year' : 'month'}`} />
            ))}
        </div>

        <p style={{ margin: 0, fontSize: 14, color: MUTED }}>
          Extra text messages are billed at $0.03 each ($0.02 on Premium). Card payments and deposits are processed by the
          salon’s own payment provider, at that provider’s rates. Subscriptions are billed by card or PayPal and can be
          cancelled at any time from the dashboard.
        </p>

        <details style={{ borderTop: `1px solid ${LINE}`, paddingTop: 20 }}>
          <summary style={{ cursor: 'pointer', fontWeight: 700, fontSize: 16, minHeight: 44, display: 'flex', alignItems: 'center' }}>Compare all features</summary>
          <div style={{ marginTop: 12 }}><ComparisonTable /></div>
        </details>
      </section>

      {/* ---------------- Company ---------------- */}
      <section id="company" style={{ borderTop: `1px solid ${LINE}` }}>
        <div style={{ ...wrap, paddingTop: mobile ? 56 : 88, paddingBottom: mobile ? 56 : 88, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: mobile ? 32 : 48 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <h2 style={{ ...h2, fontSize: mobile ? 24 : 30 }}>About the company</h2>
            <p style={{ margin: 0, color: BODY }}>Lumio Booking is software developed and operated by {COMPANY.legalName}, a company registered in the United States.</p>
            <Link href="/company" style={{ ...linkStyle, fontWeight: 600 }}>More about {COMPANY.legalName}</Link>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={label}>OFFICE</div>
            <address style={{ fontStyle: 'normal' }}>{COMPANY.office.map((l) => <Fragment key={l}>{l}<br /></Fragment>)}</address>
            <div style={{ ...label, marginTop: 14 }}>REGISTERED ADDRESS</div>
            <address style={{ fontStyle: 'normal' }}>{COMPANY.registered.map((l) => <Fragment key={l}>{l}<br /></Fragment>)}</address>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={label}>CONTACT</div>
            <a href={`mailto:${COMPANY.supportEmail}`} style={linkStyle}>{COMPANY.supportEmail}</a>
            <a href={`mailto:${COMPANY.partnersEmail}`} style={linkStyle}>{COMPANY.partnersEmail}</a>
            <a href={COMPANY.phoneHref} style={linkStyle}>{COMPANY.phone}</a>
            <div style={{ color: BODY, marginTop: 8 }}>We reply within {COMPANY.replyTime}.</div>
          </div>
        </div>
      </section>

      {/* ---------------- Footer ---------------- */}
      <footer style={{ background: INK, color: '#cbd5e1' }}>
        <div style={{ ...wrap, paddingTop: mobile ? 40 : 64, paddingBottom: 32, display: 'flex', flexDirection: 'column', gap: mobile ? 28 : 40 }}>
          <div style={{ display: 'grid', gridTemplateColumns: mobile ? 'repeat(2, minmax(0, 1fr))' : 'repeat(5, minmax(0, 1fr))', gap: mobile ? 28 : 32, fontSize: 15 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, gridColumn: mobile ? '1 / -1' : undefined }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 10, color: '#f8fafc', fontWeight: 700, fontSize: 17 }}><Mark size={26} />Lumio Booking</span>
              <span style={{ color: '#94a3b8', fontSize: 14 }}>Booking and point-of-sale software for salons.</span>
            </div>
            <FooterCol title="Product" links={[['Features', '/#product'], ['Pricing', '/#pricing'], ['Sign in', '/login'], ['Start free trial', '/signup']]} />
            <FooterCol title="For clients" links={[['How booking works', '/#clients'], ['Cancellation policy', '/booking-policy'], ['Text message alerts', '/sms-optin'], ['Delete my data', '/data-deletion']]} />
            <FooterCol title="Company" links={[['About and contact', '/company'], ['Support', '/support'], ['Merchant agreement', '/merchant-terms']]} />
            <FooterCol title="Legal" links={[['Privacy policy', '/privacy'], ['Terms of service', '/terms'], ['Messaging terms', '/terms']]} />
          </div>
          {/* SMS program disclosure — public and verifiable for A2P 10DLC review. */}
          <p style={{ margin: 0, paddingTop: 24, borderTop: '1px solid #1e293b', fontSize: 13, color: '#94a3b8', lineHeight: 1.7 }}>
            Text messages: when a client books with a salon that uses Lumio Booking and gives a mobile number, the salon may
            send appointment confirmations and reminders by text. Promotional texts are sent only with separate consent. Up
            to 6 messages a month. Message and data rates may apply. Reply STOP to opt out or HELP for help. Opt-in and
            consent data is never shared with third parties.{' '}
            <Link href="/sms-optin" style={{ color: '#e2e8f0' }}>Sign up for text alerts</Link> ·{' '}
            <Link href="/privacy" style={{ color: '#e2e8f0' }}>Privacy policy</Link> ·{' '}
            <Link href="/terms" style={{ color: '#e2e8f0' }}>Messaging terms</Link>.
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 24px', fontSize: 13, color: '#94a3b8' }}>
            <span>© {new Date().getFullYear()} {COMPANY.legalName}</span>
            <span>{officeLine()}</span>
            <a href={COMPANY.phoneHref} style={{ color: '#94a3b8', textDecoration: 'none' }}>{COMPANY.phone}</a>
          </div>
        </div>
      </footer>
    </div>
  );
}

function PlanCard({ name, tag, hi, price, per, note, bullets, href }: { name: string; tag: string; hi: boolean; price: string; per: string; note: string; bullets: string[]; href: string }) {
  return (
    <div style={{ border: hi ? `2px solid ${INK}` : `1px solid ${LINE}`, borderRadius: 12, padding: hi ? 27 : 28, display: 'flex', flexDirection: 'column', gap: 20, background: '#ffffff' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 18, fontWeight: 700 }}>{name}</div>
          {tag && <div style={{ fontSize: 14, color: MUTED }}>{tag}</div>}
        </div>
        {hi && <span style={{ fontSize: 12, fontWeight: 600, color: '#334155', border: '1px solid #cbd5e1', borderRadius: 999, padding: '2px 10px', whiteSpace: 'nowrap' }}>Recommended</span>}
      </div>
      <div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
          <span style={{ fontSize: 40, fontWeight: 700, letterSpacing: -1 }}>{price}</span>
          <span style={{ color: MUTED }}>{per}</span>
        </div>
        {note && <div style={{ fontSize: 13.5, color: MUTED }}>{note}</div>}
      </div>
      <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 8, color: '#334155', fontSize: 15 }}>
        {bullets.map((b) => <li key={b}>{b}</li>)}
      </ul>
      <Link href={href} style={hi
        ? { marginTop: 'auto', minHeight: 48, display: 'grid', placeItems: 'center', borderRadius: 8, background: INK, color: '#f8fafc', textDecoration: 'none', fontWeight: 600 }
        : { marginTop: 'auto', minHeight: 48, display: 'grid', placeItems: 'center', borderRadius: 8, border: `1px solid ${INK}`, color: INK, textDecoration: 'none', fontWeight: 600 }}>Start free trial</Link>
    </div>
  );
}

function FooterCol({ title, links }: { title: string; links: [string, string][] }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <span style={{ color: '#f8fafc', fontWeight: 600 }}>{title}</span>
      {links.map(([t, h]) => <Link key={t} href={h} style={{ color: '#cbd5e1', textDecoration: 'none' }}>{t}</Link>)}
    </div>
  );
}

/** A drawn example of a salon's booking page — labelled as an example, never a real salon. */
function BookingPreview({ mobile }: { mobile: boolean }) {
  const row: CSSProperties = { display: 'flex', alignItems: 'center', gap: 12, padding: '12px 8px' };
  const slot: CSSProperties = { textAlign: 'center', padding: '9px 0', border: `1px solid ${LINE}`, borderRadius: 8, fontSize: 14 };
  return (
    <div aria-label="Example of a salon booking page" role="img" style={{ flex: '1 1 400px', minWidth: 0, maxWidth: 520, border: `1px solid ${LINE}`, borderRadius: 16, background: '#ffffff', boxShadow: '0 1px 2px rgba(15,23,42,.04), 0 24px 48px -32px rgba(15,23,42,.35)', overflow: 'hidden' }}>
      <div style={{ padding: mobile ? '14px 16px' : '20px 24px', borderBottom: `1px solid ${LINE}`, display: 'flex', alignItems: 'center', gap: 14 }}>
        <span style={{ width: 44, height: 44, borderRadius: '50%', background: '#f1f5f9', display: 'grid', placeItems: 'center', fontWeight: 700, color: '#334155', flexShrink: 0 }}>SN</span>
        <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.35, minWidth: 0 }}>
          <span style={{ fontWeight: 700 }}>Sample Nail Studio</span>
          <span style={{ fontSize: 13, color: MUTED }}>Open today 9:30 am – 7:00 pm</span>
        </div>
        <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 600, color: BODY, border: `1px solid ${LINE}`, borderRadius: 999, padding: '2px 10px' }}>Example</span>
      </div>
      <div style={{ padding: '16px 24px 8px', fontSize: 12, fontWeight: 600, letterSpacing: 0.6, color: MUTED }}>SERVICE</div>
      <div style={{ display: 'flex', flexDirection: 'column', padding: '0 16px' }}>
        <div style={{ ...row, borderBottom: '1px solid #f1f5f9' }}><span style={{ flex: 1 }}>Gel manicure</span><span style={{ fontSize: 13, color: MUTED }}>45 min</span><span style={{ width: 52, textAlign: 'right', fontWeight: 600 }}>$35</span></div>
        <div style={{ ...row, borderRadius: 10, background: '#eef2ff', border: '1px solid #c7d2fe' }}><span style={{ flex: 1, fontWeight: 600 }}>Spa pedicure</span><span style={{ fontSize: 13, color: BODY }}>50 min</span><span style={{ width: 52, textAlign: 'right', fontWeight: 600 }}>$49</span></div>
        {!mobile && <div style={row}><span style={{ flex: 1 }}>Gel-X full set</span><span style={{ fontSize: 13, color: MUTED }}>90 min</span><span style={{ width: 52, textAlign: 'right', fontWeight: 600 }}>$65</span></div>}
      </div>
      <div style={{ padding: '16px 24px 8px', fontSize: 12, fontWeight: 600, letterSpacing: 0.6, color: MUTED }}>TUESDAY, OCTOBER 27</div>
      <div style={{ padding: '0 24px', display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 8 }}>
        <span style={slot}>10:00</span>
        <span style={slot}>10:45</span>
        <span style={{ ...slot, border: `1px solid ${INK}`, background: INK, color: '#f8fafc', fontWeight: 600 }}>1:15</span>
        <span style={slot}>2:30</span>
      </div>
      <div style={{ padding: '20px 24px 24px' }}>
        <div style={{ minHeight: 48, borderRadius: 8, background: BRAND, color: '#f8fafc', display: 'grid', placeItems: 'center', fontWeight: 600 }}>Book appointment · $49</div>
        <div style={{ marginTop: 10, fontSize: 12.5, color: MUTED, textAlign: 'center' }}>Free cancellation up to 24 hours before · salon policy</div>
      </div>
    </div>
  );
}

/** A drawn example of one day in a salon's calendar. */
function CalendarPreview() {
  const appt = (bg: string, bd: string, h: number, who: string, what: string, dashed = false) => (
    <div style={{ height: h, boxSizing: 'border-box', borderRadius: 8, background: dashed ? 'transparent' : bg, border: `1px ${dashed ? 'dashed' : 'solid'} ${bd}`, padding: '8px 10px', fontSize: 13, lineHeight: 1.4, color: dashed ? MUTED : INK }}>
      {who && <b>{who}</b>}{who && <br />}{what}
    </div>
  );
  const col: CSSProperties = { padding: 6, display: 'flex', flexDirection: 'column', gap: 6 };
  return (
    <div role="img" aria-label="Example of a salon calendar for one day" style={{ border: `1px solid ${LINE}`, borderRadius: 16, overflow: 'hidden', background: '#ffffff' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '16px 24px', borderBottom: `1px solid ${LINE}`, flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 700 }}>Tuesday, October 27</span>
        <span style={{ fontSize: 13, color: MUTED }}>Sample salon · 3 technicians</span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 8, fontSize: 13 }}>
          <span style={{ padding: '4px 12px', borderRadius: 999, background: INK, color: '#f8fafc', fontWeight: 600 }}>Day</span>
          <span style={{ padding: '4px 12px', borderRadius: 999, border: `1px solid ${LINE}`, color: '#334155' }}>Week</span>
        </span>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <div style={{ minWidth: 700, display: 'grid', gridTemplateColumns: '72px repeat(3, minmax(0, 1fr))' }}>
          <div style={{ borderRight: `1px solid ${LINE}` }} />
          {['Anna', 'Lily', 'Kim'].map((n, i) => (
            <div key={n} style={{ padding: '12px 16px', fontWeight: 600, borderBottom: `1px solid ${LINE}`, borderRight: i < 2 ? `1px solid ${LINE}` : 'none' }}>{n}</div>
          ))}
          <div style={{ display: 'flex', flexDirection: 'column', borderRight: `1px solid ${LINE}`, fontSize: 12, color: MUTED }}>
            {['10 am', '11 am', '12 pm', '1 pm'].map((t) => <span key={t} style={{ height: 64, padding: '6px 10px', boxSizing: 'border-box' }}>{t}</span>)}
          </div>
          <div style={{ ...col, borderRight: `1px solid ${LINE}` }}>
            {appt('#eef2ff', '#c7d2fe', 82, 'Maria G.', 'Gel manicure · 10:00')}
            <div style={{ height: 58 }} />
            {appt('#ecfdf5', '#a7f3d0', 100, 'Walk-in', 'Spa pedicure · 12:30')}
          </div>
          <div style={{ ...col, borderRight: `1px solid ${LINE}` }}>
            <div style={{ height: 30 }} />
            {appt('#eef2ff', '#c7d2fe', 120, 'Jenny T.', 'Gel-X full set · 10:30')}
            {appt('#fff7ed', '#fed7aa', 64, 'Deposit paid', 'Dip powder · 1:00')}
          </div>
          <div style={col}>
            {appt('#eef2ff', '#c7d2fe', 64, 'Sara L.', 'Pedicure · 10:00')}
            {appt('', '#cbd5e1', 90, '', 'Open · 11:15', true)}
            {appt('#eef2ff', '#c7d2fe', 64, 'Anh N.', 'Manicure · 1:00')}
          </div>
        </div>
      </div>
    </div>
  );
}

const navLink: CSSProperties = { color: '#334155', textDecoration: 'none', fontSize: 15 };
const linkStyle: CSSProperties = { color: LINK, textDecoration: 'none' };
const label: CSSProperties = { fontSize: 13, fontWeight: 600, letterSpacing: 0.6, color: MUTED };
const darkBtn: CSSProperties = { display: 'inline-flex', alignItems: 'center', minHeight: 44, padding: '0 18px', borderRadius: 8, background: INK, color: '#f8fafc', textDecoration: 'none', fontSize: 15, fontWeight: 600, border: 'none', cursor: 'pointer' };

function toggleBtn(active: boolean): CSSProperties {
  return { border: 'none', cursor: 'pointer', minHeight: 36, padding: '0 16px', borderRadius: 6, fontSize: 14, fontWeight: 600, fontFamily: 'inherit', background: active ? INK : 'transparent', color: active ? '#f8fafc' : BODY };
}
