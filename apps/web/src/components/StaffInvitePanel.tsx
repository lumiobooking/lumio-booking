'use client';

/**
 * rt200 — "Mời nhân viên": the owner makes a link, sends it on Zalo; the person
 * opens it and presses "Đăng nhập với Facebook". No account to create, no
 * password to hand over. The link is shown once (the server keeps only a hash).
 */
import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';

type Invite = { id: string; staffRole: string; roleLabel: string; label: string | null; maxUses: number; uses: number; expiresAt: string; createdAt: string; status: 'open' | 'used' | 'expired' | 'revoked' | 'missing' };

const ROLES: { v: string; vi: string; en: string; hintVi: string; hintEn: string }[] = [
  { v: 'CHAT', vi: '💬 Tư vấn tin nhắn', en: '💬 Messages only', hintVi: 'Chỉ Hộp thư: trả lời khách, nhận turn. Không thấy lịch, tiền.', hintEn: 'Inbox only: answers customers, takes turns. No calendar or money.' },
  { v: 'RECEPTIONIST', vi: '💵 Lễ tân', en: '💵 Front desk', hintVi: 'Hộp thư + lịch hẹn, nhận khách, tính tiền.', hintEn: 'Inbox + bookings, check-in, checkout.' },
  { v: 'TECHNICIAN', vi: '💅 Thợ', en: '💅 Technician', hintVi: 'App thợ: lịch và thu nhập của chính mình.', hintEn: 'Tech app: their own schedule and earnings.' },
  { v: 'MANAGER', vi: '👔 Quản lý', en: '👔 Manager', hintVi: 'Gần như toàn quyền, trừ cài đặt và gói Lumio.', hintEn: 'Almost everything except settings and the plan.' },
];

const STATUS: Record<string, [string, string]> = { open: ['còn dùng được', 'open'], used: ['đã dùng hết', 'used up'], expired: ['hết hạn', 'expired'], revoked: ['đã huỷ', 'cancelled'], missing: ['—', '—'] };

