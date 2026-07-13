'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth';
import { apiFetch } from '../../../lib/api';

interface Status {
  stripe: { hasKey: boolean; hasWebhook: boolean; live: boolean };
  paypal: { hasClient: boolean; hasWebhook: boolean; env: string };
  email?: { hasKey: boolean; senderEmail: string; senderName: string; logoUrl?: string };
  inbound?: { domain: string; forwardTo: string; webhookUrl: string; ready: boolean };
  webhookStripeUrl: string;
  webhookPaypalUrl: string;
}

interface Diag {
  ok: boolean;
  key: { ok: boolean; detail: string };
  sender: { ok: boolean; detail: string };
  domain: { ok: boolean; detail: string };
  advice: string;
}

export default function GatewaysPage() {
  const { token, user, ready } = useAuth();
  const router = useRouter();
  const [st, setSt] = useState<Status | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Stripe inputs
  const [stripeKey, setStripeKey] = useState('');
  const [stripeHook, setStripeHook] = useState('');
  // PayPal inputs
  const [ppId, setPpId] = useState('');
  const [ppSecret, setPpSecret] = useState('');
  const [ppHook, setPpHook] = useState('');
  const [ppEnv, setPpEnv] = useState('live');
  // Invoice email (Brevo) inputs
  const [brevoKey, setBrevoKey] = useState('');
  const [brevoSender, setBrevoSender] = useState('');
  const [brevoName, setBrevoName] = useState('');
  const [brandLogo, setBrandLogo] = useState('');
  const [inDomain, setInDomain] = useState('');
  const [inFwd, setInFwd] = useState('');
  const [testEmail, setTestEmail] = useState('');
  const [diag, setDiag] = useState<Diag | null>(null);

  useEffect(() => {
    if (!ready) return;
    if (!token) router.replace('/login');
    else if (user && user.role !== 'SUPER_ADMIN') router.replace('/');
  }, [ready, token, user, router]);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const s = await apiFetch<Status>('/billing/config', { token });
      setSt(s); setPpEnv(s.paypal.env || 'live');
      setBrevoSender(s.email?.senderEmail || ''); setBrevoName(s.email?.senderName || ''); setBrandLogo(s.email?.logoUrl || ''); setInDomain(s.inbound?.domain || ''); setInFwd(s.inbound?.forwardTo || '');
    }
    catch (e) { setErr(e instanceof Error ? e.message : 'Failed to load'); }
  }, [token]);
  useEffect(() => { if (ready && token && user?.role === 'SUPER_ADMIN') load(); }, [ready, token, user, load]);

  async function testNow() {
    setBusy(true); setErr(null); setMsg(null);
    try {
      const r = await apiFetch<{ stripe: string; paypal: string }>('/billing/config/test', { token });
      const fmt = (v: string) => v === 'ok' ? '✓ working' : v === 'not configured' ? 'not set' : `✗ ${v}`;
      setMsg(`Test — Stripe: ${fmt(r.stripe)}  ·  PayPal: ${fmt(r.paypal)}`);
    } catch (e) { setErr(e instanceof Error ? e.message : 'Test failed'); }
    finally { setBusy(false); }
  }

  async function save(body: Record<string, string>) {
    setBusy(true); setErr(null); setMsg(null);
    try {
      const s = await apiFetch<Status>('/billing/config', { method: 'POST', token, body });
      setSt(s);
      setMsg('✓ Saved. Connection status updated below.');
      setStripeKey(''); setStripeHook(''); setPpId(''); setPpSecret(''); setPpHook('');
    } catch (e) { setErr(e instanceof Error ? e.message : 'Save failed'); }
    finally { setBusy(false); }
  }

  async function diagnose() {
    setBusy(true); setErr(null); setMsg(null); setDiag(null);
    try {
      setDiag(await apiFetch<Diag>('/admin/invoices/email-diagnose', { method: 'POST', token }));
    } catch (e) { setErr(e instanceof Error ? e.message : 'Check failed'); }
    finally { setBusy(false); }
  }

  async function sendTest() {
    setBusy(true); setErr(null); setMsg(null);
    try {
      const r = await apiFetch<{ sent: boolean; via: string; error?: string }>('/admin/invoices/test-email', { method: 'POST', token, body: { email: testEmail } });
      if (r.sent) setMsg(`✓ Test email sent to ${testEmail} (via ${r.via}). Check the inbox / spam folder.`);
      else setErr(`Not sent: ${r.error || 'email not configured'} — via ${r.via}.`);
    } catch (e) { setErr(e instanceof Error ? e.message : 'Test failed'); }
    finally { setBusy(false); }
  }

  if (!ready || !token || user?.role !== 'SUPER_ADMIN') {
    return <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', color: '#94a3b8' }}>Loading…</div>;
  }

  const copy = (t: string) => navigator.clipboard?.writeText(t).then(() => { setMsg('✓ Webhook URL copied'); }).catch(() => {});
  const dot = (on: boolean) => <span style={{ color: on ? '#22c55e' : '#ef4444', fontWeight: 700 }}>● {on ? 'Connected' : 'Not set'}</span>;

  return (
    <main style={{ maxWidth: 820, margin: '0 auto', padding: '32px 24px', color: '#e2e8f0' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 24, margin: 0 }}>Payment gateways</h1>
          <p style={{ color: '#94a3b8', margin: '4px 0 0', fontSize: 14 }}>Connect Stripe / PayPal so salons can pay you. Money goes to the account these keys belong to.</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={testNow} disabled={busy} style={ghost}>Test connection</button>
          <a href="/super-admin/tenants" style={ghost}>← Salons</a>
        </div>
      </header>

      {err && <Banner color="#fecaca" bg="#7f1d1d">{err}</Banner>}
      {msg && <Banner color="#bbf7d0" bg="#14532d">{msg}</Banner>}

      {/* Stripe */}
      <section style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ fontSize: 18, margin: 0 }}>💳 Stripe (cards)</h2>
          <span style={{ fontSize: 13 }}>{st ? dot(st.stripe.hasKey && st.stripe.hasWebhook) : '…'}{st?.stripe.live ? ' · LIVE' : st?.stripe.hasKey ? ' · TEST' : ''}</span>
        </div>
        <p style={{ color: '#94a3b8', fontSize: 13, margin: '8px 0 12px' }}>From Stripe → Developers → API keys (Secret key) and Webhooks (signing secret).</p>
        <label style={lbl}>Secret key {st?.stripe.hasKey && <span style={savedTag}>saved</span>}</label>
        <input style={inp} type="password" value={stripeKey} onChange={(e) => setStripeKey(e.target.value)} placeholder={st?.stripe.hasKey ? '•••••••• (leave blank to keep)' : 'sk_live_… or sk_test_…'} />
        <label style={lbl}>Webhook signing secret {st?.stripe.hasWebhook && <span style={savedTag}>saved</span>}</label>
        <input style={inp} type="password" value={stripeHook} onChange={(e) => setStripeHook(e.target.value)} placeholder={st?.stripe.hasWebhook ? '•••••••• (leave blank to keep)' : 'whsec_…'} />
        <button onClick={() => save({ stripeSecretKey: stripeKey, stripeWebhookSecret: stripeHook })} disabled={busy} style={primaryBtn}>Save Stripe</button>

        <div style={hintBox}>
          <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 4 }}>Add this webhook URL in Stripe (events: checkout.session.completed, customer.subscription.updated/deleted, invoice.payment_failed):</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <code style={codeBox}>{st?.webhookStripeUrl}</code>
            <button onClick={() => st && copy(st.webhookStripeUrl)} style={ghost}>Copy</button>
          </div>
        </div>
      </section>

      {/* PayPal */}
      <section style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ fontSize: 18, margin: 0 }}>PayPal</h2>
          <span style={{ fontSize: 13 }}>{st ? dot(st.paypal.hasClient && st.paypal.hasWebhook) : '…'}{st ? ` · ${(st.paypal.env || 'live').toUpperCase()}` : ''}</span>
        </div>
        <p style={{ color: '#94a3b8', fontSize: 13, margin: '8px 0 12px' }}>From developer.paypal.com → your REST app (Client ID + Secret) and Webhooks (Webhook ID).</p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div><label style={lbl}>Client ID {st?.paypal.hasClient && <span style={savedTag}>saved</span>}</label>
            <input style={inp} value={ppId} onChange={(e) => setPpId(e.target.value)} placeholder={st?.paypal.hasClient ? '•••• (keep)' : 'AY…'} /></div>
          <div><label style={lbl}>Secret</label>
            <input style={inp} type="password" value={ppSecret} onChange={(e) => setPpSecret(e.target.value)} placeholder={st?.paypal.hasClient ? '•••• (keep)' : 'EL…'} /></div>
          <div><label style={lbl}>Webhook ID {st?.paypal.hasWebhook && <span style={savedTag}>saved</span>}</label>
            <input style={inp} value={ppHook} onChange={(e) => setPpHook(e.target.value)} placeholder="2W9…" /></div>
          <div><label style={lbl}>Environment</label>
            <select style={inp} value={ppEnv} onChange={(e) => setPpEnv(e.target.value)}><option value="live">Live</option><option value="sandbox">Sandbox (test)</option></select></div>
        </div>
        <button onClick={() => save({ paypalClientId: ppId, paypalSecret: ppSecret, paypalWebhookId: ppHook, paypalEnv: ppEnv })} disabled={busy} style={{ ...primaryBtn, marginTop: 12 }}>Save PayPal</button>

        <div style={hintBox}>
          <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 4 }}>Add this webhook URL in PayPal (subscription + payment events):</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <code style={codeBox}>{st?.webhookPaypalUrl}</code>
            <button onClick={() => st && copy(st.webhookPaypalUrl)} style={ghost}>Copy</button>
          </div>
        </div>
      </section>

      {/* Invoice email (Brevo) — Lumio → salons */}
      <section style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ fontSize: 18, margin: 0 }}>✉ Platform email — invoices AND email marketing</h2>
          <span style={{ fontSize: 13 }}>{st ? dot(!!st.email?.hasKey) : '…'}</span>
        </div>
        <p style={{ color: '#94a3b8', fontSize: 13, margin: '8px 0 12px' }}>
          The address <b>every Lumio email goes out FROM</b> — month-end invoices, renewal invoices, and <b>every Email marketing campaign you send</b>.
          Free key at brevo.com → SMTP &amp; API → API Keys (~300 emails/day free).
          Verify your sender address in Brevo first (Senders &amp; IP → Senders), and authenticate your domain (SPF/DKIM) or your campaigns will land in spam.
          A personal @gmail.com address cannot be used as the sender for bulk mail — use an address on your own domain.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div style={{ gridColumn: '1 / -1' }}><label style={lbl}>Brevo API key {st?.email?.hasKey && <span style={savedTag}>saved</span>}</label>
            <input style={inp} type="password" value={brevoKey} onChange={(e) => setBrevoKey(e.target.value)} placeholder={st?.email?.hasKey ? '•••••••• (leave blank to keep)' : 'xkeysib-…'} /></div>
          <div><label style={lbl}>Sender email (verified in Brevo)</label>
            <input style={inp} value={brevoSender} onChange={(e) => setBrevoSender(e.target.value)} placeholder="billing@yourdomain.com" /></div>
          <div><label style={lbl}>Sender name</label>
            <input style={inp} value={brevoName} onChange={(e) => setBrevoName(e.target.value)} placeholder="Viet Nguyen · Lumio Agency" /></div>
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={lbl}>Logo URL (shown at the top of every Lumio email)</label>
            <input style={inp} value={brandLogo} onChange={(e) => setBrandLogo(e.target.value)} placeholder="https://lumioagency.com/…/logo.png" />
            <div style={{ fontSize: 11.5, color: '#64748b', marginTop: -6, marginBottom: 8 }}>
              A square PNG, at least 128×128, on a public https:// link. Without it the email opens with a blank space where the logo should be — which reads as amateur, or as a scam.
            </div>
            {brandLogo && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 8, background: '#0f172a', border: '1px solid #334155', marginBottom: 8 }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={brandLogo} alt="logo" style={{ width: 44, height: 44, borderRadius: 10, objectFit: 'contain', background: '#fff' }} />
                <span style={{ fontSize: 12, color: '#94a3b8' }}>Preview — if you see a broken image here, customers will too.</span>
              </div>
            )}
          </div>
        </div>
        <button onClick={() => save({ brevoApiKey: brevoKey, brevoSenderEmail: brevoSender, brevoSenderName: brevoName, brandLogoUrl: brandLogo })} disabled={busy} style={primaryBtn}>Save email</button>

        <div style={hintBox}>
          <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 6 }}>Send yourself a test to confirm it works before month-end:</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <input style={{ ...inp, marginBottom: 0, flex: 1, minWidth: 200 }} value={testEmail} onChange={(e) => setTestEmail(e.target.value)} placeholder="your@email.com" />
            <button onClick={sendTest} disabled={busy || !testEmail} style={ghost}>Send test</button>
            <button onClick={diagnose} disabled={busy} style={{ ...ghost, borderColor: '#6366f1', color: '#a5b4fc' }}>
              Check setup with Brevo
            </button>
          </div>

          {/* "I pressed send and nothing arrived" — ask Brevo itself why. */}
          {diag && (
            <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
              {([
                ['API key', diag.key],
                ['Sender verified', diag.sender],
                ['Domain (SPF/DKIM)', diag.domain],
              ] as [string, { ok: boolean; detail: string }][]).map(([label, r]) => (
                <div key={label} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '10px 12px', borderRadius: 8,
                  background: '#0f172a', border: `1px solid ${r.ok ? '#166534' : '#7f1d1d'}` }}>
                  <span style={{ flexShrink: 0, fontSize: 14 }}>{r.ok ? '✅' : '❌'}</span>
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 13, fontWeight: 700, color: '#e2e8f0' }}>{label}</span>
                    <span style={{ display: 'block', fontSize: 12.5, color: '#cbd5e1', lineHeight: 1.55, marginTop: 2 }}>{r.detail}</span>
                  </span>
                </div>
              ))}
              <div style={{ padding: '10px 12px', borderRadius: 8, background: 'rgba(245,158,11,0.10)', border: '1px solid #b45309', color: '#fde68a', fontSize: 12.5, lineHeight: 1.55 }}>
                <b>Next:</b> {diag.advice}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Auto-detecting replies. Without this, "replied" has to be ticked by hand —
          and a follow-up robot that keeps chasing someone who already answered is
          the fastest way to lose a prospect. */}
      <section style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ fontSize: 18, margin: 0 }}>↩ Auto-detect replies (stops the follow-up robot)</h2>
          <span style={{ fontSize: 13 }}>{st ? dot(!!st.inbound?.ready) : '…'}</span>
        </div>
        <p style={{ color: '#94a3b8', fontSize: 13, margin: '8px 0 12px', lineHeight: 1.7 }}>
          Today a reply lands in your Gmail and the system never sees it — so you have to tick “Replied” by hand.
          Point a <b>subdomain</b> at Brevo&rsquo;s inbound parsing and every reply comes back through Lumio instead:
          the contact is marked as replied automatically, the follow-up stops for them forever, and the message is
          forwarded to your real inbox so nothing is lost.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div>
            <label style={lbl}>Reply subdomain</label>
            <input style={inp} value={inDomain} onChange={(e) => setInDomain(e.target.value)} placeholder="reply.lumioagency.com" />
          </div>
          <div>
            <label style={lbl}>Forward replies to</label>
            <input style={inp} value={inFwd} onChange={(e) => setInFwd(e.target.value)} placeholder="service.lumioagency@gmail.com" />
          </div>
        </div>
        <button onClick={() => save({ inboundDomain: inDomain, inboundForwardTo: inFwd })} disabled={busy} style={primaryBtn}>
          Save reply detection
        </button>

        {st?.inbound?.webhookUrl && (
          <div style={hintBox}>
            <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 8 }}>
              Two things to do once, in Brevo &amp; your DNS:
            </div>
            <ol style={{ margin: 0, paddingLeft: 18, color: '#cbd5e1', fontSize: 12.5, lineHeight: 1.9 }}>
              <li>
                DNS: add an <b>MX record</b> for <code style={code}>{inDomain || 'reply.yourdomain.com'}</code> pointing to{' '}
                <code style={code}>in.mailin.fr</code> (priority 10). Brevo shows the exact host under
                Senders &amp; IP → Inbound parsing.
              </li>
              <li>
                Brevo → <b>Inbound parsing</b> → set the webhook URL to:
                <div style={{ display: 'flex', gap: 8, marginTop: 6, alignItems: 'center' }}>
                  <code style={{ ...code, flex: 1, wordBreak: 'break-all' }}>{st.inbound.webhookUrl}</code>
                  <button onClick={() => navigator.clipboard?.writeText(st.inbound!.webhookUrl)} style={ghost}>Copy</button>
                </div>
                <span style={{ color: '#f87171' }}>Treat this URL as a password — anyone holding it can mark contacts as replied.</span>
              </li>
            </ol>
          </div>
        )}
      </section>

      <p style={{ color: '#64748b', fontSize: 12 }}>Tip: start with Stripe TEST keys + the test card 4242 4242 4242 4242 to verify, then switch to LIVE keys to receive real money. Renewals are automatic.</p>
    </main>
  );
}

