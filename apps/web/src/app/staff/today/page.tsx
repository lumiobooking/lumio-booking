'use client';

// "Hôm nay" — the technician's home screen on her phone.
//
// One look answers the four things a technician checks between clients:
//   1. Is anything waiting for my yes?   (new bookings: Nhận / Không nhận)
//   2. Who am I on right now?            (my part of the visit, the other part)
//   3. What's next?                      (next booking, with a countdown)
//   4. How is my day going?              (turns, tips, bookings left)
// and the one thing she does most — "Xong" — is a big button sitting right
// above the tab bar, under her thumb. It asks once in a sheet, then offers an
// undo, so a wet or gloved finger can't close a customer by accident.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { StaffShell } from '../../../components/StaffShell';
import { useAuth } from '../../../lib/auth';
import { apiFetch } from '../../../lib/api';
import { formatPrice } from '../../../lib/ui';
import { useLang } from '../../../lib/i18n';
import { useLiveRefresh } from '../../../lib/useLiveRefresh';
import { useLiveEvents } from '../../../lib/useLiveEvents';
import { dayKeyInTz, fmtInTz } from '../../../lib/datetime';
import { BOTTOM_SAFE, IC, Icon, L, SectionLabel, Sheet, TAB_H, Toast, fmtTurns, minsSince, st, useToast } from '../../../components/staff/kit';
import { ClockCard } from '../../../components/staff/ClockCard';
import { NextVisitClient, NextVisitSheet } from '../../../components/staff/NextVisitSheet';
import { BookingSheet, StaffBooking, bookingName, bookingServices, bookingMinutes, canStart } from '../../../components/staff/BookingSheet';

interface Item { lineId: string; serviceId: string; name: string; priceCents: number; staffId: string | null; legId?: string }
interface Leg {
  legId: string; zone: 'HAND' | 'FOOT' | 'OTHER'; status: 'WAITING' | 'SERVING' | 'DONE';
  staffId: string | null; startedAt: string | null; names: string[]; legacy?: boolean; turnValue?: number;
}
interface Chair {
  id: string; customerName: string | null; phone: string | null; assignedAt: string | null;
  stationId: string | null; awaitingPayment?: boolean; items: Item[]; legs?: Leg[];
}
interface MyChair { staffId: string | null; currency: string; serving: Chair[]; techNames?: Record<string, string> }
interface MyDay {
  staffId: string | null; currency: string; turns: number; busy: boolean; onBreak?: boolean; freeRank: number | null; queue: number;
  /** The rotation as the dispatcher reads it, in order — so "why not me yet" has an answer. */
  techs?: { id: string; name: string; rank: number; turns: number; busy: boolean; busyFor?: number | null; onBreak?: boolean; inRotation?: boolean; me: boolean; nextUp: boolean }[];
  today: { serviceCents: number; services: number; tipsCents: number; directTipsCents: number };
}
interface Svc { id: string; name: string; priceCents: number; durationMinutes?: number }
interface ChairOpt { id: string; name: string; type: string; takenBy: string | null }

const LIVE = ['ASSIGNED', 'ACCEPTED', 'CONFIRMED', 'ARRIVED'];

function partName(l: Leg, vi: boolean): string {
  if (l.legacy) return L(vi, 'Khách của bạn', 'Your client');
  if (l.zone === 'HAND') return L(vi, 'Tay', 'Hands');
  if (l.zone === 'FOOT') return L(vi, 'Chân', 'Feet');
  return l.names[0] ?? L(vi, 'Dịch vụ', 'Service');
}

/** What the technician is doing on one ticket, and what the others are. */
function view(w: Chair, me: string | null) {
  const legs = w.legs ?? [];
  const real = legs.filter((l) => !l.legacy);
  const mine = real.length ? real.filter((l) => l.staffId === me && l.status === 'SERVING') : legs;
  const mineIds = new Set(mine.map((l) => l.legId));
  const others = real.filter((l) => !mineIds.has(l.legId));
  const othersOpen = others.filter((l) => l.status !== 'DONE');
  const lines = real.length ? w.items.filter((it) => it.legId && mineIds.has(it.legId)) : w.items;
  const startedAt = mine.map((l) => l.startedAt).filter(Boolean).sort()[0] ?? w.assignedAt;
  const turns = mine.reduce((s, l) => s + (typeof l.turnValue === 'number' ? l.turnValue : 1), 0) || 1;
  return { mine, others, othersOpen, lines, startedAt, turns };
}

export default function StaffTodayPage() {
  const { lang } = useLang();
  const vi = lang === 'vi';
  const today = fmtInTz(new Date(), { weekday: 'long', day: 'numeric', month: 'numeric' });
  return (
    <StaffShell title={L(vi, 'Hôm nay', 'Today')} subtitle={<span style={{ textTransform: 'capitalize' }}>{today}</span>}>
      <Inner />
    </StaffShell>
  );
}

