'use client';

// Public Merchant Service Agreement.
//
// Why this page exists: Reserve with Google requires an aggregator to have a
// DIRECT contractual relationship with every merchant it submits in its feed.
// A reviewer needs to be able to see, without asking us, what that relationship
// is. This page is the public summary of the agreement every salon accepts when
// it subscribes to Lumio Booking.

export default function MerchantTermsPage() {
  return (
    <main style={wrap}>
      <div style={card}>
        <h1 style={h1}>Merchant Service Agreement</h1>
        <p style={muted}>
          Lumio Booking, operated by Lumio Agency LLC · 5900 Balcones Drive STE 100, Austin, TX 78731, United States ·
          Last updated: July 2026.
        </p>

        <p style={p}>
          This agreement governs the relationship between <strong>Lumio Agency LLC</strong> (&ldquo;Lumio&rdquo;,
          &ldquo;we&rdquo;) and each business (&ldquo;Merchant&rdquo;, &ldquo;salon&rdquo;) that subscribes to Lumio
          Booking. Every merchant accepts these terms when it creates its account and begins its subscription; a
          countersigned copy is available to the merchant on request.
        </p>

        <h2 style={h2}>1. Services we provide</h2>
        <p style={p}>
          Lumio provides the merchant with online booking software: a merchant-specific booking page, appointment
          calendar, staff scheduling, customer records, point of sale, email and SMS notifications, and reporting. Each
          merchant receives its own dedicated booking page at
          <strong> lumiobooking.com/&lt;merchant-name&gt;</strong>, which is the merchant&rsquo;s official online booking
          channel.
        </p>

        <h2 style={h2}>2. Authorisation to publish booking availability</h2>
        <p style={p}>
          The merchant authorises Lumio to publish its business details, services, prices and booking link to online
          channels on its behalf, including search engines, maps and booking directories such as Google. The merchant
          confirms that the information it enters in Lumio (business name, address, phone, services, prices, opening
          hours) is accurate, and that it is entitled to accept bookings for the services it lists.
        </p>

        <h2 style={h2}>3. Bookings and cancellations</h2>
        <p style={p}>
          Bookings made through any channel are delivered to the merchant in real time and are honoured by the merchant
          on the same terms as bookings taken by phone or in person. The merchant sets its own cancellation, rescheduling
          and no-show rules in Lumio; those rules are shown to the customer before the booking is confirmed. See our
          <a href="/booking-policy" style={a}> booking &amp; cancellation policy</a>.
        </p>

        <h2 style={h2}>4. Data</h2>
        <p style={p}>
          Customer data collected through the merchant&rsquo;s booking page belongs to the merchant. Lumio processes it
          solely to operate the service, in line with our <a href="/privacy" style={a}>Privacy Policy</a>. Each
          merchant&rsquo;s data is isolated from every other merchant on the platform. Lumio does not sell customer data
          and does not share opt-in or consent data with third parties for marketing.
        </p>

        <h2 style={h2}>5. Fees and term</h2>
        <p style={p}>
          The merchant pays a monthly or annual subscription per the plan selected at sign-up. The agreement runs
          month-to-month unless an annual plan is chosen, and either party may end it with 30 days&rsquo; notice. On
          termination the merchant&rsquo;s booking page and any published booking links are removed within 5 business
          days.
        </p>

        <h2 style={h2}>6. Merchant obligations</h2>
        <p style={p}>
          The merchant agrees to keep its availability, services and prices current in Lumio, to honour confirmed
          bookings, to hold all licences required to operate, and not to list services it is not authorised to provide.
          Repeated failure to honour bookings is grounds for removal from published booking channels.
        </p>

        <h2 style={h2}>7. Liability</h2>
        <p style={p}>
          The services booked are provided by the merchant, not by Lumio. Lumio provides the booking software
          &ldquo;as is&rdquo; and is not liable for the services delivered at the merchant&rsquo;s premises.
        </p>

        <h2 style={h2}>Contact</h2>
        <p style={p}>
          Lumio Agency LLC · 5900 Balcones Drive STE 100, Austin, TX 78731, United States<br />
          <a href="mailto:lumioagency.com@gmail.com" style={a}>lumioagency.com@gmail.com</a> · +1 (512) 886-8189 ·{' '}
          <a href="https://lumiobooking.com" style={a}>lumiobooking.com</a>
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
