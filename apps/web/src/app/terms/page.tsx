'use client';

// Public Terms of Service + SMS Messaging Terms — required for A2P 10DLC approval.

export default function TermsPage() {
  return (
    <main style={wrap}>
      <div style={card}>
        <h1 style={h1}>Terms of Service &amp; Messaging Terms</h1>
        <p style={muted}>Lumio Booking, operated by Lumio Agency. Last updated: June 2026.</p>

        <p style={p}>
          By using Lumio Booking to book an appointment or by opting in to text messages, you agree to these terms.
          Lumio Booking is appointment-booking software provided to salons; the salon you book with is responsible for
          the services you receive.
        </p>

        <h2 style={h2}>SMS / Text Messaging Terms</h2>
        <p style={p}>
          <strong>Program description.</strong> When you book an appointment and provide your mobile number, the salon may
          send you transactional text messages (appointment confirmations, reminders, and changes). If you check the
          marketing-consent box, the salon may also send promotional offers and updates.
        </p>
        <p style={p}>
          <strong>How to opt in.</strong> You opt in by providing your phone number when booking and, for promotional
          messages, by checking the dedicated consent box on the booking form. Consent is not a condition of purchasing
          any goods or services.
        </p>
        <p style={p}>
          <strong>Message frequency.</strong> Message frequency varies depending on your appointments and the salon&rsquo;s
          activity.
        </p>
        <p style={p}>
          <strong>Cost.</strong> Message and data rates may apply, according to your mobile carrier&rsquo;s plan.
        </p>
        <p style={p}>
          <strong>How to opt out.</strong> You can cancel SMS messages at any time by replying <strong>STOP</strong> to any
          message. After you send STOP, we will send a one-time confirmation that you have been unsubscribed and will send
          no further messages. To resume, reply START.
        </p>
        <p style={p}>
          <strong>Help.</strong> Reply <strong>HELP</strong> for help, or contact the salon directly. Carriers are not
          liable for delayed or undelivered messages.
        </p>
        <p style={p}>
          <strong>Privacy.</strong> Your text-messaging opt-in and consent data is never shared with third parties. See our{' '}
          <a href="/privacy" style={a}>Privacy Policy</a> for details.
        </p>

        <h2 style={h2}>Bookings &amp; cancellations</h2>
        <p style={p}>
          Appointment availability, pricing, deposits, and cancellation rules are set by each salon and shown to you
          during booking. Please contact the salon directly for changes to a specific appointment.
        </p>

        <h2 style={h2}>Acceptable use</h2>
        <p style={p}>
          You agree to provide accurate information and not to misuse the service. We may suspend access for fraudulent or
          abusive activity.
        </p>

        <h2 style={h2}>Limitation of liability</h2>
        <p style={p}>
          The service is provided &ldquo;as is&rdquo;. To the extent permitted by law, Lumio Agency is not liable for indirect
          or incidental damages arising from your use of the service.
        </p>

        <h2 style={h2}>Contact</h2>
        <p style={p}>
          Lumio Agency — <a href="mailto:lumioagency.com@gmail.com" style={a}>lumioagency.com@gmail.com</a> ·{' '}
          <a href="https://lumioagency.com" style={a}>lumioagency.com</a>
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
