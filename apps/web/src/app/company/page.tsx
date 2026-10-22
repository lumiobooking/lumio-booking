'use client';

// Public company / contact page.
//
// A partner-review team (Google Actions Center, payment providers, Meta,
// TikTok) checks that the company behind the platform is verifiable: legal
// entity, addresses, phone, email, what the product actually does and how
// people get help. Everything here comes from lib/company-info so it matches
// the home page and the legal pages word for word.

import { Fragment, CSSProperties, ReactNode } from 'react';
import Link from 'next/link';
import { useIsMobile } from '../../lib/responsive';
import { COMPANY, officeLine } from '../../lib/company-info';

const INK = '#0f172a';
const BODY = '#334155';
const MUTED = '#64748b';
const LINE = '#e2e8f0';
const LINK = '#4338ca';

export default function CompanyPage() {
  const mobile = useIsMobile();
  const pad = mobile ? 20 : 32;
  const wrap: CSSProperties = { maxWidth: 1200, margin: '0 auto', paddingLeft: pad, paddingRight: pad, boxSizing: 'border-box' };

  return (
    <div style={{ background: '#ffffff', color: INK, minHeight: '100vh', fontFamily: 'inherit', fontSize: 16, lineHeight: 1.6 }}>
      <header style={{ borderBottom: `1px solid ${LINE}` }}>
        <nav aria-label="Main" style={{ ...wrap, minHeight: mobile ? 64 : 72, display: 'flex', alignItems: 'center', gap: mobile ? 12 : 32, flexWrap: 'wrap' }}>
          <Link href="/" style={{ display: 'inline-flex', alignItems: 'center', gap: 10, textDecoration: 'none', color: INK, fontWeight: 700, fontSize: mobile ? 17 : 18 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo/lumio-mark.png" alt="" width={28} height={28} style={{ width: 28, height: 28, display: 'block', objectFit: 'contain' }} />
            Lumio Booking
          </Link>
          {!mobile && (
            <div style={{ display: 'flex', gap: 28, fontSize: 15 }}>
              <Link href="/#product" style={nav}>Product</Link>
              <Link href="/#clients" style={nav}>For clients</Link>
              <Link href="/#pricing" style={nav}>Pricing</Link>
              <Link href="/company" style={{ ...nav, color: INK, fontWeight: 600 }} aria-current="page">Company</Link>
              <Link href="/support" style={nav}>Support</Link>
            </div>
          )}
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 20 }}>
            <Link href="/login" style={{ ...nav, color: INK, fontWeight: 600 }}>Sign in</Link>
            {!mobile && <Link href="/signup" style={{ display: 'inline-flex', alignItems: 'center', minHeight: 44, padding: '0 18px', borderRadius: 8, background: INK, color: '#f8fafc', textDecoration: 'none', fontSize: 15, fontWeight: 600 }}>Start free trial</Link>}
          </div>
        </nav>
      </header>

      <main style={{ ...wrap, paddingTop: mobile ? 40 : 72, paddingBottom: mobile ? 56 : 96, display: 'flex', flexWrap: 'wrap', gap: mobile ? 40 : 64, alignItems: 'flex-start' }}>
        <div style={{ flex: '999 1 560px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 40 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: LINK }}>Company</div>
            <h1 style={{ margin: 0, fontSize: mobile ? 32 : 44, lineHeight: 1.12, fontWeight: 700, letterSpacing: mobile ? -0.6 : -1 }}>About Lumio Booking</h1>
            <p style={{ margin: 0, fontSize: mobile ? 17 : 19, color: '#475569' }}>
              Lumio Booking is appointment and point-of-sale software for nail salons, spas and other beauty businesses. It is
              developed and operated by {COMPANY.legalName}.
            </p>
          </div>

          <Section title="What we do">
            <p style={p}>
              Each business on Lumio Booking gets its own booking page, calendar, staff schedules, client records, checkout and
              automatic reminders. Clients book in a few steps without creating an account, and the appointment goes straight
              into the salon&rsquo;s calendar.
            </p>
            <p style={p}>
              Lumio Booking is a software provider. Services are performed and priced by each salon, and payments for services go
              to the salon through its own payment provider.
            </p>
          </Section>

          <Section title="How we work with salons">
            <ul style={{ margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 8, color: BODY }}>
              <li>Every salon accepts our <Link href="/merchant-terms" style={a}>Merchant Agreement</Link> and confirms its business name, address and phone number.</li>
              <li>Salons set their own services, prices, opening hours and cancellation policy. Prices shown to clients are the salon&rsquo;s final prices before tips.</li>
              <li>Each salon&rsquo;s data is kept separate. Client details are used only to run that salon&rsquo;s bookings.</li>
              <li>Salons can cancel their subscription at any time from their dashboard.</li>
            </ul>
          </Section>

          <Section title="Support">
            <div style={{ border: `1px solid ${LINE}`, borderRadius: 12, overflow: 'hidden' }}>
              <Row who="Clients with an appointment" last={false}>
                Contact the salon first; its phone number is in your confirmation. If you can&rsquo;t reach it, write to{' '}
                <a href={`mailto:${COMPANY.supportEmail}`} style={a}>{COMPANY.supportEmail}</a>.
              </Row>
              <Row who="Salons using Lumio" last={false}>
                Email <a href={`mailto:${COMPANY.supportEmail}`} style={a}>{COMPANY.supportEmail}</a> or call{' '}
                <a href={COMPANY.phoneHref} style={a}>{COMPANY.phone}</a>. We reply within {COMPANY.replyTime}; problems that stop
                bookings are handled first.
              </Row>
              <Row who="Partners and press" last>
                <a href={`mailto:${COMPANY.partnersEmail}`} style={a}>{COMPANY.partnersEmail}</a>
              </Row>
            </div>
          </Section>

          <Section title="Policies">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px 28px', fontWeight: 600 }}>
              <Link href="/terms" style={a}>Terms of service</Link>
              <Link href="/privacy" style={a}>Privacy policy</Link>
              <Link href="/booking-policy" style={a}>Booking and cancellation policy</Link>
              <Link href="/merchant-terms" style={a}>Merchant agreement</Link>
              <Link href="/terms" style={a}>Messaging terms</Link>
              <Link href="/data-deletion" style={a}>Delete my data</Link>
            </div>
          </Section>

          <Section title="See it working">
            <p style={p}>
              A sample salon booking page: <Link href="/book/lumio-salon" style={a}>lumiobooking.com/book/lumio-salon</Link>. No sign-in
              is needed to see availability.
            </p>
          </Section>
        </div>

        <aside aria-label="Company details" style={{ flex: '1 1 320px', minWidth: 0, border: `1px solid ${LINE}`, borderRadius: 12, background: '#f8fafc', padding: mobile ? 22 : 28, display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div style={{ fontSize: 18, fontWeight: 700 }}>Company details</div>
          <Fact label="LEGAL ENTITY">{COMPANY.legalName}</Fact>
          <Fact label="TRADING NAME">{COMPANY.tradingName}</Fact>
          <Fact label="OFFICE"><address style={{ fontStyle: 'normal' }}>{COMPANY.office.map((l) => <Fragment key={l}>{l}<br /></Fragment>)}</address></Fact>
          <Fact label="REGISTERED ADDRESS"><address style={{ fontStyle: 'normal' }}>{COMPANY.registered.map((l) => <Fragment key={l}>{l}<br /></Fragment>)}</address></Fact>
          <Fact label="PHONE"><a href={COMPANY.phoneHref} style={a}>{COMPANY.phone}</a></Fact>
          <Fact label="EMAIL"><a href={`mailto:${COMPANY.supportEmail}`} style={a}>{COMPANY.supportEmail}</a></Fact>
          <Fact label="WEBSITE"><a href={COMPANY.website} style={a}>lumiobooking.com</a></Fact>
          <Fact label="MARKETS">{COMPANY.markets}</Fact>
        </aside>
      </main>

      <footer style={{ background: INK, color: '#94a3b8' }}>
        <div style={{ ...wrap, paddingTop: 28, paddingBottom: 28, display: 'flex', flexWrap: 'wrap', gap: '8px 24px', fontSize: 13 }}>
          <span>© {new Date().getFullYear()} {COMPANY.legalName}</span>
          <span>{officeLine()}</span>
          <a href={`mailto:${COMPANY.supportEmail}`} style={{ color: '#cbd5e1', textDecoration: 'none' }}>{COMPANY.supportEmail}</a>
        </div>
      </footer>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <h2 style={{ margin: 0, fontSize: 24, fontWeight: 700 }}>{title}</h2>
      {children}
    </section>
  );
}

function Row({ who, last, children }: { who: string; last: boolean; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', borderBottom: last ? 'none' : `1px solid ${LINE}` }}>
      <div style={{ flex: '1 1 200px', padding: '14px 20px', fontWeight: 600 }}>{who}</div>
      <div style={{ flex: '2 1 320px', padding: '14px 20px', color: BODY }}>{children}</div>
    </div>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={{ fontSize: 13, fontWeight: 600, letterSpacing: 0.5, color: MUTED }}>{label}</span>
      <span>{children}</span>
    </div>
  );
}

const nav: CSSProperties = { color: '#334155', textDecoration: 'none', fontSize: 15 };
const p: CSSProperties = { margin: 0, color: BODY };
const a: CSSProperties = { color: LINK, textDecoration: 'none' };
