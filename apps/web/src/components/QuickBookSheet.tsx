'use client';

// ---------------------------------------------------------------------------
// PHONE: BOOK FROM THE CALENDAR IN ONE SHEET.
//
// The desk taps an empty slot on the phone calendar and this sheet slides up
// over the day (canvas "Đặt lịch trên lịch điện thoại — mockup", boards 2–4):
// the slot's date · time · technician already filled, then who (search, recent
// customers or a new one), what (the salon's usual services as chips, the whole
// menu one tap away) and a readback of the time with "is she free". One button
// books. Group bookings, walk-in check-in and the rest stay in the full form,
// one link away.
//
// It books through the same POST /bookings as the full form (the API scopes
// everything to the signed-in salon) — no second booking path to keep in step.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch } from '../lib/api';
import { uiLocale, wallToInstantISO } from '../lib/datetime';
import { clockText, deskHoursCheck, hoursMessage, wallParts, type HoursRules } from '../lib/desk-hours';
import { formatPrice } from '../lib/money';
import { ind } from '../lib/ui-industry';
import { EMPTY_CUSTOMER, type CustomerLookupRow, type PickedCustomer } from './CustomerPicker';
import { ServicePicker } from './ServicePicker';
import { NoShowWarning } from './NoShowWarning';
import { RecordAlertByPhone } from './RecordAlert';
import type { BookingFormService, BookingFormStaff } from './CreateBookingForm';

/** What the sheet reads of the calendar's bookings: who is busy, who came lately, what is booked most. */
export interface QuickBookBooking {
  id?: string;
  status: string;
  startTime: string;
  endTime: string;
  assignedStaff: { id: string } | null;
  customer?: { id: string; firstName: string; lastName: string | null; phone: string | null; email?: string | null } | null;
  service?: { id: string } | null;
}

export interface QuickBooked { id: string | null; name: string; startLocal: string; staffName: string | null }

const DEAD = new Set(['CANCELLED', 'COMPLETED', 'NO_SHOW', 'REJECTED']);
const pad = (n: number) => String(n).padStart(2, '0');

