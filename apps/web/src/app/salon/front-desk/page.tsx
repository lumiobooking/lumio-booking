'use client';

/**
 * QUẦY LỄ TÂN — the receptionist's home screen.
 *
 * A receptionist used to sign in and land in the technicians' app, or on a
 * dashboard of takings she is not meant to see. Her job is four lists and four
 * buttons: who is arriving, who is waiting, who is in a chair, who is ready to
 * pay — and "new walk-in", "new booking", "check out", "find a client". This
 * screen is exactly that, read from the same floor board the Walk-ins page uses,
 * so the two can never disagree. Owners and managers can open it too.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { SalonShell } from '../../../components/SalonShell';
import { useAuth } from '../../../lib/auth';
import { apiFetch } from '../../../lib/api';
import { ui } from '../../../lib/ui';
import { useLang } from '../../../lib/i18n';

interface Ticket {
  id: string;
  customerName: string | null;
  customerId?: string | null;
  partySize?: number;
  note?: string | null;
  createdAt: string;
  assignedAt?: string | null;
  awaitingPayment?: boolean;
  service?: { id: string; name: string } | null;
  assignedStaff?: { id: string; firstName: string; lastName: string | null } | null;
  items?: { name?: string }[];
  phase?: 'WAITING' | 'SERVING' | 'BETWEEN' | 'DONE';
}
interface Booked { id: string; startTime: string; customerName: string | null; serviceName: string | null; staff: { id: string; name: string } | null; source?: string }
interface StaffChip { id: string; name: string; busy: boolean; busyFor: number | null; nextUp: boolean; turns: number }
interface Board { waiting: Ticket[]; serving: Ticket[]; booked: Booked[]; staff: StaffChip[] }

export default function FrontDeskPage() {
  return (
    <SalonShell>
      <FrontDesk />
    </SalonShell>
  );
}

const minsSince = (iso: string | null | undefined, now: number) => (iso ? Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000)) : 0);
const services = (t: Ticket) => {
  const names = (t.items ?? []).map((i) => i.name).filter(Boolean) as string[];
  return names.length ? names.join(' + ') : t.service?.name ?? '';
};
const techName = (t: Ticket) => (t.assignedStaff ? `${t.assignedStaff.firstName}${t.assignedStaff.lastName ? ' ' + t.assignedStaff.lastName : ''}` : '');
const checkoutHref = (w: Ticket) => `/salon/pos?walkInId=${w.id}&serviceId=${w.service?.id ?? ''}&staffId=${w.assignedStaff?.id ?? ''}&customerId=${w.customerId ?? ''}&customer=${encodeURIComponent(w.customerName || '')}`;

function FrontDesk() {
  const { token, user } = useAuth();
  const { lang } = useLang();
  const vi = lang === 'vi';
  const L = (v: string, e: string) => (vi ? v : e);
  const caps = useMemo(() => new Set(user?.capabilities ?? []), [user?.capabilities]);
  const owner = user?.role === 'SALON_ADMIN' || user?.role === 'SUPER_ADMIN';
  const may = (c: string) => owner || caps.has(c);
  const [board, setBoard] = useState<Board | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    if (!token) return;
    try { setBoard(await apiFetch<Board>('/walkins/board', { token })); setErr(null); }
    catch (e) { setErr(e instanceof Error ? e.message : L('Không tải được', 'Could not load')); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);
  useEffect(() => {
    load();
    const a = window.setInterval(load, 15_000);
    const b = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => { window.clearInterval(a); window.clearInterval(b); };
  }, [load]);

  async function arrive(id: string) {
    setBusy(id);
    try { await apiFetch(`/walkins/seat-appointment/${id}`, { method: 'POST', token }); await load(); }
    catch (e) { setErr(e instanceof Error ? e.message : L('Không check-in được', 'Could not check in')); }
    finally { setBusy(null); }
  }

  const upcoming = board?.booked ?? [];
  const waiting = board?.waiting ?? [];
  const inChair = (board?.serving ?? []).filter((w) => !w.awaitingPayment);
  const toPay = (board?.serving ?? []).filter((w) => w.awaitingPayment);
  const free = (board?.staff ?? []).filter((s) => !s.busy);
  const time = (iso: string) => new Date(iso).toLocaleTimeString(vi ? 'vi-VN' : 'en-US', { hour: 'numeric', minute: '2-digit' });
  const today = new Date(now).toLocaleDateString(vi ? 'vi-VN' : 'en-US', { weekday: 'long', day: 'numeric', month: 'long' });

  const actions = [
    may('walkins') && { href: '/salon/walkins?new=1', icon: '🚶', t: L('Khách walk-in', 'New walk-in'), d: L('Nhận khách vào hàng chờ', 'Add to the queue') },
    may('bookings') && { href: '/salon/bookings?new=1', icon: '📅', t: L('Đặt lịch', 'New booking'), d: L('Khách gọi / hẹn lần sau', 'Phone or next visit') },
    may('pos') && { href: '/salon/pos', icon: '💳', t: L('Tính tiền', 'Check out'), d: L('Mở máy tính tiền', 'Open the register') },
    may('customers') && { href: '/salon/customers', icon: '🔎', t: L('Tìm khách', 'Find a client'), d: L('Tên hoặc số điện thoại', 'Name or phone') },
  ].filter(Boolean) as { href: string; icon: string; t: string; d: string }[];

  const col: React.CSSProperties = { ...ui.card, padding: 0, marginBottom: 0, display: 'flex', flexDirection: 'column', minWidth: 0 };
  const head = (title: string, n: number, tone: string) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 14px', borderBottom: '1px solid var(--line)' }}>
      <span style={{ width: 9, height: 9, borderRadius: '50%', background: tone, flexShrink: 0 }} />
      <span style={{ fontWeight: 700, fontSize: 14.5, color: 'var(--cf1f5f9)', flex: 1 }}>{title}</span>
      <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--c94a3b8)' }}>{n}</span>
    </div>
  );
  const row: React.CSSProperties = { padding: '11px 14px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 10 };
  const empty = (s: string) => <div style={{ padding: '18px 14px', fontSize: 13, color: 'var(--c64748b)' }}>{s}</div>;
  const name: React.CSSProperties = { fontWeight: 600, fontSize: 14, color: 'var(--ce2e8f0)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };
  const sub: React.CSSProperties = { fontSize: 12.5, color: 'var(--c94a3b8)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };
  const smallBtn: React.CSSProperties = { ...ui.primaryBtn, padding: '7px 12px', fontSize: 12.5, whiteSpace: 'nowrap', textDecoration: 'none', flexShrink: 0 };

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <h2 style={{ fontSize: 20, margin: 0 }}>{L('Quầy lễ tân', 'Front desk')}</h2>
        <span style={{ fontSize: 13.5, color: 'var(--c94a3b8)', textTransform: 'capitalize' }}>{today}</span>
        <span style={{ flex: 1 }} />
        {may('walkins') && <a href="/salon/walkins" style={{ fontSize: 13, color: 'var(--ink-link)', textDecoration: 'none' }}>{L('Mở bảng Walk-ins & xoay tua →', 'Open Walk-ins & turns →')}</a>}
      </div>

      {err && <div style={ui.banner}>{err}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 10 }}>
        {actions.map((a) => (
          <a key={a.href} href={a.href} style={{ ...ui.card, marginBottom: 0, textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px' }}>
            <span style={{ fontSize: 24 }} aria-hidden>{a.icon}</span>
            <span style={{ minWidth: 0 }}>
              <span style={{ display: 'block', fontWeight: 700, fontSize: 15, color: 'var(--cf1f5f9)' }}>{a.t}</span>
              <span style={{ display: 'block', fontSize: 12.5, color: 'var(--c94a3b8)' }}>{a.d}</span>
            </span>
          </a>
        ))}
      </div>

      {(board?.staff?.length ?? 0) > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--ccbd5e1)' }}>{L(`Thợ rảnh ${free.length}/${board!.staff.length}`, `Free techs ${free.length}/${board!.staff.length}`)}</span>
          {board!.staff.map((s) => (
            <span key={s.id} title={s.busy && s.busyFor ? L(`rảnh trong ~${s.busyFor} phút`, `free in ~${s.busyFor} min`) : ''}
              style={{ fontSize: 12.5, fontWeight: 600, padding: '4px 10px', borderRadius: 999, whiteSpace: 'nowrap',
                border: `1px solid ${s.busy ? 'var(--line)' : 'var(--c166534)'}`,
                background: s.busy ? 'transparent' : 'var(--c14532d)', color: s.busy ? 'var(--c94a3b8)' : 'var(--cbbf7d0)' }}>
              {s.nextUp ? '★ ' : ''}{s.name}{s.busy ? (s.busyFor ? ` · ${s.busyFor}′` : ` · ${L('bận', 'busy')}`) : ''}
            </span>
          ))}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14, alignItems: 'start' }}>
        <div style={col}>
          {head(L('Sắp đến', 'Arriving today'), upcoming.length, '#6366f1')}
          {board && !upcoming.length && empty(L('Không còn lịch hẹn nào hôm nay.', 'No more bookings today.'))}
          {upcoming.map((b) => {
            const late = new Date(b.startTime).getTime() < now;
            return (
              <div key={b.id} style={row}>
                <span style={{ width: 62, flexShrink: 0, fontWeight: 700, fontSize: 13.5, color: late ? 'var(--ink-warn)' : 'var(--ce2e8f0)' }}>{time(b.startTime)}</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', ...name }}>{b.customerName || L('Khách', 'Guest')}</span>
                  <span style={{ display: 'block', ...sub }}>{[b.serviceName, b.staff?.name].filter(Boolean).join(' · ')}</span>
                </span>
                {may('walkins') && (
                  <button type="button" disabled={busy === b.id} onClick={() => arrive(b.id)} style={{ ...smallBtn, opacity: busy === b.id ? 0.6 : 1 }}>
                    {busy === b.id ? '…' : L('Đã đến', 'Arrived')}
                  </button>
                )}
              </div>
            );
          })}
        </div>

        <div style={col}>
          {head(L('Đang chờ', 'Waiting'), waiting.length, '#f59e0b')}
          {board && !waiting.length && empty(L('Không có khách đang chờ.', 'Nobody is waiting.'))}
          {waiting.map((w) => {
            const m = minsSince(w.createdAt, now);
            return (
              <a key={w.id} href="/salon/walkins" style={{ ...row, textDecoration: 'none' }}>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', ...name }}>{w.customerName || L('Khách', 'Guest')}{(w.partySize ?? 1) > 1 ? ` · ${w.partySize}` : ''}</span>
                  <span style={{ display: 'block', ...sub }}>{services(w) || L('Chưa chọn dịch vụ', 'No service yet')}</span>
                </span>
                <span style={{ fontSize: 12.5, fontWeight: 700, color: m >= 20 ? 'var(--ink-bad)' : m >= 10 ? 'var(--ink-warn)' : 'var(--c94a3b8)', whiteSpace: 'nowrap' }}>{m}′</span>
              </a>
            );
          })}
        </div>

        <div style={col}>
          {head(L('Đang làm', 'In a chair'), inChair.length, '#22c55e')}
          {board && !inChair.length && empty(L('Chưa có khách nào đang làm.', 'Nobody in a chair.'))}
          {inChair.map((w) => (
            <div key={w.id} style={row}>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', ...name }}>{w.customerName || L('Khách', 'Guest')}</span>
                <span style={{ display: 'block', ...sub }}>{[techName(w), services(w)].filter(Boolean).join(' · ')}</span>
              </span>
              <span style={{ fontSize: 12.5, color: 'var(--c94a3b8)', whiteSpace: 'nowrap' }}>{minsSince(w.assignedAt ?? w.createdAt, now)}′</span>
              {may('pos') && <a href={checkoutHref(w)} style={{ ...smallBtn, background: 'var(--c334155)', color: 'var(--ce2e8f0)' }}>{L('Tính tiền', 'Check out')}</a>}
            </div>
          ))}
        </div>

        <div style={col}>
          {head(L('Chờ tính tiền', 'Ready to pay'), toPay.length, '#ef4444')}
          {board && !toPay.length && empty(L('Không có khách chờ tính tiền.', 'Nobody waiting to pay.'))}
          {toPay.map((w) => (
            <div key={w.id} style={row}>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', ...name }}>{w.customerName || L('Khách', 'Guest')}</span>
                <span style={{ display: 'block', ...sub }}>{[techName(w), services(w)].filter(Boolean).join(' · ')}</span>
              </span>
              {may('pos') && <a href={checkoutHref(w)} style={smallBtn}>{L('Tính tiền', 'Check out')}</a>}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
