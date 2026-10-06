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
import { PartyChip, type PartyInfo } from '../../../components/PartyChip';
import { arrivalState, clockIn, minutesText, salonDayLabel } from '../../../lib/desk-time';

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
  /** Minutes past the visit's expected finish (server-computed). */
  overdueMinutes?: number | null;
  group?: PartyInfo | null;
  /** When the customer actually walked in (a booking's check-in time). */
  arrivedAt?: string | null;
  /** The booked time, for a checked-in appointment. */
  bookedAt?: string | null;
}
interface Booked { id: string; startTime: string; customerName: string | null; serviceName: string | null; staff: { id: string; name: string } | null; source?: string; groupId?: string | null; groupSize?: number }
interface StaffChip { id: string; name: string; busy: boolean; busyFor: number | null; nextUp: boolean; turns: number }
interface Board { waiting: Ticket[]; serving: Ticket[]; booked: Booked[]; staff: StaffChip[]; timezone?: string | null }

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

  async function arrive(id: string, party = false) {
    setBusy(id);
    try { await apiFetch(`/walkins/seat-appointment/${id}`, { method: 'POST', token, body: party ? { party: true } : {} }); await load(); }
    catch (e) { setErr(e instanceof Error ? e.message : L('Không check-in được', 'Could not check in')); }
    finally { setBusy(null); }
  }

  // Every clock on this screen is the SALON's (board.timezone), never the browser's.
  const tz = board?.timezone || (typeof window !== 'undefined' ? window.localStorage.getItem('lumio_tz') : null) || null;
  const booked = board?.booked ?? [];
  // Still to come today, soonest first — and, apart, the ones whose time has
  // passed without a check-in (late, or a no-show to call).
  const upcoming = booked.filter((b) => arrivalState(b.startTime, now).kind !== 'late');
  const late = booked.filter((b) => arrivalState(b.startTime, now).kind === 'late');
  const waiting = board?.waiting ?? [];
  const inChair = (board?.serving ?? []).filter((w) => !w.awaitingPayment);
  const toPay = (board?.serving ?? []).filter((w) => w.awaitingPayment);
  const free = (board?.staff ?? []).filter((s) => !s.busy);
  const time = (iso: string | null | undefined) => clockIn(iso, tz, vi);
  const today = salonDayLabel(now, tz, vi);
  /** "vào 10:02" — when the customer came in, salon time. */
  const cameIn = (w: Ticket) => `${L('vào', 'in')} ${time(w.arrivedAt ?? w.createdAt)}`;

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

  /** One booking: its time (salon clock), how soon / how late, who, and check-in. */
  const bookedRow = (b: Booked) => {
    const st = arrivalState(b.startTime, now);
    const tone = st.kind === 'late' ? 'var(--ink-warn)' : st.kind === 'now' || st.kind === 'soon' ? 'var(--ink-good)' : 'var(--c94a3b8)';
    const when = st.kind === 'late' ? L(`trễ ${minutesText(st.minutes, vi)}`, `${minutesText(st.minutes, vi)} late`)
      : st.kind === 'now' ? L('đến giờ', 'due now')
      : L(`còn ${minutesText(st.minutes, vi)}`, `in ${minutesText(st.minutes, vi)}`);
    const hot = st.kind === 'now' || st.kind === 'soon';
    return (
      <div key={b.id} style={{ ...row, ...(hot ? { background: 'rgba(34,197,94,0.08)', boxShadow: 'inset 3px 0 0 #22c55e' } : null) }}>
        <span style={{ width: 66, flexShrink: 0 }}>
          <span style={{ display: 'block', fontWeight: 700, fontSize: 13.5, color: st.kind === 'late' ? 'var(--ink-warn)' : 'var(--ce2e8f0)' }}>{time(b.startTime)}</span>
          <span style={{ display: 'block', fontSize: 11, fontWeight: 700, color: tone, whiteSpace: 'nowrap' }}>{when}</span>
        </span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: 'block', ...name }}>{b.customerName || L('Khách', 'Guest')}</span>
          <span style={{ display: 'block', ...sub }}>{[b.serviceName, b.staff?.name ?? L('chưa giao thợ', 'no technician yet')].filter(Boolean).join(' · ')}</span>
        </span>
        {may('walkins') && (
          <span style={{ display: 'inline-flex', gap: 6, flexShrink: 0 }}>
            {/* A party: one press seats everyone booked together who is still to come. */}
            {(b.groupSize ?? 1) > 1 && (
              <button type="button" disabled={busy === b.id} onClick={() => arrive(b.id, true)} title={L('Nhận tất cả người trong nhóm còn chưa đến', 'Seat everyone in the party who has not arrived yet')}
                style={{ ...smallBtn, background: 'rgba(99,102,241,0.18)', color: 'var(--cc7d2fe)', border: '1px solid rgba(99,102,241,0.45)', opacity: busy === b.id ? 0.6 : 1 }}>
                {busy === b.id ? '…' : `👥 ${L('Cả nhóm', 'Party')} (${b.groupSize})`}
              </button>
            )}
            <button type="button" disabled={busy === b.id} onClick={() => arrive(b.id)} style={{ ...smallBtn, opacity: busy === b.id ? 0.6 : 1 }}>
              {busy === b.id ? '…' : L('Đã đến', 'Arrived')}
            </button>
          </span>
        )}
      </div>
    );
  };

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
          {board && !upcoming.length && empty(L('Không còn khách hẹn nào sắp tới hôm nay.', 'No more bookings to come today.'))}
          {upcoming.map((b) => bookedRow(b))}
          {late.length > 0 && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', background: 'var(--wash-amber-2)', borderBottom: '1px solid var(--line)', fontSize: 12, fontWeight: 700, color: 'var(--ink-warn)' }}>
                <span>⏰ {L('Quá giờ hẹn, chưa đến', 'Past their time, not here yet')}</span>
                <span style={{ marginLeft: 'auto' }}>{late.length}</span>
              </div>
              {late.map((b) => bookedRow(b))}
            </>
          )}
        </div>

        <div style={col}>
          {head(L('Đang chờ', 'Waiting'), waiting.length, '#f59e0b')}
          {board && !waiting.length && empty(L('Không có khách đang chờ.', 'Nobody is waiting.'))}
          {waiting.map((w) => {
            const m = minsSince(w.arrivedAt ?? w.createdAt, now);
            return (
              <a key={w.id} href="/salon/walkins" style={{ ...row, textDecoration: 'none' }}>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', ...name }}>{w.customerName || L('Khách', 'Guest')}{!w.group && (w.partySize ?? 1) > 1 ? ` · ${w.partySize}` : ''}</span>
                  <span style={{ display: 'block', ...sub }}>{services(w) || L('Chưa chọn dịch vụ', 'No service yet')}</span>
                </span>
                <PartyChip group={w.group} />
                <span style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <span style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: m >= 20 ? 'var(--ink-bad)' : m >= 10 ? 'var(--ink-warn)' : 'var(--c94a3b8)' }}>{minutesText(m, vi)}</span>
                  <span style={{ display: 'block', fontSize: 11, color: 'var(--c64748b)' }}>{cameIn(w)}</span>
                </span>
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
              <PartyChip group={w.group} />
              {w.overdueMinutes != null && w.overdueMinutes >= 15 && (
                <span title={L('Khách đã quá thời gian dịch vụ. Quá 45′ hệ thống tự chuyển sang Chờ thanh toán để thợ rảnh.', 'Past the services\u2019 time. At 45′ over, the visit moves to Waiting to pay by itself so the technician is free.')}
                  style={{ fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap', borderRadius: 999, padding: '2px 8px', color: w.overdueMinutes >= 45 ? 'var(--ink-bad)' : 'var(--ink-warn)', background: w.overdueMinutes >= 45 ? 'rgba(239,68,68,0.14)' : 'var(--wash-amber-2)' }}>
                  ⏰ {L('Quá giờ', 'Over')} +{w.overdueMinutes}′
                </span>
              )}
              <span style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                <span style={{ display: 'block', fontSize: 12.5, color: 'var(--c94a3b8)' }} title={L('Đã làm được', 'In the chair for')}>{minutesText(minsSince(w.assignedAt ?? w.createdAt, now), vi)}</span>
                <span style={{ display: 'block', fontSize: 11, color: 'var(--c64748b)' }}>{cameIn(w)}</span>
              </span>
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
                <span style={{ display: 'block', fontSize: 11, color: 'var(--c64748b)' }}>{cameIn(w)}</span>
              </span>
              {may('pos') && <a href={checkoutHref(w)} style={smallBtn}>{L('Tính tiền', 'Check out')}</a>}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