function Banner({ children, color, bg }: { children: React.ReactNode; color: string; bg: string }) {
  return <div style={{ background: bg, color, padding: '10px 14px', borderRadius: 8, fontSize: 14, marginBottom: 14 }}>{children}</div>;
}

const card: React.CSSProperties = { background: '#1e293b', border: '1px solid #334155', borderRadius: 14, padding: 20, marginBottom: 18 };
const inp: React.CSSProperties = { width: '100%', boxSizing: 'border-box', padding: '9px 11px', borderRadius: 8, border: '1px solid #475569', background: '#0f172a', color: '#e2e8f0', fontSize: 14, colorScheme: 'dark', marginBottom: 10 };
const lbl: React.CSSProperties = { display: 'block', fontSize: 13, color: '#cbd5e1', marginBottom: 4 };
const primaryBtn: React.CSSProperties = { padding: '9px 16px', borderRadius: 8, border: 'none', background: '#6366f1', color: '#fff', fontWeight: 600, fontSize: 14, cursor: 'pointer' };
const ghost: React.CSSProperties = { padding: '7px 12px', borderRadius: 8, border: '1px solid #475569', background: 'transparent', color: '#e2e8f0', fontSize: 13, cursor: 'pointer', textDecoration: 'none' };
const code: React.CSSProperties = { background: '#0f172a', border: '1px solid #334155', borderRadius: 6, padding: '3px 7px', fontFamily: 'ui-monospace, monospace', fontSize: 12, color: '#a5b4fc' };
const hintBox: React.CSSProperties = { marginTop: 14, paddingTop: 12, borderTop: '1px solid #334155' };
const codeBox: React.CSSProperties = { flex: 1, background: '#0f172a', border: '1px solid #334155', borderRadius: 6, padding: '6px 10px', fontSize: 12, color: '#cbd5e1', overflowX: 'auto', whiteSpace: 'nowrap' };
const savedTag: React.CSSProperties = { marginLeft: 6, fontSize: 11, color: '#22c55e', border: '1px solid #22c55e', borderRadius: 999, padding: '0 6px' };
