'use client';

// CHIA TUA — THE TV IN THE BREAK ROOM.
//
// One screen, no buttons: who is next, who is working, who is on a break, and
// everyone's turns for the day, in the order the dispatcher will hand out the
// next client. Polls every 10 s. The front desk or the owner signs in once on
// the TV's browser (or the iPad on the wall); technicians only read.

import { useEffect, useState } from 'react';
import { useAuth } from '../../lib/auth';
import { apiFetch } from '../../lib/api';
import { uiLocale } from '../../lib/datetime';
import { fmtTurns } from '../../lib/walkin-floor';
import { formatPrice } from '../../lib/ui';
import { uiCurrency } from '../../lib/ui-currency';
import { rulesLine, TurnRules } from '../../lib/turn-rules-ui';

interface Tech { id: string; name: string; turns: number; moneyCents: number; busy: boolean; onBreak?: boolean; rank: number | null; inRotation?: boolean }
interface Turns { day: string; rules: TurnRules; techs: Tech[] }
interface Board { waiting: unknown[]; serving: unknown[] }

/** Fixed accent grounds for the rank bubbles: a white digit reads on all of them in both themes. */
const NEXT_BADGE = { background: '#15803d', color: '#fff' } as const;
const FREE_BADGE = { background: '#4f46e5', color: '#fff' } as const;
const BUSY_BADGE = { background: '#b45309', color: '#fff' } as const;
const REST_BADGE = { background: '#475569', color: '#fff' } as const;

