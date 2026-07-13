'use client';

// Lumio's own outbound: pitching the software to salons. Same engine the salons
// use, but sent on the platform's Brevo account.

import { EmailCampaigns } from '../../../components/EmailCampaigns';
import { useAuth } from '../../../lib/auth';

export default function AdminEmailPage() {
  const { logout } = useAuth();
  return (
    <main style={{ minHeight: '100vh', background: '#0b1120', color: '#e2e8f0', padding: '28px 20px' }}>
      <div style={{ maxWidth: 1180, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
          <div>
            <h1 style={{ fontSize: 24, margin: '0 0 4px' }}>Email marketing</h1>
            <p style={{ color: '#94a3b8', margin: 0, fontSize: 14 }}>
              Send a product email to a list of salons. Sent from the platform Brevo account, with a one-click unsubscribe on every message.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <a href="/super-admin/tenants" style={{ ...btn, textDecoration: 'none' }}>← Salons</a>
            <button onClick={logout} style={btn}>Log out</button>
          </div>
        </div>
        <EmailCampaigns base="/admin/email-campaigns" vi={false} defaultFromName="Lumio Booking" />
      </div>
    </main>
  );
}

const btn: React.CSSProperties = {
  padding: '9px 16px', borderRadius: 8, border: '1px solid #334155',
  background: 'transparent', color: '#e2e8f0', fontSize: 13.5, cursor: 'pointer',
};
