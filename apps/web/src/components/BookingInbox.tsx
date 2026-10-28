'use client';

/**
 * The header's booking notifications — built from the approved canvas
 * "Lịch — thông báo, sắp xếp thợ, 1 thợ":
 *
 *   ConfirmPill        2A  yellow "3 cần xác nhận", right after the menu button;
 *                          hidden when nothing waits. Opens the bell on that tab.
 *   BookingSoundToggle 2B  "Tiếng báo" on / off for the ting (this device).
 *   InboxPanel         2A  the bell's list: Cần xác nhận · Mới đặt · Đã huỷ,
 *                          with Xác nhận / Từ chối right in the row.
 *                     2C  on a phone: a sheet from the bottom, big buttons.
 *   BookingToasts      2B  a card top-right for 8 s when a customer books or
 *                          cancels, and one "ting".
 *
 * The data comes from lib/booking-inbox (one poll, in the bell). The API
 * scopes everything to the signed-in salon.
 */
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { apiFetch } from '../lib/api';
import { formatPrice } from '../lib/money';
import { uiLocale } from '../lib/datetime';
import { srcMetaOf } from '../lib/booking-sources';
import { openInbox, removeFromInbox, TOAST_MS, useInbox, useSoundOn, type InboxItem, type InboxTab, type ToastItem } from '../lib/booking-inbox';

const L = (vi: boolean, v: string, e: string) => (vi ? v : e);
const AMBER = '#f59e0b';
const GREEN = '#16a34a';
const RED = '#dc2626';
const INDIGO = '#4f46e5';
const HUES = ['#6366f1', '#db2777', '#16a34a', '#0891b2', '#ea580c', '#7c3aed', '#ca8a04'];

const tzNow = () => { try { return window.localStorage.getItem('lumio_tz') || undefined; } catch { return undefined; } };

/** "Hôm nay 2:30 PM" · "Mai 10:00 AM" · "Thứ 6, 31/10 · 4:00 PM". */
export function whenLabel(iso: string, vi: boolean, now = new Date()): string {
  const d = new Date(iso);
  const tz = tzNow();
  const loc = uiLocale();
  const day = (x: Date) => x.toLocaleDateString('en-CA', { timeZone: tz });
  const time = d.toLocaleTimeString(loc, { hour: 'numeric', minute: '2-digit', timeZone: tz });
  const tomorrow = new Date(now.getTime() + 86400_000);
  if (day(d) === day(now)) return `${L(vi, 'Hôm nay', 'Today')} ${time}`;
  if (day(d) === day(tomorrow)) return `${L(vi, 'Ngày mai', 'Tomorrow')} ${time}`;
  const date = d.toLocaleDateString(vi ? 'vi-VN' : loc, { weekday: 'short', day: 'numeric', month: 'numeric', timeZone: tz });
  return `${date} · ${time}`;
}

export function agoLabel(iso: string, vi: boolean): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return L(vi, 'vừa xong', 'just now');
  if (s < 3600) return L(vi, `${Math.floor(s / 60)} phút trước`, `${Math.floor(s / 60)} min ago`);
  if (s < 86400) return L(vi, `${Math.floor(s / 3600)} giờ trước`, `${Math.floor(s / 3600)} h ago`);
  return L(vi, `${Math.floor(s / 86400)} ngày trước`, `${Math.floor(s / 86400)} d ago`);
}

const price = (i: InboxItem) => (i.priceCents > 0 ? formatPrice(i.priceCents, i.currency).replace(/[.,]00(?=\D*$)/, '') : '');
const hueOf = (name: string) => HUES[[...name].reduce((s, c) => s + c.charCodeAt(0), 0) % HUES.length];

function SourceTag({ i, vi }: { i: InboxItem; vi: boolean }) {
  const m = srcMetaOf(i);
  return (
    <span style={{ flexShrink: 0, fontSize: 11, fontWeight: 700, color: m.color, background: `color-mix(in srgb, ${m.color} 14%, transparent)`, borderRadius: 999, padding: '2px 8px', whiteSpace: 'nowrap' }}>
      {vi ? m.labelVi : m.labelEn}
    </span>
  );
}

// ---------------------------------------------------------------- the pill

