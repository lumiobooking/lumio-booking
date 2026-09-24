// Public account-deletion instructions — the URL both app stores ask for
// (Google Play "Delete account URL", Apple's review notes). Plain HTML on
// purpose: it is read by reviewers and by people who are not signed in.

export const metadata = {
  title: 'Delete your account — Lumio Booking',
  description: 'How to delete your Lumio Booking account and what happens to your data.',
};

export default function AccountDeletionPage() {
  const box = { background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: '14px 16px', margin: '14px 0' } as const;
  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: '48px 20px', fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif', color: '#1f2937', lineHeight: 1.65, background: '#fff' }}>
      <h1 style={{ fontSize: 28, marginBottom: 6 }}>Delete your account</h1>
      <p style={{ color: '#6b7280', marginTop: 0 }}>Lumio Booking · salon management app</p>

      <h2 style={{ fontSize: 18, marginTop: 28 }}>From inside the app (fastest)</h2>
      <ol>
        <li>Sign in, open the menu and tap <b>My account</b> (Tài khoản của tôi).</li>
        <li>Scroll to <b>Delete account</b> and tap <i>I want to delete my account…</i></li>
        <li>Enter your current password, type <code>DELETE</code>, and confirm.</li>
      </ol>
      <p>Your login is closed immediately and you are signed out on every device.</p>

      <h2 style={{ fontSize: 18, marginTop: 28 }}>By email</h2>
      <p>
        Write to <a href="mailto:support@lumiobooking.com">support@lumiobooking.com</a> from the email address on the account
        with the subject <i>Delete my account</i>. We confirm within 7 days.
      </p>

      <h2 style={{ fontSize: 18, marginTop: 28 }}>What is deleted, what is kept</h2>
      <div style={box}>
        <b>Deleted right away:</b> your login email, password, name and phone on the account; every notification
        device registered to it; your ability to sign in.
      </div>
      <div style={box}>
        <b>Kept by the salon:</b> appointment, payment, invoice and audit records of the salon you worked at. These are the
        business&apos;s own books and are retained for the period its tax law requires. They no longer carry your login.
      </div>
      <div style={box}>
        <b>Salon owners:</b> if you are the salon&apos;s only admin, add another admin first, or ask us to close the salon
        entirely — a salon closure deletes the salon&apos;s data after a 30-day grace period.
      </div>

      <p style={{ marginTop: 28, fontSize: 13, color: '#6b7280' }}>
        Customers who booked with a salon and want their own data removed: see <a href="/data-deletion">Data deletion</a>.
        Privacy policy: <a href="/privacy">lumiobooking.com/privacy</a>.
      </p>
    </main>
  );
}
