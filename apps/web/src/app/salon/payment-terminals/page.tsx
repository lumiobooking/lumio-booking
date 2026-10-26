'use client';

import { useCallback, useEffect, useState } from 'react';
import { SalonShell } from '../../../components/SalonShell';
import { useAuth } from '../../../lib/auth';
import { apiFetch } from '../../../lib/api';
import { ui } from '../../../lib/ui';
import { useLang } from '../../../lib/i18n';
import { TerminalRequestCard } from '../../../components/TerminalRequestCard';

// ---- Types (mirror the payments-hub API) ----
interface HubStatus { enabled: boolean; encryption: boolean; providers: string[]; webhookBase?: string | null }
interface Capabilities { terminal?: boolean; online?: boolean; tapToPay?: boolean; interac?: boolean; partialRefund?: boolean; currencies?: string[]; }
interface Connection { provider: string; status: string; label?: string | null; keyHint?: string | null; currency?: string; capabilities?: Capabilities; lastCheckedAt?: string | null; }
interface Device { id: string; externalReaderId: string; label?: string | null; status: string; locationId?: string | null; hasOwnKey?: boolean; keyHint?: string | null; }
interface Intent { id: string; status: string; amountCents: number; currency: string; error?: string | null; }

// Providers usable in Phase 1. Others are shown as "coming soon".
const PROVIDER_META: Record<string, { name: string; recommended?: boolean; help: { en: string; vi: string }; fields: string[]; connections?: { cloud?: string; usb?: string; bluetooth?: string }; countries?: string[] }> = {
  helcim: {
    name: 'Helcim',
    recommended: true,
    help: {
      en: 'Helcim Dashboard → Settings → Integrations → API Access → create an API token (allow Payments + Payments Hardware). ONE Helcim account covers both the Smart Terminal and online payments. Lumio registers nothing.',
      vi: 'Helcim Dashboard → Settings → Integrations → API Access → tạo API token (bật quyền Payments + Payments Hardware). MỘT tài khoản Helcim dùng được cho cả máy quẹt Smart Terminal lẫn thanh toán online. Lumio không đăng ký gì.',
    },
    fields: ['secret', 'currency'],
  },
  stripe: {
    name: 'Stripe (Terminal + cọc online)',
    help: {
      en: 'You need: (1) REQUIRED — a key: Stripe Dashboard → Developers → API keys → Create restricted key (allow Terminal, PaymentIntents, Checkout Sessions, Charges/Refunds) → paste the rk_live_… key (sk_live_… also works). The publishable key (pk_…) is NOT needed. (2) RECOMMENDED — webhook secret: Developers → Webhooks → Add endpoint with the address below, events checkout.session.completed and checkout.session.async_payment_succeeded (add payment_intent.* if you use card readers) → copy the Signing secret (whsec_…). The deposit then shows as paid the moment the customer pays, even if she closes the page; without it Lumio still checks with Stripe every couple of minutes. (3) ONLY for card readers / Tap to Pay — Location ID (tml_…). The same key takes card terminals AND online deposits (Stripe Checkout). Lumio registers nothing.',
      vi: 'Cần: (1) BẮT BUỘC — key: Stripe Dashboard → Developers → API keys → Create restricted key (cấp quyền Terminal, PaymentIntents, Checkout Sessions, Charges/Refunds) → dán key rk_live_… (sk_live_… cũng được). KHÔNG cần Publishable key (pk_…). (2) NÊN CÓ — webhook secret: Developers → Webhooks → Add endpoint với địa chỉ bên dưới, chọn sự kiện checkout.session.completed và checkout.session.async_payment_succeeded (thêm payment_intent.* nếu dùng máy quẹt) → copy Signing secret (whsec_…). Có nó, tiền cọc hiện “đã trả” ngay khi khách trả, kể cả khi khách đóng trang; không có thì Lumio vẫn tự hỏi Stripe vài phút một lần. (3) CHỈ khi dùng máy quẹt / Tap to Pay — Location ID (tml_…). Cùng một key dùng cho máy quẹt VÀ thu cọc online (Stripe Checkout). Lumio không đăng ký gì.',
    },
    fields: ['secret', 'currency', 'locationId', 'webhookSecret'],
  },
  dejavoo: {
    name: 'Dejavoo / iPOSpays (P1, QD series)',
    help: {
      en: 'In YOUR iPOSpays merchant portal: Settings → Generate Ecom/TOP Merchant Keys → pick your TPN → Generate Token. Paste the TPN and that token below. Ask your ISO to switch the terminal to SPIn (semi-integrated) mode. Lumio registers nothing and never holds your funds.',
      vi: 'Trong cổng iPOSpays CỦA TIỆM: Settings → Generate Ecom/TOP Merchant Keys → chọn TPN → Generate Token. Dán TPN và token đó vào đây. Nhờ ISO bật chế độ SPIn (semi-integrated) cho máy. Lumio không đăng ký gì và không giữ tiền của tiệm.',
    },
    fields: ['tpn', 'registerId', 'secret', 'currency', 'environment'],
  },
  paypal: {
    name: 'PayPal (cọc online)',
    help: {
      en: 'developer.paypal.com with the SALON\'S PayPal Business account → Apps & Credentials → Live → create an app → copy the Client ID and the Secret. Customers pay deposits with PayPal or a card as a guest; Lumio captures only after reading the order from PayPal. No card terminal.',
      vi: 'developer.paypal.com bằng tài khoản PayPal Business CỦA TIỆM → Apps & Credentials → Live → tạo app → copy Client ID và Secret. Khách trả cọc bằng PayPal hoặc thẻ (không cần tài khoản); Lumio chỉ thu khi đã đọc lệnh từ PayPal. Không dùng cho máy quẹt.',
    },
    fields: ['publicId', 'secret', 'currency', 'environment'],
  },
  clover: {
    name: 'Clover (cọc online)',
    help: {
      en: 'Clover Dashboard → Account & Setup → Ecommerce API Tokens → create a Hosted Checkout (private) token; Merchant ID is under Account & Setup → Merchants. Then Settings → Ecommerce → Hosted Checkout → Webhook: paste the webhook address below, generate the signing secret and paste it here (required — it is how Clover proves a deposit was paid). The Clover device at the counter is not driven from Lumio yet: ring card sales on it and pick CARD in Lumio.',
      vi: 'Clover Dashboard → Account & Setup → Ecommerce API Tokens → tạo token Hosted Checkout (private); Merchant ID ở Account & Setup → Merchants. Sau đó Settings → Ecommerce → Hosted Checkout → Webhook: dán địa chỉ webhook bên dưới, tạo signing secret rồi dán vào đây (bắt buộc — Clover dùng nó để xác nhận khách đã trả cọc). Máy Clover tại quầy chưa điều khiển từ Lumio: bán trên máy rồi chọn CARD trong Lumio.',
    },
    fields: ['publicId', 'secret', 'currency', 'environment', 'webhookSecret'],
  },
  mock: {
    name: 'Mock (sandbox test)',
    help: { en: 'For testing only. Use any key that starts with "mock_".', vi: 'Chỉ để test. Dùng key bất kỳ bắt đầu bằng "mock_".' },
    fields: ['secret'],
  },
  square: {
    name: 'Square Terminal',
    help: {
      en: 'developer.squareup.com (YOUR Square account) → create an application → Production Access Token + Location ID. Paste both. No OAuth — Lumio registers nothing.',
      vi: 'developer.squareup.com (tài khoản Square của TIỆM) → tạo application → Production Access Token + Location ID. Dán cả hai. Không OAuth — Lumio không đăng ký gì.',
    },
    fields: ['secret', 'currency', 'locationId'],
  },
  adyen: {
    name: 'Adyen',
    help: {
      en: 'Adyen Customer Area → Developers → API credentials → generate an API key with the "Cloud Device API" role. Enter it below with your merchant account and pick the environment. Add each terminal by its POI/device id.',
      vi: 'Adyen Customer Area → Developers → API credentials → tạo API key có quyền "Cloud Device API". Nhập key + merchant account và chọn môi trường. Thêm từng máy bằng POI/device id.',
    },
    fields: ['secret', 'currency', 'locationId', 'region'],
  },
  sumup: {
    name: 'SumUp',
    help: {
      en: 'SumUp Dashboard → Developers → create an API key. Paste it, then pair your Solo reader with its pairing code below.',
      vi: 'SumUp Dashboard → Developers → tạo API key. Dán vào, rồi ghép Solo reader bằng pairing code ở dưới.',
    },
    fields: ['secret', 'currency'],
  },
};
const COMING_SOON: Array<{ id: string; name: string; phase: string }> = [];

