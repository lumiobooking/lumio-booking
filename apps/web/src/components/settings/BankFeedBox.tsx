'use client';

/**
 * Tự xác nhận tiền chuyển khoản (SePay / Casso) — one box, shown on the
 * restaurant till's settings AND in Settings › Payments for every Vietnamese
 * shop (19/11/2026): the same feed reports bill codes (LM57) to the till and
 * chat deposit codes (LB482913) to the Inbox. The secret is shown once; only
 * its hash is kept. Calls are the signed-in shop's own (/restaurant/bank-feed,
 * owner only).
 */
import { useEffect, useState, type CSSProperties } from 'react';
import { apiFetch } from '../../lib/api';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8005/api';
const C = { panel: 'var(--c0f172a)', raised: 'var(--c1e293b)', border: 'var(--c334155)', text: 'var(--ce2e8f0)', muted: 'var(--c94a3b8)' };
const btn: CSSProperties = { minHeight: 44, padding: '0 14px', borderRadius: 12, border: `1px solid ${C.border}`, background: C.panel, color: C.text, fontWeight: 700, fontSize: 14, cursor: 'pointer', fontFamily: 'inherit' };
const field: CSSProperties = { minHeight: 46, borderRadius: 12, border: `1px solid ${C.border}`, padding: '0 12px', background: C.panel, color: C.text, fontSize: 15, fontFamily: 'inherit' };
const chip = (on: boolean): CSSProperties => (on
  ? { minHeight: 40, padding: '0 14px', borderRadius: 999, border: 'none', background: '#4f46e5', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }
  : { minHeight: 40, padding: '0 14px', borderRadius: 999, border: `1px solid ${C.border}`, background: C.panel, color: C.text, fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' });

interface BankFeed { configured: boolean; provider: string | null; hookId: string | null; lastAt: string | null }

/**
 * Bank feed: SePay or Casso tell us when money lands on the restaurant's
 * account; a transfer carrying the bill code shows up on that bill. The secret
 * is shown once, here, and only its hash is kept on the server.
 */
export function BankFeedBox({ vi, token }: { vi: boolean; token: string | null }) {
  const L = (v: string, e: string) => (vi ? v : e);
  const [feed, setFeed] = useState<BankFeed | null>(null);
  const [provider, setProvider] = useState<'sepay' | 'casso'>('sepay');
  const [made, setMade] = useState<{ provider: string; hookId: string; secret: string; path: string } | null>(null);
  const [sure, setSure] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => {
    if (!token) return;
    apiFetch<BankFeed>('/restaurant/bank-feed', { token }).then((f) => { setFeed(f); if (f.provider === 'casso') setProvider('casso'); }).catch(() => undefined);
  }, [token]);
  async function setup() {
    if (feed?.configured && !sure) { setSure(true); return; }
    setErr('');
    try {
      const r = await apiFetch<{ provider: string; hookId: string; secret: string; path: string }>('/restaurant/bank-feed', { method: 'POST', token, body: { provider } });
      setMade(r); setSure(false);
      setFeed({ configured: true, provider: r.provider, hookId: r.hookId, lastAt: feed?.lastAt ?? null });
    } catch (e) { setErr((e instanceof Error ? e.message : String(e)).replace(/^Error:\s*/, '').slice(0, 160)); }
  }
  const copy = (t: string) => { try { void navigator.clipboard.writeText(t); } catch { /* no clipboard */ } };
  const url = made ? `${API_URL}${made.path}` : feed?.hookId ? `${API_URL}/public/bank-feed/${feed.hookId}` : '';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 12, borderRadius: 14, background: C.raised }}>
      <b>{L('Tự xác nhận tiền về (SePay / Casso)', 'Confirm transfers automatically (SePay / Casso)')}</b>
      <span style={{ fontSize: 12.5, color: C.muted }}>
        {feed?.configured
          ? L(`Đã nối ${feed.provider === 'casso' ? 'Casso' : 'SePay'}${feed.lastAt ? ` · lần nhận gần nhất ${new Date(feed.lastAt).toLocaleString('vi-VN')}` : ' · chưa nhận giao dịch nào'}.`, `Connected to ${feed.provider === 'casso' ? 'Casso' : 'SePay'}${feed.lastAt ? ` · last ${new Date(feed.lastAt).toLocaleString()}` : ' · nothing received yet'}.`)
          : L('Chưa nối. Không nối vẫn dùng được VietQR, thu ngân tự kiểm tra app ngân hàng.', 'Not connected. VietQR still works; the cashier checks the banking app.')}
      </span>
      <div style={{ display: 'flex', gap: 6 }}>
        {(['sepay', 'casso'] as const).map((p) => <button key={p} type="button" onClick={() => setProvider(p)} style={chip(provider === p)}>{p === 'sepay' ? 'SePay' : 'Casso'}</button>)}
      </div>
      <button type="button" onClick={() => void setup()} style={{ ...btn, ...(sure ? { borderColor: '#b91c1c', color: 'var(--ink-bad)' } : {}) }}>
        {sure ? L('Chắc chắn? Khoá cũ sẽ ngừng hoạt động', 'Sure? The old secret stops working') : feed?.configured ? L('Tạo khoá mới', 'New secret') : L('Tạo địa chỉ & khoá kết nối', 'Create address & secret')}
      </button>
      {url && (
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 12.5, color: C.muted, fontWeight: 600 }}>{L('Địa chỉ webhook', 'Webhook URL')}</span>
          <span style={{ display: 'flex', gap: 6 }}><input readOnly value={url} style={{ ...field, flex: 1, fontSize: 12.5 }} /><button type="button" onClick={() => copy(url)} style={btn}>{L('Chép', 'Copy')}</button></span>
        </label>
      )}
      {made && (
        <>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 12.5, color: 'var(--ink-warn)', fontWeight: 700 }}>{L('Khoá bí mật (chỉ hiện một lần, chép ngay)', 'Secret (shown once, copy it now)')}</span>
            <span style={{ display: 'flex', gap: 6 }}><input readOnly value={made.secret} style={{ ...field, flex: 1, fontFamily: 'monospace' }} /><button type="button" onClick={() => copy(made.secret)} style={btn}>{L('Chép', 'Copy')}</button></span>
          </label>
          <span style={{ fontSize: 12.5, whiteSpace: 'pre-line' }}>
            {made.provider === 'casso'
              ? L('Casso › Webhook: dán địa chỉ trên, dán khoá vào ô “Khoá bảo mật / secure token”. Lưu và bấm gửi thử.', 'Casso › Webhook: paste the URL, and the secret as the “secure token”. Save and send a test.')
              : L('SePay › Tích hợp WebHooks › Thêm: dán địa chỉ trên, chọn chứng thực “API Key”, dán khoá vào ô API Key, chỉ nhận tiền vào. Lưu và bấm gửi thử.', 'SePay › WebHooks › Add: paste the URL, pick “API Key” authentication, paste the secret as the key, money in only. Save and send a test.')}
          </span>
        </>
      )}
      {err && <span style={{ color: 'var(--ink-bad)' }}>{err}</span>}
    </div>
  );
}
