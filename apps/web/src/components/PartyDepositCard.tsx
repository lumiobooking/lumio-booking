'use client';

/**
 * ĐẶT CỌC BÀN ĐÔNG — per-guest deposit for big parties (API: /settings/party-deposit).
 * A reservation has no price, so the salon deposit (a % of the price) is 0 for
 * a table; this asks N × amount from a party size up, through the same
 * deposit flow. Shown to restaurants, cafés and eateries.
 */
import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useLang } from '../lib/i18n';
import { ui } from '../lib/ui';

interface P { enabled: boolean; fromParty: number; perPersonCents: number }

export function PartyDepositCard() {
  const { token } = useAuth();
  const { lang } = useLang();
  const vi = lang === 'vi';
  const [p, setP] = useState<P | null>(null);
  const [amount, setAmount] = useState('10.00');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token) return;
    apiFetch<P>('/settings/party-deposit', { token })
      .then((r) => { setP(r); setAmount(((r.perPersonCents ?? 0) / 100).toFixed(2)); })
      .catch(() => setP(null));
  }, [token]);

  async function save() {
    if (!p || busy) return;
    setBusy(true); setMsg(null);
    try {
      const r = await apiFetch<P>('/settings/party-deposit', { method: 'PATCH', token, body: { ...p, perPersonCents: Math.max(0, Math.round((parseFloat(amount) || 0) * 100)) } });
      setP(r); setAmount((r.perPersonCents / 100).toFixed(2)); setMsg(vi ? 'Đã lưu' : 'Saved');
    } catch (e) { setMsg(e instanceof Error ? e.message : 'Failed'); }
    finally { setBusy(false); }
  }

  if (!p) return null;
  return (
    <div style={{ ...ui.card, marginTop: 16 }}>
      <h3 style={{ margin: '0 0 4px', fontSize: 16 }}>{vi ? 'Đặt cọc bàn đông người' : 'Deposit for large parties'}</h3>
      <p style={{ margin: '0 0 12px', color: 'var(--c94a3b8)', fontSize: 13 }}>
        {vi ? 'Đặt bàn không có giá nên đặt cọc theo % luôn bằng 0. Mục này thu cọc theo đầu người khi nhóm từ N khách trở lên — giữ lại nếu khách không đến, hoàn khi khách huỷ đúng hạn, trừ vào hoá đơn khi khách dùng bữa.'
          : 'A reservation has no price, so a % deposit is always 0. This asks a per-guest deposit from N guests up — kept on a no-show, refunded on a timely cancel, credited to the bill.'}
      </p>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14, cursor: 'pointer', marginBottom: 12 }}>
        <input type="checkbox" checked={p.enabled} onChange={(e) => setP({ ...p, enabled: e.target.checked })} />
        {vi ? 'Bật đặt cọc cho bàn đông' : 'Ask a deposit from large parties'}
      </label>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, opacity: p.enabled ? 1 : 0.55 }}>
        <label><span style={ui.label}>{vi ? 'Từ số khách' : 'From party size'}</span>
          <input style={ui.input} type="number" min={2} max={100} value={p.fromParty} onChange={(e) => setP({ ...p, fromParty: Math.max(2, parseInt(e.target.value, 10) || 2) })} /></label>
        <label><span style={ui.label}>{vi ? 'Tiền cọc mỗi khách' : 'Deposit per guest'}</span>
          <input style={ui.input} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
      </div>
      <p style={{ color: 'var(--c64748b)', fontSize: 12, marginTop: 8, lineHeight: 1.55 }}>
        {vi ? `Ví dụ: nhóm ${p.fromParty} khách cọc ${(p.fromParty * (parseFloat(amount) || 0)).toFixed(2)}. Cần kết nối cổng thanh toán online để khách trả cọc khi đặt.`
          : `Example: a party of ${p.fromParty} pays ${(p.fromParty * (parseFloat(amount) || 0)).toFixed(2)}. Needs an online payment provider connected for guests to pay when booking.`}
      </p>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 12 }}>
        <button style={ui.primaryBtn} onClick={save} disabled={busy}>{vi ? 'Lưu' : 'Save'}</button>
        {msg && <span style={{ fontSize: 13, color: 'var(--c94a3b8)' }}>{msg}</span>}
      </div>
    </div>
  );
}