export function QuickBookSheet({ token, vi, services, staff, bookings, initial, salonTz, hours, isOwner, currency, onClose, onCreated, onFullForm }: {
  token: string;
  vi: boolean;
  services: BookingFormService[];
  staff: BookingFormStaff[];
  bookings: QuickBookBooking[];
  initial?: { staffId?: string; startLocal?: string };
  salonTz?: string;
  hours?: HoursRules | null;
  isOwner?: boolean;
  currency?: string;
  onClose: () => void;
  onCreated: (b: QuickBooked) => void;
  /** Group booking, walk-in check-in, a time far back: the full form. */
  onFullForm: () => void;
}) {
  const L = (v: string, e: string) => (vi ? v : e);
  const [startLocal, setStartLocal] = useState(initial?.startLocal ?? '');
  const [staffId, setStaffId] = useState(initial?.staffId ?? '');
  const [cust, setCust] = useState<PickedCustomer>(EMPTY_CUSTOMER);
  const [row, setRow] = useState<CustomerLookupRow | null>(null);
  const [mode, setMode] = useState<'search' | 'picked' | 'new'>('search');
  const [q, setQ] = useState('');
  const [found, setFound] = useState<CustomerLookupRow[]>([]);
  const [searching, setSearching] = useState(false);
  const [serviceIds, setServiceIds] = useState<string[]>([]);
  const [allServices, setAllServices] = useState(false);
  const [note, setNote] = useState('');
  const [overrideAt, setOverrideAt] = useState<string | null>(null);
  const [hereChoice, setHereChoice] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const timeRef = useRef<HTMLDivElement | null>(null);

  // "$100", not "$100.00" — the way the calendar cards say it.
  const money = (c: number) => formatPrice(c, currency).replace(/[.,]00(?=\D*$)/, '');
  const svcById = useMemo(() => new Map(services.map((s) => [s.id, s])), [services]);
  const usable = useMemo(() => services.filter((s) => s.isActive !== false && !s.walkInOnly), [services]);
  const staffName = (id: string) => { const s = staff.find((x) => x.id === id); return s ? s.firstName : ''; };

  // Customer search: 250 ms after the last key, two characters or more (GET /customers/lookup — this salon only).
  useEffect(() => {
    const term = q.trim();
    if (mode !== 'search' || term.length < 2) { setFound([]); return; }
    let live = true;
    const h = window.setTimeout(async () => {
      setSearching(true);
      try {
        const r = await apiFetch<CustomerLookupRow[]>(`/customers/lookup?q=${encodeURIComponent(term)}`, { token });
        if (live) setFound(Array.isArray(r) ? r : []);
      } catch { if (live) setFound([]); }
      finally { if (live) setSearching(false); }
    }, 250);
    return () => { live = false; window.clearTimeout(h); };
  }, [q, token, mode]);

  // Recent customers: the people on the calendar the desk is looking at, latest first.
  const recent = useMemo(() => {
    const seen = new Set<string>();
    const out: { id: string; firstName: string; lastName: string | null; phone: string | null; email: string | null; at: string }[] = [];
    const now = Date.now();
    const sorted = bookings.filter((b) => b.customer && b.status !== 'CANCELLED' && b.status !== 'REJECTED')
      .slice().sort((a, b) => Math.abs(Date.parse(a.startTime) - now) - Math.abs(Date.parse(b.startTime) - now));
    for (const b of sorted) {
      const c = b.customer!;
      if (seen.has(c.id) || !c.firstName) continue;
      seen.add(c.id);
      out.push({ id: c.id, firstName: c.firstName, lastName: c.lastName, phone: c.phone, email: c.email ?? null, at: b.startTime });
      if (out.length >= 3) break;
    }
    return out;
  }, [bookings]);

  // The salon's usual services: what the calendar books most, topped up from the menu.
  const popular = useMemo(() => {
    const n = new Map<string, number>();
    for (const b of bookings) if (b.service?.id && !DEAD.has(b.status)) n.set(b.service.id, (n.get(b.service.id) ?? 0) + 1);
    const ranked = usable.filter((s) => n.has(s.id)).sort((a, b) => (n.get(b.id) ?? 0) - (n.get(a.id) ?? 0));
    const rest = usable.filter((s) => !n.has(s.id));
    return [...ranked, ...rest].slice(0, 4);
  }, [bookings, usable]);

  const pickRow = (r: CustomerLookupRow) => {
    setRow(r); setMode('picked'); setQ(''); setFound([]);
    setCust({ id: r.id, firstName: r.firstName, lastName: r.lastName ?? '', phone: r.phone ?? '', email: r.email ?? '', birthDate: r.birthDate ? String(r.birthDate).slice(0, 10) : '' });
    const h = r.history;
    // Her usual technician when the slot did not name one; her last services when nothing is picked yet.
    const fav = h?.favoriteStaff && staff.some((s) => s.id === h.favoriteStaff!.id) ? h.favoriteStaff.id : '';
    if (fav && !staffId) setStaffId(fav);
    const lastIds = (h?.last?.services ?? []).map((x) => x.id).filter((id) => usable.some((s) => s.id === id));
    if (lastIds.length) setServiceIds((ids) => (ids.length ? ids : lastIds));
  };
  /** A recent customer: shown at once, her history fetched behind it. */
  const pickRecent = async (c: (typeof recent)[number]) => {
    setRow(null); setMode('picked'); setQ(''); setFound([]);
    setCust({ id: c.id, firstName: c.firstName, lastName: c.lastName ?? '', phone: c.phone ?? '', email: c.email ?? '', birthDate: '' });
    const term = (c.phone ?? '').replace(/\D/g, '').slice(-7) || `${c.firstName} ${c.lastName ?? ''}`.trim();
    try {
      const r = await apiFetch<CustomerLookupRow[]>(`/customers/lookup?q=${encodeURIComponent(term)}`, { token });
      const hit = (Array.isArray(r) ? r : []).find((x) => x.id === c.id);
      if (hit) pickRow(hit);
    } catch { /* the basic card is enough to book */ }
  };
  const startNew = () => {
    const term = q.trim();
    const digits = term.replace(/[^\d+]/g, '');
    const isPhone = digits.length >= 6 && digits.length >= term.length - 3;
    const [first, ...rest] = isPhone ? [''] : term.split(/\s+/);
    setRow(null); setMode('new'); setQ(''); setFound([]);
    setCust({ ...EMPTY_CUSTOMER, firstName: first ?? '', lastName: rest.join(' '), phone: isPhone ? term : '' });
  };
  const resetCustomer = () => { setRow(null); setMode('search'); setCust(EMPTY_CUSTOMER); };
  const setField = (k: keyof PickedCustomer, v: string) => setCust((c) => ({ ...c, [k]: v }));
  const toggleSvc = (id: string) => setServiceIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

  // ── time ──
  const parts = wallParts(startLocal);
  const totalMin = serviceIds.reduce((s, id) => s + (svcById.get(id)?.durationMinutes ?? 0), 0);
  const totalCents = serviceIds.reduce((s, id) => s + (svcById.get(id)?.priceCents ?? 0), 0);
  const hasPrices = serviceIds.some((id) => typeof svcById.get(id)?.priceCents === 'number');
  const endMin = parts ? parts.minutes + (totalMin || 0) : 0;
  const dayLabel = parts
    ? new Date(Date.UTC(Number(parts.ymd.slice(0, 4)), parts.mo - 1, parts.d)).toLocaleDateString(vi ? 'vi-VN' : uiLocale(), { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
    : L('Chọn ngày', 'Pick a day');
  const startText = parts ? clockText(parts.minutes, vi) : '—';
  const endText = parts && totalMin > 0 ? clockText(endMin, vi) : '—';
  const setDate = (ymd: string) => { if (/^\d{4}-\d{2}-\d{2}$/.test(ymd)) setStartLocal(`${ymd}T${parts ? `${pad(parts.h)}:${pad(parts.mi)}` : '10:00'}`); };
  const setTime = (hm: string) => { if (/^\d{2}:\d{2}$/.test(hm)) setStartLocal(`${parts?.ymd ?? new Date().toISOString().slice(0, 10)}T${hm}`); };

  // Is the technician free for the whole visit? (The API checks too; this is the readback.)
  const clash = (() => {
    if (!staffId || !startLocal || totalMin <= 0) return null;
    const s = Date.parse(wallToInstantISO(startLocal, salonTz || undefined));
    if (!Number.isFinite(s)) return null;
    const e = s + totalMin * 60_000;
    return bookings.some((b) => b.assignedStaff?.id === staffId && !DEAD.has(b.status) && Date.parse(b.startTime) < e && Date.parse(b.endTime) > s);
  })();
  const hoursCheck = startLocal ? deskHoursCheck(startLocal, hours, vi) : ({ ok: true } as const);
  const outside = !hoursCheck.ok && overrideAt !== startLocal;
  const pastMin = (() => {
    if (!startLocal) return 0;
    const at = Date.parse(wallToInstantISO(startLocal, salonTz || undefined));
    return Number.isFinite(at) ? Math.floor((Date.now() - at) / 60_000) : 0;
  })();
  const tooOld = pastMin > 12 * 60;
  // Same window as the server: a start from 30 min ahead to 12 h back may land as "Arrived".
  const hereAllowed = !!startLocal && pastMin >= -30 && !tooOld;
  const hereAuto = hereAllowed && pastMin >= -10 && pastMin <= 120;
  const hereNow = hereAllowed && (hereChoice ?? hereAuto);

  const hasWho = mode === 'picked' ? !!cust.id : mode === 'new' ? !!cust.firstName.trim() : false;
  const ready = hasWho && serviceIds.length > 0 && !!startLocal;
  const whoName = cust.firstName.trim() || L('Khách', 'Customer');

  async function submit() {
    setError(null);
    if (!hasWho) { setError(L('Chọn khách cũ hoặc nhập tên khách mới.', 'Pick a customer or type a new name.')); return; }
    if (!serviceIds.length) { setError(L('Chọn ít nhất một dịch vụ.', 'Pick at least one service.')); return; }
    if (!startLocal) { setError(L('Chọn giờ hẹn.', 'Pick a time.')); return; }
    if (outside) { setError(hoursMessage(startLocal, hoursCheck, vi)); return; }
    if (tooOld) { setError(L('Giờ này đã qua hơn 12 tiếng — kiểm tra lại ngày và sáng/chiều.', 'That time is more than 12 hours ago — check the date and AM/PM.')); return; }
    setSubmitting(true);
    try {
      const created = await apiFetch<{ id?: string } | null>('/bookings', {
        method: 'POST',
        token,
        body: {
          serviceId: serviceIds[0],
          serviceIds,
          startTime: wallToInstantISO(startLocal, salonTz || undefined),
          staffId: staffId || undefined,
          autoAssign: staffId ? undefined : true,
          ...(!hoursCheck.ok && overrideAt === startLocal ? { outsideHours: true } : {}),
          customerId: mode === 'picked' ? cust.id ?? undefined : undefined,
          customerFirstName: cust.firstName,
          customerLastName: cust.lastName || undefined,
          customerEmail: cust.email || undefined,
          customerPhone: cust.phone || undefined,
          partySize: 1,
          notes: note.trim() || undefined,
          ...(hereNow ? { arrivedNow: true } : {}),
        },
      });
      onCreated({ id: created && typeof created === 'object' && typeof created.id === 'string' ? created.id : null, name: whoName, startLocal, staffName: staffId ? staffName(staffId) : null });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Create failed';
      if (/in the past/i.test(msg)) setError(L('Giờ này đã qua quá xa — kiểm tra lại ngày và sáng/chiều.', 'That time is too far in the past — check the date and AM/PM.'));
      else setError(/^OUTSIDE_HOURS/.test(msg) ? (hoursMessage(startLocal, deskHoursCheck(startLocal, hours, vi), vi) || msg.replace(/^OUTSIDE_HOURS:\s*/, '')) : msg);
    } finally {
      setSubmitting(false);
    }
  }

  // Esc closes; the page behind does not scroll while the sheet is up.
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', key);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', key); document.body.style.overflow = prev; };
  }, [onClose]);

  const sectionLabel: React.CSSProperties = { fontSize: 13, fontWeight: 700, color: 'var(--ccbd5e1)', letterSpacing: '0.02em', textTransform: 'uppercase' };
  const fieldLabel: React.CSSProperties = { fontSize: 12, color: 'var(--c94a3b8)' };
  const field: React.CSSProperties = { width: '100%', boxSizing: 'border-box', height: 46, padding: '0 12px', borderRadius: 12, border: '1px solid var(--c334155)', background: 'var(--c0f172a)', fontFamily: 'inherit', fontSize: 16, color: 'var(--ce2e8f0)' };
  const pill: React.CSSProperties = { height: 44, padding: '0 12px', borderRadius: 12, border: '1px solid var(--c334155)', background: 'var(--c0f172a)', fontFamily: 'inherit', fontSize: 14, fontWeight: 600, color: 'var(--cf1f5f9)', display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer', whiteSpace: 'nowrap', minWidth: 0 };
  const linkBtn: React.CSSProperties = { alignSelf: 'flex-start', minHeight: 40, padding: 0, border: 0, background: 'transparent', fontFamily: 'inherit', fontSize: 14, fontWeight: 700, color: 'var(--ink-link)', display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' };
  const initials = (f: string, l: string | null | undefined) => `${f.charAt(0)}${(l ?? '').charAt(0)}`.toUpperCase();
  const toTime = () => timeRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  const Plus = () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>;
  const Chevron = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--c94a3b8)" strokeWidth={2.2} strokeLinecap="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>;
  const shortDay = (iso: string) => new Date(iso).toLocaleDateString(vi ? 'vi-VN' : uiLocale(), { month: 'short', day: 'numeric', ...(salonTz ? { timeZone: salonTz } : {}) });
  const lastSeen = (iso: string) => (Date.parse(iso) > Date.now() ? L(`có hẹn ${shortDay(iso)}`, `booked ${shortDay(iso)}`) : L(`lần cuối ${shortDay(iso)}`, `last visit ${shortDay(iso)}`));
  const custRow = (key: string, init: string, name: string, sub: string, onPick: () => void, last: boolean) => (
    <button key={key} type="button" onClick={onPick}
      style={{ minHeight: 56, padding: '8px 12px', border: 0, borderBottom: last ? 0 : '1px solid var(--c1f2937)', background: 'var(--c0f172a)', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left', cursor: 'pointer', width: '100%' }}>
      <span style={{ width: 34, height: 34, flexShrink: 0, borderRadius: '50%', background: 'var(--c312e81)', color: 'var(--ce0e7ff)', fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{init}</span>
      <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
        <b style={{ fontSize: 14.5, color: 'var(--cf1f5f9)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</b>
        <span style={{ fontSize: 12.5, color: 'var(--c94a3b8)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sub}</span>
      </span>
      <Chevron />
    </button>
  );

  return (
    <div role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: 'fixed', inset: 0, zIndex: 120, background: 'rgba(2,6,23,.5)', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
      <style>{'@keyframes lumioSheetUp{from{transform:translateY(40px);opacity:.4}to{transform:none;opacity:1}}.qbs input:focus,.qbs select:focus{outline:none;border-color:#6366f1;box-shadow:0 0 0 3px rgba(99,102,241,.18)}'}</style>
      <section role="dialog" aria-modal="true" aria-label={L('Đặt lịch mới', 'New booking')} className="qbs"
        style={{ maxHeight: 'calc(100dvh - 48px - env(safe-area-inset-top, 0px))', height: 'calc(100dvh - 48px - env(safe-area-inset-top, 0px))', background: 'var(--c111827)', borderRadius: '22px 22px 0 0', display: 'flex', flexDirection: 'column', boxShadow: '0 -12px 32px -12px rgba(2,6,23,.35)', animation: 'lumioSheetUp .2s ease-out' }}>
        <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 8 }}><span style={{ width: 40, height: 5, borderRadius: 999, background: 'var(--c334155)' }} /></div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 16px 10px' }}>
          <h2 style={{ margin: 0, fontSize: 19, fontWeight: 800, color: 'var(--cf1f5f9)' }}>{L('Đặt lịch mới', 'New booking')}</h2>
          <button type="button" onClick={onClose} aria-label={L('Đóng', 'Close')}
            style={{ width: 40, height: 40, borderRadius: '50%', border: 0, background: 'var(--c1e293b)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--ce2e8f0)" strokeWidth={2.4} strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', overscrollBehavior: 'contain', WebkitOverflowScrolling: 'touch', padding: '0 16px 16px', display: 'flex', flexDirection: 'column', gap: 18 }}>
          {/* The slot that was tapped: date · time · technician. Tap any to change it below. */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button type="button" onClick={toTime} style={pill}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#6366f1" strokeWidth={2.2} strokeLinecap="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></svg>{dayLabel}
              </button>
              <button type="button" onClick={toTime} style={pill}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#6366f1" strokeWidth={2.2} strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>{startText}
              </button>
              <button type="button" onClick={toTime} style={{ ...pill, paddingLeft: staffId ? 6 : 12 }}>
                {staffId && <span style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--c064e3b)', color: 'var(--c6ee7b7)', fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{staffName(staffId).charAt(0).toUpperCase()}</span>}
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{staffId ? staffName(staffId) : ind(L('Thợ theo lượt', 'Any technician'))}</span>
              </button>
            </div>
            {initial?.startLocal && <span style={{ fontSize: 12, color: 'var(--c94a3b8)' }}>{L('Lấy từ ô bạn vừa chạm. Chạm để đổi.', 'From the slot you tapped. Tap to change.')}</span>}
          </div>

          {/* Who */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <label htmlFor="qb-cust" style={sectionLabel}>{L('Khách', 'Customer')}</label>
            {mode === 'picked' && (
              <div style={{ padding: '10px 12px', borderRadius: 12, border: '1.5px solid #6366f1', background: 'var(--c1e1b4b)', display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ width: 38, height: 38, flexShrink: 0, borderRadius: '50%', background: 'var(--c312e81)', color: 'var(--ce0e7ff)', fontSize: 14, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{initials(cust.firstName, cust.lastName)}</span>
                <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <b style={{ fontSize: 15, color: 'var(--cf1f5f9)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{`${cust.firstName} ${cust.lastName}`.trim()}</b>
                  <span style={{ fontSize: 12.5, color: 'var(--ccbd5e1)' }}>
                    {[cust.phone, row ? (row.history.visits > 0 ? L(`${row.history.visits} lần`, `${row.history.visits} visit${row.history.visits > 1 ? 's' : ''}`) : L('khách trong hệ thống', 'on file')) : null,
                      row?.history.favoriteStaff ? ind(L(`thợ quen ${row.history.favoriteStaff.name}`, `usually ${row.history.favoriteStaff.name}`)) : null].filter(Boolean).join(' · ')}
                  </span>
                  {row && row.history.noShows > 0 && <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-warn)' }}>{L(`không đến ${row.history.noShows} lần`, `${row.history.noShows} no-show${row.history.noShows > 1 ? 's' : ''}`)}</span>}
                </span>
                <button type="button" onClick={resetCustomer} style={{ height: 36, padding: '0 10px', borderRadius: 9, border: '1px solid var(--c3730a3)', background: 'var(--c0f172a)', fontFamily: 'inherit', fontSize: 13, fontWeight: 700, color: 'var(--ink-link)', cursor: 'pointer', flexShrink: 0 }}>{L('Đổi', 'Change')}</button>
              </div>
            )}
            {mode === 'new' && (
              <div style={{ padding: 12, borderRadius: 12, background: 'var(--c0b1322)', border: '1px solid var(--c1f2937)', display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ flex: 1, fontSize: 13, color: 'var(--ccbd5e1)' }}><b style={{ color: 'var(--cf1f5f9)' }}>{L('Khách mới', 'New customer')}</b> · {L('chưa có trong hệ thống', 'not on file yet')}</span>
                  <button type="button" onClick={resetCustomer} style={{ ...linkBtn, minHeight: 32, fontSize: 13 }}>{L('Tìm lại', 'Search')}</button>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}><span style={fieldLabel}>{L('Tên', 'First name')} *</span>
                    <input style={field} value={cust.firstName} onChange={(e) => setField('firstName', e.target.value)} autoComplete="off" /></label>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}><span style={fieldLabel}>{L('Họ', 'Last name')}</span>
                    <input style={field} value={cust.lastName} onChange={(e) => setField('lastName', e.target.value)} placeholder={L('Không bắt buộc', 'Optional')} autoComplete="off" /></label>
                </div>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}><span style={fieldLabel}>{L('SĐT (nhận tin xác nhận)', 'Phone (gets the confirmation text)')}</span>
                  <input style={field} type="tel" inputMode="tel" value={cust.phone} onChange={(e) => setField('phone', e.target.value)} /></label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}><span style={fieldLabel}>Email</span>
                  <input style={field} type="email" value={cust.email} onChange={(e) => setField('email', e.target.value)} placeholder={L('Không bắt buộc', 'Optional')} /></label>
                {cust.phone.replace(/\D/g, '').length >= 7 && (
                  <div>
                    <NoShowWarning token={token} phone={cust.phone} vi={vi} />
                    <RecordAlertByPhone token={token} phone={cust.phone} vi={vi} />
                  </div>
                )}
              </div>
            )}
            {mode === 'search' && (
              <>
                <div style={{ position: 'relative' }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--c94a3b8)" strokeWidth={2.2} strokeLinecap="round" aria-hidden="true" style={{ position: 'absolute', left: 14, top: 15 }}><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
                  <input id="qb-cust" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={L('Tên hoặc số điện thoại', 'Name or phone number')} autoComplete="off"
                    style={{ ...field, height: 48, paddingLeft: 42, border: '1.5px solid #6366f1' }} />
                  {searching && <span style={{ position: 'absolute', right: 14, top: 14, fontSize: 13, color: 'var(--c94a3b8)' }}>…</span>}
                </div>
                {q.trim().length >= 2 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', border: '1px solid var(--c1f2937)', borderRadius: 12, overflow: 'hidden' }}>
                    {found.map((r) => custRow(r.id, initials(r.firstName, r.lastName), `${r.firstName} ${r.lastName ?? ''}`.trim(),
                      [r.phone, r.history.visits > 0 ? L(`${r.history.visits} lần`, `${r.history.visits} visit${r.history.visits > 1 ? 's' : ''}`) : null].filter(Boolean).join(' · '), () => pickRow(r), false))}
                    <button type="button" onClick={startNew}
                      style={{ minHeight: 48, padding: '0 12px', border: 0, background: 'var(--c0b1322)', fontFamily: 'inherit', fontSize: 14, fontWeight: 700, color: 'var(--ink-link)', display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', textAlign: 'left' }}>
                      <Plus />{L(`Khách mới “${q.trim()}”`, `New customer “${q.trim()}”`)}
                    </button>
                  </div>
                ) : (
                  <>
                    {recent.length > 0 && <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--c94a3b8)', marginTop: 2 }}>{L('Gần đây', 'Recent')}</span>}
                    <div style={{ display: 'flex', flexDirection: 'column', border: '1px solid var(--c1f2937)', borderRadius: 12, overflow: 'hidden' }}>
                      {recent.map((c) => custRow(c.id, initials(c.firstName, c.lastName), `${c.firstName} ${c.lastName ?? ''}`.trim(),
                        [c.phone, lastSeen(c.at)].filter(Boolean).join(' · '), () => { void pickRecent(c); }, false))}
                      <button type="button" onClick={startNew}
                        style={{ minHeight: 48, padding: '0 12px', border: 0, background: 'var(--c0b1322)', fontFamily: 'inherit', fontSize: 14, fontWeight: 700, color: 'var(--ink-link)', display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                        <Plus />{L('Khách mới', 'New customer')}
                      </button>
                    </div>
                  </>
                )}
              </>
            )}
          </div>

          {/* What */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span style={sectionLabel}>{L('Dịch vụ', 'Service')}</span>
            {serviceIds.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {serviceIds.map((id) => {
                  const s = svcById.get(id);
                  if (!s) return null;
                  return (
                    <div key={id} style={{ padding: '10px 12px', borderRadius: 12, border: '1px solid var(--c334155)', display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <b style={{ fontSize: 14.5, color: 'var(--cf1f5f9)' }}>{s.name}</b>
                        <span style={{ fontSize: 12.5, color: 'var(--c94a3b8)' }}>{s.durationMinutes} {L('phút', 'min')}</span>
                      </span>
                      {typeof s.priceCents === 'number' && <b style={{ fontSize: 15, color: 'var(--cf1f5f9)' }}>{money(s.priceCents)}</b>}
                      <button type="button" onClick={() => toggleSvc(id)} aria-label={L(`Bỏ ${s.name}`, `Remove ${s.name}`)}
                        style={{ width: 36, height: 36, flexShrink: 0, borderRadius: '50%', border: 0, background: 'var(--c1e293b)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--c94a3b8)" strokeWidth={2.6} strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
            {serviceIds.length === 0 && !allServices && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {popular.map((s) => (
                  <button key={s.id} type="button" onClick={() => toggleSvc(s.id)}
                    style={{ minHeight: 44, maxWidth: '100%', padding: '6px 12px', borderRadius: 12, border: '1px solid var(--c334155)', background: 'var(--c0f172a)', fontFamily: 'inherit', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 0, cursor: 'pointer', textAlign: 'left' }}>
                    <b style={{ fontSize: 13.5, color: 'var(--cf1f5f9)' }}>{s.name}</b>
                    <span style={{ fontSize: 12, color: 'var(--c94a3b8)' }}>{s.durationMinutes} {L('phút', 'min')}{typeof s.priceCents === 'number' ? ` · ${money(s.priceCents)}` : ''}</span>
                  </button>
                ))}
              </div>
            )}
            {allServices ? (
              <>
                <ServicePicker services={services} selected={serviceIds} onToggle={toggleSvc} onSet={(ids) => setServiceIds(ids)} history={row?.history ?? null} currency={currency} vi={vi} hideWalkInOnly hideChosen maxHeight={320} />
                {serviceIds.length > 0 && <button type="button" onClick={() => setAllServices(false)} style={linkBtn}>{L('Xong', 'Done')}</button>}
              </>
            ) : (
              <button type="button" onClick={() => setAllServices(true)} style={linkBtn}>
                {serviceIds.length ? <><Plus />{L('Thêm dịch vụ khác', 'Add another service')}</> : <>{L('Tất cả dịch vụ ›', 'All services ›')}</>}
              </button>
            )}
          </div>

          {/* When & who does it */}
          <div ref={timeRef} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span style={sectionLabel}>{ind(L('Giờ & thợ', 'Time & technician'))}</span>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}><span style={fieldLabel}>{L('Ngày', 'Date')}</span>
                <input type="date" style={field} value={parts?.ymd ?? ''} onChange={(e) => setDate(e.target.value)} /></label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}><span style={fieldLabel}>{ind(L('Thợ', 'Technician'))}</span>
                <select style={field} value={staffId} onChange={(e) => setStaffId(e.target.value)}>
                  <option value="">{ind(L('⚡ Tự chọn thợ (theo lượt)', '⚡ Any technician (by turn)'))}</option>
                  {staff.filter((s) => s.isActive || s.id === staffId).map((s) => (
                    <option key={s.id} value={s.id}>{s.firstName}{s.lastName ? ` ${s.lastName}` : ''}{row?.history.favoriteStaff?.id === s.id ? L(' ★ thợ quen', ' ★ usual') : ''}</option>
                  ))}
                </select></label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}><span style={fieldLabel}>{L('Bắt đầu', 'Start')}</span>
                <input type="time" step={900} style={field} value={parts ? `${pad(parts.h)}:${pad(parts.mi)}` : ''} onChange={(e) => setTime(e.target.value)} /></label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}><span style={fieldLabel}>{L('Kết thúc', 'End')}</span>
                <span style={{ ...field, display: 'flex', alignItems: 'center', background: 'var(--c0b1322)', color: totalMin > 0 ? 'var(--cf1f5f9)' : 'var(--c94a3b8)', fontWeight: 600 }}>{endText}</span></div>
            </div>
            {clash !== null && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 10, fontSize: 13, fontWeight: 600,
                ...(clash ? { background: 'var(--wash-amber)', color: 'var(--ink-warn)' } : { background: 'var(--c052e16)', color: 'var(--ink-good)' }) }}>
                {clash
                  ? <>⚠ {L(`${staffName(staffId)} đã có lịch trong giờ này — chọn giờ hoặc thợ khác.`, `${staffName(staffId)} already has a booking then — pick another time or technician.`)}</>
                  : <><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12l5 5 9-11" /></svg>{L(`${staffName(staffId)} rảnh ${startText} – ${endText}`, `${staffName(staffId)} is free ${startText} – ${endText}`)}</>}
              </div>
            )}
            {!staffId && totalMin > 0 && <span style={{ fontSize: 12.5, color: 'var(--c94a3b8)' }}>{ind(L('Hệ thống chọn thợ theo lượt và tay nghề khi đặt.', 'A technician is picked by turn and skill when you book.'))}</span>}
            {startLocal && outside && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink-bad)' }}>⚠ {hoursMessage(startLocal, hoursCheck, vi)}</span>
                {isOwner && <button type="button" onClick={() => { setOverrideAt(startLocal); setError(null); }} style={{ ...linkBtn, minHeight: 36, fontSize: 13 }}>{ind(L('Vẫn đặt ngoài giờ (chủ tiệm)', 'Book outside hours anyway (owner)'))}</button>}
              </div>
            )}
            {startLocal && pastMin > 2 && (
              <span style={{ fontSize: 12.5, fontWeight: 600, color: tooOld ? 'var(--ink-bad)' : 'var(--ink-warn)' }}>
                {tooOld ? L('⚠ Giờ này đã qua hơn 12 tiếng — kiểm tra lại ngày và sáng/chiều.', '⚠ That time is more than 12 hours ago — check the date and AM/PM.')
                  : L(`⏱ Giờ này đã qua ${pastMin} phút — vẫn ghi được.`, `⏱ That was ${pastMin} min ago — it can still be recorded.`)}
              </span>
            )}
            {hereAllowed && (
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '8px 10px', borderRadius: 10, cursor: 'pointer', border: `1px solid ${hereNow ? 'rgba(34,197,94,0.55)' : 'var(--c334155)'}`, background: hereNow ? 'rgba(34,197,94,0.10)' : 'transparent' }}>
                <input type="checkbox" checked={hereNow} onChange={(e) => setHereChoice(e.target.checked)} style={{ marginTop: 2, width: 18, height: 18, accentColor: '#16a34a', flexShrink: 0 }} />
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ce2e8f0)' }}>{ind(L('Khách đang ở tiệm — check-in luôn', 'Customer is here now — check in'))}</span>
              </label>
            )}
          </div>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={fieldLabel}>{ind(L('Ghi chú cho thợ (không bắt buộc)', 'Note for the technician (optional)'))}</span>
            <input style={field} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder={L('vd. mắt nhạy cảm, thích độ cong C', 'e.g. sensitive eyes, prefers C curl')} />
          </label>

          <button type="button" onClick={onFullForm} style={{ ...linkBtn, fontSize: 13.5, color: 'var(--c94a3b8)' }}>
            {ind(L('Đặt cho nhóm, nhiều khách… → mở form đầy đủ', 'Group booking, several guests… → open the full form'))}
          </button>
        </div>

        <div style={{ padding: '10px 16px', paddingBottom: 'calc(14px + env(safe-area-inset-bottom, 0px))', borderTop: '1px solid var(--c1f2937)', background: 'var(--c111827)', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {error
            ? <span role="alert" style={{ fontSize: 13, color: 'var(--ink-bad)', textAlign: 'center' }}>{error}</span>
            : ready && <span style={{ fontSize: 13, color: 'var(--ccbd5e1)', textAlign: 'center', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {[whoName, serviceIds.map((id) => svcById.get(id)?.name).filter(Boolean).join(' + '), `${startText}${totalMin > 0 ? ` – ${endText}` : ''}${staffId ? L(` với ${staffName(staffId)}`, ` with ${staffName(staffId)}`) : ''}`].join(' · ')}
              </span>}
          <button type="button" onClick={() => { void submit(); }} disabled={!ready || submitting}
            style={{ width: '100%', height: 52, borderRadius: 14, border: 0, fontFamily: 'inherit', fontSize: 16, fontWeight: 700, cursor: !ready || submitting ? 'not-allowed' : 'pointer',
              ...(ready ? { background: '#4f46e5', color: '#fff', boxShadow: '0 10px 20px -10px rgba(79,70,229,.7)', opacity: submitting ? 0.7 : 1 } : { background: 'var(--c1f2937)', color: 'var(--c94a3b8)' }) }}>
            {submitting ? L('Đang đặt…', 'Booking…')
              : !ready ? L('Chọn khách và dịch vụ', 'Pick a customer and a service')
              : `${hereNow ? L('Đặt & check-in', 'Book & check in') : L('Đặt lịch', 'Book')}${hasPrices && totalCents > 0 ? ` · ${money(totalCents)}` : ''}`}
          </button>
        </div>
      </section>
    </div>
  );
}
