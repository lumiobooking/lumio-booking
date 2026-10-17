'use client';

// WALK-IN 2.0 — THE QUEUE ON THE TV IN THE WAITING AREA.
//
// For customers, not staff: who is next, about how long, and who has been
// called. First name and the initial of the last only (privacy). No buttons;
// polls every 10 s. Sign in once on the TV as the salon (owner or front desk),
// like the turn board (/turns-tv).

import { useEffect, useState } from 'react';
import { useAuth } from '../../lib/auth';
import { apiFetch } from '../../lib/api';
import { uiLocale } from '../../lib/datetime';
import { shortName } from '../../lib/walkin-floor';

interface Waiting { id: string; customerName: string | null; partySize: number; eta?: { min: number; max: number } | null; calledAt?: string | null; group?: { tag: string; size: number } | null }
interface Board { waiting: Waiting[]; staff: { id: string; busy: boolean; onBreak?: boolean }[] }

export default function QueueTvPage() {
  const { token, ready } = useAuth();
  const vi = uiLocale().startsWith('vi');
  const T = (v: string, e: string) => (vi ? v : e);
  const [board, setBoard] = useState<Board | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    if (!token) return;
    let alive = true;
    const tick = async () => {
      try {
        const b = await apiFetch<Board>('/walkins/board', { token });
        if (!alive) return;
        setBoard(b); setErr(null); setNow(new Date());
      } catch (e) { if (alive) setErr(e instanceof Error ? e.message : 'Failed'); }
    };
    void tick();
    const id = setInterval(tick, 10_000);
    return () => { alive = false; clearInterval(id); };
  }, [token]);

  if (!ready) return <main style={{ minHeight: '100vh', background: 'var(--c0b1120)' }} />;
  if (!token) {
    return (
      <main style={{ minHeight: '100vh', background: 'var(--c0b1120)', color: 'var(--cf1f5f9)', display: 'grid', placeItems: 'center', padding: 24 }}>
        <div style={{ textAlign: 'center', maxWidth: 440 }}>
          <div style={{ fontSize: 28, fontWeight: 800 }}>{T('Hàng chờ', 'Queue')}</div>
          <div style={{ marginTop: 10, fontSize: 16, color: 'var(--c94a3b8)', lineHeight: 1.5 }}>{T('Đăng nhập tài khoản tiệm trên TV này một lần, rồi mở lại trang /queue-tv.', 'Sign in to the salon account on this TV once, then open /queue-tv again.')}</div>
        </div>
      </main>
    );
  }

  const waiting = board?.waiting ?? [];
  const free = (board?.staff ?? []).filter((s) => !s.busy && !s.onBreak).length;
  const clock = now.toLocaleTimeString(vi ? 'vi-VN' : 'en-US', { hour: 'numeric', minute: '2-digit' });
  const etaText = (w: Waiting) => {
    if (w.calledAt) return T('Mời vào quầy', 'Please come up');
    if (!w.eta) return '';
    if (w.eta.max === 0) return T('Ngay bây giờ', 'Now');
    return T(`${w.eta.min}–${w.eta.max} phút`, `${w.eta.min}–${w.eta.max} min`);
  };

  return (
    <main style={{ minHeight: '100vh', background: 'var(--c0b1120)', color: 'var(--cf1f5f9)', padding: 'clamp(18px, 3vw, 40px)', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 18 }}>
      <header style={{ display: 'flex', alignItems: 'baseline', gap: 16, flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0, fontSize: 'clamp(28px, 4vw, 48px)', fontWeight: 800, letterSpacing: -0.6 }}>{T('Hàng chờ', 'Queue')}</h1>
        <span style={{ fontSize: 'clamp(16px, 2vw, 22px)', color: 'var(--c94a3b8)' }}>{clock}</span>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 'clamp(16px, 2vw, 22px)', color: 'var(--ccbd5e1)' }}><b style={{ color: 'var(--cf8fafc)' }}>{free}</b> {T('thợ đang rảnh', 'technicians free')}</span>
      </header>
      {err && <div style={{ color: 'var(--ink-bad)', fontSize: 15 }}>{err}</div>}
      {waiting.length === 0 ? (
        <div style={{ flex: 1, display: 'grid', placeItems: 'center', color: 'var(--c94a3b8)', fontSize: 'clamp(22px, 3vw, 36px)', fontWeight: 700 }}>{T('Không ai phải chờ — mời bạn vào', 'No wait — come right in')}</div>
      ) : (
        <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 12 }}>
          {waiting.slice(0, 10).map((w, i) => {
            const called = Boolean(w.calledAt);
            return (
              <li key={w.id} style={{ display: 'grid', gridTemplateColumns: 'clamp(48px, 6vw, 80px) minmax(0, 1fr) auto', alignItems: 'center', gap: 18, padding: 'clamp(12px, 1.6vw, 20px) clamp(14px, 2vw, 26px)', borderRadius: 18, background: called ? '#4f46e5' : 'var(--c1e293b)', color: called ? '#ffffff' : 'var(--cf8fafc)' }}>
                <span style={{ fontSize: 'clamp(24px, 3vw, 40px)', fontWeight: 800, color: called ? 'inherit' : 'var(--ca5b4fc)', fontVariantNumeric: 'tabular-nums' }}>{i + 1}</span>
                <span style={{ fontSize: 'clamp(22px, 2.8vw, 36px)', fontWeight: 700, color: 'inherit', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {shortName(w.customerName, vi)}{w.partySize > 1 ? ` · ${w.partySize} ${T('người', 'people')}` : ''}
                </span>
                <span style={{ fontSize: 'clamp(18px, 2.2vw, 28px)', fontWeight: 700, color: called ? 'inherit' : 'var(--ccbd5e1)', whiteSpace: 'nowrap' }}>{etaText(w)}</span>
              </li>
            );
          })}
        </ol>
      )}
      <footer style={{ marginTop: 'auto', fontSize: 'clamp(14px, 1.6vw, 18px)', color: 'var(--c94a3b8)' }}>
        {T('Thời gian là dự kiến và có thể thay đổi.', 'Times are estimates and may change.')}
      </footer>
    </main>
  );
}
