'use client';

import { useCallback, useEffect, useState } from 'react';
import { SalonShell } from '../../../components/SalonShell';
import { useAuth } from '../../../lib/auth';
import { apiFetch } from '../../../lib/api';
import { ui } from '../../../lib/ui';
import { useLang } from '../../../lib/i18n';

// ---- Types (mirror the payments-hub API) ----
interface HubStatus { enabled: boolean; encryption: boolean; providers: string[]; }
interface Capabilities { terminal?: boolean; online?: boolean; tapToPay?: boolean; interac?: boolean; partialRefund?: boolean; currencies?: string[]; }
interface Connection { provider: string; status: string; label?: string | null; keyHint?: string | null; currency?: string; capabilities?: Capabilities; lastCheckedAt?: string | null; }
interface Device { id: string; externalReaderId: string; label?: string | null; status: string; locationId?: string | null; }
interface Intent { id: string; status: string; amountCents: number; currency: string; error?: string | null; }

// Providers usable in Phase 1. Others are shown as "coming soon".
const PROVIDER_META: Record<string, { name: string; recommended?: boolean; help: { en: string; vi: string }; fields: string[] }> = {
  stripe: {
    name: 'Stripe Terminal',
    recommended: true,
    help: {
      en: 'Stripe Dashboard → Developers → API keys → Create restricted key (allow Terminal, PaymentIntents, Charges/Refunds). Paste the rk_live_… key. Lumio registers nothing.',
      vi: 'Stripe Dashboard → Developers → API keys → Create restricted key (cấp quyền Terminal, PaymentIntents, Charges/Refunds). Dán key rk_live_…. Lumio không đăng ký gì.',
    },
    fields: ['secret', 'currency', 'locationId', 'webhookSecret'],
  },
  mock: {
    name: 'Mock (sandbox test)',
    help: { en: 'For testing only. Use any key that starts with "mock_".', vi: 'Chỉ để test. Dùng key bất kỳ bắt đầu bằng "mock_".' },
    fields: ['secret'],
  },
};
const COMING_SOON = [
  { id: 'sumup', name: 'SumUp', phase: 'Phase 2' },
  { id: 'square', name: 'Square Terminal', phase: 'Phase 2' },
  { id: 'adyen', name: 'Adyen', phase: 'Phase 3' },
];

const box: React.CSSProperties = { border: '1px solid #334155', borderRadius: 12, padding: 16, marginTop: 14, background: '#0f172a' };
const label: React.CSSProperties = { display: 'block', fontSize: 12, color: '#94a3b8', margin: '10px 0 4px' };
const input: React.CSSProperties = { width: '100%', padding: '9px 11px', borderRadius: 8, border: '1px solid #334155', background: '#1e293b', color: '#e2e8f0', fontSize: 14, boxSizing: 'border-box' };

export default function PaymentTerminalsPage() {
  return (
    <SalonShell>
      <Inner />
    </SalonShell>
  );
}

