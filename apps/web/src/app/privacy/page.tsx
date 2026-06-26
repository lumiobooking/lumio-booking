'use client';

// Public Privacy Policy — required for A2P 10DLC (Twilio/TCR) approval.
// Contains the mandatory clauses: SMS opt-in consent data is never shared, and
// no mobile information is shared with third parties for marketing.

export default function PrivacyPage() {
  return (
    <main style={wrap}>
      <div style={card}>
        <h1 style={h1}>Privacy Policy</h1>
        <p style={muted}>Lumio Booking, operated by Lumio Agency. Last updated: June 2026.</p>

        <p style={p}>
          This Privacy Policy explains how Lumio Booking (&ldquo;we&rdquo;, &ldquo;us&rdquo;) and the salons that use our software
          collect, use, and protect your information when you book an appointment or receive messages from us.
        </p>

        <h2 style={h2}>Information we collect</h2>
        <p style={p}>
          When you book an appointment we collect your name, phone number, email address (optional), and appointment
          details. We use this information to schedule your visit, send you appointment-related messages, and (only if you
          opt in) send you promotional offers from the salon you booked with.
        </p>

        <h2 style={h2}>SMS / text messaging</h2>
        <p style={p}>
          If you provide your mobile number when booking, you may receive transactional text messages such as appointment
          confirmations and reminders. If you separately opt in (by checking the marketing consent box), you may also
          receive promotional offers. Message frequency varies. <strong>Message and data rates may apply.</strong> You can
          opt out at any time by replying <strong>STOP</strong>, or reply <strong>HELP</strong> for assistance.
        </p>
        <p style={p}>
          <strong>Text messaging consent and opt-in data will not be shared with any third parties.</strong> No mobile
          information will be shared with third parties or affiliates for marketing or promotional purposes at any time.
          The above categories of data we may process exclude text-messaging originator opt-in data and consent — this
          information is never shared, sold, or transferred to any third party or lead generator.
        </p>

        <h2 style={h2}>How we use your information</h2>
        <p style={p}>
          We use your information only to: provide and manage your bookings; send appointment confirmations, reminders,
          and updates; process payments; run loyalty and (with consent) marketing communications for the salon you
          visited; and improve the service. We do not sell your personal information.
        </p>

        <h2 style={h2}>Sharing</h2>
        <p style={p}>
          Your information is shared only with the salon you booked with and the service providers that operate the
          platform on our behalf (for example, secure hosting, email, SMS, and payment processors) strictly to deliver
          the service. These providers are bound to protect your data and may not use it for their own purposes. As stated
          above, SMS opt-in/consent data is never shared.
        </p>

        <h2 style={h2}>Data retention &amp; security</h2>
        <p style={p}>
          We retain your information for as long as needed to provide the service and meet legal obligations, and we use
          reasonable administrative and technical safeguards to protect it.
        </p>

        <h2 style={h2}>Your choices</h2>
        <p style={p}>
          You may opt out of marketing texts at any time by replying STOP. You may request access to or deletion of your
          information by contacting the salon you booked with or us at the address below.
        </p>

        <h2 style={h2}>Contact</h2>
        <p style={p}>
          Lumio Agency — <a href="mailto:lumioagency.com@gmail.com" style={a}>lumioagency.com@gmail.com</a> ·{' '}
          <a href="https://lumioagency.com" style={a}>lumioagency.com</a>
        </p>

        <p style={{ ...muted, marginTop: 24 }}>
          See also our <a href="/terms" style={a}>Terms of Service &amp; Messaging Terms</a>.
        </p>
      </div>
    </main>
  );
}

const wrap: React.CSSProperties = { minHeight: '100vh', background: '#f8fafc', padding: '32px 16px', fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif' };
const card: React.CSSProperties = { maxWidth: 760, margin: '0 auto', background: '#fff', borderRadius: 16, padding: '32px 36px', boxShadow: '0 8px 30px rgba(15,23,42,0.08)', color: '#1e293b' };
const h1: React.CSSProperties = { fontSize: 28, margin: '0 0 4px', color: '#0f172a' };
const h2: React.CSSProperties = { fontSize: 17, margin: '24px 0 6px', color: '#0f172a' };
const p: React.CSSProperties = { fontSize: 14.5, lineHeight: 1.65, color: '#334155', margin: '0 0 10px' };
const muted: React.CSSProperties = { fontSize: 13, color: '#64748b', margin: '0 0 18px' };
const a: React.CSSProperties = { color: '#4f46e5', textDecoration: 'none' };
