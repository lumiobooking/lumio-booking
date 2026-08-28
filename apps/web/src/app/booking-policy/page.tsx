'use client';

// Public booking, cancellation and no-show policy.
//
// Reserve with Google requires that a customer can see, before confirming, what
// happens if they cancel or do not show up, and that cancellation is possible
// through the same channel used to book. This page states the platform-wide
// rules; each salon may set stricter windows, which are shown on its own
// booking page before confirmation.

export default function BookingPolicyPage() {
  return (
    <main style={wrap}>
      <div style={card}>
        <h1 style={h1}>Booking, Cancellation &amp; No-Show Policy</h1>
        <p style={muted}>Lumio Booking, operated by Lumio Agency LLC. Last updated: July 2026.</p>

        <p style={p}>
          Lumio Booking is the online booking channel for the salon you are booking with. The salon provides the service;
          Lumio provides the software that holds your appointment. This page explains what applies to every booking made
          through Lumio, on our website, on a salon&rsquo;s own website, or from a salon&rsquo;s Google Business Profile.
        </p>

        <h2 style={h2}>Confirming a booking</h2>
        <p style={p}>
          A booking is confirmed the moment you complete the booking form — no account is required. You receive an
          immediate confirmation by email, and by SMS if you provided a mobile number. The confirmation shows the salon,
          service, staff member, date, time, duration and price.
        </p>

        <h2 style={h2}>Changing or cancelling</h2>
        <p style={p}>
          You may cancel or reschedule free of charge up to <strong>2 hours before</strong> the appointment, unless the
          salon has set a longer notice period — in which case that period is shown on the salon&rsquo;s booking page
          before you confirm. To change a booking, use the link in your confirmation message or call the salon directly;
          both routes reach the same calendar.
        </p>

        <h2 style={h2}>No-shows and late arrival</h2>
        <p style={p}>
          If you do not arrive, the salon may record a no-show on your customer record. Arriving more than 15 minutes
          late may mean the service has to be shortened or rescheduled, at the salon&rsquo;s discretion, because the
          following appointment is already booked.
        </p>

        <h2 style={h2}>Deposits and payment</h2>
        <p style={p}>
          Most salons take payment in-store after the service. Where a salon requires a deposit or online payment, that
          is stated on its booking page before you confirm, together with the refund rule that applies to it. Lumio never
          charges you separately for making a booking.
        </p>

        <h2 style={h2}>Prices</h2>
        <p style={p}>
          Prices shown are set by the salon and include any discount that applies to your booking. Some salons display
          both a cash price and a card price; where they do, both are shown on the service before you select it. The
          final price is confirmed before you complete the booking.
        </p>

        <h2 style={h2}>If something goes wrong</h2>
        <p style={p}>
          Contact the salon first — its phone number is in your confirmation message. If you cannot reach the salon, or
          your booking did not arrive, contact us and we will resolve it:{' '}
          <a href="mailto:lumioagency.com@gmail.com" style={a}>lumioagency.com@gmail.com</a> · +1 (512) 886-8189. We
          answer within one business day.
        </p>

        <p style={muted}>
          See also: <a href="/terms" style={a}>Terms of Service</a> ·{' '}
          <a href="/privacy" style={a}>Privacy Policy</a> ·{' '}
          <a href="/merchant-terms" style={a}>Merchant Service Agreement</a>
        </p>
      </div>
    </main>
  );
}

const wrap: React.CSSProperties = { minHeight: '100vh', background: 'var(--cf8fafc)', padding: '32px 16px', fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif' };
const card: React.CSSProperties = { maxWidth: 760, margin: '0 auto', background: '#fff', borderRadius: 16, padding: '32px 36px', boxShadow: '0 8px 30px rgba(15,23,42,0.08)', color: 'var(--c1e293b)' };
const h1: React.CSSProperties = { fontSize: 28, margin: '0 0 4px', color: 'var(--c0f172a)' };
const h2: React.CSSProperties = { fontSize: 17, margin: '24px 0 6px', color: 'var(--c0f172a)' };
const p: React.CSSProperties = { fontSize: 14.5, lineHeight: 1.65, color: 'var(--c334155)', margin: '0 0 10px' };
const muted: React.CSSProperties = { fontSize: 13, color: 'var(--c64748b)', margin: '0 0 18px' };
const a: React.CSSProperties = { color: '#4f46e5', textDecoration: 'none' };