function Inner() {
  const { token } = useAuth();
  const { lang } = useLang();
  const vi = lang === 'vi';
  const L = vi
    ? { title: 'Máy quẹt thẻ (POS)', sub: 'Kết nối tài khoản thanh toán của chính tiệm — Lumio chỉ tích hợp, không giữ tiền.', choose: 'Chọn nhà cung cấp', connect: 'Kết nối', connected: 'Đã kết nối', test: 'Kiểm tra kết nối', disconnect: 'Ngắt kết nối', readers: 'Máy quẹt (reader)', addReader: 'Thêm reader', refresh: 'Làm mới', code: 'Mã ghép (pairing/registration code)', readerLabel: 'Tên gợi nhớ', currency: 'Tiền tệ', secret: 'API key (secret)', webhook: 'Webhook secret (tuỳ chọn)', location: 'Location ID (tuỳ chọn)', disabled: 'Tính năng chưa được bật. Quản trị nền tảng cần đặt PAYMENTS_HUB_ENABLED=true.', noEnc: '⚠ Chưa cấu hình PAYMENT_ENC_KEY — không thể lưu key an toàn.', testCharge: 'Thử một giao dịch', amount: 'Số tiền (cents)', run: 'Chạy thử', comingSoon: 'Sắp có', howTo: 'Lấy key ở đâu' }
    : { title: 'Card terminals (POS)', sub: "Connect the salon's own payment account — Lumio only integrates, never holds funds.", choose: 'Choose a provider', connect: 'Connect', connected: 'Connected', test: 'Test connection', disconnect: 'Disconnect', readers: 'Card readers', addReader: 'Add reader', refresh: 'Refresh', code: 'Pairing / registration code', readerLabel: 'Friendly label', currency: 'Currency', secret: 'API key (secret)', webhook: 'Webhook secret (optional)', location: 'Location ID (optional)', disabled: 'Feature not enabled yet. A platform admin must set PAYMENTS_HUB_ENABLED=true.', noEnc: '⚠ PAYMENT_ENC_KEY not configured — cannot store keys securely.', testCharge: 'Run a test charge', amount: 'Amount (cents)', run: 'Run test', comingSoon: 'Coming soon', howTo: 'Where to get your key' };

  const [status, setStatus] = useState<HubStatus | null>(null);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  // connect form
  const [provider, setProvider] = useState('stripe');
  const [secret, setSecret] = useState('');
  const [webhookSecret, setWebhookSecret] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [locationId, setLocationId] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true); setError(null);
    try {
      const [st, cons] = await Promise.all([
        apiFetch<HubStatus>('/payments-hub/status', { token }),
        apiFetch<Connection[]>('/payments-hub/connections', { token }).catch(() => []),
      ]);
      setStatus(st); setConnections(cons);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally { setLoading(false); }
  }, [token]);
  useEffect(() => { load(); }, [load]);

  async function doConnect() {
    setBusy(true); setError(null); setMsg(null);
    try {
      await apiFetch('/payments-hub/connect', { method: 'POST', token, body: { provider, secret: secret.trim(), webhookSecret: webhookSecret.trim() || undefined, currency, locationId: locationId.trim() || undefined } });
      setSecret(''); setWebhookSecret('');
      setMsg(vi ? 'Kết nối thành công.' : 'Connected successfully.');
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Connect failed'); }
    finally { setBusy(false); }
  }
  async function doTest(p: string) {
    setError(null); setMsg(null);
    try { const r = await apiFetch<{ ok: boolean; error?: string }>(`/payments-hub/test/${p}`, { method: 'POST', token }); setMsg(r.ok ? (vi ? 'Kết nối OK ✓' : 'Connection OK ✓') : `✗ ${r.error ?? 'error'}`); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Test failed'); }
  }
  async function doDisconnect(p: string) {
    if (!confirm(vi ? `Ngắt kết nối ${p}?` : `Disconnect ${p}?`)) return;
    try { await apiFetch(`/payments-hub/connection/${p}`, { method: 'DELETE', token }); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Disconnect failed'); }
  }

  if (loading) return <section><h1 style={{ fontSize: 24 }}>{L.title}</h1><p style={{ color: '#94a3b8' }}>…</p></section>;

  const meta = PROVIDER_META[provider];
  const activeProviders = (status?.providers ?? []).filter((p) => PROVIDER_META[p]);

  return (
    <section>
      <h1 style={{ fontSize: 24, margin: '0 0 4px' }}>{L.title}</h1>
      <p style={{ color: '#94a3b8', marginTop: 0, fontSize: 14 }}>{L.sub}</p>

      {error && <div style={ui.banner}>{error}</div>}
      {msg && <div style={{ ...ui.banner, borderColor: '#22c55e', color: '#86efac' }}>{msg}</div>}
      {status && !status.enabled && <div style={ui.banner}>{L.disabled}</div>}
      {status && status.enabled && !status.encryption && <div style={ui.banner}>{L.noEnc}</div>}

      {/* Existing connections */}
      {connections.filter((c) => c.status === 'ACTIVE').map((c) => (
        <div key={c.provider} style={box}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <div>
              <strong style={{ fontSize: 16 }}>{PROVIDER_META[c.provider]?.name ?? c.provider}</strong>
              <span style={{ marginLeft: 10, fontSize: 12, color: '#22c55e', fontWeight: 700 }}>● {L.connected}</span>
              <div style={{ color: '#94a3b8', fontSize: 13, marginTop: 4 }}>
                {L.secret}: {c.keyHint ?? '—'} · {c.currency}
                {c.capabilities?.interac ? ' · Interac' : ''}{c.capabilities?.tapToPay ? ' · Tap to Pay' : ''}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => doTest(c.provider)} style={ui.primaryBtn}>{L.test}</button>
              <button onClick={() => doDisconnect(c.provider)} style={ui.dangerBtn}>{L.disconnect}</button>
            </div>
          </div>
          <Readers provider={c.provider} token={token} L={L} />
          <TestCharge provider={c.provider} token={token} L={L} vi={vi} />
        </div>
      ))}

      {/* Connect a new provider */}
      <div style={box}>
        <strong style={{ fontSize: 15 }}>{L.choose}</strong>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '10px 0' }}>
          {activeProviders.map((p) => (
            <button key={p} onClick={() => setProvider(p)} style={{ ...(provider === p ? ui.primaryBtn : ghost), position: 'relative' }}>
              {PROVIDER_META[p].name}{PROVIDER_META[p].recommended ? ' ★' : ''}
            </button>
          ))}
          {COMING_SOON.map((p) => (
            <span key={p.id} style={{ ...ghost, opacity: 0.5 }}>{p.name} · {L.comingSoon} ({p.phase})</span>
          ))}
        </div>

        {meta && (
          <>
            <p style={{ fontSize: 12, color: '#a5b4fc', background: '#1e293b', padding: 10, borderRadius: 8, lineHeight: 1.5 }}>
              <strong>{L.howTo}:</strong> {vi ? meta.help.vi : meta.help.en}
            </p>
            <label style={label}>{L.secret}</label>
            <input style={input} type="password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder={provider === 'stripe' ? 'rk_live_…' : provider === 'mock' ? 'mock_test' : ''} autoComplete="off" />
            {meta.fields.includes('currency') && (
              <>
                <label style={label}>{L.currency}</label>
                <select style={input} value={currency} onChange={(e) => setCurrency(e.target.value)}>
                  <option value="USD">USD</option>
                  <option value="CAD">CAD (Interac)</option>
                </select>
              </>
            )}
            {meta.fields.includes('locationId') && (<><label style={label}>{L.location}</label><input style={input} value={locationId} onChange={(e) => setLocationId(e.target.value)} placeholder="tml_… / loc_…" /></>)}
            {meta.fields.includes('webhookSecret') && (<><label style={label}>{L.webhook}</label><input style={input} type="password" value={webhookSecret} onChange={(e) => setWebhookSecret(e.target.value)} placeholder="whsec_…" autoComplete="off" /></>)}
            <div style={{ marginTop: 14 }}>
              <button onClick={doConnect} disabled={busy || !secret.trim() || !status?.enabled} style={{ ...ui.primaryBtn, opacity: busy || !secret.trim() || !status?.enabled ? 0.6 : 1 }}>
                {busy ? '…' : L.connect}
              </button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}

const ghost: React.CSSProperties = { padding: '9px 14px', borderRadius: 8, border: '1px solid #334155', background: 'transparent', color: '#e2e8f0', fontSize: 14, cursor: 'pointer' };

function Readers({ provider, token, L }: { provider: string; token: string | null; L: any }) {
  const [readers, setReaders] = useState<Device[]>([]);
  const [code, setCode] = useState('');
  const [rlabel, setRLabel] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!token) return;
    try { setReaders(await apiFetch<Device[]>(`/payments-hub/readers/${provider}`, { token })); } catch (e) { setErr(e instanceof Error ? e.message : 'error'); }
  }, [provider, token]);
  useEffect(() => { load(); }, [load]);
  async function add() {
    setErr(null);
    try { await apiFetch(`/payments-hub/readers/${provider}`, { method: 'POST', token, body: { code: code.trim(), label: rlabel.trim() || undefined } }); setCode(''); setRLabel(''); await load(); }
    catch (e) { setErr(e instanceof Error ? e.message : 'error'); }
  }
  return (
    <div style={{ marginTop: 14, borderTop: '1px solid #334155', paddingTop: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <strong style={{ fontSize: 13, color: '#cbd5e1' }}>{L.readers}</strong>
        <button onClick={load} style={{ ...ghost, padding: '5px 10px', fontSize: 12 }}>{L.refresh}</button>
      </div>
      {err && <div style={{ color: '#fca5a5', fontSize: 12, marginTop: 6 }}>{err}</div>}
      {readers.length === 0 ? <p style={{ color: '#64748b', fontSize: 13 }}>—</p> : (
        <ul style={{ listStyle: 'none', padding: 0, margin: '8px 0' }}>
          {readers.map((r) => (
            <li key={r.id} style={{ fontSize: 13, color: '#e2e8f0', padding: '4px 0' }}>
              <span style={{ color: r.status === 'ONLINE' ? '#22c55e' : '#94a3b8' }}>●</span> {r.label || r.externalReaderId} <span style={{ color: '#64748b' }}>({r.status})</span>
            </li>
          ))}
        </ul>
      )}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
        <input style={{ ...input, width: 200 }} value={code} onChange={(e) => setCode(e.target.value)} placeholder={L.code} />
        <input style={{ ...input, width: 160 }} value={rlabel} onChange={(e) => setRLabel(e.target.value)} placeholder={L.readerLabel} />
        <button onClick={add} disabled={!code.trim()} style={{ ...ui.primaryBtn, opacity: code.trim() ? 1 : 0.6 }}>{L.addReader}</button>
      </div>
    </div>
  );
}

function TestCharge({ provider, token, L, vi }: { provider: string; token: string | null; L: any; vi: boolean }) {
  const [amount, setAmount] = useState('100');
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function run() {
    setBusy(true); setResult(null);
    try {
      const clientRef = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `t_${Date.now()}`;
      let intent = await apiFetch<Intent>('/payments-hub/charge', { method: 'POST', token, body: { provider, amountCents: parseInt(amount, 10) || 0, clientRef, description: 'Lumio test charge' } });
      // Poll up to ~20s for the reader to settle.
      for (let i = 0; i < 10 && (intent.status === 'PROCESSING' || intent.status === 'REQUIRES_PAYMENT'); i++) {
        await new Promise((r) => setTimeout(r, 2000));
        intent = await apiFetch<Intent>(`/payments-hub/intents/${intent.id}`, { token });
      }
      setResult(`${intent.status}${intent.error ? ' — ' + intent.error : ''}`);
    } catch (e) { setResult(e instanceof Error ? e.message : 'error'); }
    finally { setBusy(false); }
  }
  return (
    <div style={{ marginTop: 12, borderTop: '1px dashed #334155', paddingTop: 12 }}>
      <strong style={{ fontSize: 13, color: '#cbd5e1' }}>{L.testCharge}</strong>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
        <input style={{ ...input, width: 130 }} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={L.amount} />
        <button onClick={run} disabled={busy} style={{ ...ui.primaryBtn, opacity: busy ? 0.6 : 1 }}>{busy ? '…' : L.run}</button>
        {result && <span style={{ fontSize: 13, color: result.startsWith('SUCCEEDED') ? '#86efac' : '#fca5a5' }}>{result}</span>}
      </div>
    </div>
  );
}