/**
 * Phase 1 ships Cloud only. USB and Bluetooth exist in the codebase but are
 * deliberately kept out of the salon UI until they pass end-to-end testing —
 * showing a half-finished payment path to a salon is worse than not showing it.
 * Flip NEXT_PUBLIC_TERMINAL_USB_ENABLED to 'true' to reveal them for internal QA.
 */
const SHOW_USB_BT = process.env.NEXT_PUBLIC_TERMINAL_USB_ENABLED === 'true';
const CONNECTION_TYPES: Array<'cloud' | 'usb' | 'bluetooth'> = SHOW_USB_BT
  ? ['cloud', 'usb', 'bluetooth']
  : ['cloud'];

const box: React.CSSProperties = { border: '1px solid var(--c334155)', borderRadius: 12, padding: 16, marginTop: 14, background: 'var(--c0f172a)' };
const label: React.CSSProperties = { display: 'block', fontSize: 12, color: 'var(--c94a3b8)', margin: '10px 0 4px' };
const input: React.CSSProperties = { width: '100%', padding: '9px 11px', borderRadius: 8, border: '1px solid var(--c334155)', background: 'var(--c1e293b)', color: 'var(--ce2e8f0)', fontSize: 14, boxSizing: 'border-box' };

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
    ? { title: 'Máy quẹt thẻ (POS)', sub: 'Kết nối tài khoản thanh toán của chính tiệm — Lumio chỉ tích hợp, không giữ tiền.', choose: 'Chọn nhà cung cấp', connect: 'Kết nối', connected: 'Đã kết nối', test: 'Kiểm tra kết nối', disconnect: 'Ngắt kết nối', readers: 'Máy quẹt (reader)', addReader: 'Thêm máy quẹt', refresh: 'Làm mới', code: 'Mã ghép (pairing/registration code)', readerLabel: 'Tên gợi nhớ', currency: 'Tiền tệ', secret: 'API key (secret)', webhook: 'Webhook secret (tuỳ chọn)', location: 'Location ID (tuỳ chọn)', disabled: 'Tính năng chưa được bật. Quản trị nền tảng cần đặt PAYMENTS_HUB_ENABLED=true.', noEnc: '⚠ Chưa cấu hình PAYMENT_ENC_KEY — không thể lưu key an toàn.', testCharge: 'Thử một giao dịch', amount: 'Số tiền (cents)', run: 'Chạy thử', comingSoon: 'Sắp có', howTo: 'Lấy key ở đâu', country: 'Quốc gia', connType: 'Kiểu kết nối', cloud: 'Cloud/WiFi', usb: 'USB', bluetooth: 'Bluetooth', comingSoonNote: 'Kiểu kết nối này sắp có.', needAgent: 'cần ghép thiết bị', needAgentTip: 'Tạo mã ghép ở mục "Thiết bị cầu nối" bên dưới', region: 'Môi trường', regionTest: 'Test (sandbox)', regionUs: 'Live — US', regionEu: 'Live — EU/khác', manualNote: 'Tiệm dùng máy quẹt khác? Vẫn bán bình thường — chọn CARD ở POS rồi quẹt trên máy của tiệm; hệ thống vẫn ghi doanh thu, tip và lương thợ.', agentNote: 'Máy quẹt sẽ tự xuất hiện sau khi Bridge/Companion kết nối. Vẫn cần nhập API key nhà cung cấp bên dưới.', tpn: 'TPN (Terminal Profile Number)', registerId: 'Register ID (tuỳ chọn)', authKey: 'Auth Key', environment: 'Môi trường', envProd: 'Production (máy thật)', envSandbox: 'Sandbox (test)', readerLocation: 'Cơ sở (tuỳ chọn)', readerKey: 'Auth Key riêng của máy này', ownKey: 'key riêng', terminalOnline: 'Máy đang online ✓', terminalOffline: 'Máy không phản hồi — kiểm tra dây mạng và biểu tượng mũi tên trên máy', tipInAmount: 'Số tiền gửi sang máy đã bao gồm tip', tipInAmountHelp: 'Cứ để nguyên như vậy. Chỉ bỏ tick nếu bán thử có tip mà máy hiện SỐ TIỀN CAO HƠN thực tế đúng bằng tiền tip — khi đó bỏ tick rồi Kết nối lại là hết.' }
    : { title: 'Card terminals (POS)', sub: "Connect the salon's own payment account — Lumio only integrates, never holds funds.", choose: 'Choose a provider', connect: 'Connect', connected: 'Connected', test: 'Test connection', disconnect: 'Disconnect', readers: 'Card readers', addReader: 'Add card reader', refresh: 'Refresh', code: 'Pairing / registration code', readerLabel: 'Friendly label', currency: 'Currency', secret: 'API key (secret)', webhook: 'Webhook secret (optional)', location: 'Location ID (optional)', disabled: 'Feature not enabled yet. A platform admin must set PAYMENTS_HUB_ENABLED=true.', noEnc: '⚠ PAYMENT_ENC_KEY not configured — cannot store keys securely.', testCharge: 'Run a test charge', amount: 'Amount (cents)', run: 'Run test', comingSoon: 'Coming soon', howTo: 'Where to get your key', country: 'Country', connType: 'Connection type', cloud: 'Cloud/WiFi', usb: 'USB', bluetooth: 'Bluetooth', comingSoonNote: 'This connection type is coming soon.', needAgent: 'pair a device', needAgentTip: 'Create a pairing code in "Devices & Agents" below', region: 'Environment', regionTest: 'Test (sandbox)', regionUs: 'Live — US', regionEu: 'Live — EU/other', manualNote: "Using a terminal Lumio can't drive yet? You can still sell — pick CARD at the POS and run it on your own terminal; revenue, tips and payroll are still recorded.", agentNote: 'Readers appear automatically once the Bridge/Companion connects. You still need the provider API key below.', tpn: 'TPN (Terminal Profile Number)', registerId: 'Register ID (optional)', authKey: 'Auth Key', environment: 'Environment', envProd: 'Production (live terminal)', envSandbox: 'Sandbox (test)', readerLocation: 'Location (optional)', readerKey: "This terminal's own Auth Key", ownKey: 'own key', terminalOnline: 'Terminal is online ✓', terminalOffline: 'No response — check the network cable and the arrow icon on the terminal', tipInAmount: 'The amount sent to the terminal already includes the tip', tipInAmountHelp: 'Leave this on. Only turn it off if a tipped test sale shows an amount on the terminal that is too high by exactly the tip — untick it and reconnect.' };

  const [status, setStatus] = useState<HubStatus | null>(null);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  // connect form
  const [provider, setProvider] = useState('helcim');
  const [secret, setSecret] = useState('');
  const [webhookSecret, setWebhookSecret] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [locationId, setLocationId] = useState('');
  const [country, setCountry] = useState('US');
  const [region, setRegion] = useState('test');
  const [tpn, setTpn] = useState('');
  const [registerId, setRegisterId] = useState('');
  const [publicId, setPublicId] = useState('');
  const [environment, setEnvironment] = useState<'sandbox' | 'production'>('production');
  const [amountIncludesTip, setAmountIncludesTip] = useState(true);
  const [connType, setConnType] = useState<'cloud' | 'usb' | 'bluetooth'>('cloud');
  const [agents, setAgents] = useState<Array<{ kind: string; paired: boolean; status: string }>>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true); setError(null);
    try {
      const [st, cons, ags] = await Promise.all([
        apiFetch<HubStatus>('/payments-hub/status', { token }),
        apiFetch<Connection[]>('/payments-hub/connections', { token }).catch(() => []),
        apiFetch<Array<{ kind: string; paired: boolean; status: string }>>('/payments-hub/agents', { token }).catch(() => []),
      ]);
      setStatus(st); setConnections(cons); setAgents(ags);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally { setLoading(false); }
  }, [token]);
  useEffect(() => { load(); }, [load]);

  async function doConnect() {
    setBusy(true); setError(null); setMsg(null);
    try {
      await apiFetch('/payments-hub/connect', { method: 'POST', token, body: {
        provider,
        secret: secret.trim(),
        webhookSecret: webhookSecret.trim() || undefined,
        currency,
        locationId: locationId.trim() || undefined,
        region,
        tpn: tpn.trim() || undefined,
        registerId: registerId.trim() || undefined,
        publicId: PROVIDER_META[provider]?.fields.includes('publicId') ? publicId.trim() || undefined : undefined,
        environment: PROVIDER_META[provider]?.fields.includes('environment') ? environment : undefined,
        amountIncludesTip: provider === 'dejavoo' ? amountIncludesTip : undefined,
      } });
      setSecret(''); setWebhookSecret('');
      setMsg(vi ? 'Đã kết nối — Lumio đã kiểm tra key trực tiếp với nhà cung cấp ✓. Bấm “Kiểm tra kết nối” bất cứ lúc nào để thử lại.' : 'Connected — Lumio checked the key with the provider ✓. Press “Test connection” any time to check again.');
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

  if (loading) return <section><h1 style={{ fontSize: 24 }}>{L.title}</h1><p style={{ color: 'var(--c94a3b8)' }}>…</p></section>;

  // USB / Bluetooth become selectable once a Bridge / Companion is actually paired.
  const usbOk = agents.some((a) => a.kind === 'BRIDGE' && a.paired);
  const btOk = agents.some((a) => a.kind === 'COMPANION' && a.paired);
  const meta = PROVIDER_META[provider];
  // The same check the server runs (payments-hub/key-format.ts), shown as you type.
  const keyHint = (() => {
    const k = secret.trim(), w = webhookSecret.trim();
    if (!k && !w) return null;
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(k)) return vi ? 'Ô này đang chứa một email — có thể trình duyệt tự điền. Xoá đi rồi dán key.' : 'This holds an email — your browser may have filled it in. Clear it and paste the key.';
    if (provider !== 'stripe') return null;
    if (/^pk_(live|test)_/.test(k)) return vi ? 'Đây là Publishable key (pk_…) — Lumio không cần. Dán Restricted key (rk_live_…) hoặc Secret key (sk_live_…).' : 'That is the publishable key (pk_…) — not needed. Paste a restricted key (rk_live_…) or the secret key (sk_live_…).';
    if (k && !/^(sk|rk)_(live|test)_[A-Za-z0-9]+$/.test(k)) return vi ? 'Key Stripe bắt đầu bằng rk_live_ hoặc sk_live_ (rk_test_ / sk_test_ để thử).' : 'A Stripe key starts with rk_live_ or sk_live_ (rk_test_ / sk_test_ to try).';
    if (w && !/^whsec_[A-Za-z0-9]+$/.test(w)) return vi ? 'Webhook secret bắt đầu bằng whsec_.' : 'A webhook secret starts with whsec_.';
    return null;
  })();
  const activeProviders = (status?.providers ?? []).filter((p) => PROVIDER_META[p]);

  return (
    <section>
      <h1 style={{ fontSize: 24, margin: '0 0 4px' }}>{L.title}</h1>
      <p style={{ color: 'var(--c94a3b8)', marginTop: 0, fontSize: 14 }}>{L.sub}</p>
      <p style={{ color: 'var(--c64748b)', fontSize: 12.5, marginTop: 6, lineHeight: 1.5, maxWidth: 760 }}>{L.manualNote}</p>

      {error && <div style={ui.banner}>{error}</div>}
      {msg && <div style={{ ...ui.banner, borderColor: '#22c55e', color: 'var(--c86efac)' }}>{msg}</div>}
      {status && !status.enabled && <div style={ui.banner}>{L.disabled}</div>}
      {status && status.enabled && !status.encryption && <div style={ui.banner}>{L.noEnc}</div>}

      {/* Existing connections */}
      {connections.filter((c) => c.status === 'ACTIVE').map((c) => (
        <div key={c.provider} style={box}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <div>
              <strong style={{ fontSize: 16 }}>{PROVIDER_META[c.provider]?.name ?? c.provider}</strong>
              <span style={{ marginLeft: 10, fontSize: 12, color: 'var(--ink-good)', fontWeight: 600 }}>● {L.connected}</span>
              <div style={{ color: 'var(--c94a3b8)', fontSize: 13, marginTop: 4 }}>
                {L.secret}: {c.keyHint ?? '—'} · {c.currency}
                {c.capabilities?.interac ? ' · Interac' : ''}{c.capabilities?.tapToPay ? ' · Tap to Pay' : ''}{c.capabilities?.online ? (vi ? ' · Thu cọc online' : ' · Online deposits') : ''}{c.capabilities?.terminal === false ? (vi ? ' · Không dùng máy quẹt' : ' · No terminal') : ''}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => doTest(c.provider)} style={ui.primaryBtn}>{L.test}</button>
              <button onClick={() => doDisconnect(c.provider)} style={ui.dangerBtn}>{L.disconnect}</button>
            </div>
          </div>
          {c.capabilities?.terminal !== false && <Readers provider={c.provider} token={token} L={L} />}
          {c.capabilities?.terminal !== false && <TestCharge provider={c.provider} token={token} L={L} vi={vi} />}
          {/* Connected, but the key cannot drive readers: say why the reader section is missing and how to get it. */}
          {c.capabilities?.terminal === false && !ONLINE_ONLY.includes(c.provider) && (
            <div style={{ marginTop: 12, background: 'var(--wash-amber)', border: '1px solid var(--line)', borderRadius: 8, padding: '10px 12px', fontSize: 13, lineHeight: 1.55, color: 'var(--ce2e8f0)' }}>
              <strong style={{ color: 'var(--ink-warn)' }}>{vi ? 'Chưa thêm được máy quẹt' : 'Card readers not available yet'}</strong>
              <div>{vi
                ? 'Key đang dùng chỉ thu được tiền online, chưa có quyền Terminal. Vào Stripe → Developers → API keys → tạo lại Restricted key có bật quyền Terminal (Write) → dán vào ô "API key" bên dưới → Kết nối lại. Mục "Máy quẹt (reader)" sẽ hiện ngay trong khung này.'
                : 'This key can take online payments but has no Terminal permission. In Stripe → Developers → API keys, create a restricted key with Terminal (Write) → paste it in "API key" below → Connect again. The "Card readers" section then appears right here.'}</div>
            </div>
          )}
        </div>
      ))}
      {/* Not connected yet: the readers live inside the provider's box once it is connected. */}
      {!connections.some((c) => c.status === 'ACTIVE' && !ONLINE_ONLY.includes(c.provider)) && status?.enabled && (
        <div style={{ ...box, background: 'var(--c1e293b)', fontSize: 13, lineHeight: 1.55, color: 'var(--ccbd5e1)' }}>
          {vi
            ? '① Chọn nhà cung cấp, dán key và bấm Kết nối ở bên dưới. ② Kết nối xong, khung của nhà cung cấp hiện ở đây với mục "Máy quẹt (reader)" và nút "Thêm máy quẹt" để nhập mã ghép hiện trên máy.'
            : '① Pick a provider, paste the key and press Connect below. ② Once connected, its box appears here with a "Card readers" section and an "Add card reader" button for the pairing code shown on the reader.'}
        </div>
      )}

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
            <label style={label}>{L.country}</label>
            <select style={input} value={country} onChange={(e) => setCountry(e.target.value)}>
              <option value="US">United States</option>
              <option value="CA">Canada</option>
            </select>
            <label style={label}>{L.connType}</label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
              {CONNECTION_TYPES.map((ct) => {
                const on = ct === 'cloud' ? true : ct === 'usb' ? usbOk : btOk;
                return (
                  <button key={ct} onClick={() => on && setConnType(ct)} disabled={!on} title={on ? '' : L.needAgentTip}
                    style={{ ...(connType === ct && on ? ui.primaryBtn : ghost), opacity: on ? 1 : 0.5, fontSize: 13 }}>
                    {L[ct]}{on ? '' : ' · ' + L.needAgent}
                  </button>
                );
              })}
            </div>
            {connType !== 'cloud' && (
              <p style={{ color: 'var(--ca5b4fc)', fontSize: 12, background: 'var(--c1e293b)', padding: 10, borderRadius: 8, margin: '8px 0 0' }}>{L.agentNote}</p>
            )}
            {(
              <>
                <p style={{ fontSize: 12, color: 'var(--ca5b4fc)', background: 'var(--c1e293b)', padding: 10, borderRadius: 8, lineHeight: 1.5 }}>
                  <strong>{L.howTo}:</strong> {vi ? meta.help.vi : meta.help.en}
                </p>
                {meta.fields.includes('tpn') && (
                  <>
                    <label style={label}>{L.tpn}</label>
                    <input style={input} value={tpn} onChange={(e) => setTpn(e.target.value)} placeholder="Z11XXXXXXXXX" autoComplete="off" />
                  </>
                )}
                {meta.fields.includes('registerId') && (
                  <>
                    <label style={label}>{L.registerId}</label>
                    <input style={input} value={registerId} onChange={(e) => setRegisterId(e.target.value)} placeholder={vi ? 'Bỏ trống nếu đã có TPN' : 'Leave blank if you have a TPN'} autoComplete="off" />
                  </>
                )}
                {meta.fields.includes('publicId') && (
                  <>
                    <label style={label}>{provider === 'clover' ? 'Merchant ID' : 'Client ID'}</label>
                    <input style={input} value={publicId} onChange={(e) => setPublicId(e.target.value)} placeholder={provider === 'clover' ? 'e.g. 8PMHXXXXXXXX' : 'A…'} autoComplete="off" />
                  </>
                )}
                {(provider === 'clover' || provider === 'stripe') && status?.webhookBase && (
                  <p style={{ fontSize: 12, color: 'var(--c94a3b8)', margin: '10px 0 0', lineHeight: 1.5, wordBreak: 'break-all' }}>
                    Webhook: <code style={{ color: 'var(--ce2e8f0)' }}>{status.webhookBase.replace('{provider}', provider)}</code>
                  </p>
                )}
                <label style={label}>{provider === 'dejavoo' ? L.authKey : provider === 'clover' ? (vi ? 'Ecommerce private token' : 'Ecommerce private token') : provider === 'paypal' ? 'Secret' : L.secret}</label>
                {/* new-password + a non-login name: a browser's password manager must never fill the owner's login in here. */}
                <input style={input} type="password" name={`${provider}-api-key`} value={secret} onChange={(e) => setSecret(e.target.value)} placeholder={provider === 'stripe' ? 'rk_live_…' : provider === 'mock' ? 'mock_test' : provider === 'helcim' ? 'Helcim API token' : provider === 'dejavoo' ? (vi ? 'Token 10 ký tự từ iPOSpays' : '10-character token from iPOSpays') : ''} autoComplete="new-password" data-1p-ignore="true" data-lpignore="true" spellCheck={false} />
                {keyHint && <div style={{ fontSize: 12.5, color: 'var(--ink-warn)', marginTop: 6, lineHeight: 1.5 }}>{keyHint}</div>}
                {meta.fields.includes('currency') && (
                  <>
                    <label style={label}>{L.currency}</label>
                    <select style={input} value={currency} onChange={(e) => setCurrency(e.target.value)}>
                      <option value="USD">USD</option>
                      <option value="CAD">CAD (Interac)</option>
                    </select>
                  </>
                )}
                {meta.fields.includes('locationId') && (<><label style={label}>{L.location}</label><input style={input} name={`${provider}-location`} value={locationId} onChange={(e) => setLocationId(e.target.value)} placeholder="tml_… / loc_…" autoComplete="off" data-1p-ignore="true" data-lpignore="true" spellCheck={false} /></>)}
                {meta.fields.includes('region') && (
                  <>
                    <label style={label}>{L.region}</label>
                    <select style={input} value={region} onChange={(ev) => setRegion(ev.target.value)}>
                      <option value="test">{L.regionTest}</option>
                      <option value="live-us">{L.regionUs}</option>
                      <option value="live-eu">{L.regionEu}</option>
                    </select>
                  </>
                )}
                {meta.fields.includes('environment') && (
                  <>
                    <label style={label}>{L.environment}</label>
                    <select style={input} value={environment} onChange={(e) => setEnvironment(e.target.value as 'sandbox' | 'production')}>
                      <option value="production">{L.envProd}</option>
                      <option value="sandbox">{L.envSandbox}</option>
                    </select>
                  </>
                )}
                {provider === 'dejavoo' && (
                  <div style={{ marginTop: 12, background: 'var(--c1e293b)', border: '1px solid var(--c334155)', borderRadius: 8, padding: 11 }}>
                    <label style={{ display: 'flex', gap: 9, alignItems: 'flex-start', cursor: 'pointer' }}>
                      <input type="checkbox" checked={amountIncludesTip} onChange={(e) => setAmountIncludesTip(e.target.checked)} style={{ marginTop: 3 }} />
                      <span>
                        <span style={{ color: 'var(--ce2e8f0)', fontSize: 13, fontWeight: 600 }}>{L.tipInAmount}</span>
                        <span style={{ display: 'block', color: 'var(--c94a3b8)', fontSize: 11.5, lineHeight: 1.5, marginTop: 3 }}>{L.tipInAmountHelp}</span>
                      </span>
                    </label>
                  </div>
                )}
                {meta.fields.includes('webhookSecret') && (<><label style={label}>{L.webhook}</label><input style={input} type="password" name={`${provider}-webhook-secret`} value={webhookSecret} onChange={(e) => setWebhookSecret(e.target.value)} placeholder="whsec_…" autoComplete="new-password" data-1p-ignore="true" data-lpignore="true" spellCheck={false} /></>)}
                <div style={{ marginTop: 14 }}>
                  <button onClick={doConnect} disabled={busy || !secret.trim() || !!keyHint || !status?.enabled} style={{ ...ui.primaryBtn, opacity: busy || !secret.trim() || !!keyHint || !status?.enabled ? 0.6 : 1 }}>
                    {busy ? '…' : L.connect}
                  </button>
                </div>
              </>
            )}
          </>
        )}
      </div>
      <TerminalRequestCard token={token} vi={vi} />
      {status?.enabled && <AgentsSection token={token} vi={vi} />}
    </section>
  );
}