function Inner() {
  const { token } = useAuth();
  const { lang } = useLang();
  const vi = lang === 'vi';
  const [chair, setChair] = useState<MyChair | null>(null);
  const [day, setDay] = useState<MyDay | null>(null);
  const [bookings, setBookings] = useState<StaffBooking[]>([]);
  const [services, setServices] = useState<Svc[]>([]);
  const [chairs, setChairs] = useState<ChairOpt[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sheet, setSheet] = useState<{ kind: 'finish' | 'add' | 'chair' | 'skip'; id: string } | null>(null);
  const [skipReason, setSkipReason] = useState('');
  const [open, setOpen] = useState<{ b: StaffBooking; reject: boolean } | null>(null);
  const [banner, setBanner] = useState<{ name: string; part: string } | null>(null);
  const [nextVisit, setNextVisit] = useState<NextVisitClient | null>(null);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const { toast, show, clear } = useToast();
  const seen = useRef<Set<string> | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const since = new Date(Date.now() - 12 * 3600_000).toISOString();
      const [c, d, b] = await Promise.all([
        apiFetch<MyChair>('/my-chair', { token }),
        apiFetch<MyDay>('/my-chair/today', { token }).catch(() => null),
        apiFetch<StaffBooking[]>(`/bookings/my?from=${encodeURIComponent(since)}`, { token }).catch(() => [] as StaffBooking[]),
      ]);
      setChair(c); setDay(d); setBookings(Array.isArray(b) ? b : []); setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to load'); }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { void load(); }, [load]);
  useLiveRefresh(load, 15000);
  useLiveEvents('/my-chair/events', token, () => { void load(); });

  // The menu and the chairs only matter once a sheet asks for them.
  useEffect(() => {
    if (token && nextVisit && services.length === 0) apiFetch<Svc[]>('/my-chair/services', { token }).then(setServices).catch(() => undefined);
  }, [token, nextVisit, services.length]);
  useEffect(() => {
    if (!token || !sheet || sheet.kind === 'finish') return;
    if (sheet.kind === 'add' && services.length === 0) apiFetch<Svc[]>('/my-chair/services', { token }).then(setServices).catch(() => undefined);
    if (sheet.kind === 'chair') apiFetch<ChairOpt[]>('/my-chair/chairs', { token }).then(setChairs).catch(() => undefined);
  }, [token, sheet, services.length]);

  const me = chair?.staffId ?? null;
  const serving = useMemo(() => chair?.serving ?? [], [chair]);

  // A customer the dispatcher (or the desk) just put on her: say so, loudly,
  // at the top — where the eye goes when the phone buzzes.
  useEffect(() => {
    if (!chair) return;
    const ids = new Set(serving.map((w) => w.id));
    if (seen.current) {
      const fresh = serving.find((w) => !seen.current!.has(w.id));
      if (fresh) {
        const v = view(fresh, me);
        setBanner({ name: fresh.customerName || 'Walk-in', part: v.mine.map((l) => partName(l, vi)).join(' + ') + (v.lines.length ? ` — ${v.lines.map((x) => x.name).join(', ')}` : '') });
        try { navigator.vibrate?.(200); } catch { /* not supported */ }
      }
    }
    seen.current = ids;
  }, [chair, serving, me, vi]);
  useEffect(() => {
    if (!banner) return;
    const t = window.setTimeout(() => setBanner(null), 9000);
    return () => window.clearTimeout(t);
  }, [banner]);

  const currency = chair?.currency ?? day?.currency ?? 'USD';
  const now = Date.now();
  const pending = bookings.filter((b) => b.status === 'ASSIGNED' && new Date(b.startTime).getTime() > now - 3600_000);
  const upcoming = bookings
    .filter((b) => LIVE.includes(b.status) && b.status !== 'ASSIGNED' && new Date(b.startTime).getTime() > now - 30 * 60000)
    .sort((a, b) => a.startTime.localeCompare(b.startTime));
  const next = upcoming[0] ?? null;
  const todayKey = dayKeyInTz(new Date());
  const leftToday = bookings.filter((b) => LIVE.includes(b.status) && dayKeyInTz(b.startTime) === todayKey && new Date(b.startTime).getTime() > now - 30 * 60000).length;
  const sticky = serving.length === 1 ? serving[0] : null;

  async function call(path: string, method: 'POST' | 'PATCH', body?: Record<string, unknown>) {
    setBusy(true); setError(null);
    try { await apiFetch(path, { method, token, body }); await load(); return true; }
    catch (e) { setError(e instanceof Error ? e.message : 'Action failed'); return false; }
    finally { setBusy(false); }
  }

  async function finish(w: Chair, thenRebook = false) {
    const v = view(w, me);
    const part = v.othersOpen.length > 0;
    setSheet(null);
    // "Hẹn lần sau": the ticket leaves her chair once it is done, so the
    // client is captured now and the sheet opens right after.
    const client: NextVisitClient = { walkInId: w.id, name: w.customerName || 'Walk-in', serviceIds: [...new Set(v.lines.map((it) => it.serviceId))] };
    if (await call(`/my-chair/${w.id}/done`, 'PATCH')) {
      if (thenRebook) setNextVisit(client);
      show(part ? L(vi, `Xong phần của bạn · +${fmtTurns(v.turns)} lượt`, `Your part is done · +${fmtTurns(v.turns)} turn`) : L(vi, `Xong khách · +${fmtTurns(v.turns)} lượt`, `Client done · +${fmtTurns(v.turns)} turn`),
        L(vi, 'Hoàn tác', 'Undo'), () => { clear(); void call(`/my-chair/${w.id}/reactivate`, 'PATCH'); });
    }
  }
  const accept = async (b: StaffBooking) => {
    if (await call(`/bookings/${b.id}/accept`, 'POST')) { setOpen(null); show(L(vi, `Đã nhận lịch ${fmtInTz(b.startTime, { hour: 'numeric', minute: '2-digit' })} · ${bookingName(b)}`, `Accepted · ${bookingName(b)}`)); }
  };
  const reject = async (b: StaffBooking, reason: string) => {
    if (await call(`/bookings/${b.id}/reject`, 'POST', { reason })) { setOpen(null); show(L(vi, 'Đã báo quầy — lịch sẽ giao thợ khác', 'The desk will give it to someone else')); }
  };
  const start = async (b: StaffBooking) => {
    if (await call(`/my-chair/appointments/${b.id}/start`, 'POST')) { setOpen(null); show(L(vi, `Bắt đầu làm cho ${bookingName(b)}`, `Started · ${bookingName(b)}`)); }
  };

  if (loading && !chair) return <p style={{ color: 'var(--c94a3b8)' }}>{L(vi, 'Đang tải…', 'Loading…')}</p>;

  const sheetTicket = sheet ? serving.find((w) => w.id === sheet.id) ?? null : null;
  const tipsToday = (day?.today.tipsCents ?? 0) + (day?.today.directTipsCents ?? 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, paddingBottom: sticky ? 84 : 0 }}>
      {error && <div style={{ ...st.card, borderColor: 'var(--ink-bad)', color: 'var(--ink-bad)', fontSize: 14, padding: 12 }}>{error}</div>}

      {/* ---- 1. New bookings waiting for her answer ---- */}
      {pending.length > 0 && (
        <div style={{ ...st.card, background: 'var(--wash-amber)', borderColor: 'var(--ink-warn)', padding: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--ink-warn)', letterSpacing: '0.04em' }}>
              {L(vi, `${pending.length} LỊCH MỚI CHỜ BẠN NHẬN`, `${pending.length} NEW BOOKING${pending.length > 1 ? 'S' : ''} FOR YOU`)}
            </span>
            {pending.length > 1 && <Link href="/staff/bookings" style={{ marginLeft: 'auto', color: 'var(--ink-warn)', fontSize: 13, fontWeight: 700, padding: '12px 0' }}>{L(vi, 'Xem tất cả', 'See all')}</Link>}
          </div>
          <button type="button" onClick={() => setOpen({ b: pending[0], reject: false })}
            style={{ display: 'block', width: '100%', textAlign: 'left', background: 'transparent', border: 'none', padding: '8px 0 0', cursor: 'pointer', color: 'var(--ce2e8f0)' }}>
            <div style={{ fontSize: 16, fontWeight: 700, textTransform: 'capitalize' }}>
              {fmtInTz(pending[0].startTime, { weekday: 'short' })} {fmtInTz(pending[0].startTime, { hour: 'numeric', minute: '2-digit' })} · {bookingName(pending[0])}
            </div>
            <div style={{ fontSize: 14, color: 'var(--ccbd5e1)', marginTop: 2 }}>{bookingServices(pending[0])}{bookingMinutes(pending[0]) ? ` · ${bookingMinutes(pending[0])} ${L(vi, 'phút', 'min')}` : ''}</div>
          </button>
          <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
            <button type="button" disabled={busy} onClick={() => setOpen({ b: pending[0], reject: true })} style={{ ...st.ghost, flex: '1 1 0' }}>{L(vi, 'Không nhận', 'Decline')}</button>
            <button type="button" disabled={busy} onClick={() => accept(pending[0])} style={{ ...st.primary, flex: '1.6 1 0', height: 48 }}>{L(vi, 'Nhận lịch này', 'Accept')}</button>
          </div>
        </div>
      )}

      {/* ---- chấm công (only where the salon uses it) ---- */}
      <ClockCard token={token} vi={vi} onToast={(t) => show(t)} />

      {/* ---- 2. Right now ---- */}
      <div>
        <SectionLabel right={<span style={{ fontSize: 12, fontWeight: 700, color: serving.length ? 'var(--ink-good)' : 'var(--ink-link)' }}>{serving.length ? L(vi, '● Đang làm', '● Working') : L(vi, '● Rảnh', '● Free')}</span>}>
          {L(vi, 'Bây giờ', 'Right now')}
        </SectionLabel>
        {serving.length === 0 && day?.onBreak ? (
          <div style={{ ...st.card, display: 'flex', alignItems: 'center', gap: 16, borderColor: 'var(--ink-warn)' }}>
            <div style={{ width: 64, height: 64, borderRadius: 999, background: 'var(--wash-amber-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <Icon d={IC.clock} size={28} color="var(--ink-warn)" />
            </div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--ce2e8f0)' }}>{L(vi, 'Đang tạm nghỉ', 'On a break')}</div>
              <div style={{ fontSize: 14, color: 'var(--c94a3b8)', marginTop: 4, lineHeight: 1.45 }}>{L(vi, 'Hệ thống không giao khách cho bạn. Bấm "Quay lại" khi sẵn sàng.', 'No clients are handed to you. Tap "Back" when ready.')}</div>
            </div>
            <button type="button" disabled={busy} onClick={() => call('/my-chair/back', 'POST').then((ok) => ok && show(L(vi, 'Đã quay lại vòng tua', 'Back in the rotation')))} style={{ ...st.primary, height: 48 }}>{L(vi, 'Quay lại', 'Back')}</button>
          </div>
        ) : serving.length === 0 ? (
          <div style={{ ...st.card, display: 'flex', alignItems: 'center', gap: 16 }}>
            <div style={{ width: 64, height: 64, borderRadius: 999, background: 'var(--c1e1b4b)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <span style={{ fontSize: 26, fontWeight: 800, color: 'var(--cc7d2fe)', lineHeight: 1 }}>{day?.freeRank ?? '–'}</span>
              <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--cc7d2fe)' }}>{L(vi, 'thứ tự', 'in line')}</span>
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--ce2e8f0)' }}>{L(vi, 'Bạn đang rảnh', 'You are free')}</div>
              <div style={{ fontSize: 14, color: 'var(--c94a3b8)', marginTop: 4, lineHeight: 1.45 }}>
                {day?.freeRank === 1
                  ? L(vi, 'Bạn là người tiếp theo — có khách là hệ thống tự giao cho bạn.', 'You are next — the system hands you the next client.')
                  : day?.freeRank
                    ? L(vi, `Trước bạn còn ${day.freeRank - 1} người rảnh. Có khách, hệ thống tự giao — không cần canh.`, `${day.freeRank - 1} ahead of you. Clients are handed out automatically.`)
                    : L(vi, 'Có khách, hệ thống sẽ tự giao cho bạn.', 'Clients are handed out automatically.')}
                {day && day.queue > 0 ? L(vi, ` · ${day.queue} khách đang chờ.`, ` · ${day.queue} waiting.`) : ''}
              </div>
              {day?.freeRank && day.freeRank > 1 && (day.techs ?? []).length > 0 && (
                <div style={{ fontSize: 12.5, color: 'var(--c94a3b8)', marginTop: 6, lineHeight: 1.5 }}>
                  {L(vi, 'Vì sao: ', 'Why: ')}
                  {(day.techs ?? []).filter((t) => !t.me && !t.busy && !t.onBreak && t.inRotation !== false && t.rank < ((day.techs ?? []).find((x) => x.me)?.rank ?? 99))
                    .map((t) => `${t.name} ${t.turns % 1 === 0 ? t.turns : t.turns.toFixed(1)} ${vi ? 'tua' : ''}`.trim()).join(' · ')}
                  {' '}{L(vi, `— bạn ${day.turns % 1 === 0 ? day.turns : day.turns.toFixed(1)} tua.`, `— you ${day.turns % 1 === 0 ? day.turns : day.turns.toFixed(1)}.`)}
                </div>
              )}
              <button type="button" disabled={busy} onClick={() => call('/my-chair/break', 'POST').then((ok) => ok && show(L(vi, 'Đã tạm nghỉ — không nhận khách', 'On a break — no clients for now')))}
                style={{ background: 'transparent', border: 'none', color: 'var(--ink-link)', fontSize: 13, fontWeight: 700, padding: '8px 0 0', cursor: 'pointer' }}>
                {L(vi, 'Tạm nghỉ (ăn trưa, ra ngoài)', 'Take a break')}
              </button>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {serving.map((w) => (
              <NowCard key={w.id} w={w} me={me} vi={vi} currency={currency} techNames={chair?.techNames ?? {}} busy={busy}
                inlineFinish={serving.length > 1}
                onFinish={() => setSheet({ kind: 'finish', id: w.id })}
                onAdd={() => { setQuery(''); setSheet({ kind: 'add', id: w.id }); }}
                onChair={() => setSheet({ kind: 'chair', id: w.id })}
                onPay={() => call(`/my-chair/${w.id}/wait-payment`, 'PATCH').then((ok) => ok && show(L(vi, 'Đã báo quầy: khách ra trả tiền', 'Sent to the desk to pay')))}
                onSkip={() => { setSkipReason(''); setSheet({ kind: 'skip', id: w.id }); }} />
            ))}
          </div>
        )}
      </div>

      {/* ---- 3. Next ---- */}
      <div>
        <SectionLabel right={upcoming.length > 1 ? <Link href="/staff/bookings" style={{ color: 'var(--ink-link)', fontSize: 13, fontWeight: 700, padding: '10px 0' }}>{L(vi, 'Cả lịch', 'Schedule')}</Link> : undefined}>
          {L(vi, 'Tiếp theo', 'Next')}
        </SectionLabel>
        {next ? <NextCard b={next} vi={vi} busy={busy} onOpen={() => setOpen({ b: next, reject: false })} onStart={() => start(next)} /> : (
          <div style={{ ...st.card, color: 'var(--c94a3b8)', fontSize: 14 }}>{L(vi, 'Không còn lịch hẹn nào sắp tới.', 'No more bookings coming up.')}</div>
        )}
      </div>

      {/* ---- 4. The day in numbers ---- */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10 }}>
        <Stat href="/staff/turns" label={L(vi, 'Lượt hôm nay', 'Turns today')} value={fmtTurns(day?.turns ?? 0)} />
        <Stat href="/staff/me" label={L(vi, 'Tips hôm nay', 'Tips today')} value={formatPrice(tipsToday, currency)} good />
        <Stat href="/staff/bookings" label={L(vi, 'Lịch còn lại', 'Bookings left')} value={String(leftToday)} />
      </div>

      {/* ---- the one big button, under the thumb ---- */}
      {sticky && (() => {
        const v = view(sticky, me);
        return (
          <div style={{ position: 'fixed', left: 0, right: 0, bottom: `calc(${TAB_H}px + ${BOTTOM_SAFE})`, zIndex: 110, padding: '10px 16px', background: 'var(--c0b1120)', borderTop: '1px solid var(--line)' }}>
            <button type="button" disabled={busy} onClick={() => setSheet({ kind: 'finish', id: sticky.id })} style={{ ...st.done, width: '100%', maxWidth: 560, margin: '0 auto' }}>
              <Icon d={IC.check} size={22} stroke={2.8} />
              {v.othersOpen.length ? L(vi, 'Xong phần của tôi', 'My part is done') : L(vi, 'Xong khách', 'Client done')}
            </button>
          </div>
        );
      })()}

      {/* ---- sheets ---- */}
      <Sheet open={sheet?.kind === 'finish' && !!sheetTicket} onClose={() => setSheet(null)} label={L(vi, 'Xác nhận xong', 'Confirm')}>
        {sheetTicket && (() => {
          const v = view(sheetTicket, me);
          const name = sheetTicket.customerName || 'Walk-in';
          const part = v.mine.map((l) => partName(l, vi).toLowerCase()).join(' + ');
          const left = v.othersOpen.map((l) => partName(l, vi).toLowerCase()).join(', ');
          return (
            <div>
              <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--ce2e8f0)' }}>
                {v.othersOpen.length ? L(vi, `Xong phần ${part} của ${name}?`, `Done with ${name}'s ${part}?`) : L(vi, `Xong khách ${name}?`, `Finish ${name}?`)}
              </div>
              <div style={{ fontSize: 14, color: 'var(--c94a3b8)', marginTop: 4 }}>
                {v.othersOpen.length ? L(vi, `Khách vẫn ở lại cho phần ${left}.`, `The client stays for the ${left}.`) : L(vi, 'Đây là phần cuối của khách.', 'This is the last part of the visit.')}
              </div>
              <div style={{ marginTop: 14, border: '1px solid var(--line)', borderRadius: 14, overflow: 'hidden' }}>
                {v.lines.map((it) => (
                  <div key={it.lineId} style={{ display: 'flex', padding: '12px 14px', borderBottom: '1px solid var(--line)', fontSize: 15, color: 'var(--ce2e8f0)' }}>
                    <span style={{ flex: 1 }}>{it.name}</span><span style={{ color: 'var(--ccbd5e1)' }}>{formatPrice(it.priceCents, currency)}</span>
                  </div>
                ))}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 14px', background: 'var(--c052e16)' }}>
                  <Icon d={IC.check} size={18} stroke={2.6} color="var(--ink-good)" />
                  <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink-good)' }}>
                    {L(vi, `Bạn được cộng ${fmtTurns(v.turns)} lượt`, `You get ${fmtTurns(v.turns)} turn`)}{day ? ` (${fmtTurns(day.turns)} → ${fmtTurns(day.turns + v.turns)})` : ''}
                  </span>
                </div>
              </div>
              <div style={{ fontSize: 13, color: 'var(--ccbd5e1)', marginTop: 12, lineHeight: 1.5 }}>
                {v.othersOpen.length
                  ? L(vi, 'Bạn rảnh ngay và hệ thống tự giao khách tiếp theo theo lượt. Thợ kế tiếp sẽ làm phần còn lại.', 'You are free right away; the next technician does the rest.')
                  : L(vi, 'Khách ra quầy thanh toán. Lỡ bấm vẫn hoàn tác được trong vài giây.', 'The client goes to the desk to pay. You can undo for a few seconds.')}
              </div>
              <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
                <button type="button" onClick={() => setSheet(null)} style={{ ...st.ghost, flex: 1, height: 56 }}>{L(vi, 'Chưa xong', 'Not yet')}</button>
                <button type="button" disabled={busy} onClick={() => finish(sheetTicket)} style={{ ...st.done, flex: 2 }}>{L(vi, 'Xác nhận xong', 'Confirm')}</button>
              </div>
              {!v.othersOpen.length && (
                <button type="button" disabled={busy} onClick={() => finish(sheetTicket, true)} style={{ ...st.ghost, width: '100%', height: 52, marginTop: 10 }}>
                  {L(vi, 'Xong & hẹn lần sau', 'Done & book the next visit')}
                </button>
              )}
            </div>
          );
        })()}
      </Sheet>

      <Sheet open={sheet?.kind === 'skip' && !!sheetTicket} onClose={() => setSheet(null)} label={L(vi, 'Bỏ qua khách', 'Pass on')}>
        {sheetTicket && (
          <div>
            <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--ce2e8f0)' }}>{L(vi, `Không nhận ${sheetTicket.customerName || 'khách này'}?`, `Pass ${sheetTicket.customerName || 'this client'} on?`)}</div>
            <div style={{ fontSize: 14, color: 'var(--c94a3b8)', marginTop: 4, lineHeight: 1.5 }}>{L(vi, 'Khách về lại hàng chờ và được giao cho thợ rảnh tiếp theo. Tuỳ quy tắc của tiệm, lượt này có thể vẫn tính là tua của bạn.', 'The client goes back to the queue for the next free technician. Under the salon’s rules this may still count as your turn.')}</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10, marginTop: 14 }}>
              {[L(vi, 'Không làm dịch vụ này', "I don't do this service"), L(vi, 'Khách yêu cầu thợ khác', 'Client wants someone else'), L(vi, 'Cần nghỉ gấp', 'Need a break now'), L(vi, 'Lý do khác', 'Other reason')].map((r) => (
                <button key={r} type="button" onClick={() => setSkipReason(r)} aria-pressed={skipReason === r}
                  style={{ minHeight: 52, padding: '8px 10px', borderRadius: 12, border: `1.5px solid ${skipReason === r ? '#6366f1' : 'var(--line-strong)'}`, background: skipReason === r ? 'var(--c1e1b4b)' : 'var(--c0f172a)', color: skipReason === r ? 'var(--cc7d2fe)' : 'var(--ce2e8f0)', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>{r}</button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
              <button type="button" onClick={() => setSheet(null)} style={{ ...st.ghost, flex: 1, height: 56 }}>{L(vi, 'Giữ khách', 'Keep')}</button>
              <button type="button" disabled={!skipReason || busy} onClick={async () => {
                const v = view(sheetTicket, me);
                const leg = v.mine[0];
                if (!leg) return;
                setSheet(null);
                if (await call(`/my-chair/${sheetTicket.id}/legs/${leg.legId}/skip`, 'POST', { reason: skipReason })) show(L(vi, 'Đã chuyển khách về hàng chờ', 'Client sent back to the queue'));
              }} style={{ ...st.primary, flex: 2, height: 56, opacity: skipReason ? 1 : 0.45 }}>{L(vi, 'Bỏ qua', 'Pass on')}</button>
            </div>
          </div>
        )}
      </Sheet>

      <NextVisitSheet client={nextVisit} services={services} token={token} vi={vi} onClose={() => setNextVisit(null)} onBooked={(t) => show(t)} />

      <Sheet open={sheet?.kind === 'add'} onClose={() => setSheet(null)} label={L(vi, 'Thêm dịch vụ', 'Add a service')}>
        <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--ce2e8f0)' }}>{L(vi, 'Thêm dịch vụ bạn vừa làm', 'Add what you did')}</div>
        <div style={{ fontSize: 14, color: 'var(--c94a3b8)', marginTop: 4 }}>{L(vi, 'Tính vào phần của bạn và hoá đơn của khách.', 'Counts on your part and the client’s bill.')}</div>
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={L(vi, 'Tìm dịch vụ…', 'Search…')} aria-label={L(vi, 'Tìm dịch vụ', 'Search services')}
          style={{ width: '100%', boxSizing: 'border-box', height: 48, marginTop: 14, borderRadius: 12, border: '1px solid var(--line-strong)', background: 'var(--c0f172a)', color: 'var(--ce2e8f0)', fontSize: 16, padding: '0 14px' }} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
          {services.filter((s) => !query.trim() || s.name.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 40).map((s) => (
            <button key={s.id} type="button" disabled={busy}
              onClick={async () => { const id = sheet?.id; setSheet(null); if (id && await call(`/my-chair/${id}/services`, 'POST', { serviceId: s.id })) show(L(vi, `Đã thêm ${s.name}`, `Added ${s.name}`)); }}
              style={{ minHeight: 54, borderRadius: 12, border: '1px solid var(--line)', background: 'var(--c0f172a)', color: 'var(--ce2e8f0)', fontSize: 15, display: 'flex', alignItems: 'center', gap: 10, padding: '0 14px', cursor: 'pointer', textAlign: 'left' }}>
              <span style={{ flex: 1, fontWeight: 600 }}>{s.name}</span>
              <span style={{ color: 'var(--c94a3b8)' }}>{formatPrice(s.priceCents, currency)}</span>
              <Icon d={IC.plus} size={20} color="var(--ink-link)" />
            </button>
          ))}
          {services.length === 0 && <div style={{ color: 'var(--c94a3b8)', fontSize: 14, padding: 8 }}>{L(vi, 'Đang tải…', 'Loading…')}</div>}
        </div>
      </Sheet>

      <Sheet open={sheet?.kind === 'chair'} onClose={() => setSheet(null)} label={L(vi, 'Chọn ghế', 'Pick a chair')}>
        <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--ce2e8f0)' }}>{L(vi, 'Khách đang ngồi ghế nào?', 'Which chair?')}</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10, marginTop: 14 }}>
          {chairs.map((c) => {
            const on = sheetTicket?.stationId === c.id;
            const taken = !!c.takenBy && !on;
            return (
              <button key={c.id} type="button" disabled={taken || busy}
                onClick={async () => { const id = sheet?.id; setSheet(null); if (id) await call(`/my-chair/${id}/chair`, 'PATCH', { stationId: c.id }); }}
                style={{ minHeight: 58, borderRadius: 12, border: `1.5px solid ${on ? '#6366f1' : 'var(--line-strong)'}`, background: on ? 'var(--c1e1b4b)' : 'var(--c0f172a)', color: taken ? 'var(--c64748b)' : on ? 'var(--cc7d2fe)' : 'var(--ce2e8f0)', cursor: taken ? 'not-allowed' : 'pointer', padding: '6px 10px', textAlign: 'left' }}>
                <div style={{ fontSize: 15, fontWeight: 700 }}>{c.name}</div>
                <div style={{ fontSize: 12, color: 'var(--c94a3b8)' }}>{taken ? L(vi, 'Đang có khách', 'In use') : c.type}</div>
              </button>
            );
          })}
        </div>
        {chairs.length === 0 && <div style={{ color: 'var(--c94a3b8)', fontSize: 14, padding: 8 }}>{L(vi, 'Tiệm chưa khai báo ghế.', 'No chairs set up yet.')}</div>}
      </Sheet>

      <BookingSheet booking={open?.b ?? null} startReject={open?.reject ?? false} vi={vi} currency={currency}
        onClose={() => setOpen(null)} onAccept={accept} onReject={reject} onStart={start} />

      {banner && (
        <div role="alert" style={{ position: 'fixed', left: 12, right: 12, top: 'calc(10px + env(safe-area-inset-top, 0px))', zIndex: 260, maxWidth: 536, margin: '0 auto', background: '#14532d', borderRadius: 18, padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 12, boxShadow: '0 12px 30px rgba(0,0,0,0.4)' }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: '#ffffff', opacity: 0.85, letterSpacing: '0.06em' }}>{L(vi, 'KHÁCH MỚI CHO BẠN', 'NEW CLIENT FOR YOU')}</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#ffffff', marginTop: 2 }}>{banner.name} · {banner.part}</div>
          </div>
          <button type="button" onClick={() => { setBanner(null); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
            style={{ height: 44, padding: '0 16px', borderRadius: 12, border: 'none', background: '#ffffff', color: '#14532d', fontSize: 14, fontWeight: 800, cursor: 'pointer' }}>
            {L(vi, 'Xem', 'View')}
          </button>
        </div>
      )}

      {toast && <Toast text={toast.text} action={toast.action} onAction={toast.onAction} raised={!!sticky} />}
    </div>
  );
}

