'use client';

/**
 * rt200 — back from Facebook. Trades the short ticket for a session (no token
 * ever travels in the address bar), lets someone in two salons pick one, then
 * opens their work: the Inbox for a messages-only team member.
 */
import { useEffect, useState } from 'react';
import { homeFor, useAuth, type LoginResponse } from '../../../lib/auth';
import { apiFetch } from '../../../lib/api';

const C = { bg: '#e8eef6', card: '#ffffff', ink: '#0f2747', muted: '#52637d', blue: '#0659b8', bad: '#b42318' };

export default function FacebookBack() {
  const { adopt } = useAuth();
  const [choose, setChoose] = useState<{ i: number; salon: string }[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ticket, setTicket] = useState('');

  async function finish(t: string, pick?: number) {
    try {
      const r = await apiFetch<LoginResponse | { choose: { i: number; salon: string }[] }>('/auth/facebook/exchange', { method: 'POST', body: { ticket: t, ...(pick !== undefined ? { pick } : {}) } });
      if ('choose' in r) { setChoose(r.choose); return; }
      const user = adopt(r);
      window.location.replace(homeFor(user));
    } catch (e) { setErr(String((e as Error)?.message ?? e)); }
  }

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('t') ?? '';
    // Out of the address bar and the history at once.
    window.history.replaceState(null, '', '/login/facebook');
    setTicket(t);
    if (!t) { setErr('Thiếu thông tin đăng nhập — bấm lại “Đăng nhập với Facebook”.'); return; }
    void finish(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main style={{ minHeight: '100dvh', background: C.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px max(16px, env(safe-area-inset-right, 0px)) 24px max(16px, env(safe-area-inset-left, 0px))', boxSizing: 'border-box', colorScheme: 'light' }}>
      <div style={{ width: '100%', maxWidth: 400, background: C.card, borderRadius: 22, padding: '26px 22px', boxShadow: '0 18px 40px rgba(15,39,71,.12)', color: C.ink, display: 'flex', flexDirection: 'column', gap: 12, textAlign: 'center' }}>
        {!err && !choose && <p style={{ margin: 0, color: C.muted }}>Đang đăng nhập…</p>}
        {choose && (
          <>
            <h1 style={{ fontSize: 19, margin: 0 }}>Bạn muốn vào tiệm nào?</h1>
            {choose.map((c) => (
              <button key={c.i} type="button" onClick={() => void finish(ticket, c.i)} style={{ height: 48, borderRadius: 12, border: `1px solid ${C.blue}`, background: 'transparent', color: C.blue, fontSize: 15, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>{c.salon || 'Tiệm'}</button>
            ))}
          </>
        )}
        {err && (
          <>
            <p style={{ margin: 0, color: C.bad, fontWeight: 600 }}>{err}</p>
            <a href="/login" style={{ color: C.blue, fontWeight: 700, textDecoration: 'none' }}>Về trang đăng nhập →</a>
          </>
        )}
      </div>
    </main>
  );
}