export function StaffInvitePanel({ token, vi, defaultRole = 'CHAT' }: { token: string | null; vi: boolean; defaultRole?: string }) {
  const L = (v: string, e: string) => (vi ? v : e);
  const [role, setRole] = useState(defaultRole);
  const [uses, setUses] = useState(1);
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [list, setList] = useState<Invite[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    try { setList(await apiFetch<Invite[]>('/staff-invites', { token })); } catch { /* the panel still makes links */ }
  }, [token]);
  useEffect(() => { void load(); }, [load]);

  async function make() {
    if (!token) return;
    setBusy(true); setErr(null); setCopied(false);
    try {
      const r = await apiFetch<{ url: string }>('/staff-invites', { method: 'POST', token, body: { staffRole: role, maxUses: uses, days: 7 } });
      setLink(r.url);
      await load();
    } catch (e) { setErr(String((e as Error)?.message ?? e)); } finally { setBusy(false); }
  }
  async function copy() {
    if (!link) return;
    try { await navigator.clipboard.writeText(link); setCopied(true); } catch { setCopied(false); }
  }
  async function revoke(id: string) {
    if (!token) return;
    try { await apiFetch(`/staff-invites/${encodeURIComponent(id)}/revoke`, { method: 'POST', token }); await load(); } catch (e) { setErr(String((e as Error)?.message ?? e)); }
  }

  const box: React.CSSProperties = { border: '1px solid var(--line)', borderRadius: 12, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10, background: 'var(--c0f172a)' };
  const hint = ROLES.find((r) => r.v === role);
  const shareText = link ? L(`Chào bạn, mời bạn vào tiệm trên Lumio. Mở link bằng Safari/Chrome rồi bấm "Đăng nhập với Facebook" hoặc "Vào bằng số điện thoại": ${link}`, `You're invited to our salon on Lumio. Open the link in Safari/Chrome, then "Continue with Facebook" or "Join with your phone": ${link}`) : '';

  return (
    <div style={box}>
      <div>
        <b style={{ fontSize: 14.5, color: 'var(--ce2e8f0)' }}>🔗 {L('Mời nhân viên bằng link', 'Invite by link')}</b>
        <p style={{ margin: '4px 0 0', fontSize: 12.5, color: 'var(--c94a3b8)', lineHeight: 1.5 }}>
          {L('Tạo link, gửi qua Zalo. Nhân viên mở link, bấm “Đăng nhập với Facebook” hoặc “Vào bằng số điện thoại” (tự đặt mật khẩu) là vào tiệm — anh không phải tạo tài khoản.', 'Make a link and send it on Zalo. They open it and use Facebook or their phone number (with their own password) — no account for you to create.')}
        </p>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <select value={role} onChange={(e) => setRole(e.target.value)} style={{ height: 36, borderRadius: 9, border: '1px solid var(--line-strong)', background: 'transparent', color: 'var(--ce2e8f0)', padding: '0 8px', fontSize: 13.5, fontFamily: 'inherit' }} aria-label={L('Vai trò', 'Role')}>
          {ROLES.map((r) => <option key={r.v} value={r.v}>{vi ? r.vi : r.en}</option>)}
        </select>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--ccbd5e1)' }}>
          {L('Cho', 'For')}
          <select value={uses} onChange={(e) => setUses(Number(e.target.value))} style={{ height: 36, borderRadius: 9, border: '1px solid var(--line-strong)', background: 'transparent', color: 'var(--ce2e8f0)', padding: '0 8px', fontSize: 13.5, fontFamily: 'inherit' }}>
            {[1, 2, 3, 5, 10].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
          {L('người · hạn 7 ngày', 'people · 7 days')}
        </label>
        <button type="button" onClick={() => void make()} disabled={busy} style={{ height: 36, padding: '0 14px', borderRadius: 9, border: '1px solid var(--ink-link)', background: 'transparent', color: 'var(--ink-link)', fontWeight: 700, fontSize: 13.5, cursor: 'pointer', fontFamily: 'inherit', opacity: busy ? 0.6 : 1 }}>
          {busy ? '…' : L('Tạo link mời', 'Make invite link')}
        </button>
      </div>
      {hint && <span style={{ fontSize: 12, color: 'var(--c94a3b8)' }}>{vi ? hint.hintVi : hint.hintEn}</span>}
      {link && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '10px 12px', borderRadius: 10, background: 'var(--wash-blue)' }}>
          <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--ink-link)' }}>{L('Link chỉ hiện một lần — chép và gửi ngay:', 'Shown once — copy and send it now:')}</span>
          <code style={{ fontSize: 12.5, wordBreak: 'break-all', color: 'var(--ce2e8f0)' }}>{link}</code>
          <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" onClick={() => void copy()} style={{ height: 32, padding: '0 12px', borderRadius: 8, border: '1px solid var(--line-strong)', background: 'transparent', color: 'var(--ce2e8f0)', fontWeight: 700, fontSize: 12.5, cursor: 'pointer', fontFamily: 'inherit' }}>{copied ? L('✓ Đã chép', '✓ Copied') : L('Chép link', 'Copy link')}</button>
            <button type="button" onClick={() => { void navigator.clipboard.writeText(shareText).then(() => setCopied(true)).catch(() => undefined); }} style={{ height: 32, padding: '0 12px', borderRadius: 8, border: '1px solid var(--line-strong)', background: 'transparent', color: 'var(--ce2e8f0)', fontWeight: 700, fontSize: 12.5, cursor: 'pointer', fontFamily: 'inherit' }}>{L('Chép kèm lời nhắn Zalo', 'Copy with a message')}</button>
          </span>
        </div>
      )}
      {err && <span style={{ fontSize: 12.5, color: 'var(--ink-bad)' }}>{err}</span>}
      {list.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--c94a3b8)' }}>{L('Link đã tạo', 'Links made')}</span>
          {list.slice(0, 8).map((i) => (
            <div key={i.id} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 12.5, color: 'var(--ccbd5e1)', padding: '4px 0', borderTop: '1px solid var(--line)' }}>
              <span>{i.roleLabel}</span>
              <span style={{ color: 'var(--c94a3b8)' }}>· {i.uses}/{i.maxUses} {L('người đã vào', 'joined')} · {new Date(i.createdAt).toLocaleDateString(vi ? 'vi-VN' : 'en-US')}</span>
              <span style={{ fontWeight: 700, color: i.status === 'open' ? 'var(--ink-good)' : 'var(--c94a3b8)' }}>{vi ? STATUS[i.status][0] : STATUS[i.status][1]}</span>
              {i.status === 'open' && <button type="button" onClick={() => void revoke(i.id)} style={{ marginLeft: 'auto', border: 0, background: 'transparent', color: 'var(--ink-bad)', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>{L('Huỷ link', 'Cancel link')}</button>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