function NowCard({ w, me, vi, currency, techNames, busy, inlineFinish, onFinish, onAdd, onChair, onPay, onSkip }: {
  w: Chair; me: string | null; vi: boolean; currency: string; techNames: Record<string, string>; busy: boolean; inlineFinish: boolean;
  onFinish: () => void; onAdd: () => void; onChair: () => void; onPay: () => void; onSkip?: () => void;
}) {
  const v = view(w, me);
  const fresh = minsSince(v.startedAt) < 3;
  return (
    <div style={{ ...st.card, borderColor: fresh ? '#22c55e' : 'var(--line)' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 20, fontWeight: 800, color: 'var(--ce2e8f0)', lineHeight: 1.2 }}>{w.customerName || 'Walk-in'}</span>
            {fresh && <span style={{ fontSize: 11, fontWeight: 800, background: '#15803d', color: '#fff', borderRadius: 999, padding: '3px 8px' }}>{L(vi, 'MỚI GIAO', 'NEW')}</span>}
          </div>
          {w.phone && <a href={`tel:${w.phone}`} style={{ display: 'inline-block', fontSize: 13, color: 'var(--ink-link)', marginTop: 4, textDecoration: 'none', padding: '4px 0' }}>{w.phone}</a>}
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--ink-good)', lineHeight: 1 }}>{minsSince(v.startedAt)}′</div>
          <div style={{ fontSize: 11, color: 'var(--c94a3b8)', marginTop: 3 }}>{L(vi, 'đang làm', 'in chair')}</div>
        </div>
      </div>

      <div style={{ marginTop: 12, borderRadius: 14, background: 'var(--c052e16)', border: '1px solid var(--c166534)', padding: '12px 14px' }}>
        <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--ink-good)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
          {L(vi, 'Phần của bạn', 'Your part')} · {v.mine.map((l) => partName(l, vi)).join(' + ')}
        </div>
        {v.lines.map((it) => (
          <div key={it.lineId} style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
            <span style={{ flex: 1, fontSize: 15, fontWeight: 600, color: 'var(--ce2e8f0)' }}>{it.name}</span>
            <span style={{ fontSize: 15, color: 'var(--ccbd5e1)' }}>{formatPrice(it.priceCents, currency)}</span>
          </div>
        ))}
        {v.lines.length === 0 && <div style={{ fontSize: 14, color: 'var(--ccbd5e1)', marginTop: 6 }}>{L(vi, 'Chưa có dịch vụ — bấm “Thêm dịch vụ”.', 'No services yet — tap “Add service”.')}</div>}
      </div>

      {v.others.map((l) => {
        const who = l.staffId ? techNames[l.staffId] ?? '' : '';
        const state = l.status === 'DONE'
          ? { text: L(vi, `✓ xong${who ? ' · ' + who : ''}`, `✓ done${who ? ' · ' + who : ''}`), color: 'var(--c94a3b8)' }
          : l.status === 'SERVING'
            ? { text: L(vi, `${who || 'Thợ khác'} đang làm`, `${who || 'Another tech'} working`), color: 'var(--ink-good)' }
            : { text: who ? L(vi, `chờ ${who}`, `waiting for ${who}`) : L(vi, 'chờ thợ — tự giao', 'waiting — auto'), color: 'var(--ink-warn)' };
        return (
          <div key={l.legId} style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8, padding: '10px 14px', borderRadius: 14, border: '1px solid var(--line)' }}>
            <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--c94a3b8)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>{partName(l, vi)}</span>
            <span style={{ flex: 1, minWidth: 0, fontSize: 14, color: 'var(--ccbd5e1)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.names.join(', ')}</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: state.color, whiteSpace: 'nowrap' }}>{state.text}</span>
          </div>
        );
      })}

      <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
        <button type="button" disabled={busy} onClick={onAdd} style={{ ...st.ghost, flex: 1, padding: '0 10px' }}><Icon d={IC.plus} size={18} stroke={2.2} />{L(vi, 'Thêm dịch vụ', 'Add service')}</button>
        <button type="button" disabled={busy} onClick={onChair} style={{ ...st.ghost, flex: 1, padding: '0 10px' }}><Icon d={IC.chair} size={18} />{L(vi, 'Ghế', 'Chair')}</button>
      </div>
      {/* Pass the customer on — only while the leg is fresh, so a half-done job is never bounced. */}
      {onSkip && fresh && (
        <button type="button" disabled={busy} onClick={onSkip} style={{ background: 'transparent', border: 'none', color: 'var(--c94a3b8)', fontSize: 13, fontWeight: 600, padding: '10px 0 0', cursor: 'pointer', width: '100%' }}>
          {L(vi, 'Không nhận khách này (bỏ qua)', 'Pass this client on')}
        </button>
      )}
      {v.othersOpen.length === 0 && (
        w.awaitingPayment
          ? <div style={{ marginTop: 10, fontSize: 13, fontWeight: 600, color: 'var(--ink-warn)', textAlign: 'center' }}>{L(vi, 'Khách đang chờ trả tiền ở quầy', 'Waiting to pay at the desk')}</div>
          : <button type="button" disabled={busy} onClick={onPay} style={{ ...st.ghost, width: '100%', marginTop: 10 }}><Icon d={IC.money} size={18} />{L(vi, 'Ra quầy trả tiền', 'Send to pay')}</button>
      )}
      {inlineFinish && (
        <button type="button" disabled={busy} onClick={onFinish} style={{ ...st.done, width: '100%', marginTop: 10 }}>
          <Icon d={IC.check} size={20} stroke={2.8} />{v.othersOpen.length ? L(vi, 'Xong phần của tôi', 'My part is done') : L(vi, 'Xong khách', 'Client done')}
        </button>
      )}
    </div>
  );
}

