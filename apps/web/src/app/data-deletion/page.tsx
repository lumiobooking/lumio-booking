// Public Data Deletion instructions page — used as the "Data Deletion URL" in the
// Meta app settings and as the status page returned by the deletion callback.

export const metadata = {
  title: 'Data Deletion — Lumio Booking',
  description: 'How to request deletion of your data from the Lumio Booking messaging assistant.',
};

const SUPPORT_EMAIL = 'lumioagency.com@gmail.com';

export default function DataDeletionPage({ searchParams }: { searchParams: { id?: string } }) {
  const ref = typeof searchParams?.id === 'string' ? searchParams.id : '';

  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: '48px 20px', fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif', color: '#1f2937', lineHeight: 1.6 }}>
      <h1 style={{ fontSize: 28, marginBottom: 6 }}>Data Deletion</h1>
      <p style={{ color: '#6b7280', marginTop: 0 }}>Lumio Booking messaging assistant</p>

      {ref && (
        <div style={{ background: '#ecfdf5', border: '1px solid #34d399', borderRadius: 10, padding: '14px 16px', margin: '18px 0' }}>
          <strong style={{ color: '#065f46' }}>✓ Your deletion request has been received and processed.</strong>
          <div style={{ color: '#065f46', fontSize: 14, marginTop: 4 }}>Reference: <code>{ref}</code></div>
        </div>
      )}

      <p>
        When you chat with a salon on Facebook Messenger or Instagram, our booking assistant may store
        your conversation so it can help you book an appointment. This page explains how to have that
        data deleted.
      </p>

      <h2 style={{ fontSize: 19, marginTop: 28 }}>What we store</h2>
      <ul>
        <li>Your Messenger/Instagram conversation with the salon&apos;s booking assistant (message history).</li>
        <li>Any contact details you provided to make a booking (name, phone, and email if you gave one).</li>
      </ul>

      <h2 style={{ fontSize: 19, marginTop: 28 }}>How to request deletion</h2>
      <p><strong>Option 1 — Remove the app (automatic).</strong> In Facebook go to
        {' '}<em>Settings &amp; privacy → Settings → Apps and Websites</em>, remove <strong>Lumio Booking</strong>.
        Facebook notifies us and your conversation data is deleted automatically.</p>
      <p><strong>Option 2 — Email us.</strong> Send a request to{' '}
        <a href={`mailto:${SUPPORT_EMAIL}?subject=Data%20deletion%20request`} style={{ color: '#2563eb' }}>{SUPPORT_EMAIL}</a>{' '}
        with the name or phone number you used, and we will delete your data within 30 days.</p>

      <h2 style={{ fontSize: 19, marginTop: 28 }}>What happens next</h2>
      <p>We delete the stored conversation and any booking contact details associated with your request.
        Appointment records the salon must keep for its own business and tax purposes may be retained by
        the individual salon; contact the salon directly for those.</p>

      <p style={{ color: '#6b7280', fontSize: 13, marginTop: 32, borderTop: '1px solid #e5e7eb', paddingTop: 16 }}>
        Questions? Contact{' '}
        <a href={`mailto:${SUPPORT_EMAIL}`} style={{ color: '#2563eb' }}>{SUPPORT_EMAIL}</a>. See also our{' '}
        <a href="/privacy" style={{ color: '#2563eb' }}>Privacy Policy</a>.
      </p>
    </main>
  );
}