export default function TurnsTvPage() {
  const { token, ready } = useAuth();
  const cur = uiCurrency();
  const vi = uiLocale().startsWith('vi');
  const [data, setData] = useState<Turns | null>(null);
  const [queue, setQueue] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    if (!token) return;
    let alive = true;
    const tick = async () => {
      try {
        const [t, b] = await Promise.all([apiFetch<Turns>('/walkins/turns', { token }), apiFetch<Board>('/walkins/board', { token }).catch(() => null)]);
        if (!alive) return;
        setData(t); setQueue(b ? b.waiting.length : null); setErr(null); setNow(new Date());
      } catch (e) { if (alive) setErr(e instanceof Error ? e.message : 'Failed'); }
    };
    void tick();
    const id = setInterval(tick, 10_000);
    return () => { alive = false; clearInterval(id); };
  }, [token]);

  const T = (v: string, e: string) => (vi ? v : e);
  if (!ready) return <main style={{ minHeight: '100vh', background: 'var(--c0b1120)' }} />;
  if (!token) {
    return (
      <main style={{ minHeight: '100vh', background: 'var(--c0b1120)', color: 'var(--cf1f5f9)', display: 'grid', placeItems: 'center', padding: 24, fontFamily: 'inherit' }}>
        <div style={{ textAlign: 'center', maxWidth: 420 }}>
          <div style={{ fontSize: 28, fontWeight: 800 }}>{T('Bảng tua', 'Turn board')}</div>
          <div style={{ marginTop: 10, fontSize: 16, color: 'var(--c94a3b8)', lineHeight: 1.5 }}>{T('Đăng nhập tài khoản tiệm trên thiết bị này một lần, rồi mở lại trang /turns-tv.', 'Sign in to the salon account on this device once, then open /turns-tv again.')}</div>
          <a href="/login" style={{ display: 'inline-block', marginTop: 18, padding: '12px 22px', borderRadius: 12, background: '#4f46e5', color: '#fff', fontWeight: 700, textDecoration: 'none' }}>{T('Đăng nhập', 'Sign in')}</a>
        </div>
      </main>
    );
  }
  const techs = data ? [...data.techs].sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99) || Number(a.busy) - Number(b.busy) || a.name.localeCompare(b.name)) : [];
  const money = data?.rules.mode === 'MONEY';
  const cols = techs.length <= 4 ? techs.length || 1 : techs.length <= 8 ? 4 : techs.length <= 12 ? 4 : 5;
  const time = now.toLocaleTimeString(uiLocale(), { hour: 'numeric', minute: '2-digit' });

  return (
    <main style={{ minHeight: '100vh', background: 'var(--c0b1120)', color: 'var(--cf1f5f9)', padding: 'max(16px, 2vw)', display: 'flex', flexDirection: 'column', gap: 'max(12px, 1.5vw)' }}>
      <header style={{ display: 'flex', alignItems: 'baseline', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 'clamp(22px, 3.2vw, 44px)', fontWeight: 800 }}>{T('Tua hôm nay', 'Turns today')}</div>
        <div style={{ fontSize: 'clamp(14px, 1.6vw, 22px)', color: 'var(--c94a3b8)' }}>{data?.day ?? ''} · {time}</div>
        {queue != null && <div style={{ marginLeft: 'auto', fontSize: 'clamp(16px, 2vw, 28px)', fontWeight: 700, color: queue > 0 ? 'var(--ink-warn)' : 'var(--c94a3b8)' }}>{queue > 0 ? T(`${queue} khách đang chờ`, `${queue} waiting`) : T('Không ai chờ', 'Nobody waiting')}</div>}
      </header>
      {err && <div style={{ color: 'var(--ink-bad)', fontSize: 16 }}>{err}</div>}
      {!data && !err && <div style={{ color: 'var(--c94a3b8)', fontSize: 18 }}>{T('Đang tải…', 'Loading…')}</div>}
      <section style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap: 'max(10px, 1.2vw)', flex: 1, alignContent: 'start' }}>
        {techs.map((t) => {
          const state = t.inRotation === false ? 'manual' : t.onBreak ? 'rest' : t.busy ? 'busy' : t.rank === 1 ? 'next' : 'free';
          const badge = state === 'next' ? NEXT_BADGE : state === 'busy' ? BUSY_BADGE : state === 'rest' || state === 'manual' ? REST_BADGE : FREE_BADGE;
          const label = state === 'next' ? T('TỚI LƯỢT', 'NEXT UP') : state === 'busy' ? T('đang làm', 'serving') : state === 'rest' ? T('☕ tạm nghỉ', '☕ on break') : state === 'manual' ? T('chỉ khách request', 'requests only') : T('rảnh', 'free');
          return (
            <div key={t.id} style={{ borderRadius: 18, padding: 'max(12px, 1.4vw)', background: state === 'next' ? 'rgba(34,197,94,0.14)' : 'var(--c111827)', border: `2px solid ${state === 'next' ? '#22c55e' : state === 'busy' ? '#f59e0b' : 'var(--line)'}`, opacity: state === 'rest' ? 0.65 : 1, display: 'flex', alignItems: 'center', gap: 'max(10px, 1.2vw)', minHeight: 'clamp(76px, 10vw, 140px)' }}>
              <div style={{ ...badge, width: 'clamp(40px, 4.5vw, 72px)', height: 'clamp(40px, 4.5vw, 72px)', borderRadius: 999, display: 'grid', placeItems: 'center', fontSize: 'clamp(18px, 2.2vw, 34px)', fontWeight: 800, flexShrink: 0 }}>{t.rank ?? (t.busy ? '●' : '·')}</div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 'clamp(18px, 2.2vw, 32px)', fontWeight: 800, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.name}</div>
                <div style={{ fontSize: 'clamp(13px, 1.4vw, 20px)', fontWeight: 700, color: state === 'next' ? 'var(--ink-good)' : state === 'busy' ? 'var(--ink-warn)' : 'var(--c94a3b8)' }}>{label}</div>
              </div>
              <div style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                <div style={{ fontSize: 'clamp(24px, 3vw, 44px)', fontWeight: 800, lineHeight: 1 }}>{fmtTurns(t.turns)}</div>
                <div style={{ fontSize: 'clamp(11px, 1.1vw, 15px)', color: 'var(--c94a3b8)' }}>{money ? formatPrice(t.moneyCents, cur) : T('tua', 'turns')}</div>
              </div>
            </div>
          );
        })}
      </section>
      {data && <footer style={{ fontSize: 'clamp(11px, 1.1vw, 15px)', color: 'var(--c64748b)', lineHeight: 1.4 }}>{rulesLine(data.rules, vi)}</footer>}
    </main>
  );
}
