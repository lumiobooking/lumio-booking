'use client';

// Public Support / Help Center — referenced by the SMS HELP auto-reply and the
// A2P registration (HELP message URL). Must be publicly accessible so reviewers
// and recipients can reach it. Covers SMS help (STOP/HELP/START), message rates,
// frequency, contact options, and links to Privacy + Terms.

export default function SupportPage() {
  return (
    <main style={wrap}>
      <div style={card}>
        <div style={{ textAlign: 'center', marginBottom: 6 }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: '#0f172a', letterSpacing: -0.5 }}>
            Lumio<span style={{ color: INDIGO }}>Booking</span>
          </div>
          <h1 style={h1}>Support &amp; Help Center</h1>
          <p style={muted}>We&rsquo;re here to help with bookings and text messages.</p>
        </div>

        <h2 style={h2}>Text message (SMS) help</h2>
        <p style={p}>
          Lumio Booking sends appointment confirmations, reminders, and updates from the salon you booked with, plus
          promotional offers if you opted in. Here&rsquo;s how to manage those texts:
        </p>
        <ul style={ul}>
          <li><strong>Stop messages:</strong> reply <strong>STOP</strong> to any text. You&rsquo;ll get a one-time confirmation and we&rsquo;ll send no further messages.</li>
          <li><strong>Resume messages:</strong> reply <strong>START</strong>.</li>
          <li><strong>Get help:</strong> reply <strong>HELP</strong>, or email us using the contact below.</li>
          <li><strong>Message frequency:</strong> varies — typically up to 6 messages per month.</li>
          <li><strong>Cost:</strong> message and data rates may apply, depending on your mobile carrier&rsquo;s plan.</li>
        </ul>
        <p style={p}>
          Your mobile opt-in and consent information is <strong>never shared with third parties</strong>. You can review or
          start a text subscription on our <a href="/sms-optin" style={a}>Text Alerts</a> page.
        </p>

        <h2 style={h2}>Booking &amp; appointment help</h2>
        <p style={p}>
          To change, reschedule, or cancel a specific appointment, contact the salon you booked with directly — their
          name and phone number appear in your booking confirmation. If you used a one-tap confirm/cancel link in a
          reminder, you can also manage your appointment from there.
        </p>

        <h2 style={h2}>Contact us</h2>
        <p style={p}>
          Email: <a href="mailto:lumioagency.com@gmail.com" style={a}>lumioagency.com@gmail.com</a><br />
          Website: <a href="https://lumioagency.com" style={a}>lumioagency.com</a>
        </p>
        <p style={p}>We aim to respond within 1–2 business days.</p>

        <p style={{ ...muted, marginTop: 22 }}>
          See also our <a href="/privacy" style={a}>Privacy Policy</a> and{' '}
          <a href="/terms" style={a}>Terms of Service &amp; Messaging Terms</a>.
        </p>
      </div>
    </main>
  );
}

const INDIGO = '#6366f1';
const wrap: React.CSSProperties = { minHeight: '100vh', background: '#f8fafc', padding: '32px 16px', fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif' };
const card: React.CSSProperties = { maxWidth: 680, margin: '0 auto', background: '#fff', borderRadius: 16, padding: '28px 32px', boxShadow: '0 8px 30px rgba(15,23,42,0.08)', color: '#1e293b' };
const h1: React.CSSProperties = { fontSize: 24, margin: '12px 0 4px', color: '#0f172a' };
const h2: React.CSSProperties = { fontSize: 17, margin: '24px 0 8px', color: '#0f172a' };
const p: React.CSSProperties = { fontSize: 14.5, lineHeight: 1.65, color: '#334155', margin: '0 0 10px' };
const ul: React.CSSProperties = { fontSize: 14.5, lineHeight: 1.7, color: '#334155', margin: '0 0 10px', paddingLeft: 20 };
const muted: React.CSSProperties = { fontSize: 13, color: '#64748b', margin: 0 };
const a: React.CSSProperties = { color: INDIGO, textDecoration: 'none' };