/** 2A: "3 cần xác nhận". Nothing waiting → nothing drawn. */
export function ConfirmPill({ vi, compact }: { vi: boolean; compact?: boolean }) {
  const { inbox } = useInbox();
  const n = inbox.needs.length;
  if (!n) return null;
  return (
    <button type="button" onClick={() => openInbox('needs')}
      aria-label={L(vi, `${n} lịch cần xác nhận`, `${n} bookings to confirm`)}
      style={{ height: compact ? 36 : 40, padding: compact ? '0 10px 0 6px' : '0 14px 0 10px', borderRadius: 999, border: `1px solid ${AMBER}`, background: 'var(--wash-amber-3)', color: 'var(--ink-warn)', fontFamily: 'inherit', fontSize: compact ? 13 : 14, fontWeight: 700, display: 'flex', alignItems: 'center', gap: compact ? 6 : 8, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0, boxShadow: compact ? 'none' : '0 0 0 4px rgba(245,158,11,0.15)' }}>
      <span style={{ minWidth: compact ? 22 : 24, height: compact ? 22 : 24, padding: '0 6px', boxSizing: 'border-box', borderRadius: 999, background: AMBER, color: '#fff', fontSize: compact ? 12 : 13, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{n}</span>
      {compact ? L(vi, 'xác nhận', 'to confirm') : L(vi, 'cần xác nhận', 'to confirm')}
    </button>
  );
}

// ---------------------------------------------------------------- sound

const SpeakerIcon = ({ on }: { on: boolean }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M11 5L6 9H2v6h4l5 4V5z" />
    {on ? <><path d="M15.5 8.5a5 5 0 0 1 0 7" /><path d="M19 5a10 10 0 0 1 0 14" /></> : <path d="M22 9l-6 6M16 9l6 6" />}
  </svg>
);

/** 2B: "Tiếng báo" — the ting when a customer books or cancels. Shown once the inbox has loaded (the desk can read bookings). */
export function BookingSoundToggle({ vi }: { vi: boolean }) {
  const { loaded } = useInbox();
  const [on, setOn] = useSoundOn();
  if (!loaded) return null;
  return (
    <button type="button" onClick={() => setOn(!on)} aria-pressed={on}
      title={on ? L(vi, 'Đang bật tiếng “ting” khi khách đặt / huỷ — bấm để tắt', 'A “ting” plays when a customer books or cancels — click to mute') : L(vi, 'Đang tắt tiếng báo — bấm để bật', 'Booking sound is off — click to turn on')}
      style={{ height: 40, padding: '0 12px', borderRadius: 10, border: '1px solid var(--line)', background: 'var(--c0f172a)', color: on ? 'var(--ce2e8f0)' : 'var(--c64748b)', fontFamily: 'inherit', fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}>
      <SpeakerIcon on={on} />{on ? L(vi, 'Tiếng báo', 'Sound') : L(vi, 'Tiếng báo: tắt', 'Sound: off')}
    </button>
  );
}

// ---------------------------------------------------------------- actions

async function confirmBooking(token: string | null, id: string) {
  await apiFetch(`/bookings/${encodeURIComponent(id)}/confirm`, { method: 'POST', token });
  removeFromInbox(id, ['needs']);
}
/** "Từ chối": the salon cannot take it — cancelled, a paid deposit goes back, the customer is told (bookings cancel). */
async function declineBooking(token: string | null, id: string) {
  await apiFetch(`/bookings/${encodeURIComponent(id)}/cancel`, { method: 'POST', token, body: { money: 'refund' } });
  removeFromInbox(id, ['needs', 'fresh']);
}

function useRowAction(token: string | null, vi: boolean, after?: () => void) {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<{ id: string; msg: string } | null>(null);
  const run = async (id: string, what: 'confirm' | 'decline') => {
    setBusy(id); setErr(null);
    try { await (what === 'confirm' ? confirmBooking(token, id) : declineBooking(token, id)); after?.(); }
    catch (e) { setErr({ id, msg: e instanceof Error ? e.message : L(vi, 'Không lưu được, thử lại', 'Could not save, try again') }); }
    finally { setBusy(null); }
  };
  return { busy, err, run };
}

// ---------------------------------------------------------------- the panel

export function InboxPanel({ token, vi, mobile, tab, setTab, onOpen, onClose, onSeen, onAll, others, onChanged }: {
  token: string | null; vi: boolean; mobile: boolean;
  tab: InboxTab; setTab: (t: InboxTab) => void;
  /** A customer's name was clicked: the booking's details. */
  onOpen: (id: string) => void;
  onClose: () => void;
  onSeen: () => void;
  onAll: () => void;
  /** Other notifications not about bookings (payments, posts, reports) not seen yet. */
  others: number;
  onChanged: () => void;
}) {
  const { inbox } = useInbox();
  const [asking, setAsking] = useState<string | null>(null);
  const { busy, err, run } = useRowAction(token, vi, onChanged);
  const list = inbox[tab];
  const big = mobile;

  const tabBtn = (t: InboxTab, label: string, color: string) => {
    const on = tab === t;
    const n = inbox[t].length;
    return (
      <button key={t} type="button" onClick={() => setTab(t)} aria-pressed={on}
        style={{ flex: t === 'needs' ? 1.3 : 1, height: 36, borderRadius: 9, border: on ? `1px solid ${t === 'needs' ? AMBER : color}` : '1px solid transparent', background: on ? (t === 'needs' ? 'var(--wash-amber-3)' : 'var(--c1e293b)') : 'var(--c111827)', color: on && t === 'needs' ? 'var(--ink-warn)' : 'var(--ce2e8f0)', fontFamily: 'inherit', fontSize: 13, fontWeight: on ? 700 : 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, cursor: 'pointer', whiteSpace: 'nowrap', minWidth: 0 }}>
        {label}{n > 0 && <span style={{ background: color, color: '#fff', borderRadius: 999, padding: '0 7px', fontSize: 12, lineHeight: '18px' }}>{n}</span>}
      </button>
    );
  };

  const row = (i: InboxItem) => {
    const needs = tab === 'needs';
    const cancelled = tab === 'cancelled';
    const hue = hueOf(i.customer);
    const line2 = [whenLabel(i.startTime, vi), i.staff ?? (needs ? L(vi, 'Thợ bất kỳ', 'Any technician') : null), price(i)].filter(Boolean).join(' · ');
    const sure = asking === i.id;
    const actBtn: CSSProperties = { height: big ? 44 : 34, borderRadius: big ? 10 : 8, fontFamily: 'inherit', fontSize: big ? 14 : 13, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: busy ? 'wait' : 'pointer', opacity: busy === i.id ? 0.6 : 1 };
    return (
      <div key={i.id} style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 8, background: needs ? 'var(--wash-amber)' : 'transparent' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {!big && <span aria-hidden="true" style={{ width: 34, height: 34, flexShrink: 0, borderRadius: '50%', background: `color-mix(in srgb, ${hue} 18%, transparent)`, color: hue, fontWeight: 700, fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{i.customer.charAt(0).toUpperCase()}</span>}
          <button type="button" onClick={() => onOpen(i.id)} style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1, background: 'transparent', border: 0, padding: 0, textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit', color: 'var(--ce2e8f0)' }}>
            <span style={{ fontSize: big ? 14.5 : 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', textDecoration: cancelled ? 'line-through' : 'none' }}>
              <b>{i.customer}</b> <span style={{ color: 'var(--c94a3b8)' }}>· {i.service}{i.extra > 0 ? ` +${i.extra}` : ''}</span>
            </span>
            <span style={{ fontSize: big ? 13 : 12.5, color: 'var(--ccbd5e1)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {line2}{cancelled ? L(vi, ' — giờ này đã trống', ' — that time is free now') : ''}
            </span>
          </button>
          <SourceTag i={i} vi={vi} />
        </div>
        {needs && !sure && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', paddingLeft: big ? 0 : 44 }}>
            <button type="button" disabled={!!busy} onClick={() => void run(i.id, 'confirm')}
              style={{ ...actBtn, flex: big ? 1 : undefined, padding: '0 16px', border: 0, background: GREEN, color: '#fff', fontWeight: 700 }}>✓ {L(vi, 'Xác nhận', 'Confirm')}</button>
            <button type="button" disabled={!!busy} onClick={() => setAsking(i.id)}
              style={{ ...actBtn, flex: big ? '0 0 100px' : undefined, padding: '0 14px', border: '1px solid var(--line-strong)', background: 'transparent', color: 'var(--ink-bad)', fontWeight: 600 }}>{L(vi, 'Từ chối', 'Decline')}</button>
            {!big && <span style={{ flex: 1 }} />}
            {!big && <span style={{ fontSize: 12, color: 'var(--c64748b)' }}>{agoLabel(i.at, vi)}</span>}
          </div>
        )}
        {needs && sure && (
          <div role="alertdialog" aria-label={L(vi, 'Từ chối lịch này?', 'Decline this booking?')} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', paddingLeft: big ? 0 : 44 }}>
            <span style={{ fontSize: 13, color: 'var(--ce2e8f0)', flex: '1 1 100%' }}>{L(vi, 'Từ chối lịch này? Khách sẽ được báo, tiền cọc (nếu có) được hoàn.', 'Decline this booking? The customer is told; any deposit is refunded.')}</span>
            <button type="button" disabled={!!busy} onClick={() => { setAsking(null); void run(i.id, 'decline'); }}
              style={{ ...actBtn, padding: '0 14px', border: 0, background: RED, color: '#fff', fontWeight: 700 }}>{L(vi, 'Từ chối lịch', 'Decline')}</button>
            <button type="button" onClick={() => setAsking(null)}
              style={{ ...actBtn, padding: '0 14px', border: '1px solid var(--line-strong)', background: 'transparent', color: 'var(--ce2e8f0)', fontWeight: 600 }}>{L(vi, 'Thôi', 'Keep it')}</button>
          </div>
        )}
        {!needs && <span style={{ fontSize: 12, color: 'var(--c64748b)', paddingLeft: big ? 0 : 44 }}>{cancelled ? L(vi, 'Huỷ ', 'Cancelled ') : L(vi, 'Đặt ', 'Booked ')}{agoLabel(i.at, vi)}</span>}
        {err && err.id === i.id && <span role="alert" style={{ fontSize: 12.5, color: 'var(--ink-bad)', paddingLeft: big ? 0 : 44 }}>{err.msg}</span>}
      </div>
    );
  };

  const empty = tab === 'needs' ? L(vi, 'Không có lịch nào chờ xác nhận.', 'Nothing waiting for a yes.')
    : tab === 'fresh' ? L(vi, 'Chưa có lịch khách mới đặt trong 2 ngày qua.', 'No new customer bookings in the last 2 days.')
      : L(vi, 'Không có lịch nào bị huỷ trong 2 ngày qua.', 'No cancellations in the last 2 days.');

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', padding: big ? '4px 16px 10px' : '14px 16px 10px', gap: 10, flexShrink: 0 }}>
        <b style={{ flex: 1, fontSize: big ? 17 : 16, color: 'var(--cf1f5f9)' }}>{L(vi, 'Thông báo', 'Notifications')}</b>
        {big ? <MiniSound vi={vi} /> : null}
        <button type="button" onClick={onSeen} style={{ background: 'transparent', border: 0, color: 'var(--ink-link)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>{L(vi, 'Đánh dấu đã xem', 'Mark as seen')}</button>
        {big && <button type="button" onClick={onClose} aria-label={L(vi, 'Đóng', 'Close')} style={{ background: 'transparent', border: 0, color: 'var(--c94a3b8)', fontSize: 24, lineHeight: 1, cursor: 'pointer' }}>×</button>}
      </div>
      <div role="tablist" style={{ display: 'flex', gap: 6, padding: '0 12px 10px', borderBottom: '1px solid var(--line)', flexShrink: 0 }}>
        {tabBtn('needs', L(vi, 'Cần xác nhận', 'To confirm'), AMBER)}
        {tabBtn('fresh', big ? L(vi, 'Mới', 'New') : L(vi, 'Mới đặt', 'New'), INDIGO)}
        {tabBtn('cancelled', big ? L(vi, 'Huỷ', 'Cancelled') : L(vi, 'Đã huỷ', 'Cancelled'), RED)}
      </div>
      <div style={{ overflowY: 'auto', flex: 1, minHeight: 0 }}>
        {list.length === 0
          ? <p style={{ color: 'var(--c64748b)', fontSize: 13.5, padding: '26px 16px', textAlign: 'center', margin: 0 }}>{empty}</p>
          : list.map(row)}
      </div>
      {others > 0 && (
        <button type="button" onClick={onAll} style={{ flexShrink: 0, border: 0, borderTop: '1px solid var(--line)', background: 'transparent', padding: '9px 16px', textAlign: 'left', fontSize: 12.5, color: 'var(--ccbd5e1)', cursor: 'pointer', fontFamily: 'inherit' }}>
          {L(vi, `+${others} thông báo khác (thanh toán, bài đăng…)`, `+${others} other notifications (payments, posts…)`)}
        </button>
      )}
      <div style={{ padding: big ? '12px 16px 22px' : '12px 16px', borderTop: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: big ? 'center' : 'space-between', gap: 10, fontSize: 13, flexShrink: 0 }}>
        {!big && <span style={{ color: 'var(--c64748b)' }}>{L(vi, 'Bấm tên khách để mở chi tiết lịch hẹn', 'Click a name to open the booking')}</span>}
        <button type="button" onClick={onAll} style={{ background: 'transparent', border: 0, color: 'var(--ink-link)', fontWeight: 700, fontSize: big ? 14 : 13, cursor: 'pointer', fontFamily: 'inherit' }}>{big ? L(vi, 'Xem tất cả thông báo →', 'All notifications →') : L(vi, 'Xem tất cả →', 'View all →')}</button>
      </div>
    </>
  );
}

/** The phone has no room for "Tiếng báo" in its top bar: it sits in the sheet's header. */
function MiniSound({ vi }: { vi: boolean }) {
  const [on, setOn] = useSoundOn();
  return (
    <button type="button" onClick={() => setOn(!on)} aria-pressed={on} aria-label={on ? L(vi, 'Tắt tiếng báo', 'Mute') : L(vi, 'Bật tiếng báo', 'Unmute')}
      style={{ width: 36, height: 36, borderRadius: 9, border: '1px solid var(--line)', background: 'transparent', color: on ? 'var(--ce2e8f0)' : 'var(--c64748b)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
      <SpeakerIcon on={on} />
    </button>
  );
}

// ---------------------------------------------------------------- toasts

const TOAST_LOOK: Record<InboxTab, { edge: string; chipBg: string; chipInk: string; vi: string; en: string }> = {
  needs: { edge: AMBER, chipBg: 'var(--wash-amber-3)', chipInk: 'var(--ink-warn)', vi: 'CẦN XÁC NHẬN', en: 'TO CONFIRM' },
  cancelled: { edge: RED, chipBg: 'var(--wash-red-2)', chipInk: 'var(--ink-bad)', vi: 'ĐÃ HUỶ', en: 'CANCELLED' },
  fresh: { edge: INDIGO, chipBg: 'var(--wash-blue)', chipInk: 'var(--ink-link)', vi: 'MỚI ĐẶT', en: 'NEW' },
};

function Toast({ t, vi, mobile, token, onClose, onOpen, onChanged }: { t: ToastItem; vi: boolean; mobile: boolean; token: string | null; onClose: () => void; onOpen: (id: string) => void; onChanged: () => void }) {
  const look = TOAST_LOOK[t.tab];
  const i = t.item;
  const [paused, setPaused] = useState(false);
  const left = useRef(TOAST_MS);
  const [pct, setPct] = useState(100);
  const { busy, err, run } = useRowAction(token, vi, () => { onChanged(); onClose(); });
  useEffect(() => {
    if (paused) return;
    const started = Date.now();
    const base = left.current;
    const iv = window.setInterval(() => {
      const rem = base - (Date.now() - started);
      left.current = rem;
      setPct(Math.max(0, (rem / TOAST_MS) * 100));
      if (rem <= 0) { window.clearInterval(iv); onClose(); }
    }, 100);
    return () => window.clearInterval(iv);
  }, [paused, onClose]);
  const who = <b>{i.customer}</b>;
  const svc = <b>{i.service}{i.extra > 0 ? ` +${i.extra}` : ''}</b>;
  const line2 = [whenLabel(i.startTime, vi), i.staff, t.tab === 'cancelled' ? null : price(i)].filter(Boolean).join(' · ');
  const m = srcMetaOf(i);
  return (
    <div role="status" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} onTouchStart={() => setPaused(true)}
      style={{ position: 'relative', overflow: 'hidden', background: 'var(--c111827)', border: '1px solid var(--line)', borderLeft: `5px solid ${look.edge}`, borderRadius: 12, boxShadow: '0 14px 36px rgba(15,23,42,0.28)', padding: t.tab === 'fresh' ? '10px 14px' : '12px 14px', display: 'flex', flexDirection: 'column', gap: t.tab === 'fresh' ? 0 : 6, color: 'var(--ce2e8f0)' }}>
      {t.tab === 'fresh' ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 11, fontWeight: 800, color: look.chipInk, background: look.chipBg, borderRadius: 999, padding: '2px 8px', whiteSpace: 'nowrap' }}>{vi ? look.vi : look.en}</span>
          <button type="button" onClick={() => { onOpen(i.id); onClose(); }} style={{ flex: 1, minWidth: 0, textAlign: 'left', background: 'transparent', border: 0, padding: 0, color: 'var(--ce2e8f0)', fontFamily: 'inherit', fontSize: 13.5, cursor: 'pointer', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            <b>{i.customer}</b> · {i.service} · {whenLabel(i.startTime, vi)}
          </button>
          <button type="button" onClick={onClose} aria-label={L(vi, 'Đóng', 'Close')} style={{ background: 'transparent', border: 0, color: 'var(--c94a3b8)', fontSize: 18, lineHeight: 1, cursor: 'pointer' }}>×</button>
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 800, color: look.chipInk, background: look.chipBg, borderRadius: 999, padding: '2px 8px', letterSpacing: '.02em' }}>{vi ? look.vi : look.en}</span>
            <span style={{ fontSize: 12, color: 'var(--c94a3b8)' }}>{agoLabel(i.at, vi)}{t.tab === 'needs' ? ` · ${vi ? m.labelVi : m.labelEn}` : ''}</span>
            <span style={{ flex: 1 }} />
            <button type="button" onClick={onClose} aria-label={L(vi, 'Đóng', 'Close')} style={{ background: 'transparent', border: 0, color: 'var(--c94a3b8)', fontSize: 18, lineHeight: 1, cursor: 'pointer' }}>×</button>
          </div>
          <span style={{ fontSize: 14.5 }}>{who} {t.tab === 'cancelled' ? L(vi, 'huỷ', 'cancelled') : L(vi, 'vừa đặt', 'just booked')} {svc}</span>
          <span style={{ fontSize: 13, color: 'var(--ccbd5e1)' }}>{line2}{t.tab === 'cancelled' ? L(vi, ' — giờ này đã trống', ' — that time is free now') : ''}</span>
          {t.tab === 'needs' && (
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" disabled={!!busy} onClick={() => void run(i.id, 'confirm')}
                style={{ height: mobile ? 42 : 34, padding: '0 16px', borderRadius: 8, border: 0, background: GREEN, color: '#fff', fontFamily: 'inherit', fontSize: 13, fontWeight: 700, cursor: 'pointer', opacity: busy ? 0.6 : 1 }}>✓ {L(vi, 'Xác nhận', 'Confirm')}</button>
              <button type="button" onClick={() => { onOpen(i.id); onClose(); }}
                style={{ height: mobile ? 42 : 34, padding: '0 14px', borderRadius: 8, border: '1px solid var(--line-strong)', background: 'transparent', color: 'var(--ce2e8f0)', fontFamily: 'inherit', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>{L(vi, 'Xem lịch', 'Open')}</button>
            </div>
          )}
          {err && <span role="alert" style={{ fontSize: 12.5, color: 'var(--ink-bad)' }}>{err.msg}</span>}
        </>
      )}
      <span aria-hidden="true" style={{ position: 'absolute', left: 0, bottom: 0, height: 3, width: `${pct}%`, background: look.edge, transition: 'width .1s linear' }} />
    </div>
  );
}

/** 2B: the stack, top-right under the header (full width on a phone). */
export function BookingToasts({ toasts, vi, mobile, token, dismiss, onOpen, onChanged }: {
  toasts: ToastItem[]; vi: boolean; mobile: boolean; token: string | null;
  dismiss: (key: string) => void; onOpen: (id: string) => void; onChanged: () => void;
}) {
  if (!toasts.length) return null;
  return (
    <div aria-live="polite" style={{ position: 'fixed', top: mobile ? 68 : 76, right: mobile ? 8 : 24, left: mobile ? 8 : 'auto', width: mobile ? 'auto' : 400, zIndex: 80, display: 'flex', flexDirection: 'column', gap: 10 }}>
      {toasts.slice(0, 4).map((t) => (
        <Toast key={t.key} t={t} vi={vi} mobile={mobile} token={token} onClose={() => dismiss(t.key)} onOpen={onOpen} onChanged={onChanged} />
      ))}
    </div>
  );
}
