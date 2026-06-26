'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '../lib/auth';
import { useIsMobile } from '../lib/responsive';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8005/api';
const INK = '#0f172a';
const INDIGO = '#6366f1';

interface PublicPlan {
  id: string; name: string; tagline: string | null; description: string | null; currency: string;
  priceMonthlyCents: number; priceYearlyCents: number; trialDays: number;
  features: string[]; highlighted: boolean;
  providers: { stripe: boolean; paypal: boolean };
}

const money = (cents: number, currency = 'USD') =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(cents / 100);

export default function HomePage() {
  const { user, ready } = useAuth();
  const mobile = useIsMobile();
  const [plans, setPlans] = useState<PublicPlan[]>([]);
  const [yearly, setYearly] = useState(false);

  useEffect(() => {
    fetch(`${API_URL}/public/plans`).then((r) => r.json()).then((d) => Array.isArray(d) && setPlans(d)).catch(() => {});
  }, []);

  const dashHref = user?.role === 'SUPER_ADMIN' ? '/super-admin/tenants' : user?.role === 'STAFF' ? '/staff/bookings' : '/salon';

  return (
    <div style={{ background: '#fff', color: INK, minHeight: '100vh', fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif' }}>
      {/* ---------------- Nav ---------------- */}
      <header style={{ position: 'sticky', top: 0, zIndex: 50, background: 'rgba(255,255,255,0.85)', backdropFilter: 'blur(10px)', borderBottom: '1px solid #eef2f7' }}>
        <nav style={{ maxWidth: 1120, margin: '0 auto', padding: '14px 24px', display: 'flex', alignItems: 'center', gap: 24 }}>
          <Link href="/" style={{ fontSize: 20, fontWeight: 800, color: INK, textDecoration: 'none', letterSpacing: -0.5 }}>
            Lumio<span style={{ color: INDIGO }}>Booking</span>
          </Link>
          {!mobile && (
            <div style={{ display: 'flex', gap: 22, marginLeft: 16 }}>
              <a href="#features" style={navLink}>Features</a>
              <a href="#how" style={navLink}>How it works</a>
              <a href="#pricing" style={navLink}>Pricing</a>
            </div>
          )}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 10, alignItems: 'center' }}>
            {ready && user ? (
              <Link href={dashHref} style={primaryBtn}>{mobile ? 'Dashboard' : 'Go to dashboard'}</Link>
            ) : (
              <>
                <Link href="/login" style={{ ...navLink, fontWeight: 600 }}>Sign in</Link>
                <a href="#pricing" style={primaryBtn}>{mobile ? 'Try free' : 'Start free trial'}</a>
              </>
            )}
          </div>
        </nav>
      </header>

      {/* ---------------- Hero ---------------- */}
      <section style={{ background: 'linear-gradient(180deg,#eef2ff 0%, #ffffff 70%)' }}>
        <div style={{ maxWidth: 900, margin: '0 auto', padding: mobile ? '52px 20px 44px' : '84px 24px 64px', textAlign: 'center' }}>
          <span style={pill}>For nail salons in the US &amp; Canada</span>
          <h1 style={{ fontSize: mobile ? 33 : 52, lineHeight: 1.1, fontWeight: 800, letterSpacing: mobile ? -0.8 : -1.5, margin: '18px 0 0' }}>
            The booking system that fills your chairs — and runs your salon.
          </h1>
          <p style={{ fontSize: mobile ? 16 : 20, color: '#475569', maxWidth: 640, margin: '16px auto 0', lineHeight: 1.5 }}>
            Online booking, point-of-sale checkout, loyalty rewards, automatic reminders and payments — all in one beautiful app your clients can install on their phone.
          </p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginTop: 28, flexWrap: 'wrap' }}>
            <a href="#pricing" style={{ ...primaryBtn, padding: '14px 28px', fontSize: 16, width: mobile ? '100%' : 'auto', textAlign: 'center' }}>Start your 14-day free trial</a>
            <Link href="/book/lumio-salon" style={{ ...ghostBtn, padding: '14px 28px', fontSize: 16, width: mobile ? '100%' : 'auto', textAlign: 'center' }}>See a live booking page →</Link>
          </div>
          <p style={{ color: '#94a3b8', fontSize: 13, marginTop: 16 }}>No setup fees · Cancel anytime · Card or PayPal</p>
        </div>
      </section>

      {/* ---------------- Trust strip ---------------- */}
      <section style={{ borderTop: '1px solid #eef2f7', borderBottom: '1px solid #eef2f7', background: '#fbfcfe' }}>
        <div style={{ maxWidth: 1120, margin: '0 auto', padding: '22px 24px', display: 'flex', gap: 36, justifyContent: 'center', flexWrap: 'wrap', color: '#64748b', fontSize: 14, fontWeight: 600 }}>
          <span>★★★★★ Loved by busy salons</span>
          <span>· Secure payments by Stripe &amp; PayPal</span>
          <span>· Works with your WordPress site</span>
        </div>
      </section>

      {/* ---------------- Features ---------------- */}
      <section id="features" style={{ maxWidth: 1120, margin: '0 auto', padding: mobile ? '52px 20px' : '80px 24px' }}>
        <SectionHead eyebrow="Everything in one place" title="Run the whole salon, not just the calendar" />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 20, marginTop: 40 }}>
          {FEATURES.map((f) => (
            <div key={f.title} style={featureCard}>
              <div style={{ fontSize: 26 }}>{f.icon}</div>
              <h3 style={{ fontSize: 17, margin: '12px 0 6px' }}>{f.title}</h3>
              <p style={{ color: '#64748b', fontSize: 14, margin: 0, lineHeight: 1.5 }}>{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ---------------- How it works ---------------- */}
      <section id="how" style={{ background: '#0b1120', color: '#e2e8f0' }}>
        <div style={{ maxWidth: 1120, margin: '0 auto', padding: mobile ? '52px 20px' : '80px 24px' }}>
          <SectionHead eyebrow="Up and running today" title="Launch in three simple steps" dark />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 24, marginTop: 44 }}>
            {STEPS.map((s, i) => (
              <div key={s.title} style={{ background: '#111827', border: '1px solid #1f2937', borderRadius: 16, padding: 26 }}>
                <div style={{ width: 38, height: 38, borderRadius: '50%', background: INDIGO, display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: 16 }}>{i + 1}</div>
                <h3 style={{ fontSize: 18, margin: '16px 0 6px' }}>{s.title}</h3>
                <p style={{ color: '#94a3b8', fontSize: 14, margin: 0, lineHeight: 1.5 }}>{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------------- Pricing ---------------- */}
      <section id="pricing" style={{ maxWidth: 1120, margin: '0 auto', padding: mobile ? '52px 20px' : '80px 24px' }}>
        <SectionHead eyebrow="Simple, transparent pricing" title="Choose the plan that fits your salon" />
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 24 }}>
          <div style={{ display: 'inline-flex', background: '#f1f5f9', borderRadius: 999, padding: 4 }}>
            <button onClick={() => setYearly(false)} style={toggleBtn(!yearly)}>Monthly</button>
            <button onClick={() => setYearly(true)} style={toggleBtn(yearly)}>Yearly <span style={{ color: yearly ? '#c7d2fe' : '#16a34a', fontWeight: 700 }}>save ~17%</span></button>
          </div>
        </div>

        {plans.length === 0 ? (
          <p style={{ textAlign: 'center', color: '#94a3b8', marginTop: 40 }}>Plans are being set up — please check back shortly.</p>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fit, minmax(280px, ${plans.length > 1 ? '380px' : '420px'}))`, gap: 24, justifyContent: 'center', marginTop: 40 }}>
            {plans.map((p) => {
              const cents = yearly ? p.priceYearlyCents : p.priceMonthlyCents;
              const per = yearly ? '/year' : '/month';
              return (
                <div key={p.id} style={{ ...priceCard, ...(p.highlighted ? priceCardHi : {}) }}>
                  {p.highlighted && <span style={popularBadge}>MOST POPULAR</span>}
                  <h3 style={{ fontSize: 22, margin: 0 }}>{p.name}</h3>
                  {p.tagline && <p style={{ color: '#64748b', fontSize: 14, margin: '6px 0 0' }}>{p.tagline}</p>}
                  <div style={{ margin: '20px 0 4px' }}>
                    <span style={{ fontSize: 44, fontWeight: 800, letterSpacing: -1 }}>{money(cents, p.currency)}</span>
                    <span style={{ color: '#64748b', fontSize: 16 }}>{per}</span>
                  </div>
                  {yearly && p.priceMonthlyCents > 0 && (
                    <p style={{ color: '#16a34a', fontSize: 13, margin: '0 0 8px', fontWeight: 600 }}>
                      ≈ {money(Math.round(p.priceYearlyCents / 12), p.currency)}/mo billed yearly
                    </p>
                  )}
                  {p.trialDays > 0 && <p style={{ color: '#64748b', fontSize: 13, margin: '4px 0 0' }}>{p.trialDays}-day free trial</p>}
                  <Link href={`/signup?plan=${p.id}&interval=${yearly ? 'year' : 'month'}`} style={{ ...primaryBtn, display: 'block', textAlign: 'center', padding: '13px', marginTop: 20, ...(p.highlighted ? {} : { background: '#fff', color: INDIGO, border: `1.5px solid ${INDIGO}` }) }}>
                    Start free trial
                  </Link>
                  <ul style={{ listStyle: 'none', padding: 0, margin: '22px 0 0', display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {(p.features.length ? p.features : defaultFeatures(p)).map((f) => (
                      <li key={f} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 14, color: '#334155' }}>
                        <span style={{ color: '#16a34a', fontWeight: 800 }}>✓</span> {f}
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        )}
        <p style={{ textAlign: 'center', color: '#94a3b8', fontSize: 13, marginTop: 28 }}>
          All plans include secure card payments (Stripe) and PayPal · cancel anytime from your dashboard.
        </p>
      </section>

      {/* ---------------- Final CTA ---------------- */}
      <section style={{ background: 'linear-gradient(135deg,#4f46e5,#7c3aed)', color: '#fff' }}>
        <div style={{ maxWidth: 800, margin: '0 auto', padding: mobile ? '52px 20px' : '72px 24px', textAlign: 'center' }}>
          <h2 style={{ fontSize: mobile ? 26 : 34, fontWeight: 800, margin: 0, letterSpacing: -1 }}>Ready to grow your salon?</h2>
          <p style={{ fontSize: 18, opacity: 0.9, margin: '14px 0 28px' }}>Start free for 14 days. No card charged until your trial ends.</p>
          <a href="#pricing" style={{ ...primaryBtn, background: '#fff', color: INDIGO, padding: '14px 30px', fontSize: 16 }}>Get started</a>
        </div>
      </section>

      {/* ---------------- Footer ---------------- */}
      <footer style={{ background: '#0b1120', color: '#94a3b8' }}>
        <div style={{ maxWidth: 1120, margin: '0 auto', padding: '40px 24px', display: 'flex', flexWrap: 'wrap', gap: 16, justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 800, color: '#fff' }}>Lumio<span style={{ color: INDIGO }}>Booking</span></div>
            <p style={{ fontSize: 13, margin: '6px 0 0' }}>Booking &amp; salon management software.</p>
          </div>
          <div style={{ display: 'flex', gap: 20, fontSize: 14, flexWrap: 'wrap' }}>
            <a href="#features" style={{ color: '#94a3b8', textDecoration: 'none' }}>Features</a>
            <a href="#pricing" style={{ color: '#94a3b8', textDecoration: 'none' }}>Pricing</a>
            <Link href="/privacy" style={{ color: '#94a3b8', textDecoration: 'none' }}>Privacy Policy</Link>
            <Link href="/terms" style={{ color: '#94a3b8', textDecoration: 'none' }}>Terms &amp; SMS Terms</Link>
            <Link href="/sms-optin" style={{ color: '#94a3b8', textDecoration: 'none' }}>Text Alerts</Link>
            <Link href="/login" style={{ color: '#94a3b8', textDecoration: 'none' }}>Sign in</Link>
          </div>
        </div>
        {/* SMS program disclosure — public & verifiable for A2P 10DLC review */}
        <div style={{ borderTop: '1px solid #1f2937', padding: '18px 24px', maxWidth: 1120, margin: '0 auto', fontSize: 12.5, lineHeight: 1.6, color: '#64748b' }}>
          <strong style={{ color: '#94a3b8' }}>Text messaging:</strong> When a client books with a salon using Lumio Booking and provides a
          mobile number, the salon may send appointment confirmations and reminders by SMS, and — only with separate
          opt-in — promotional offers. Up to ~6 msgs/month. Msg &amp; data rates may apply. Reply STOP to opt out,
          HELP for help. Opt-in and consent data is never shared with third parties.{' '}
          <Link href="/sms-optin" style={{ color: '#c7d2fe', textDecoration: 'none' }}>Sign up for text alerts</Link> ·{' '}
          <Link href="/privacy" style={{ color: '#c7d2fe', textDecoration: 'none' }}>Privacy Policy</Link> ·{' '}
          <Link href="/terms" style={{ color: '#c7d2fe', textDecoration: 'none' }}>Messaging Terms</Link>.
        </div>
        <div style={{ borderTop: '1px solid #1f2937', padding: '18px 24px', textAlign: 'center', fontSize: 13 }}>
          © {new Date().getFullYear()} Lumio Booking · Developed by{' '}
          <a href="https://lumioagency.com/" target="_blank" rel="noopener noreferrer" style={{ color: '#c7d2fe', fontWeight: 600, textDecoration: 'none' }}>Lumio Agency</a>
        </div>
      </footer>
    </div>
  );
}

function defaultFeatures(p: PublicPlan): string[] {
  const out = [
    p.priceYearlyCents ? 'Online booking 24/7' : 'Online booking 24/7',
    'Automatic email reminders',
  ];
  return out;
}

function SectionHead({ eyebrow, title, dark }: { eyebrow: string; title: string; dark?: boolean }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ color: INDIGO, fontWeight: 700, fontSize: 13, letterSpacing: 1, textTransform: 'uppercase' }}>{eyebrow}</div>
      <h2 style={{ fontSize: 'clamp(24px, 6vw, 34px)', fontWeight: 800, letterSpacing: -1, margin: '10px 0 0', color: dark ? '#fff' : INK, maxWidth: 640, marginLeft: 'auto', marginRight: 'auto' }}>{title}</h2>
    </div>
  );
}

const FEATURES = [
  { icon: '📅', title: 'Online booking 24/7', desc: 'Clients book in seconds from your own salon page — picks date, service, add-ons and technician with no double-booking.' },
  { icon: '🧾', title: 'Point of sale & receipts', desc: 'Ring up services and retail at the counter, take tips, split payment methods, and print or text receipts.' },
  { icon: '🎁', title: 'Loyalty rewards', desc: 'Clients earn points on every paid visit and redeem them for discounts — automatically.' },
  { icon: '💳', title: 'Payments built in', desc: 'Accept cards, Apple Pay, Google Pay and PayPal online or in-salon. Money lands in your account.' },
  { icon: '✉️', title: 'Reminders that reduce no-shows', desc: 'Automatic email confirmations and reminders to clients and staff for every appointment.' },
  { icon: '👩‍🔧', title: 'Staff & smart assignment', desc: 'Manage technicians, working hours and let the system fairly auto-assign or honor client preferences.' },
  { icon: '📱', title: 'Installable app (PWA)', desc: 'Your booking page installs like a real app on iPhone, Android, Windows and Mac — no app store needed.' },
  { icon: '🔌', title: 'WordPress connector', desc: 'Embed the booking form on your existing WordPress site with a lightweight plugin and a license key.' },
];

const STEPS = [
  { title: 'Pick a plan & sign up', desc: 'Choose Starter or Pro, create your login, and start a 14-day free trial. No card charged upfront.' },
  { title: 'Set up your salon', desc: 'Add your services, prices, staff and working hours — or import them. Connect your domain and payments.' },
  { title: 'Take bookings & get paid', desc: 'Share your booking link, accept appointments and payments, and watch loyalty bring clients back.' },
];

const navLink: React.CSSProperties = { color: '#475569', textDecoration: 'none', fontSize: 15 };
const pill: React.CSSProperties = { display: 'inline-block', background: '#e0e7ff', color: '#4338ca', fontSize: 13, fontWeight: 600, padding: '6px 14px', borderRadius: 999 };
const primaryBtn: React.CSSProperties = { background: INDIGO, color: '#fff', fontWeight: 700, fontSize: 14, padding: '10px 18px', borderRadius: 10, textDecoration: 'none', border: 'none', cursor: 'pointer' };
const ghostBtn: React.CSSProperties = { background: '#fff', color: INK, fontWeight: 600, fontSize: 14, padding: '10px 18px', borderRadius: 10, textDecoration: 'none', border: '1.5px solid #cbd5e1', cursor: 'pointer' };
const featureCard: React.CSSProperties = { background: '#fff', border: '1px solid #eef2f7', borderRadius: 16, padding: 24, boxShadow: '0 1px 3px rgba(15,23,42,0.04)' };
const priceCard: React.CSSProperties = { position: 'relative', background: '#fff', border: '1.5px solid #e2e8f0', borderRadius: 20, padding: 30, boxShadow: '0 4px 20px rgba(15,23,42,0.05)' };
const priceCardHi: React.CSSProperties = { border: `2px solid ${INDIGO}`, boxShadow: '0 12px 36px rgba(99,102,241,0.18)' };
const popularBadge: React.CSSProperties = { position: 'absolute', top: -12, right: 24, background: INDIGO, color: '#fff', fontSize: 11, fontWeight: 700, letterSpacing: 0.5, padding: '4px 12px', borderRadius: 999 };

function toggleBtn(active: boolean): React.CSSProperties {
  return { border: 'none', cursor: 'pointer', padding: '8px 18px', borderRadius: 999, fontSize: 14, fontWeight: 600, background: active ? INDIGO : 'transparent', color: active ? '#fff' : '#475569', display: 'flex', gap: 6, alignItems: 'center' };
}