/** Providers that only take money online (no card reader to add). */
const ONLINE_ONLY = ['paypal', 'clover'];

const ghost: React.CSSProperties = { padding: '9px 14px', borderRadius: 8, border: '1px solid var(--c334155)', background: 'transparent', color: 'var(--ce2e8f0)', fontSize: 14, cursor: 'pointer' };

function Readers({ provider, token, L }: { provider: string; token: string | null; L: any }) {
  const [readers, setReaders] = useState<Device[]>([]);
  const [code, setCode] = useState('');
  const [rlabel, setRLabel] = useState('');
  const [rlocation, setRLocation] = useState('');
  const [rkey, setRKey] = useState('');
  const [testing, setTesting] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!token) return;
    try { setReaders(await apiFetch<Device[]>(`/payments-hub/readers/${provider}`, { token })); } catch (e) { setErr(e instanceof Error ? e.message : 'error'); }
  }, [provider, token]);
  useEffect(() => { load(); }, [load]);
  async function add() {
    setErr(null);
    try {
      await apiFetch(`/payments-hub/readers/${provider}`, { method: 'POST', token, body: {
        code: code.trim(),
        label: rlabel.trim() || undefined,
        locationId: rlocation.trim() || undefined,
        // Each iPOSpays TPN has its own Auth Key, so a second location usually
        // needs its own. Blank = reuse the account-level key.
        authKey: rkey.trim() || undefined,
      } });
      setCode(''); setRLabel(''); setRLocation(''); setRKey(''); await load();
    }
    catch (e) { setErr(e instanceof Error ? e.message : 'error'); }
  }
  async function testOne(id: string) {
    setErr(null); setNote(null); setTesting(id);
    try {
      const r = await apiFetch<{ ok: boolean; message?: string }>(`/payments-hub/readers/test/${id}`, { method: 'POST', token });
      setNote(r.ok ? L.terminalOnline : `${L.terminalOffline}${r.message ? ' — ' + r.message : ''}`);
      await load();
    } catch (e) { setErr(e instanceof Error ? e.message : 'error'); }
    finally { setTesting(null); }
  }
  return (
    <div style={{ marginTop: 14, borderTop: '1px solid var(--c334155)', paddingTop: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <strong style={{ fontSize: 13, color: 'var(--ccbd5e1)' }}>{L.readers}</strong>
        <button onClick={load} style={{ ...ghost, padding: '5px 10px', fontSize: 12 }}>{L.refresh}</button>
      </div>
      {err && <div style={{ color: 'var(--cfca5a5)', fontSize: 12, marginTop: 6 }}>{err}</div>}
      {note && <div style={{ color: 'var(--c86efac)', fontSize: 12, marginTop: 6 }}>{note}</div>}
      {readers.length === 0 ? <p style={{ color: 'var(--c64748b)', fontSize: 13 }}>—</p> : (
        <ul style={{ listStyle: 'none', padding: 0, margin: '8px 0' }}>
          {readers.map((r) => (
            <li key={r.id} style={{ fontSize: 13, color: 'var(--ce2e8f0)', padding: '5px 0', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ color: r.status === 'ONLINE' ? 'var(--ink-good)' : 'var(--c94a3b8)' }}>●</span>
              <span>{r.label || r.externalReaderId}</span>
              <span style={{ color: 'var(--c64748b)' }}>({r.status})</span>
              {r.locationId && <span style={{ color: 'var(--ca5b4fc)', fontSize: 11 }}>· {r.locationId}</span>}
              {r.hasOwnKey && <span style={{ color: 'var(--c64748b)', fontSize: 11 }}>· {L.ownKey}{r.keyHint ? ' ' + r.keyHint : ''}</span>}
              <button onClick={() => testOne(r.id)} disabled={testing === r.id} style={{ ...ghost, padding: '3px 9px', fontSize: 11 }}>
                {testing === r.id ? '…' : L.test}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
        <input style={{ ...input, width: 200 }} value={code} onChange={(e) => setCode(e.target.value)} placeholder={provider === 'dejavoo' ? 'TPN' : L.code} />
        <input style={{ ...input, width: 150 }} value={rlabel} onChange={(e) => setRLabel(e.target.value)} placeholder={L.readerLabel} />
        <input style={{ ...input, width: 150 }} value={rlocation} onChange={(e) => setRLocation(e.target.value)} placeholder={L.readerLocation} />
        {provider === 'dejavoo' && (
          <input style={{ ...input, width: 190 }} type="password" value={rkey} onChange={(e) => setRKey(e.target.value)} placeholder={L.readerKey} autoComplete="off" />
        )}
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
    <div style={{ marginTop: 12, borderTop: '1px dashed var(--c334155)', paddingTop: 12 }}>
      <strong style={{ fontSize: 13, color: 'var(--ccbd5e1)' }}>{L.testCharge}</strong>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
        <input style={{ ...input, width: 130 }} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={L.amount} />
        <button onClick={run} disabled={busy} style={{ ...ui.primaryBtn, opacity: busy ? 0.6 : 1 }}>{busy ? '…' : L.run}</button>
        {result && <span style={{ fontSize: 13, color: result.startsWith('SUCCEEDED') ? 'var(--c86efac)' : 'var(--cfca5a5)' }}>{result}</span>}
      </div>
    </div>
  );
}

function AgentsSection({ token, vi }: { token: string | null; vi: boolean }) {
  const [agents, setAgents] = useState<Array<{ id: string; kind: string; label?: string | null; status: string }>>([]);
  const [pairCode, setPairCode] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!token) return;
    try { setAgents(await apiFetch('/payments-hub/agents', { token })); } catch (e) { setErr(e instanceof Error ? e.message : 'error'); }
  }, [token]);
  useEffect(() => { load(); }, [load]);
  async function add(kind: string) {
    setErr(null); setPairCode(null);
    try { const a = await apiFetch<{ pairingCode: string }>('/payments-hub/agents', { method: 'POST', token, body: { kind } }); setPairCode(a.pairingCode); await load(); }
    catch (e) { setErr(e instanceof Error ? e.message : 'error'); }
  }
  async function unpair(id: string) {
    try { await apiFetch(`/payments-hub/agents/${id}`, { method: 'DELETE', token }); await load(); } catch { /* ignore */ }
  }
  return (
    <div style={box}>
      <strong style={{ fontSize: 15 }}>{vi ? 'Thiết bị cầu nối (Bridge / Companion)' : 'Devices & Agents (Bridge / Companion)'}</strong>
      <p style={{ color: 'var(--c94a3b8)', fontSize: 12, marginTop: 4 }}>{vi ? 'Cho máy quẹt USB (Windows Bridge) hoặc Bluetooth (mobile Companion). Tạo mã ghép rồi nhập vào ứng dụng.' : 'For USB (Windows Bridge) or Bluetooth (mobile Companion) readers. Create a code and enter it in the app.'}</p>
      {err && <div style={{ color: 'var(--cfca5a5)', fontSize: 12 }}>{err}</div>}
      {pairCode && (
        <div style={{ background: 'var(--c052e16)', border: '1px solid #22c55e', borderRadius: 8, padding: 12, margin: '8px 0' }}>
          <div style={{ color: 'var(--c86efac)', fontSize: 13 }}>{vi ? 'Nhập mã này vào Bridge/Companion (hết hạn 15 phút):' : 'Enter this code in the Bridge/Companion (expires in 15 min):'}</div>
          <div style={{ color: 'var(--cf8fafc)', fontSize: 24, letterSpacing: 4, fontWeight: 600, marginTop: 6 }}>{pairCode}</div>
        </div>
      )}
      <ul style={{ listStyle: 'none', padding: 0, margin: '8px 0' }}>
        {agents.map((a) => (
          <li key={a.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13, color: 'var(--ce2e8f0)', padding: '6px 0' }}>
            <span><span style={{ color: a.status === 'ONLINE' ? 'var(--ink-good)' : 'var(--c94a3b8)' }}>●</span> {a.kind}{a.label ? ' · ' + a.label : ''} <span style={{ color: 'var(--c64748b)' }}>({a.status})</span></span>
            <button onClick={() => unpair(a.id)} style={{ ...ghost, padding: '4px 10px', fontSize: 12 }}>{vi ? 'Gỡ' : 'Unpair'}</button>
          </li>
        ))}
        {agents.length === 0 && <li style={{ color: 'var(--c64748b)', fontSize: 13 }}>—</li>}
      </ul>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button onClick={() => add('COMPANION')} style={ghost}>+ Companion (Bluetooth)</button>
        <button onClick={() => add('BRIDGE')} style={ghost}>+ Bridge (USB)</button>
      </div>
    </div>
  );
}
