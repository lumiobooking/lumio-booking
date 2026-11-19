'use client';

/**
 * rt200/rt202 — the invite link a salon owner sends on Zalo.
 *
 * Two ways in, same result (a team member of THIS salon, in the Inbox):
 *  - "Đăng nhập với Facebook" — identity only (the name); on a phone that
 *    already has Facebook signed in in the browser it is one tap.
 *  - "Vào bằng số điện thoại" — name, phone, a password of their own; next
 *    time phone + password on the sign-in page. No Facebook at all.
 *
 * Opened inside Zalo / Messenger / Facebook's own browser, Facebook usually
 * asks for the password again (that browser is not signed in) or refuses
 * outright, so the phone path comes first there, with a way out to Safari /
 * Chrome.
 */
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { apiFetch } from '../../../lib/api';
import { homeFor, useAuth, type LoginResponse } from '../../../lib/auth';

type Preview = { ok: true; salonName: string; role: string; roleLabel: string; facebook?: boolean } | { ok: false; reason: string };

const C = { bg: '#e8eef6', card: '#ffffff', ink: '#0f2747', muted: '#52637d', fb: '#1877f2', bad: '#b42318', line: '#d5deea', blue: '#0659b8' };

/** Zalo, Facebook, Messenger, Instagram, LINE, TikTok in-app browsers. */
function inAppBrowser(): string | null {
  if (typeof navigator === 'undefined') return null;
  const ua = navigator.userAgent || '';
  if (/Zalo/i.test(ua)) return 'Zalo';
  if (/FBAN|FBAV|FB_IAB|FBIOS|Messenger/i.test(ua)) return 'Facebook';
  if (/Instagram/i.test(ua)) return 'Instagram';
  if (/Line\//i.test(ua)) return 'LINE';
  if (/musical_ly|Bytedance|TikTok/i.test(ua)) return 'TikTok';
  return null;
}

const field: React.CSSProperties = { height: 48, borderRadius: 12, border: `1px solid ${C.line}`, padding: '0 14px', fontSize: 16, color: C.ink, background: '#ffffff', fontFamily: 'inherit', width: '100%', boxSizing: 'border-box' };

export default function JoinPage() {
  const params = useParams<{ token: string }>();
  const token = String(params?.token ?? '');
  const { adopt } = useAuth();
  const [p, setP] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [app, setApp] = useState<string | null>(null);
  const [usePhone, setUsePhone] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [pw, setPw] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const a = inAppBrowser();
    setApp(a);
    if (a) setUsePhone(true);
    void apiFetch<Preview>(`/staff-invites/preview/${encodeURIComponent(token)}`).then((r) => {
      setP(r);
      // rt203: no Facebook sign-in on this server — the phone form is the way in.
      if (r.ok && r.facebook === false) setUsePhone(true);
    }).catch(() => setP({ ok: false, reason: 'missing' }));
  }, [token]);

  async function facebook() {
    setBusy(true); setErr(null);
    try {
      const r = await apiFetch<{ url: string }>('/auth/facebook/start', { method: 'POST', body: { mode: 'join', token } });
      window.location.assign(r.url);
    } catch (e) { setErr(String((e as Error)?.message ?? e)); setBusy(false); }
  }

  async function withPhone(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (name.trim().length < 2) { setErr('Nhập tên của bạn.'); return; }
    if (phone.replace(/\D/g, '').length < 9) { setErr('Nhập số điện thoại của bạn.'); return; }
    if (pw.length < 8) { setErr('Mật khẩu cần ít nhất 8 ký tự.'); return; }
    setBusy(true);
    try {
      const r = await apiFetch<LoginResponse>('/staff-invites/join', { method: 'POST', body: { token, name: name.trim(), phone: phone.trim(), password: pw } });
      const user = adopt(r);
      window.location.replace(homeFor(user));
    } catch (e2) { setErr(String((e2 as Error)?.message ?? e2)); setBusy(false); }
  }

  async function copyLink() {
    try { await navigator.clipboard.writeText(window.location.href); setCopied(true); } catch { setCopied(false); }
  }

  const why: Record<string, string> = {
    used: 'Link này đã dùng hết lượt.', expired: 'Link này đã hết hạn.', revoked: 'Link này đã bị chủ tiệm huỷ.', missing: 'Link này không đúng.',
  };
  const ios = typeof navigator !== 'undefined' && /iPhone|iPad|iPod/.test(navigator.userAgent);

  return (
    <main style={{ minHeight: '100dvh', background: C.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px max(16px, env(safe-area-inset-right, 0px)) 24px max(16px, env(safe-area-inset-left, 0px))', boxSizing: 'border-box', colorScheme: 'light', fontFamily: 'inherit' }}>
      <div style={{ width: '100%', maxWidth: 420, background: C.card, borderRadius: 24, padding: '26px 22px', boxShadow: '0 18px 40px rgba(15,39,71,.12)', color: C.ink, display: 'flex', flexDirection: 'column', gap: 13, textAlign: 'center' }}>
        <img src="/logo/lumio-mark.png" alt="" width={52} height={52} style={{ margin: '0 auto' }} />
        {!p && <p style={{ color: C.muted, margin: 0 }}>Đang mở link…</p>}
        {p && !p.ok && (
          <>
            <h1 style={{ fontSize: 20, margin: 0 }}>Không vào được</h1>
            <p style={{ color: C.bad, margin: 0, fontWeight: 600 }}>{why[p.reason] ?? why.missing}</p>
            <p style={{ color: C.muted, margin: 0, fontSize: 14, lineHeight: 1.5 }}>Nhờ chủ tiệm gửi link mời mới. Nếu bạn đã vào tiệm rồi, mở trang đăng nhập và gõ số điện thoại + mật khẩu, hoặc bấm “Đăng nhập với Facebook”.</p>
            <a href="/login" style={{ color: C.fb, fontWeight: 700, textDecoration: 'none' }}>Mở trang đăng nhập →</a>
          </>
        )}
        {p && p.ok && (
          <>
            <p style={{ margin: 0, color: C.muted, fontSize: 14 }}>Bạn được mời vào</p>
            <h1 style={{ fontSize: 23, margin: 0 }}>{p.salonName}</h1>
            <p style={{ margin: 0, fontSize: 14.5 }}>Vai trò: <b>{p.roleLabel}</b></p>

            {app && p.facebook !== false && (
              <div style={{ textAlign: 'left', background: '#fff7e6', border: '1px solid #f5c26b', borderRadius: 12, padding: '10px 12px', fontSize: 13.5, lineHeight: 1.5, color: '#7a4b00' }}>
                Bạn đang mở link trong <b>{app}</b>. Cách nhanh nhất: <b>vào bằng số điện thoại</b> ngay bên dưới.
                <br />Muốn dùng Facebook: bấm <b>⋯</b> ở góc trên → <b>{ios ? 'Mở bằng Safari' : 'Mở bằng trình duyệt'}</b>
                {' '}(hoặc <button type="button" onClick={() => void copyLink()} style={{ border: 0, background: 'none', padding: 0, color: C.blue, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', fontSize: 13.5 }}>{copied ? 'đã chép link ✓' : 'chép link'}</button> rồi dán vào {ios ? 'Safari' : 'Chrome'}).
              </div>
            )}

            {!usePhone ? (
              <>
                <button type="button" onClick={() => void facebook()} disabled={busy} style={{ height: 52, border: 0, borderRadius: 14, background: C.fb, color: '#ffffff', fontSize: 16, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, opacity: busy ? 0.6 : 1, fontFamily: 'inherit' }}>
                  <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path fill="#ffffff" d="M24 12.07C24 5.4 18.63 0 12 0S0 5.4 0 12.07C0 18.1 4.39 23.1 10.13 24v-8.44H7.08v-3.49h3.04V9.41c0-3.02 1.8-4.7 4.54-4.7 1.31 0 2.68.24 2.68.24v2.97h-1.51c-1.49 0-1.95.93-1.95 1.88v2.27h3.32l-.53 3.49h-2.79V24C19.61 23.1 24 18.1 24 12.07z" /></svg>
                  {busy ? 'Đang mở Facebook…' : 'Đăng nhập với Facebook'}
                </button>
                <button type="button" onClick={() => { setUsePhone(true); setErr(null); }} style={{ height: 46, borderRadius: 14, border: `1px solid ${C.line}`, background: 'transparent', color: C.ink, fontSize: 15, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                  📱 Vào bằng số điện thoại
                </button>
              </>
            ) : (
              <form onSubmit={(e) => void withPhone(e)} style={{ display: 'flex', flexDirection: 'column', gap: 9, textAlign: 'left' }}>
                <input style={field} placeholder="Tên của bạn" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
                <input style={field} placeholder="Số điện thoại" type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
                <input style={field} placeholder="Tự đặt mật khẩu (ít nhất 8 ký tự)" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
                <button type="submit" disabled={busy} style={{ height: 50, border: 0, borderRadius: 14, background: C.blue, color: '#ffffff', fontSize: 16, fontWeight: 700, cursor: 'pointer', opacity: busy ? 0.6 : 1, fontFamily: 'inherit' }}>
                  {busy ? 'Đang vào…' : 'Vào tiệm'}
                </button>
                <span style={{ fontSize: 12.5, color: C.muted, lineHeight: 1.5 }}>Lần sau: vào trang đăng nhập Lumio, gõ <b>số điện thoại</b> và <b>mật khẩu</b> này.</span>
                {!app && p.facebook !== false && <button type="button" onClick={() => { setUsePhone(false); setErr(null); }} style={{ border: 0, background: 'none', color: C.fb, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', fontSize: 14 }}>← Dùng Facebook thay vì số điện thoại</button>}
                {app && p.facebook !== false && <button type="button" onClick={() => void facebook()} style={{ border: 0, background: 'none', color: C.fb, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', fontSize: 14 }}>Vẫn thử Đăng nhập với Facebook</button>}
              </form>
            )}
            {err && <p style={{ color: C.bad, margin: 0, fontSize: 13.5, fontWeight: 600 }}>{err}</p>}
            {!usePhone && <p style={{ margin: 0, color: C.muted, fontSize: 12.5, lineHeight: 1.5 }}>Lumio chỉ lấy <b>tên</b> của bạn từ Facebook. Không đọc tin nhắn, bạn bè hay trang cá nhân. Tin trả lời khách được gửi bằng Fanpage của tiệm.</p>}
          </>
        )}
      </div>
    </main>
  );
}
