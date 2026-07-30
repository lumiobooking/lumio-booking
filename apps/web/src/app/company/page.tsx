'use client';

// Public company / contact page.
//
// A partner-review team (Google Actions Center, payment providers, Meta) checks
// that the company behind the platform is verifiable: legal entity, registered
// address, phone, email, and what the product actually does. Keeping it on one
// public page means nobody has to email us to establish that.

export default function CompanyPage() {
  return (
    <main style={wrap}>
      <div style={card}>
        <h1 style={h1}>About Lumio Booking</h1>
        <p style={muted}>Appointment-booking software for nail salons, spas and wellness businesses.</p>

        <h2 style={h2}>What we do</h2>
        <p style={p}>
          Lumio Booking is a multi-tenant booking platform. Each business on the platform gets its own booking page,
          calendar, staff scheduling, customer records, point of sale, and automated email/SMS reminders. Customers book
          in a few taps — no account, no app — and the appointment lands in the salon&rsquo;s calendar immediately.
        </p>
        <p style={p}>
          We operate the booking channel on behalf of every salon under a direct service agreement, and we manage their
          online presence, including their Google Business Profiles. Bookings taken online, at the counter, over the phone
          or through a salon&rsquo;s social channels all flow into one calendar.
        </p>

        <h2 style={h2}>Company details</h2>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14.5 }}>
          <tbody>
            {[
              ['Legal entity', 'Lumio Agency LLC'],
              ['Trading name', 'Lumio Booking'],
              ['Registered address', '5900 Balcones Drive STE 100, Austin, TX 78731, United States'],
              ['Phone', '+1 (512) 886-8189'],
              ['Email', 'lumioagency.com@gmail.com'],
              ['Website', 'https://lumiobooking.com'],
              ['Markets served', 'United States · Canada · Australia'],
              ['Verticals', 'Nail salons, spas, medical spas, wellness, restaurants'],
            ].map(([k, v]) => (
              <tr key={k} style={{ borderTop: '1px solid #eef1f6' }}>
                <td style={{ padding: '8px 0', color: '#64748b', width: 180, verticalAlign: 'top' }}>{k}</td>
                <td style={{ padding: '8px 0', color: '#1e293b' }}>
                  {k === 'Email' ? <a href={`mailto:${v}`} style={a}>{v}</a>
                    : k === 'Website' ? <a href={v} style={a}>{v}</a>
                    : v}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <h2 style={h2}>Support</h2>
        <p style={p}>
          Salons reach us by email or phone during US business hours; urgent booking issues are answered within one
          business day. Customers who booked an appointment should contact the salon first — its number is in the
          confirmation message — or write to us if they cannot reach it.
        </p>

        <h2 style={h2}>Policies</h2>
        <p style={p}>
          <a href="/terms" style={a}>Terms of Service &amp; SMS Terms</a> ·{' '}
          <a href="/privacy" style={a}>Privacy Policy</a> ·{' '}
          <a href="/booking-policy" style={a}>Booking, Cancellation &amp; No-Show Policy</a> ·{' '}
          <a href="/merchant-terms" style={a}>Merchant Service Agreement</a> ·{' '}
          <a href="/support" style={a}>Support &amp; Help Center</a> ·{' '}
          <a href="/data-deletion" style={a}>Data deletion</a>
        </p>

        <h2 style={h2}>Try it</h2>
        <p style={p}>
          A live salon booking page: <a href="/lux-nail-spa" style={a}>lumiobooking.com/lux-nail-spa</a> — no login
          required to see availability and complete a booking.
        </p>
      </div>
    </main>
  );
}

const wrap: React.CSSProperties = { minHeight: '100vh', background: '#f8fafc', padding: '32px 16px', fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif' };
const card: React.CSSProperties = { maxWidth: 760, margin: '0 auto', background: '#fff', borderRadius: 16, padding: '32px 36px', boxShadow: '0 8px 30px rgba(15,23,42,0.08)', color: '#1e293b' };
const h1: React.CSSProperties = { fontSize: 28, margin: '0 0 4px', color: '#0f172a' };
const h2: React.CSSProperties = { fontSize: 17, margin: '24px 0 8px', color: '#0f172a' };
const p: React.CSSProperties = { fontSize: 14.5, lineHeight: 1.65, color: '#334155', margin: '0 0 10px' };
const muted: React.CSSProperties = { fontSize: 13, color: '#64748b', margin: '0 0 18px' };
const a: React.CSSProperties = { color: '#4f46e5', textDecoration: 'none' };
