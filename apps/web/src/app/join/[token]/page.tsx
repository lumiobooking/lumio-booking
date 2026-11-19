'use client';

/**
 * rt200 — the invite link a salon owner sends on Zalo. Shows which salon and
 * which role, then one button: "Đăng nhập với Facebook". Facebook is used only
 * to know who this is (name); the salon's Page is already connected by the owner.
 */
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { apiFetch } from '../../../lib/api';

type Preview = { ok: true; salonName: string; role: string; roleLabel: string } | { ok: false; reason: string };

const C = { bg: '#e8eef6', card: '#ffffff', ink: '#0f2747', muted: '#52637d', fb: '#1877f2', bad: '#b42318' };

export default function JoinPage() {
  const params = useParams<{ token: string }>();
  const token = String(params?.token ?? '');
  const [p, setP] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    void apiFetch<Preview>(`/staff-invites/preview/${encodeURIComponent(token)}`).then(setP).catch(() => setP({ ok: false, reason: 'missing' }));
  }, [token]);

  async function go() {
    setBusy(true); setErr(null);
    try {
      const r = await apiFetch<{ url: string }>('/auth/facebook/start', { method: 'POST', body: { mode: 'join', token } });
      window.location.assign(r.url);
    } catch (e) { setErr(String((e as Error)?.message ?? e)); setBusy(false); }
  }

  const why: Record<string, string> = {
    used: 'Link này đã dùng hết lượt.', expired: 'Link này đã hết hạn.', revoked: 'Link này đã bị chủ tiệm huỷ.', missing: 'Link này không đúng.',
  };

  return (
    <main style={{ minHeight: '100dvh', background: C.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px max(16px, env(safe-area-inset-right, 0px)) 24px max(16px, env(safe-area-inset-left, 0px))', boxSizing: 'border-box', colorScheme: 'light', fontFamily: 'inherit' }}>
      <div style={{ width: '100%', maxWidth: 420, background: C.card, borderRadius: 24, padding: '28px 24px', boxShadow: '0 18px 40px rgba(15,39,71,.12)', color: C.ink, display: 'flex', flexDirection: 'column', gap: 14, textAlign: 'center' }}>
        <img src="/logo/lumio-mark.png" alt="" width={56} height={56} style={{ margin: '0 auto' }} />
        {!p && <p style={{ color: C.muted, margin: 0 }}>Đang mở link…</p>}
        {p && !p.ok && (
          <>
            <h1 style={{ fontSize: 20, margin: 0 }}>Không vào được</h1>
            <p style={{ color: C.bad, margin: 0, fontWeight: 600 }}>{why[p.reason] ?? why.missing}</p>
            <p style={{ color: C.muted, margin: 0, fontSize: 14, lineHeight: 1.5 }}>Nhờ chủ tiệm gửi link mời mới. Nếu bạn đã vào tiệm rồi, mở trang đăng nhập và bấm “Đăng nhập với Facebook”.</p>
            <a href="/login" style={{ color: C.fb, fontWeight: 700, textDecoration: 'none' }}>Mở trang đăng nhập →</a>
          </>
        )}
        {p && p.ok && (
          <>
            <p style={{ margin: 0, color: C.muted, fontSize: 14 }}>Bạn được mời vào</p>
            <h1 style={{ fontSize: 23, margin: 0 }}>{p.salonName}</h1>
            <p style={{ margin: 0, fontSize: 14.5 }}>Vai trò: <b>{p.roleLabel}</b></p>
            <button type="button" onClick={() => void go()} disabled={busy} style={{ height: 52, border: 0, borderRadius: 14, background: C.fb, color: '#ffffff', fontSize: 16, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, opacity: busy ? 0.6 : 1, fontFamily: 'inherit' }}>
              <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path fill="#ffffff" d="M24 12.07C24 5.4 18.63 0 12 0S0 5.4 0 12.07C0 18.1 4.39 23.1 10.13 24v-8.44H7.08v-3.49h3.04V9.41c0-3.02 1.8-4.7 4.54-4.7 1.31 0 2.68.24 2.68.24v2.97h-1.51c-1.49 0-1.95.93-1.95 1.88v2.27h3.32l-.53 3.49h-2.79V24C19.61 23.1 24 18.1 24 12.07z" /></svg>
              {busy ? 'Đang mở Facebook…' : 'Đăng nhập với Facebook'}
            </button>
            {err && <p style={{ color: C.bad, margin: 0, fontSize: 13.5 }}>{err}</p>}
            <p style={{ margin: 0, color: C.muted, fontSize: 12.5, lineHeight: 1.5 }}>Lumio chỉ lấy <b>tên</b> của bạn từ Facebook để biết bạn là ai. Không đọc tin nhắn, bạn bè hay trang cá nhân. Tin trả lời khách được gửi bằng Fanpage của tiệm.</p>
          </>
        )}
      </div>
    </main>
  );
}