function NextCard({ b, vi, busy, onOpen, onStart }: { b: StaffBooking; vi: boolean; busy: boolean; onOpen: () => void; onStart: () => void }) {
  const diff = Math.round((new Date(b.startTime).getTime() - Date.now()) / 60000);
  const h = Math.floor(Math.abs(diff) / 60), m = Math.abs(diff) % 60;
  const span = h ? `${h}${L(vi, 'g', 'h')} ${m}${L(vi, 'p', 'm')}` : `${m}${L(vi, ' phút', ' min')}`;
  const countdown = diff >= 0 ? L(vi, `còn ${span}`, `in ${span}`) : L(vi, `trễ ${span}`, `${span} late`);
  const soon = canStart(b) && diff < 20;
  const mins = bookingMinutes(b);
  return (
    <div style={{ ...st.card, padding: 0, overflow: 'hidden' }}>
      <button type="button" onClick={onOpen}
        style={{ width: '100%', textAlign: 'left', background: 'transparent', border: 'none', padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 14, cursor: 'pointer', color: 'var(--ce2e8f0)' }}>
        <div style={{ width: 84, flexShrink: 0, whiteSpace: 'nowrap' }}>
          <div style={{ fontSize: 20, fontWeight: 800 }}>{fmtInTz(b.startTime, { hour: 'numeric', minute: '2-digit' })}</div>
          <div style={{ fontSize: 12, fontWeight: 700, color: diff < 0 ? 'var(--ink-warn)' : 'var(--ink-link)', marginTop: 2 }}>{countdown}</div>
        </div>
        <div style={{ minWidth: 0, flex: 1, borderLeft: '1px solid var(--line)', paddingLeft: 14 }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>{bookingName(b)}</div>
          <div style={{ fontSize: 13, color: 'var(--ccbd5e1)', marginTop: 2 }}>{bookingServices(b)}{mins ? ` · ${mins} ${L(vi, 'phút', 'min')}` : ''}</div>
          {b.notes && <div style={{ fontSize: 13, color: 'var(--c94a3b8)', marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.notes}</div>}
        </div>
        <Icon d={IC.chevron} size={20} color="var(--c94a3b8)" />
      </button>
      {soon && (
        <div style={{ padding: '0 16px 14px' }}>
          <button type="button" disabled={busy} onClick={onStart} style={{ ...st.primary, width: '100%' }}>{L(vi, 'Khách đã đến — bắt đầu làm', 'Client is here — start')}</button>
        </div>
      )}
    </div>
  );
}

function Stat({ href, label, value, good = false }: { href: string; label: string; value: string; good?: boolean }) {
  return (
    <Link href={href} style={{ ...st.card, padding: 12, textDecoration: 'none', display: 'block', minHeight: 48 }}>
      <div style={{ fontSize: 12, color: 'var(--c94a3b8)' }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, marginTop: 4, color: good ? 'var(--ink-good)' : 'var(--ce2e8f0)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{value}</div>
    </Link>
  );
}
