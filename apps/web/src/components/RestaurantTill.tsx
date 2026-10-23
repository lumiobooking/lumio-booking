'use client';

/**
 * THE RESTAURANT TILL — tables first.
 *
 * A salon rings up a visit when it ends; a restaurant runs a bill on a table
 * for an hour. So this till opens on the floor: tap a table, say how many
 * guests, add dishes (with their options), send the NEW ones to the kitchen
 * (each prep station gets its own ticket), print the guest check, take the
 * money. A dish the kitchen already has is locked — taking it back needs a
 * reason and, per the restaurant's rule, a manager — because that is where
 * food and money leak. To-go bills, sold-out dishes, merging two tables,
 * splitting a bill and servers who may only ask for payment live here too.
 *
 * Payment goes through the ordinary checkout on the server, so the shift,
 * tenders, the ledger and the reports see a restaurant sale exactly like any
 * other. Every call is tenant-scoped on the server; this screen only renders.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { apiFetch, ApiError } from '../lib/api';
import { useAuth, useCan } from '../lib/auth';
import { useLang } from '../lib/i18n';
import { useIsMobile } from '../lib/responsive';
import { tillMethodsFrom, payLabel, type PayMethod } from '../lib/payment-methods';
import { buildReceiptText, type ReceiptProfile } from '../lib/receipt';
import { CashShiftPanel, useShiftState } from './CashShiftPanel';
import {
  bankName, byTableName, callText, cashQuickAmounts, combinedState, evenShares, lineGroups, minutesOpen, optionsReady, pendingLines, priceWith, tillError, timerTone, vietQr, VN_BANKS,
  type BankAccount, type CheckLine, type CheckView, type FloorCheck, type InvoiceInfo, type OptionGroup, type TableState,
} from '../lib/restaurant-till';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8005/api';

interface Station { key: string; name: string }
interface Settings {
  stations: Station[]; byCategory: Record<string, string>; defaultStation: string; printVoid: boolean; printMove: boolean;
  voidNeedsApproval: boolean; warnMinutes: number; lateMinutes: number; soldOutReset: boolean; cashierUserIds: string[];
  qrOrdering: 'off' | 'confirm' | 'auto'; serviceChargePercent: number; vatPercent: number; vatIncluded: boolean; bank: BankAccount | null;
}
interface Table { id: string; name: string; seats: number; area: string | null }
interface Floor { currency: string; settings: Settings; canPay: boolean; tables: Table[]; checks: FloorCheck[] }
interface Dish { id: string; name: string; category: string | null; priceCents: number; imageUrl: string | null; station: string; options: OptionGroup[]; soldOut: boolean }
interface FailedJob { id: string; title: string | null; station: string | null; error: string | null; createdAt: string }

const MONEY_LOCALE: Record<string, string> = { USD: 'en-US', CAD: 'en-CA', VND: 'vi-VN', AUD: 'en-AU', GBP: 'en-GB', EUR: 'de-DE' };
function money(cents: number, currency: string): string {
  const code = (currency || 'USD').toUpperCase();
  try {
    const nf = new Intl.NumberFormat(MONEY_LOCALE[code] ?? 'en-US', { style: 'currency', currency: code });
    const zero = nf.resolvedOptions().maximumFractionDigits === 0;
    return nf.format(zero ? cents : cents / 100);
  } catch { return String(cents); }
}
function parseMoney(text: string, currency: string): number {
  const vnd = (currency || '').toUpperCase() === 'VND';
  if (vnd) return Math.max(0, Math.round(Number(String(text).replace(/[^\d]/g, '')) || 0));
  const n = Number(String(text).replace(/[^\d.]/g, ''));
  return Number.isFinite(n) ? Math.max(0, Math.round(n * 100)) : 0;
}
const toInput = (cents: number, currency: string) => String((currency || '').toUpperCase() === 'VND' ? cents : cents / 100);
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();

// ---- look --------------------------------------------------------------------
const C = {
  page: 'var(--c0b1120)', panel: 'var(--c0f172a)', raised: 'var(--c1e293b)', line: 'var(--line)', border: 'var(--c334155)',
  text: 'var(--ce2e8f0)', strong: 'var(--cf1f5f9)', muted: 'var(--c94a3b8)',
};
const btn: CSSProperties = { minHeight: 44, padding: '0 14px', borderRadius: 12, border: `1px solid ${C.border}`, background: C.panel, color: C.text, fontWeight: 700, fontSize: 14, cursor: 'pointer', fontFamily: 'inherit' };
const primary: CSSProperties = { ...btn, border: 'none', background: '#4f46e5', color: '#fff' };
const card: CSSProperties = { background: C.panel, border: `1px solid ${C.line}`, borderRadius: 16 };
const field: CSSProperties = { minHeight: 46, borderRadius: 12, border: `1px solid ${C.border}`, padding: '0 12px', background: C.panel, color: C.text, fontSize: 15, fontFamily: 'inherit' };
const chip = (on: boolean): CSSProperties => (on
  ? { minHeight: 40, padding: '0 14px', borderRadius: 999, border: 'none', background: '#4f46e5', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }
  : { minHeight: 40, padding: '0 14px', borderRadius: 999, border: `1px solid ${C.border}`, background: C.panel, color: C.text, fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' });
const picked = (on: boolean): CSSProperties => (on ? { borderColor: '#4f46e5', borderWidth: 2, background: 'var(--c1e1b4b)', color: 'var(--ce0e7ff)' } : {});

const TILE: Record<TableState, CSSProperties> = {
  free: { background: C.panel, border: `1.5px solid ${C.border}`, color: C.text },
  seated: { background: 'var(--c1e1b4b)', border: '1.5px solid var(--c818cf8)', color: 'var(--ce0e7ff)' },
  ordered: { background: '#4f46e5', border: '1.5px solid #4f46e5', color: '#fff' },
  unsent: { background: 'var(--c451a03)', border: '2px solid #ea580c', color: 'var(--cfde68a)' },
  prebilled: { background: '#0f766e', border: '1.5px solid #0f766e', color: '#fff' },
  askpay: { background: '#be185d', border: '1.5px solid #be185d', color: '#fff' },
  paying: { background: '#0f766e', border: '1.5px dashed #0f766e', color: '#fff' },
  call: { background: '#b45309', border: '2.5px solid #fbbf24', color: '#fff' },
};

function Modal({ title, vi, onClose, children, width = 460 }: { title: string; vi: boolean; onClose: () => void; children: ReactNode; width?: number }) {
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(2,6,23,0.6)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()} style={{ ...card, width: `min(${width}px, 96vw)`, maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', borderBottom: `1px solid ${C.line}` }}>
          <b style={{ flex: 1, fontSize: 17, color: C.strong }}>{title}</b>
          <button type="button" aria-label={vi ? 'Đóng' : 'Close'} onClick={onClose} style={{ ...btn, width: 44, padding: 0, fontSize: 18 }}>×</button>
        </div>
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>{children}</div>
      </div>
    </div>, document.body);
}

export function RestaurantTill({ onQuickSale }: { onQuickSale: () => void }) {
  const { token, user } = useAuth();
  const can = useCan();
  const { lang } = useLang();
  const vi = lang === 'vi';
  const L = (v: string, e: string) => (vi ? v : e);
  const mobile = useIsMobile(900);
  const isOwner = user?.role === 'SALON_ADMIN';
  const canVoid = can('pos.void');

  const [floor, setFloor] = useState<Floor | null>(null);
  const [menu, setMenu] = useState<Dish[]>([]);
  const [check, setCheck] = useState<CheckView | null>(null);
  const [area, setArea] = useState<string>('');
  const [cat, setCat] = useState<string>('');
  const [q, setQ] = useState('');
  const [tab, setTab] = useState<'menu' | 'bill'>('menu');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [taxRate, setTaxRate] = useState(0);
  const [methods, setMethods] = useState<PayMethod[]>(['CASH', 'CARD']);
  const [payInfo, setPayInfo] = useState<Record<string, { instructions?: string; qrUrl?: string }>>({});
  const [profile, setProfile] = useState<ReceiptProfile | null>(null);
  const [failed, setFailed] = useState<FailedJob[]>([]);
  const [openFor, setOpenFor] = useState<Table | null>(null);
  const [choose, setChoose] = useState<FloorCheck[] | null>(null);
  const [optionsFor, setOptionsFor] = useState<Dish | null>(null);
  const [voidLine, setVoidLine] = useState<CheckLine | null>(null);
  const [noteLine, setNoteLine] = useState<CheckLine | null>(null);
  const [showMove, setShowMove] = useState(false);
  const [showMerge, setShowMerge] = useState(false);
  const [showSplit, setShowSplit] = useState(false);
  const [showVoidCheck, setShowVoidCheck] = useState(false);
  const [showGuests, setShowGuests] = useState(false);
  const [showPay, setShowPay] = useState(false);
  const [showPrints, setShowPrints] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showSoldOut, setShowSoldOut] = useState(false);
  const [showShift, setShowShift] = useState(false);
  const [unsentAsk, setUnsentAsk] = useState(false);
  const shiftCtl = useShiftState(token);
  const flash = useRef<ReturnType<typeof setTimeout> | null>(null);

  const currency = floor?.currency ?? 'USD';
  const fmt = useCallback((c: number) => money(c, currency), [currency]);
  const say = useCallback((ok: boolean, text: string) => {
    setMsg({ ok, text });
    if (flash.current) clearTimeout(flash.current);
    flash.current = setTimeout(() => setMsg(null), ok ? 2500 : 5000);
  }, []);
  const fail = useCallback((e: unknown) => say(false, tillError(e instanceof ApiError || e instanceof Error ? e.message : String(e), vi)), [say, vi]);

  const loadFloor = useCallback(async () => {
    if (!token) return;
    try {
      const [f, bad] = await Promise.all([
        apiFetch<Floor>('/restaurant/floor', { token }),
        apiFetch<FailedJob[]>('/restaurant/prints/failed', { token }).catch(() => [] as FailedJob[]),
      ]);
      setFloor(f); setFailed(bad);
    } catch (e) { fail(e); }
  }, [token, fail]);
  const loadMenu = useCallback(async () => {
    if (!token) return;
    try { setMenu(await apiFetch<Dish[]>('/restaurant/menu', { token })); } catch (e) { fail(e); }
  }, [token, fail]);
  const loadCheck = useCallback(async (id: string) => {
    if (!token) return;
    try { setCheck(await apiFetch<CheckView>(`/restaurant/checks/${encodeURIComponent(id)}`, { token })); } catch (e) { fail(e); setCheck(null); }
  }, [token, fail]);
  // A quiet re-read (the pay screen watching for the bank transfer): a blip never closes the bill.
  const refreshCheck = useCallback(async (id: string) => {
    if (!token) return;
    try { setCheck(await apiFetch<CheckView>(`/restaurant/checks/${encodeURIComponent(id)}`, { token })); } catch { /* keep what is on screen */ }
  }, [token]);

  useEffect(() => {
    if (!token) return;
    void loadFloor();
    void loadMenu();
    apiFetch<{ pos?: { taxRatePercent?: number; resolvedPaymentMethods?: string[]; paymentDetails?: Record<string, { instructions?: string; qrUrl?: string }> } }>('/settings', { token })
      .then((s) => { setTaxRate(Math.max(0, s.pos?.taxRatePercent ?? 0)); setMethods(tillMethodsFrom(s.pos?.resolvedPaymentMethods)); setPayInfo(s.pos?.paymentDetails ?? {}); })
      .catch(() => undefined);
    apiFetch<ReceiptProfile>('/pos/receipt-profile', { token }).then(setProfile).catch(() => undefined);
  }, [token, loadFloor, loadMenu]);

  // The floor, the open bill and sold-out dishes follow what the other devices do.
  useEffect(() => {
    const t = setInterval(() => {
      setNow(new Date());
      if (check) void loadCheck(check.id); else void loadFloor();
      void loadMenu();
    }, 10000);
    return () => clearInterval(t);
  }, [check, loadCheck, loadFloor, loadMenu]);

  const checksByTable = useMemo(() => {
    const m = new Map<string, FloorCheck[]>();
    for (const c of floor?.checks ?? []) for (const id of c.tableIds) m.set(id, [...(m.get(id) ?? []), c]);
    return m;
  }, [floor]);
  const takeaways = useMemo(() => (floor?.checks ?? []).filter((c) => c.tableIds.length === 0), [floor]);
  const tablesSorted = useMemo(() => [...(floor?.tables ?? [])].sort(byTableName), [floor]);
  const areas = useMemo(() => [...new Set(tablesSorted.map((t) => t.area || ''))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })), [tablesSorted]);
  const categories = useMemo(() => [...new Set(menu.map((m) => m.category || ''))], [menu]);
  const shownDishes = useMemo(() => {
    const f = fold(q.trim());
    return menu.filter((m) => (!cat || (m.category || '') === cat) && (!f || fold(m.name).includes(f)));
  }, [menu, cat, q]);
  const stationName = useCallback((k: string) => floor?.settings.stations.find((s) => s.key === k)?.name ?? k, [floor]);
  // Dishes + the restaurant's service charge; the till's own tax (if any) goes on top, as at checkout.
  const billCents = check?.billCents ?? check?.subtotalCents ?? 0;
  const taxCents = useMemo(() => Math.round((billCents * taxRate) / 100), [billCents, taxRate]);
  const dueCents = billCents + taxCents;
  const canPay = floor?.canPay !== false;

  async function call<T>(path: string, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', body?: unknown): Promise<T | null> {
    if (!token) return null;
    setBusy(true);
    try { return await apiFetch<T>(path, { method, token, body }); } catch (e) { fail(e); return null; } finally { setBusy(false); }
  }

  async function openTable(t: Table | null, guests: number) {
    const c = await call<CheckView>('/restaurant/checks', 'POST', t ? { tableIds: [t.id], guests } : { takeaway: true, guests });
    setOpenFor(null);
    if (c) { setCheck(c); setTab('menu'); setQ(''); }
    else void loadFloor();
  }
  function openBill(c: FloorCheck) { setChoose(null); void loadCheck(c.id); setTab(mobile ? 'bill' : 'menu'); setQ(''); }
  function tapTable(t: Table) {
    const cs = checksByTable.get(t.id) ?? [];
    if (cs.length === 1) openBill(cs[0]);
    else if (cs.length > 1) setChoose(cs);
    else setOpenFor(t);
  }
  function backToFloor() { setCheck(null); void loadFloor(); }

  async function addDish(d: Dish, options?: { groupId: string; choiceIds: string[] }[]) {
    if (!check) return;
    if (d.soldOut) { say(false, L('Món này đã hết.', 'That dish is sold out.')); return; }
    if (!options && d.options.length) { setOptionsFor(d); return; }
    const c = await call<CheckView>(`/restaurant/checks/${check.id}/lines`, 'POST', { menuItemId: d.id, quantity: 1, ...(options ? { options } : {}) });
    if (c) setCheck(c);
  }
  async function setQty(l: CheckLine, n: number) {
    if (!check) return;
    const c = await call<CheckView>(`/restaurant/checks/${check.id}/lines/${l.id}`, 'PATCH', { quantity: Math.max(0, n) });
    if (c) setCheck(c);
  }
  async function saveNote(l: CheckLine, note: string) {
    if (!check) return;
    const c = await call<CheckView>(`/restaurant/checks/${check.id}/lines/${l.id}`, 'PATCH', { note });
    setNoteLine(null);
    if (c) setCheck(c);
  }
  async function send() {
    if (!check) return;
    const r = await call<{ sent: number; stations: string[]; check: CheckView }>(`/restaurant/checks/${check.id}/send`, 'POST');
    if (!r) return;
    setCheck(r.check);
    say(true, r.sent ? L(`Đã báo bếp ${r.sent} món · ${r.stations.map(stationName).join(', ')}`, `Sent ${r.sent} to ${r.stations.map(stationName).join(', ')}`) : L('Không có món mới để báo.', 'Nothing new to send.'));
  }
  async function prebill() {
    if (!check) return;
    const r = await call<{ check: CheckView }>(`/restaurant/checks/${check.id}/prebill`, 'POST', {});
    if (r) { setCheck(r.check); say(true, L('Đã gửi phiếu tạm tính ra máy quầy.', 'Guest check sent to the counter printer.')); }
  }
  async function askPay() {
    if (!check) return;
    const c = await call<CheckView>(`/restaurant/checks/${check.id}/request-pay`, 'POST');
    if (c) { setCheck(c); say(true, L('Đã báo thu ngân: bàn muốn thanh toán.', 'The cashier has been told this table wants to pay.')); }
  }
  async function fire() {
    if (!check) return;
    const r = await call<{ sent: number; stations: string[]; check: CheckView }>(`/restaurant/checks/${check.id}/send`, 'POST', { held: true });
    if (!r) return;
    setCheck(r.check);
    say(true, r.sent ? L(`Đã gọi ${r.sent} món đang giữ · ${r.stations.map(stationName).join(', ')}`, `Fired ${r.sent} held · ${r.stations.map(stationName).join(', ')}`) : L('Không có món đang giữ.', 'Nothing held.'));
  }
  async function toggleHold(l: CheckLine) {
    if (!check) return;
    const c = await call<CheckView>(`/restaurant/checks/${check.id}/lines/${l.id}/hold`, 'PATCH', { held: !l.held });
    if (c) setCheck(c);
  }
  async function acceptQr(sendNow: boolean) {
    if (!check) return;
    const c = await call<CheckView>(`/restaurant/checks/${check.id}/accept-qr`, 'POST', { send: sendNow });
    if (c) { setCheck(c); say(true, sendNow ? L('Đã nhận món khách gọi và báo bếp.', 'Accepted and sent to the kitchen.') : L('Đã nhận món khách gọi vào bill.', 'Accepted onto the bill.')); }
  }
  async function rejectQr() {
    if (!check) return;
    const c = await call<CheckView>(`/restaurant/checks/${check.id}/reject-qr`, 'POST');
    if (c) { setCheck(c); say(true, L('Đã bỏ các món khách gọi qua QR.', 'QR dishes rejected.')); }
  }
  async function clearCall(id: string) {
    const c = await call<CheckView>(`/restaurant/checks/${id}/clear-call`, 'POST');
    if (c && check?.id === id) setCheck(c);
    if (!check) void loadFloor();
  }
  async function openDrawer() {
    const r = await call<{ ok: boolean }>('/print-jobs/drawer', 'POST', { reason: 'manual' });
    if (r) say(true, L('Đã mở két (được ghi lại người mở).', 'Drawer opened (logged).'));
  }
  function startPay() {
    if (!check) return;
    if ((check.pendingCount ?? 0) > 0) { say(false, tillError('QR_PENDING', vi)); return; }
    if (check.unsentCount + (check.heldCount ?? 0) > 0) { setUnsentAsk(true); return; }
    setShowPay(true);
  }
  async function toggleSoldOut(d: Dish) {
    const m = await call<Dish[]>(`/restaurant/menu/${d.id}/sold-out`, 'POST', { soldOut: !d.soldOut });
    if (m) setMenu(m);
  }

  const shiftPanel = showShift && typeof document !== 'undefined' && createPortal(
    <CashShiftPanel token={token} vi={vi} currency={currency} fmt={fmt} salonName={profile?.shop.name} cashierName={user?.firstName || undefined}
      onState={shiftCtl.setState} onClose={() => setShowShift(false)} onHistory={() => { window.location.href = '/salon/pos/shifts'; }} />, document.body);

  const calls = (floor?.checks ?? []).filter((c) => (c.pendingCount ?? 0) > 0 || c.callReason);

  // ---------------------------------------------------------------- floor ----
  if (!check) {
    const tables = tablesSorted.filter((t) => !area || (t.area || '') === area);
    const groups = areas.filter((g) => tables.some((t) => (t.area || '') === g));
    const tile = (key: string, label: string, cs: FloorCheck[], onClick: () => void, seats?: number) => {
      const st = combinedState(cs);
      const first = cs[0];
      const mins = first ? minutesOpen(first.openedAt, now) : 0;
      const tone = first ? timerTone(mins, floor?.settings.warnMinutes, floor?.settings.lateMinutes) : 'ok';
      const total = cs.reduce((s, c) => s + c.subtotalCents, 0);
      const unsent = cs.reduce((s, c) => s + c.unsentCount, 0);
      const guests = cs.reduce((s, c) => s + c.guests, 0);
      const caller = cs.find((c) => (c.pendingCount ?? 0) > 0 || c.callReason);
      return (
        <button key={key} type="button" onClick={onClick} aria-label={label}
          style={{ ...TILE[st], minHeight: mobile ? 92 : 112, borderRadius: 14, padding: 10, textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: 4 }}>
          <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
            <b style={{ fontSize: 18 }}>{label}</b>
            {first && <span style={{ fontSize: 11.5, fontWeight: 800, padding: '2px 7px', borderRadius: 999, ...(tone === 'late' ? { background: '#b91c1c', color: '#fff' } : tone === 'warn' ? { background: '#f59e0b', color: '#1c1917' } : { background: 'rgba(127,127,127,.18)' }) }}>{mins}′</span>}
          </span>
          <span style={{ fontSize: 12, fontWeight: 600 }}>
            {!first ? L(`Trống · ${seats ?? 0} ghế`, `Free · ${seats ?? 0} seats`)
              : st === 'call' && caller ? ((caller.pendingCount ?? 0) > 0 ? L(`QR: ${caller.pendingCount} món chờ nhận`, `QR: ${caller.pendingCount} to accept`) : callText(caller.callReason, vi))
              : st === 'unsent' ? L(`${unsent} món chưa báo bếp`, `${unsent} not sent`)
                : st === 'askpay' ? L('Khách gọi thanh toán', 'Wants to pay')
                  : st === 'seated' ? L(`${guests} khách · chưa gọi`, `${guests} guests · no order`)
                    : st === 'prebilled' ? L('Đã in tạm tính', 'Check printed')
                      : st === 'paying' ? L('Đang thanh toán', 'Paying')
                        : `${guests} ${L('khách', 'guests')}${first.serverName ? ` · ${first.serverName}` : ''}`}
            {cs.length > 1 ? ` · ${cs.length} bill` : ''}
          </span>
          {total > 0 && <b style={{ fontSize: 14 }}>{fmt(total)}</b>}
        </button>
      );
    };
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, color: C.text }}>
        <TillHeader vi={vi} cashier={user?.firstName ?? ''} shiftOpen={!!shiftCtl.state?.shift} failed={failed.length} canPay={canPay}
          onShift={() => setShowShift(true)} onPrints={() => setShowPrints(true)} onTakeaway={() => void openTable(null, 1)} onRetail={onQuickSale}
          onSoldOut={() => setShowSoldOut(true)} onSettings={isOwner ? () => setShowSettings(true) : undefined} onDrawer={() => void openDrawer()} />
        {msg && <Toast {...msg} />}
        {calls.length > 0 && (
          <div role="alert" style={{ ...card, padding: 10, border: '2px solid #f59e0b', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {calls.map((c) => (
              <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <b style={{ flex: '1 1 220px', minWidth: 0, color: C.strong }}>
                  {c.takeaway ? c.tables : `${L('Bàn', 'Table')} ${c.tables}`} · {(c.pendingCount ?? 0) > 0 ? L(`${c.pendingCount} món khách gọi qua QR, chờ xác nhận`, `${c.pendingCount} dishes ordered by QR, waiting`) : callText(c.callReason, vi)}
                  {c.callAt ? <span style={{ color: C.muted, fontWeight: 600 }}> · {minutesOpen(c.callAt, now)}′</span> : null}
                </b>
                {c.callReason && <button type="button" disabled={busy} onClick={() => void clearCall(c.id)} style={btn}>{L('Đã xem', 'Seen')}</button>}
                <button type="button" onClick={() => openBill(c)} style={primary}>{L('Mở bill', 'Open bill')}</button>
              </div>
            ))}
          </div>
        )}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <button type="button" onClick={() => setArea('')} style={chip(!area)}>{L('Tất cả', 'All')} · {floor?.tables.length ?? 0}</button>
          {areas.filter(Boolean).map((a) => (
            <button key={a} type="button" onClick={() => setArea(a)} style={chip(area === a)}>{a}</button>
          ))}
          <span style={{ marginLeft: 'auto', fontSize: 12.5, color: C.muted }}>{L(`${floor?.checks.length ?? 0} bill đang mở`, `${floor?.checks.length ?? 0} open bills`)}</span>
        </div>
        <Legend vi={vi} />
        {!floor && <p style={{ color: C.muted }}>{L('Đang tải sơ đồ bàn…', 'Loading tables…')}</p>}
        {floor && floor.tables.length === 0 && (
          <div style={{ ...card, padding: 20 }}>
            <b>{L('Chưa có bàn nào.', 'No tables yet.')}</b>
            <p style={{ margin: '6px 0 0', color: C.muted }}>{L('Thêm bàn ở mục Bàn, rồi quay lại đây để gọi món.', 'Add tables under Tables, then come back to take orders.')} <a href="/salon/tables">{L('Mở mục Bàn', 'Open Tables')}</a></p>
          </div>
        )}
        {takeaways.length > 0 && (
          <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '.06em', color: C.muted }}>{L('MANG VỀ', 'TO GO')}</div>
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(${mobile ? 104 : 150}px, 1fr))`, gap: 10 }}>
              {takeaways.map((c) => tile(c.id, c.tables, [c], () => openBill(c)))}
            </div>
          </section>
        )}
        {groups.map((g) => (
          <section key={g || '_'} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {groups.length > 1 && <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '.06em', color: C.muted }}>{(g || L('Khác', 'Other')).toUpperCase()}</div>}
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(${mobile ? 104 : 150}px, 1fr))`, gap: 10 }}>
              {tables.filter((t) => (t.area || '') === g).map((t) => {
                const cs = checksByTable.get(t.id) ?? [];
                const label = cs.length === 1 && cs[0].tableIds.length > 1 ? cs[0].tables : t.name;
                return tile(t.id, label, cs, () => tapTable(t), t.seats);
              })}
            </div>
          </section>
        ))}
        {openFor && (
          <Modal vi={vi} title={L(`Mở bàn ${openFor.name}`, `Open ${openFor.name}`)} onClose={() => setOpenFor(null)}>
            <span style={{ color: C.muted }}>{L('Bao nhiêu khách?', 'How many guests?')}</span>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: 8 }}>
              {Array.from({ length: Math.max(8, Math.min(16, openFor.seats + 2)) }, (_, i) => i + 1).map((n) => (
                <button key={n} type="button" disabled={busy} onClick={() => void openTable(openFor, n)} style={{ ...btn, minHeight: 52, fontSize: 17, ...(n === openFor.seats ? { borderColor: '#4f46e5' } : {}) }}>{n}</button>
              ))}
            </div>
          </Modal>
        )}
        {choose && (
          <Modal vi={vi} title={L('Bàn này có nhiều bill', 'This table has several bills')} onClose={() => setChoose(null)}>
            {choose.map((c) => (
              <button key={c.id} type="button" onClick={() => openBill(c)} style={{ ...btn, minHeight: 56, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>Bill #{c.number} · {c.itemCount} {L('món', 'items')}</span><b>{fmt(c.subtotalCents)}</b>
              </button>
            ))}
          </Modal>
        )}
        {showSoldOut && <SoldOutModal vi={vi} menu={menu} busy={busy} onToggle={(d) => void toggleSoldOut(d)} onClose={() => setShowSoldOut(false)} />}
        {showPrints && <PrintsModal vi={vi} jobs={failed} onClose={() => setShowPrints(false)} onRetry={async (id) => { await call(`/restaurant/prints/${id}/retry`, 'POST'); void loadFloor(); }} />}
        {showSettings && floor && <SettingsModal vi={vi} token={token} settings={floor.settings} categories={categories} onClose={() => setShowSettings(false)} onSaved={() => { setShowSettings(false); void loadFloor(); void loadMenu(); }} />}
        {shiftPanel}
      </div>
    );
  }

  // ---------------------------------------------------------------- order ----
  const groups = lineGroups(check.lines);
  const unsent = check.unsentCount;
  const held = check.heldCount ?? 0;
  const pending = pendingLines(check.lines);
  const bankPaid = check.bankPaidCents ?? 0;
  const row = (label: ReactNode, value: string, style?: CSSProperties) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', color: C.muted, ...style }}><span>{label}</span><span>{value}</span></div>
  );
  const otherBills = (floor?.checks ?? []).filter((c) => c.id !== check.id && c.status === 'OPEN');
  const lineText = (l: CheckLine) => [...(l.options ?? []), ...(l.note ? [l.note] : [])].join(' · ');
  const menuPane = (
    <section aria-label={L('Thực đơn', 'Menu')} style={{ flex: '999 1 520px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 48, padding: '0 14px', ...card, borderRadius: 14 }}>
        <span style={{ position: 'absolute', left: -9999 }}>{L('Tìm món', 'Search dishes')}</span>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={L('Tìm món (gõ “pho”, “bia”…)', 'Search dishes')} style={{ flex: 1, border: 0, outline: 0, background: 'transparent', color: C.text, fontSize: 15, fontFamily: 'inherit' }} />
      </label>
      <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 2 }}>
        <button type="button" onClick={() => setCat('')} style={chip(!cat)}>{L('Tất cả', 'All')}</button>
        {categories.map((c0) => <button key={c0 || '_'} type="button" onClick={() => setCat(c0)} style={chip(cat === c0)}>{c0 || L('Khác', 'Other')}</button>)}
      </div>
      {menu.length === 0 && <div style={{ ...card, padding: 16 }}>{L('Chưa có món nào trong thực đơn.', 'The menu is empty.')} <a href="/salon/menu">{L('Thêm món', 'Add dishes')}</a></div>}
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(${mobile ? 140 : 160}px, 1fr))`, gap: 8 }}>
        {shownDishes.map((d) => (
          <button key={d.id} type="button" disabled={busy || d.soldOut} onClick={() => void addDish(d)}
            style={{ minHeight: 92, borderRadius: 14, border: d.soldOut ? `1px dashed ${C.border}` : `1px solid ${C.line}`, background: d.soldOut ? C.raised : C.panel, color: d.soldOut ? C.muted : C.text, textAlign: 'left', padding: 10, cursor: d.soldOut ? 'not-allowed' : 'pointer', fontFamily: 'inherit', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: 6 }}>
            <b style={{ fontSize: 14.5, lineHeight: 1.3, textDecoration: d.soldOut ? 'line-through' : undefined }}>{d.name}</b>
            <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
              {d.soldOut
                ? <span style={{ fontSize: 11.5, fontWeight: 800, color: 'var(--ink-bad)' }}>{L('HẾT MÓN', 'SOLD OUT')}</span>
                : <span style={{ fontSize: 11.5, fontWeight: 700, color: d.station === 'BAR' ? 'var(--ca5f3fc)' : C.muted }}>{stationName(d.station)}{d.options.length ? ` · ${L('tuỳ chọn', 'options')}` : ''}</span>}
              <b style={{ fontSize: 13.5 }}>{fmt(d.priceCents)}</b>
            </span>
          </button>
        ))}
      </div>
    </section>
  );

  const billPane = (
    <aside aria-label="Bill" style={{ flex: '1 1 360px', minWidth: 0, maxWidth: mobile ? undefined : 460, ...card, display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '12px 14px', borderBottom: `1px solid ${C.line}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <b style={{ fontSize: 12.5, letterSpacing: '.06em', color: C.muted }}>BILL #{check.number} · {check.itemCount} {L('MÓN', 'ITEMS')}</b>
        {check.changedAfterPrebill && <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--ink-warn)' }}>{L('Sửa sau tạm tính', 'Changed after check printed')}</span>}
        {check.payRequestedAt && <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--ink-bad)' }}>{L('Khách gọi thanh toán', 'Wants to pay')}</span>}
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 12, minHeight: 200 }}>
        {check.callReason && (
          <div role="alert" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 10, borderRadius: 14, border: '2px solid #f59e0b' }}>
            <b style={{ flex: 1, color: 'var(--ink-warn)' }}>{callText(check.callReason, vi)}{check.callAt ? ` · ${minutesOpen(check.callAt, now)}′` : ''}</b>
            <button type="button" disabled={busy} onClick={() => void clearCall(check.id)} style={btn}>{L('Đã xem', 'Seen')}</button>
          </div>
        )}
        {pending.length > 0 && (
          <section aria-label={L('Món khách gọi qua QR', 'QR order')} style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 10, borderRadius: 14, border: '2px solid #f59e0b' }}>
            <b style={{ fontSize: 12, letterSpacing: '.04em', color: 'var(--ink-warn)' }}>{L('KHÁCH GỌI QUA QR · CHỜ XÁC NHẬN', 'ORDERED BY QR · WAITING FOR YOU')}</b>
            {pending.map((l) => (
              <div key={l.id} style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                <b style={{ minWidth: 26 }}>{l.quantity}×</b>
                <span style={{ flex: 1, minWidth: 0 }}><b style={{ color: C.strong }}>{l.name}</b>{lineText(l) && <><br /><span style={{ fontSize: 12.5, color: C.muted }}>{lineText(l)}</span></>}</span>
                <span style={{ fontWeight: 700 }}>{fmt(l.quantity * l.unitPriceCents)}</span>
              </div>
            ))}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 6 }}>
              <button type="button" disabled={busy} onClick={() => void acceptQr(true)} style={{ ...btn, border: 'none', background: '#ea580c', color: '#fff', minHeight: 46 }}>{L('Nhận & báo bếp', 'Accept & send')}</button>
              <button type="button" disabled={busy} onClick={() => void acceptQr(false)} style={{ ...btn, minHeight: 46 }}>{L('Nhận, chưa báo', 'Accept only')}</button>
              <button type="button" disabled={busy} onClick={() => void rejectQr()} style={{ ...btn, minHeight: 46, color: 'var(--ink-bad)' }}>{L('Từ chối', 'Reject')}</button>
            </div>
          </section>
        )}
        {check.lines.length === 0 && <p style={{ color: C.muted, textAlign: 'center', margin: '30px 0' }}>{L('Chạm món để thêm vào bill.', 'Tap a dish to add it.')}</p>}
        {groups.map((g) => g.key === 'unsent' ? (
          <section key={g.key} style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 10, borderRadius: 14, border: '2px solid #ea580c', background: 'var(--c451a03)' }}>
            <b style={{ fontSize: 12, letterSpacing: '.04em', color: 'var(--cfde68a)' }}>{L('CHƯA BÁO BẾP · SỬA THOẢI MÁI', 'NOT SENT YET · EDIT FREELY')}</b>
            {g.lines.map((l) => (
              <div key={l.id} style={{ display: 'flex', alignItems: 'center', gap: 8, ...(l.held ? { opacity: 0.72 } : {}) }}>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <b style={{ color: C.strong }}>{l.name}</b>
                  {l.source === 'QR' && <span style={{ marginLeft: 6, fontSize: 10.5, fontWeight: 800, padding: '1px 6px', borderRadius: 6, border: `1px solid ${C.border}` }}>QR</span>}
                  {(l.options ?? []).length > 0 && <><br /><span style={{ fontSize: 12.5, color: C.text }}>{(l.options ?? []).join(' · ')}</span></>}
                  <br />
                  <span style={{ display: 'inline-flex', gap: 12, flexWrap: 'wrap' }}>
                    <button type="button" onClick={() => setNoteLine(l)} style={{ border: 0, background: 'none', padding: 0, color: 'var(--ink-link)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}>{l.note ? `“${l.note}”` : L('+ Ghi chú cho bếp', '+ Note for the kitchen')}</button>
                    <button type="button" aria-pressed={!!l.held} disabled={busy} onClick={() => void toggleHold(l)} style={{ border: 0, background: 'none', padding: 0, color: l.held ? 'var(--ink-warn)' : 'var(--ink-link)', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>{l.held ? L('⏸ Đang giữ · bỏ giữ', '⏸ Held · release') : L('Giữ lại, gọi sau', 'Hold for later')}</button>
                  </span>
                </span>
                <span style={{ display: 'inline-flex', alignItems: 'center', borderRadius: 10, border: `1px solid ${C.border}`, background: C.panel }}>
                  <button type="button" aria-label={L('Bớt', 'Less')} disabled={busy} onClick={() => void setQty(l, l.quantity - 1)} style={{ width: 40, height: 40, border: 0, background: 'none', color: C.text, fontSize: 18, fontWeight: 800, cursor: 'pointer' }}>−</button>
                  <b style={{ minWidth: 20, textAlign: 'center' }}>{l.quantity}</b>
                  <button type="button" aria-label={L('Thêm', 'More')} disabled={busy} onClick={() => void setQty(l, l.quantity + 1)} style={{ width: 40, height: 40, border: 0, background: 'none', color: C.text, fontSize: 18, fontWeight: 800, cursor: 'pointer' }}>+</button>
                </span>
                <b style={{ minWidth: 72, textAlign: 'right' }}>{fmt(l.quantity * l.unitPriceCents)}</b>
              </div>
            ))}
          </section>
        ) : (
          <section key={g.key} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: '.04em', color: C.muted }}>
              {L('ĐÃ BÁO BẾP', 'SENT')}{g.batch ? ` · ${L('LẦN', 'ROUND')} ${g.batch}` : ''}{g.sentAt ? ` · ${new Date(g.sentAt).toLocaleTimeString(vi ? 'vi-VN' : 'en-US', { hour: '2-digit', minute: '2-digit' })}` : ''}{g.by ? ` · ${g.by}` : ''}
            </div>
            {g.lines.map((l) => (
              <div key={l.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 12, background: C.raised, ...(l.state === 'VOID' ? { opacity: 0.6 } : {}) }}>
                <b style={{ minWidth: 26, textDecoration: l.state === 'VOID' ? 'line-through' : undefined }}>{l.quantity}×</b>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <b style={{ textDecoration: l.state === 'VOID' ? 'line-through' : undefined }}>{l.name}</b>
                  {lineText(l) && <><br /><span style={{ fontSize: 12.5, color: C.muted }}>{lineText(l)}</span></>}
                  {l.state === 'VOID' && <><br /><span style={{ fontSize: 12.5, color: 'var(--ink-bad)', fontWeight: 600 }}>{L('Đã huỷ', 'Cancelled')}{l.voidReason ? ` · ${l.voidReason}` : ''}</span></>}
                </span>
                {l.state === 'SENT' && l.readyAt && <span style={{ fontSize: 11.5, fontWeight: 800, color: 'var(--ink-good)' }}>✓ {L('Bếp xong', 'Ready')}</span>}
                <span style={{ fontWeight: 700, textDecoration: l.state === 'VOID' ? 'line-through' : undefined }}>{fmt(l.quantity * l.unitPriceCents)}</span>
                {l.state === 'SENT' && <button type="button" aria-label={L('Huỷ món', 'Cancel dish')} onClick={() => setVoidLine(l)} style={{ ...btn, width: 40, minHeight: 40, padding: 0 }}>⋯</button>}
              </div>
            ))}
          </section>
        ))}
      </div>
      <div style={{ padding: 12, borderTop: `1px solid ${C.line}`, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {(check.serviceCents ?? 0) > 0 && row(L('Tiền món', 'Dishes'), fmt(check.subtotalCents))}
        {(check.serviceCents ?? 0) > 0 && row(`${L('Phí phục vụ', 'Service charge')} ${check.serviceChargePercent ?? 0}%`, fmt(check.serviceCents ?? 0))}
        {taxCents > 0 && row(`${L('Thuế', 'Tax')} ${taxRate}%`, fmt(taxCents))}
        {(check.vatCents ?? 0) > 0 && row(`${L('Đã gồm VAT', 'Incl. VAT')} ${check.vatPercent ?? 0}%`, fmt(check.vatCents ?? 0), { fontSize: 12.5 })}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}><b style={{ fontSize: 16 }}>{L('Tổng', 'Total')}</b><b style={{ fontSize: 26, color: C.strong }}>{fmt(dueCents)}</b></div>
        {bankPaid > 0 && row(L('Đã nhận chuyển khoản', 'Bank transfer received'), fmt(bankPaid), { color: 'var(--ink-good)', fontWeight: 800 })}
        <button type="button" disabled={busy || unsent === 0} onClick={() => void send()}
          style={{ ...btn, minHeight: 52, border: 'none', fontSize: 15.5, ...(unsent > 0 ? { background: '#ea580c', color: '#fff' } : { opacity: 0.55 }) }}>
          {unsent > 0 ? L(`Báo bếp · ${unsent} món mới`, `Send to kitchen · ${unsent} new`) : L('Không có món mới', 'Nothing new to send')}
        </button>
        {held > 0 && (
          <button type="button" disabled={busy} onClick={() => void fire()} style={{ ...btn, minHeight: 50, border: 'none', background: '#7c3aed', color: '#fff' }}>
            {L(`Gọi món đang giữ · ${held} món`, `Fire held dishes · ${held}`)}
          </button>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: 8 }}>
          <button type="button" disabled={busy || check.itemCount === 0} onClick={() => void prebill()} style={{ ...btn, minHeight: 50 }}>{L('In tạm tính', 'Print check')}{check.preBillCount ? ` (${check.preBillCount})` : ''}</button>
          {canPay
            ? <button type="button" disabled={busy || check.itemCount === 0} onClick={startPay} style={{ ...primary, minHeight: 50, opacity: check.itemCount === 0 ? 0.55 : 1 }}>{L('Thanh toán', 'Pay')}</button>
            : <button type="button" disabled={busy || check.itemCount === 0} onClick={() => void askPay()} style={{ ...btn, minHeight: 50, border: 'none', background: '#be185d', color: '#fff' }}>{check.payRequestedAt ? L('Đã báo thu ngân', 'Cashier told') : L('Yêu cầu thanh toán', 'Ask to pay')}</button>}
        </div>
        <span style={{ fontSize: 12, color: C.muted, textAlign: 'center' }}>{L('Món đã báo bếp bị khoá. Bỏ món đó = huỷ món, cần lý do.', 'Sent dishes are locked. Removing one means cancelling it, with a reason.')}</span>
      </div>
    </aside>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, color: C.text }}>
      <div style={{ ...card, padding: '10px 12px', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
        <button type="button" onClick={backToFloor} style={btn}>‹ {L('Sơ đồ bàn', 'Tables')}</button>
        <div style={{ flex: '1 1 160px', minWidth: 0 }}>
          <div style={{ fontWeight: 800, fontSize: 18, color: C.strong }}>{check.takeaway ? check.tables : `${L('Bàn', 'Table')} ${check.tables}`}</div>
          <div style={{ fontSize: 12.5, color: C.muted }}>{L('Mở', 'Opened')} {new Date(check.openedAt).toLocaleTimeString(vi ? 'vi-VN' : 'en-US', { hour: '2-digit', minute: '2-digit' })} · {minutesOpen(check.openedAt, now)}′{check.serverName ? ` · ${check.serverName}` : ''}</div>
        </div>
        <button type="button" onClick={() => setShowGuests(true)} style={btn}>{check.guests} {L('khách', 'guests')} ▾</button>
        {!check.takeaway && <button type="button" onClick={() => setShowMove(true)} style={btn}>{L('Chuyển bàn', 'Move')}</button>}
        <button type="button" onClick={() => setShowMerge(true)} style={btn}>{L('Gộp bill', 'Merge')}</button>
        <button type="button" onClick={() => setShowSplit(true)} disabled={check.itemCount < 2} style={{ ...btn, opacity: check.itemCount < 2 ? 0.5 : 1 }}>{L('Tách bill', 'Split')}</button>
        <button type="button" onClick={() => setShowVoidCheck(true)} style={{ ...btn, color: 'var(--ink-bad)' }}>{L('Huỷ bill', 'Void')}</button>
      </div>
      {msg && <Toast {...msg} />}
      {mobile && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: 6 }}>
          <button type="button" onClick={() => setTab('menu')} style={chip(tab === 'menu')}>{L('Thực đơn', 'Menu')}</button>
          <button type="button" onClick={() => setTab('bill')} style={chip(tab === 'bill')}>Bill · {check.itemCount}{check.unsentCount ? ` (${check.unsentCount} ${L('mới', 'new')})` : ''}</button>
        </div>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'stretch' }}>
        {(!mobile || tab === 'menu') && menuPane}
        {(!mobile || tab === 'bill') && billPane}
      </div>
      {mobile && tab === 'menu' && check.unsentCount > 0 && (
        <button type="button" onClick={() => setTab('bill')} style={{ position: 'sticky', bottom: 12, minHeight: 52, borderRadius: 14, border: 'none', background: '#ea580c', color: '#fff', fontWeight: 800, fontSize: 15, fontFamily: 'inherit' }}>
          {L(`Xem bill · ${check.unsentCount} món chưa báo bếp`, `View bill · ${check.unsentCount} not sent`)}
        </button>
      )}

      {optionsFor && <OptionsModal vi={vi} dish={optionsFor} fmt={fmt} busy={busy} onClose={() => setOptionsFor(null)}
        onAdd={async (opts) => { const d = optionsFor; setOptionsFor(null); await addDish(d, opts); }} />}
      {noteLine && <NoteModal vi={vi} line={noteLine} onClose={() => setNoteLine(null)} onSave={(n) => void saveNote(noteLine, n)} />}
      {voidLine && <VoidModal vi={vi} line={voidLine} needPin={!!floor?.settings.voidNeedsApproval && !canVoid} busy={busy} fmt={fmt}
        onClose={() => setVoidLine(null)}
        onConfirm={async (quantity, reason, approvalPin) => {
          const c = await call<CheckView>(`/restaurant/checks/${check.id}/lines/${voidLine.id}/void`, 'POST', { quantity, reason, ...(approvalPin ? { approvalPin } : {}) });
          if (c) { setCheck(c); setVoidLine(null); say(true, L('Đã huỷ món, bếp nhận phiếu huỷ.', 'Cancelled; the kitchen got a cancel ticket.')); }
        }} />}
      {showGuests && (
        <Modal vi={vi} title={L('Số khách', 'Guests')} onClose={() => setShowGuests(false)}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: 8 }}>
            {Array.from({ length: 16 }, (_, i) => i + 1).map((n) => (
              <button key={n} type="button" onClick={async () => { const c = await call<CheckView>(`/restaurant/checks/${check.id}`, 'PATCH', { guests: n }); setShowGuests(false); if (c) setCheck(c); }} style={{ ...btn, minHeight: 52, ...(n === check.guests ? { borderColor: '#4f46e5' } : {}) }}>{n}</button>
            ))}
          </div>
        </Modal>
      )}
      {showMove && floor && (
        <Modal vi={vi} title={L(`Chuyển ${check.tables} sang bàn…`, `Move ${check.tables} to…`)} onClose={() => setShowMove(false)}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(90px, 1fr))', gap: 8 }}>
            {tablesSorted.filter((t) => !checksByTable.has(t.id)).map((t) => (
              <button key={t.id} type="button" disabled={busy} onClick={async () => { const c = await call<CheckView>(`/restaurant/checks/${check.id}/move`, 'POST', { tableIds: [t.id] }); setShowMove(false); if (c) { setCheck(c); say(true, L(`Đã chuyển sang ${t.name}.`, `Moved to ${t.name}.`)); void loadFloor(); } }} style={{ ...btn, minHeight: 56 }}>{t.name}<br /><span style={{ fontSize: 11.5, color: C.muted }}>{t.seats} {L('ghế', 'seats')}</span></button>
            ))}
          </div>
          {tablesSorted.every((t) => checksByTable.has(t.id)) && <p style={{ color: C.muted }}>{L('Không còn bàn trống.', 'No free table.')}</p>}
        </Modal>
      )}
      {showMerge && (
        <Modal vi={vi} title={L(`Gộp bill khác vào ${check.tables}`, `Merge another bill into ${check.tables}`)} onClose={() => setShowMerge(false)}>
          <span style={{ color: C.muted }}>{L('Món, bàn và số khách của bill được chọn chuyển sang bill này. Bếp nhận phiếu chuyển bàn cho món đang làm.', 'Its dishes, tables and guests come over to this bill. The kitchen is told about dishes still cooking.')}</span>
          {otherBills.length === 0 && <span style={{ color: C.muted }}>{L('Không có bill nào khác đang mở.', 'No other open bill.')}</span>}
          {otherBills.map((c) => (
            <button key={c.id} type="button" disabled={busy} onClick={async () => { const v = await call<CheckView>(`/restaurant/checks/${check.id}/merge`, 'POST', { fromCheckId: c.id }); setShowMerge(false); if (v) { setCheck(v); say(true, L(`Đã gộp ${c.tables} vào bill này.`, `Merged ${c.tables} into this bill.`)); void loadFloor(); } }}
              style={{ ...btn, minHeight: 56, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>{c.tables} · #{c.number} · {c.guests} {L('khách', 'guests')}</span><b>{fmt(c.subtotalCents)}</b>
            </button>
          ))}
        </Modal>
      )}
      {showSplit && <SplitModal vi={vi} check={check} fmt={fmt} busy={busy} onClose={() => setShowSplit(false)}
        onSplit={async (lines) => {
          const r = await call<{ from: CheckView; to: CheckView }>(`/restaurant/checks/${check.id}/split`, 'POST', { lines });
          if (r) { setShowSplit(false); setCheck(r.from); void loadFloor(); say(true, L(`Đã tách sang bill #${r.to.number} (${fmt(r.to.subtotalCents)}).`, `Split onto bill #${r.to.number} (${fmt(r.to.subtotalCents)}).`)); }
        }} />}
      {showVoidCheck && <VoidCheckModal vi={vi} hasSent={check.sentCount > 0} needPin={!!floor?.settings.voidNeedsApproval && !canVoid && check.sentCount > 0} busy={busy}
        onClose={() => setShowVoidCheck(false)}
        onConfirm={async (reason, approvalPin) => {
          const c = await call<CheckView>(`/restaurant/checks/${check.id}/void`, 'POST', { ...(reason ? { reason } : {}), ...(approvalPin ? { approvalPin } : {}) });
          if (c) { setShowVoidCheck(false); say(true, L('Đã huỷ bill.', 'Bill voided.')); backToFloor(); }
        }} />}
      {unsentAsk && (
        <Modal vi={vi} title={L('Còn món chưa báo bếp', 'Dishes not sent yet')} onClose={() => setUnsentAsk(false)}>
          <span>{L(`${check.unsentCount + (check.heldCount ?? 0)} món chưa gửi bếp. Báo bếp trước, hay thu tiền luôn (ví dụ nước lấy tại quầy)?`, `${check.unsentCount + (check.heldCount ?? 0)} dishes were never sent. Send them first, or take payment as is?`)}</span>
          <button type="button" onClick={async () => { setUnsentAsk(false); if (check.unsentCount > 0) await send(); if ((check.heldCount ?? 0) > 0) await fire(); setShowPay(true); }} style={{ ...btn, minHeight: 50, border: 'none', background: '#ea580c', color: '#fff' }}>{L('Báo bếp rồi thu tiền', 'Send, then pay')}</button>
          <button type="button" onClick={() => { setUnsentAsk(false); setShowPay(true); }} style={{ ...btn, minHeight: 50 }}>{L('Thu tiền luôn, không báo bếp', 'Pay without sending')}</button>
        </Modal>
      )}
      {showPay && <PayModal vi={vi} token={token} check={check} dueCents={dueCents} taxCents={taxCents} currency={currency} fmt={fmt} methods={methods} payInfo={payInfo} profile={profile}
        bank={floor?.settings.bank ?? null} onRefresh={() => refreshCheck(check.id)}
        shiftRequired={!!shiftCtl.mustOpen} onOpenShift={() => setShowShift(true)}
        onClose={() => setShowPay(false)}
        onPaid={() => { setShowPay(false); say(true, L('Đã thu tiền, bàn đã trống.', 'Paid; the table is free.')); backToFloor(); }} />}
      {shiftPanel}
    </div>
  );
}

function Toast({ ok, text }: { ok: boolean; text: string }) {
  return (
    <div role="status" style={{ padding: '10px 14px', borderRadius: 12, fontWeight: 700, fontSize: 14, ...(ok ? { background: 'var(--c052e16)', color: 'var(--c86efac)' } : { background: 'var(--c450a0a)', color: 'var(--cfca5a5)' }) }}>{text}</div>
  );
}

function TillHeader({ vi, cashier, shiftOpen, failed, canPay, onShift, onPrints, onTakeaway, onRetail, onSoldOut, onSettings, onDrawer }: {
  vi: boolean; cashier: string; shiftOpen: boolean; failed: number; canPay: boolean; onDrawer: () => void; onShift: () => void; onPrints: () => void; onTakeaway: () => void; onRetail: () => void; onSoldOut: () => void; onSettings?: () => void;
}) {
  const L = (v: string, e: string) => (vi ? v : e);
  return (
    <div style={{ ...card, padding: '10px 12px', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
      <div style={{ flex: '1 1 180px', minWidth: 0 }}>
        <div style={{ fontWeight: 800, fontSize: 17, color: C.strong }}>{L('Sơ đồ bàn', 'Tables')}</div>
        <div style={{ fontSize: 12.5, color: C.muted }}>{canPay ? L('Quầy thu ngân', 'Checkout') : L('Phục vụ', 'Server')}{cashier ? ` · ${cashier}` : ''}</div>
      </div>
      {canPay && <button type="button" onClick={onShift} style={{ ...btn, ...(shiftOpen ? { color: 'var(--ink-good)' } : { color: 'var(--ink-warn)' }) }}>{shiftOpen ? L('Ca đang mở', 'Shift open') : L('Chưa mở ca', 'No shift')}</button>}
      {failed > 0 && <button type="button" onClick={onPrints} style={{ ...btn, color: 'var(--ink-bad)' }}>⚠ {L(`${failed} phiếu in lỗi`, `${failed} print failed`)}</button>}
      <button type="button" onClick={onTakeaway} style={primary}>+ {L('Mang về', 'To go')}</button>
      {canPay && <button type="button" onClick={onDrawer} style={btn}>💵 {L('Mở két', 'Open drawer')}</button>}
      <button type="button" onClick={onSoldOut} style={btn}>{L('Hết món', 'Sold out')}</button>
      {canPay && <button type="button" onClick={onRetail} style={btn}>{L('Bán lẻ', 'Retail')}</button>}
      <a href="/kitchen" style={{ ...btn, display: 'inline-flex', alignItems: 'center', textDecoration: 'none' }}>{L('Màn hình bếp', 'Kitchen screen')}</a>
      {onSettings && <button type="button" onClick={onSettings} style={btn}>{L('Cài đặt nhà hàng', 'Restaurant settings')}</button>}
    </div>
  );
}

function Legend({ vi }: { vi: boolean }) {
  const L = (v: string, e: string) => (vi ? v : e);
  const items: [TableState, string][] = [
    ['free', L('Trống', 'Free')], ['seated', L('Có khách, chưa gọi', 'Seated')], ['ordered', L('Đã báo bếp', 'Ordered')],
    ['unsent', L('Có món chưa báo bếp', 'Not sent')], ['prebilled', L('Đã in tạm tính', 'Check printed')], ['askpay', L('Khách gọi thanh toán', 'Wants to pay')],
    ['call', L('Khách gọi / món QR chờ nhận', 'Guest calling / QR order')],
  ];
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, fontSize: 12.5, fontWeight: 600, color: C.muted }}>
      {items.map(([k, label]) => (
        <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><i style={{ width: 14, height: 14, borderRadius: 4, ...TILE[k] }} />{label}</span>
      ))}
    </div>
  );
}

function OptionsModal({ vi, dish, fmt, busy, onClose, onAdd }: { vi: boolean; dish: Dish; fmt: (c: number) => string; busy: boolean; onClose: () => void; onAdd: (o: { groupId: string; choiceIds: string[] }[]) => void }) {
  const L = (v: string, e: string) => (vi ? v : e);
  const [pick, setPick] = useState<Record<string, string[]>>(() => {
    const p: Record<string, string[]> = {};
    for (const g of dish.options) if (g.required && g.max === 1 && g.choices.length) p[g.id] = [g.choices[0].id];
    return p;
  });
  const ready = optionsReady(dish.options, pick);
  function tap(groupId: string, choiceId: string, max: number) {
    setPick((p) => {
      const cur = p[groupId] ?? [];
      if (cur.includes(choiceId)) return { ...p, [groupId]: cur.filter((x) => x !== choiceId) };
      if (max === 1) return { ...p, [groupId]: [choiceId] };
      return cur.length >= max ? p : { ...p, [groupId]: [...cur, choiceId] };
    });
  }
  return (
    <Modal vi={vi} title={`${dish.name} · ${fmt(dish.priceCents)}`} onClose={onClose} width={520}>
      {dish.options.map((g) => (
        <fieldset key={g.id} style={{ border: 0, margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <legend style={{ display: 'flex', justifyContent: 'space-between', width: '100%', padding: 0, marginBottom: 8 }}>
            <b>{g.name}</b>
            <span style={{ fontSize: 12, fontWeight: 800, color: g.required ? 'var(--ink-bad)' : C.muted }}>{g.required ? L('BẮT BUỘC', 'REQUIRED') : L('TUỲ CHỌN', 'OPTIONAL')} · {g.max === 1 ? L('CHỌN 1', 'PICK 1') : L(`TỐI ĐA ${g.max}`, `UP TO ${g.max}`)}</span>
          </legend>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: 8 }}>
            {g.choices.map((c) => {
              const on = (pick[g.id] ?? []).includes(c.id);
              return <button key={c.id} type="button" aria-pressed={on} onClick={() => tap(g.id, c.id, g.max)} style={{ ...btn, minHeight: 52, ...picked(on) }}>{c.name}{c.priceCents ? ` · +${fmt(c.priceCents)}` : ''}</button>;
            })}
          </div>
        </fieldset>
      ))}
      <button type="button" disabled={!ready || busy} onClick={() => onAdd(Object.entries(pick).map(([groupId, choiceIds]) => ({ groupId, choiceIds })))} style={{ ...primary, minHeight: 52, opacity: ready ? 1 : 0.5 }}>
        {L('Thêm vào bill', 'Add to bill')} · {fmt(priceWith(dish.priceCents, dish.options, pick))}
      </button>
    </Modal>
  );
}

function SoldOutModal({ vi, menu, busy, onToggle, onClose }: { vi: boolean; menu: Dish[]; busy: boolean; onToggle: (d: Dish) => void; onClose: () => void }) {
  const L = (v: string, e: string) => (vi ? v : e);
  const [q, setQ] = useState('');
  const f = fold(q.trim());
  const list = menu.filter((m) => !f || fold(m.name).includes(f));
  return (
    <Modal vi={vi} title={L('Báo hết món', 'Sold out')} onClose={onClose} width={520}>
      <span style={{ color: C.muted, fontSize: 13 }}>{L('Món hết bị khoá trên mọi máy. Mặc định tự có lại sáng hôm sau.', 'Sold-out dishes are locked on every device. By default they come back the next morning.')}</span>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={L('Tìm món', 'Search dishes')} aria-label={L('Tìm món', 'Search dishes')} style={field} />
      {list.map((d) => (
        <label key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', borderBottom: `1px solid ${C.line}` }}>
          <span style={{ flex: 1, fontWeight: 600, textDecoration: d.soldOut ? 'line-through' : undefined }}>{d.name}</span>
          <span style={{ fontSize: 12.5, fontWeight: 700, color: d.soldOut ? 'var(--ink-bad)' : 'var(--ink-good)' }}>{d.soldOut ? L('Hết', 'Sold out') : L('Còn', 'Available')}</span>
          <input type="checkbox" checked={d.soldOut} disabled={busy} onChange={() => onToggle(d)} style={{ width: 22, height: 22 }} />
        </label>
      ))}
    </Modal>
  );
}

function SplitModal({ vi, check, fmt, busy, onClose, onSplit }: { vi: boolean; check: CheckView; fmt: (c: number) => string; busy: boolean; onClose: () => void; onSplit: (lines: { lineId: string; quantity: number }[]) => void }) {
  const L = (v: string, e: string) => (vi ? v : e);
  const lines = check.lines.filter((l) => l.state !== 'VOID' && l.state !== 'PENDING');
  const [take, setTake] = useState<Record<string, number>>({});
  const moving = lines.reduce((s, l) => s + (take[l.id] ?? 0) * l.unitPriceCents, 0);
  const picks = Object.entries(take).filter(([, n]) => n > 0).map(([lineId, quantity]) => ({ lineId, quantity }));
  const leaves = lines.reduce((s, l) => s + l.quantity - (take[l.id] ?? 0), 0);
  return (
    <Modal vi={vi} title={L('Tách bill: chọn món sang bill mới', 'Split: pick dishes for a new bill')} onClose={onClose} width={520}>
      {lines.map((l) => (
        <div key={l.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ flex: 1, minWidth: 0 }}><b>{l.name}</b>{(l.options ?? []).length ? <span style={{ color: C.muted }}> · {(l.options ?? []).join(', ')}</span> : null}<br /><span style={{ fontSize: 12.5, color: C.muted }}>{l.quantity} × {fmt(l.unitPriceCents)}</span></span>
          <span style={{ display: 'inline-flex', alignItems: 'center', borderRadius: 10, border: `1px solid ${C.border}` }}>
            <button type="button" aria-label={L('Bớt', 'Less')} onClick={() => setTake((t) => ({ ...t, [l.id]: Math.max(0, (t[l.id] ?? 0) - 1) }))} style={{ width: 40, height: 40, border: 0, background: 'none', color: C.text, fontSize: 18, fontWeight: 800 }}>−</button>
            <b style={{ minWidth: 24, textAlign: 'center' }}>{take[l.id] ?? 0}</b>
            <button type="button" aria-label={L('Thêm', 'More')} onClick={() => setTake((t) => ({ ...t, [l.id]: Math.min(l.quantity, (t[l.id] ?? 0) + 1) }))} style={{ width: 40, height: 40, border: 0, background: 'none', color: C.text, fontSize: 18, fontWeight: 800 }}>+</button>
          </span>
        </div>
      ))}
      <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 800 }}><span>{L('Bill mới', 'New bill')}</span><span>{fmt(moving)}</span></div>
      <button type="button" disabled={busy || picks.length === 0 || leaves === 0} onClick={() => onSplit(picks)} style={{ ...primary, minHeight: 52, opacity: picks.length && leaves ? 1 : 0.5 }}>{L('Tách sang bill mới', 'Move to a new bill')}</button>
      {leaves === 0 && <span style={{ color: 'var(--ink-bad)', fontSize: 13 }}>{L('Phải để lại ít nhất một món trên bill này.', 'Leave at least one dish on this bill.')}</span>}
      <span style={{ fontSize: 12, color: C.muted }}>{L('Muốn chia đều tiền? Dùng “Chia đều” khi thanh toán.', 'Splitting the money evenly? Use “Split evenly” when paying.')}</span>
    </Modal>
  );
}

function NoteModal({ vi, line, onClose, onSave }: { vi: boolean; line: CheckLine; onClose: () => void; onSave: (note: string) => void }) {
  const L = (v: string, e: string) => (vi ? v : e);
  const [note, setNote] = useState(line.note ?? '');
  const quick = vi ? ['Ít hành', 'Không hành', 'Không cay', 'Cay', 'Ít đá', 'Mang về'] : ['No onion', 'Mild', 'Spicy', 'Less ice', 'To go', 'No sauce'];
  return (
    <Modal vi={vi} title={`${L('Ghi chú', 'Note')} · ${line.name}`} onClose={onClose}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {quick.map((x) => <button key={x} type="button" onClick={() => setNote((n) => (n ? `${n}, ${x}` : x))} style={chip(false)}>{x}</button>)}
      </div>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 12.5, color: C.muted, fontWeight: 600 }}>{L('Ghi chú cho bếp (không tính tiền)', 'Note for the kitchen (free)')}</span>
        <input value={note} maxLength={140} onChange={(e) => setNote(e.target.value)} style={field} />
      </label>
      <button type="button" onClick={() => onSave(note)} style={{ ...primary, minHeight: 50 }}>{L('Lưu', 'Save')}</button>
    </Modal>
  );
}

function VoidModal({ vi, line, needPin, busy, fmt, onClose, onConfirm }: { vi: boolean; line: CheckLine; needPin: boolean; busy: boolean; fmt: (c: number) => string; onClose: () => void; onConfirm: (qty: number, reason: string, pin: string) => void }) {
  const L = (v: string, e: string) => (vi ? v : e);
  const reasons = vi ? ['Khách đổi ý', 'Nhập nhầm món', 'Ra món quá lâu', 'Hết nguyên liệu'] : ['Guest changed mind', 'Wrong dish entered', 'Took too long', 'Out of stock'];
  const [n, setN] = useState(line.quantity);
  const [reason, setReason] = useState('');
  const [pin, setPin] = useState('');
  const ok = reason.trim().length >= 2 && (!needPin || pin.trim().length >= 4);
  return (
    <Modal vi={vi} title={L('Huỷ món đã báo bếp', 'Cancel a sent dish')} onClose={onClose}>
      <b style={{ fontSize: 17 }}>{line.quantity}× {line.name}</b>
      {line.quantity > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span>{L('Huỷ', 'Cancel')}</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', borderRadius: 12, border: `1px solid ${C.border}` }}>
            <button type="button" aria-label={L('Bớt', 'Less')} onClick={() => setN((x) => Math.max(1, x - 1))} style={{ width: 44, height: 46, border: 0, background: 'none', color: C.text, fontSize: 18, fontWeight: 800 }}>−</button>
            <b style={{ minWidth: 24, textAlign: 'center' }}>{n}</b>
            <button type="button" aria-label={L('Thêm', 'More')} onClick={() => setN((x) => Math.min(line.quantity, x + 1))} style={{ width: 44, height: 46, border: 0, background: 'none', color: C.text, fontSize: 18, fontWeight: 800 }}>+</button>
          </span>
          <span style={{ color: C.muted }}>{L(`trên ${line.quantity}`, `of ${line.quantity}`)}</span>
        </div>
      )}
      <span style={{ fontWeight: 700 }}>{L('Lý do (bắt buộc)', 'Reason (required)')}</span>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: 8 }}>
        {reasons.map((r) => <button key={r} type="button" onClick={() => setReason(r)} style={{ ...btn, minHeight: 48, ...picked(reason === r) }}>{r}</button>)}
      </div>
      <input value={reason} maxLength={140} onChange={(e) => setReason(e.target.value)} placeholder={L('Hoặc gõ lý do khác', 'Or type another reason')} aria-label={L('Lý do', 'Reason')} style={field} />
      {needPin && (
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontWeight: 700 }}>{L('PIN quản lý', 'Manager PIN')}</span>
          <span style={{ fontSize: 12.5, color: C.muted }}>{L('Bạn không có quyền huỷ món. Quản lý nhập PIN tại đây.', 'You cannot cancel dishes yourself. A manager types their PIN here.')}</span>
          <input type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value)} style={{ ...field, minHeight: 48, fontSize: 18, letterSpacing: '.3em' }} />
        </label>
      )}
      <button type="button" disabled={!ok || busy} onClick={() => onConfirm(n, reason.trim(), pin.trim())} style={{ ...btn, minHeight: 52, border: 'none', background: '#b91c1c', color: '#fff', opacity: ok ? 1 : 0.5 }}>
        {L(`Huỷ ${n} món · −${fmt(n * line.unitPriceCents)}`, `Cancel ${n} · −${fmt(n * line.unitPriceCents)}`)}
      </button>
      <span style={{ fontSize: 12, color: C.muted, textAlign: 'center' }}>{L('Bếp nhận phiếu HUỶ. Người huỷ, người duyệt và lý do được ghi lại.', 'The kitchen gets a CANCEL ticket. Who, approver and reason are logged.')}</span>
    </Modal>
  );
}

function VoidCheckModal({ vi, hasSent, needPin, busy, onClose, onConfirm }: { vi: boolean; hasSent: boolean; needPin: boolean; busy: boolean; onClose: () => void; onConfirm: (reason: string, pin: string) => void }) {
  const L = (v: string, e: string) => (vi ? v : e);
  const [reason, setReason] = useState('');
  const [pin, setPin] = useState('');
  const ok = (!hasSent || reason.trim().length >= 2) && (!needPin || pin.trim().length >= 4);
  return (
    <Modal vi={vi} title={L('Huỷ cả bill', 'Void the whole bill')} onClose={onClose}>
      <span>{hasSent ? L('Bill có món đã báo bếp. Cần lý do; bếp nhận phiếu huỷ.', 'Dishes were sent. A reason is required; the kitchen gets cancel tickets.') : L('Bill chưa báo bếp món nào. Huỷ để trả bàn trống.', 'Nothing was sent. Voiding frees the table.')}</span>
      <input value={reason} maxLength={140} onChange={(e) => setReason(e.target.value)} placeholder={L('Lý do (VD: khách bỏ về, mở nhầm bàn)', 'Reason (guests left, wrong table)')} aria-label={L('Lý do', 'Reason')} style={field} />
      {needPin && <input type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value)} placeholder={L('PIN quản lý', 'Manager PIN')} aria-label={L('PIN quản lý', 'Manager PIN')} style={{ ...field, minHeight: 48, fontSize: 18 }} />}
      <button type="button" disabled={!ok || busy} onClick={() => onConfirm(reason.trim(), pin.trim())} style={{ ...btn, minHeight: 52, border: 'none', background: '#b91c1c', color: '#fff', opacity: ok ? 1 : 0.5 }}>{L('Huỷ bill', 'Void bill')}</button>
    </Modal>
  );
}

function PrintsModal({ vi, jobs, onClose, onRetry }: { vi: boolean; jobs: FailedJob[]; onClose: () => void; onRetry: (id: string) => void }) {
  const L = (v: string, e: string) => (vi ? v : e);
  return (
    <Modal vi={vi} title={L('Phiếu in lỗi', 'Failed prints')} onClose={onClose}>
      {jobs.length === 0 && <span style={{ color: C.muted }}>{L('Không có phiếu lỗi.', 'Nothing failed.')}</span>}
      {jobs.map((j) => (
        <div key={j.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 10, borderRadius: 12, background: C.raised }}>
          <span style={{ flex: 1, minWidth: 0 }}><b>{j.title || j.id}</b><br /><span style={{ fontSize: 12.5, color: C.muted }}>{j.error || ''}</span></span>
          <button type="button" onClick={() => onRetry(j.id)} style={btn}>{L('In lại', 'Retry')}</button>
        </div>
      ))}
      <span style={{ fontSize: 12.5, color: C.muted }}>{L('Kiểm tra máy in còn giấy và máy tính in đang bật.', 'Check the printer has paper and the printing computer is on.')} <a href="/salon/settings?tab=receipt">{L('Xem máy in', 'Printers')}</a></span>
    </Modal>
  );
}

function SettingsModal({ vi, token, settings, categories, onClose, onSaved }: { vi: boolean; token: string | null; settings: Settings; categories: string[]; onClose: () => void; onSaved: () => void }) {
  const L = (v: string, e: string) => (vi ? v : e);
  const [s, setS] = useState<Settings>(settings);
  const [newName, setNewName] = useState('');
  const [err, setErr] = useState('');
  const [people, setPeople] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => { if (token) apiFetch<{ id: string; name: string }[]>('/restaurant/people', { token }).then(setPeople).catch(() => undefined); }, [token]);
  const catKey = (c: string) => c.trim().toLowerCase().replace(/\s+/g, ' ');
  async function save() {
    try {
      const bank = bin.trim() && acct.trim() ? { bin: bin.replace(/\D/g, ''), accountNo: acct.replace(/[^0-9A-Za-z]/g, ''), accountName: bankName(acctName) } : null;
      if (bank && (bank.bin.length !== 6 || bank.accountNo.length < 4)) { setErr(L('Số tài khoản hoặc mã ngân hàng (BIN 6 số) chưa đúng.', 'Check the account number and the 6-digit bank BIN.')); return; }
      await apiFetch('/restaurant/settings', { method: 'PATCH', token, body: { settings: { ...s, bank } } });
      onSaved();
    } catch (e) { setErr(tillError(e instanceof Error ? e.message : String(e), vi)); }
  }
  function addStation() {
    const name = newName.trim();
    if (!name) return;
    const key = (name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[đĐ]/g, 'D').toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '') || 'ST').slice(0, 16);
    const unique = s.stations.some((x) => x.key === key) ? `${key.slice(0, 13)}_${s.stations.length + 1}` : key.length < 2 ? `${key}_X` : key;
    setS({ ...s, stations: [...s.stations, { key: unique, name }] });
    setNewName('');
  }
  const [bin, setBin] = useState(settings.bank?.bin ?? '');
  const [acct, setAcct] = useState(settings.bank?.accountNo ?? '');
  const [acctName, setAcctName] = useState(settings.bank?.accountName ?? '');
  const known = VN_BANKS.some((b) => b.bin === bin);
  const [otherBin, setOtherBin] = useState(() => !!settings.bank && !VN_BANKS.some((b) => b.bin === settings.bank?.bin));
  const toggle = (k: 'printVoid' | 'printMove' | 'voidNeedsApproval' | 'soldOutReset' | 'vatIncluded', label: string) => (
    <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
      <span>{label}</span>
      <input type="checkbox" checked={s[k]} onChange={(e) => setS({ ...s, [k]: e.target.checked })} style={{ width: 22, height: 22 }} />
    </label>
  );
  const sel: CSSProperties = { minHeight: 40, borderRadius: 10, border: `1px solid ${C.border}`, background: C.panel, color: C.text, padding: '0 8px', fontFamily: 'inherit' };
  return (
    <Modal vi={vi} title={L('Cài đặt nhà hàng', 'Restaurant settings')} onClose={onClose} width={560}>
      <b>{L('Khu chế biến', 'Prep stations')}</b>
      {s.stations.map((st, i) => (
        <div key={st.key} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input value={st.name} aria-label={st.key} onChange={(e) => setS({ ...s, stations: s.stations.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} style={{ ...field, flex: 1, minHeight: 44 }} />
          <code style={{ fontSize: 12, color: C.muted }}>{st.key}</code>
          {s.stations.length > 1 && <button type="button" onClick={() => setS({ ...s, stations: s.stations.filter((_, j) => j !== i) })} style={{ ...btn, width: 44, padding: 0 }} aria-label={L('Xoá', 'Remove')}>×</button>}
        </div>
      ))}
      <div style={{ display: 'flex', gap: 8 }}>
        <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={L('Thêm khu (VD: Bếp nướng)', 'Add a station (e.g. Grill)')} aria-label={L('Tên khu mới', 'New station')} style={{ ...field, flex: 1, minHeight: 44 }} />
        <button type="button" onClick={addStation} style={btn}>{L('Thêm', 'Add')}</button>
      </div>
      <b>{L('Nhóm món → khu', 'Menu group → station')}</b>
      {categories.filter(Boolean).map((c0) => (
        <label key={c0} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <span>{c0}</span>
          <select value={s.byCategory[catKey(c0)] ?? ''} onChange={(e) => { const next = { ...s.byCategory }; if (e.target.value) next[catKey(c0)] = e.target.value; else delete next[catKey(c0)]; setS({ ...s, byCategory: next }); }} style={sel}>
            <option value="">{L('Tự động', 'Automatic')}</option>
            {s.stations.map((st) => <option key={st.key} value={st.key}>{st.name}</option>)}
          </select>
        </label>
      ))}
      <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <span>{L('Món chưa có nhóm in ở', 'Dishes with no group go to')}</span>
        <select value={s.defaultStation} onChange={(e) => setS({ ...s, defaultStation: e.target.value })} style={sel}>
          {s.stations.map((st) => <option key={st.key} value={st.key}>{st.name}</option>)}
        </select>
      </label>
      <b>{L('Quy tắc', 'Rules')}</b>
      {toggle('printVoid', L('In phiếu HUỶ MÓN cho bếp', 'Print a CANCEL ticket'))}
      {toggle('printMove', L('In phiếu CHUYỂN BÀN cho bếp', 'Print a TABLE MOVED ticket'))}
      {toggle('voidNeedsApproval', L('Huỷ món đã báo bếp cần quản lý duyệt', 'Cancelling a sent dish needs a manager'))}
      {toggle('soldOutReset', L('Món báo hết tự có lại sáng hôm sau', 'Sold-out dishes come back the next morning'))}
      <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <span>{L('Bàn đổi vàng / đỏ sau (phút)', 'Table turns yellow / red after (min)')}</span>
        <span style={{ display: 'flex', gap: 6 }}>
          <input type="number" value={s.warnMinutes} aria-label={L('Vàng sau', 'Yellow after')} onChange={(e) => setS({ ...s, warnMinutes: Number(e.target.value) })} style={{ ...sel, width: 70, textAlign: 'center' }} />
          <input type="number" value={s.lateMinutes} aria-label={L('Đỏ sau', 'Red after')} onChange={(e) => setS({ ...s, lateMinutes: Number(e.target.value) })} style={{ ...sel, width: 70, textAlign: 'center' }} />
        </span>
      </label>
      <b>{L('Ai được thu tiền', 'Who may take payment')}</b>
      <span style={{ fontSize: 12.5, color: C.muted }}>{L('Không chọn ai = mọi người có quyền Thu ngân đều thu được. Chọn người thì những người khác (phục vụ) chỉ gọi món và bấm “Yêu cầu thanh toán”.', 'Pick nobody = everyone with checkout access can take payment. Pick people and everyone else (servers) can only order and “Ask to pay”.')}</span>
      {people.length === 0 && <span style={{ fontSize: 12.5, color: C.muted }}>{L('Chưa có nhân viên có tài khoản đăng nhập.', 'No staff logins yet.')}</span>}
      {people.map((p) => (
        <label key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <span>{p.name}</span>
          <input type="checkbox" checked={s.cashierUserIds.includes(p.id)} onChange={(e) => setS({ ...s, cashierUserIds: e.target.checked ? [...s.cashierUserIds, p.id] : s.cashierUserIds.filter((x) => x !== p.id) })} style={{ width: 22, height: 22 }} />
        </label>
      ))}
      <b>{L('Khách gọi món bằng QR tại bàn', 'Guests order from a QR on the table')}</b>
      <select value={s.qrOrdering ?? 'off'} aria-label={L('Gọi món QR', 'QR ordering')} onChange={(e) => setS({ ...s, qrOrdering: e.target.value as Settings['qrOrdering'] })} style={{ ...sel, minHeight: 46 }}>
        <option value="off">{L('Tắt', 'Off')}</option>
        <option value="confirm">{L('Bật · nhân viên xác nhận rồi mới báo bếp (khuyên dùng)', 'On · staff accept before the kitchen sees it (recommended)')}</option>
        <option value="auto">{L('Bật · món khách gọi vào bếp ngay', 'On · straight to the kitchen')}</option>
      </select>
      <span style={{ fontSize: 12.5, color: C.muted }}>{L('In mã QR cho từng bàn ở mục Bàn › Mã QR gọi món. Khách còn bấm được “Gọi nhân viên” và “Xin thanh toán”.', 'Print each table’s QR under Tables › QR codes. Guests can also tap “Call staff” and “The bill”.')} <a href="/salon/tables?view=qr">{L('Mở Mã QR', 'Open QR codes')}</a></span>

      <b>{L('Phí phục vụ & VAT', 'Service charge & VAT')}</b>
      <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <span>{L('Phí phục vụ (% tiền món, 0 = không thu)', 'Service charge (% of dishes, 0 = none)')}</span>
        <input type="number" min={0} max={20} value={s.serviceChargePercent ?? 0} aria-label={L('Phí phục vụ', 'Service charge')} onChange={(e) => setS({ ...s, serviceChargePercent: Math.max(0, Math.min(20, Number(e.target.value) || 0)) })} style={{ ...sel, width: 80, textAlign: 'center' }} />
      </label>
      <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <span>{L('Thuế suất VAT in trên bill', 'VAT rate on the bill')}</span>
        <select value={s.vatPercent ?? 0} onChange={(e) => setS({ ...s, vatPercent: Number(e.target.value) })} style={sel}>
          {[0, 5, 8, 10].map((v) => <option key={v} value={v}>{v === 0 ? L('Không in', 'None') : `${v}%`}</option>)}
        </select>
      </label>
      {toggle('vatIncluded', L('Giá món đã gồm VAT', 'Menu prices include VAT'))}
      <span style={{ fontSize: 12.5, color: C.muted }}>{L('Giá đã gồm VAT: bill in dòng “Đã gồm VAT”. Giá chưa gồm VAT: thuế cộng thêm theo thuế suất ở Cài đặt › Thu ngân.', 'Prices include VAT: the bill prints “Incl. VAT”. Prices without VAT: tax is added at the rate set under Settings › Checkout.')}</span>

      <b>{L('Tài khoản nhận chuyển khoản (VietQR)', 'Bank account for transfers (VietQR)')}</b>
      <span style={{ fontSize: 12.5, color: C.muted }}>{L('Bill hiện mã VietQR đúng số tiền, nội dung là mã bill (VD: LM57) để đối soát.', 'The bill shows a VietQR for the exact amount, with the bill code (e.g. LM57) as the note.')}</span>
      <select value={otherBin || (bin && !known) ? '_other' : bin} aria-label={L('Ngân hàng', 'Bank')} onChange={(e) => { if (e.target.value === '_other') { setOtherBin(true); setBin(''); } else { setOtherBin(false); setBin(e.target.value); } }} style={{ ...sel, minHeight: 46 }}>
        <option value="">{L('Chưa chọn ngân hàng', 'No bank')}</option>
        {VN_BANKS.map((b) => <option key={b.bin} value={b.bin}>{b.name}</option>)}
        <option value="_other">{L('Ngân hàng khác (nhập BIN)', 'Other bank (type the BIN)')}</option>
      </select>
      {(otherBin || (bin && !known)) && <input value={bin} inputMode="numeric" maxLength={6} onChange={(e) => setBin(e.target.value.replace(/\D/g, ''))} placeholder={L('Mã BIN 6 số (VD: 970436)', '6-digit BIN (e.g. 970436)')} aria-label="BIN" style={field} />}
      <input value={acct} inputMode="numeric" maxLength={24} onChange={(e) => setAcct(e.target.value)} placeholder={L('Số tài khoản', 'Account number')} aria-label={L('Số tài khoản', 'Account number')} style={field} />
      <input value={acctName} maxLength={50} onChange={(e) => setAcctName(e.target.value)} onBlur={() => setAcctName(bankName(acctName))} placeholder={L('Tên chủ tài khoản (không dấu)', 'Account holder')} aria-label={L('Tên chủ tài khoản', 'Account holder')} style={field} />
      <BankFeedBox vi={vi} token={token} />

      <div style={{ fontSize: 12.5, color: C.muted }}>{L('Máy in: kết nối và chọn máy in cho Quầy / Bếp / Bar ở', 'Printers: connect them and pick one for the counter / kitchen / bar under')} <a href="/salon/settings?tab=receipt">{L('Cài đặt › Hoá đơn in › Máy in', 'Settings › Printed receipt › Printers')}</a>.</div>
      {err && <span style={{ color: 'var(--ink-bad)' }}>{err}</span>}
      <button type="button" onClick={() => void save()} style={{ ...primary, minHeight: 50 }}>{L('Lưu', 'Save')}</button>
    </Modal>
  );
}

interface BankFeed { configured: boolean; provider: string | null; hookId: string | null; lastAt: string | null }

/**
 * Bank feed: SePay or Casso tell us when money lands on the restaurant's
 * account; a transfer carrying the bill code shows up on that bill. The secret
 * is shown once, here, and only its hash is kept on the server.
 */
function BankFeedBox({ vi, token }: { vi: boolean; token: string | null }) {
  const L = (v: string, e: string) => (vi ? v : e);
  const [feed, setFeed] = useState<BankFeed | null>(null);
  const [provider, setProvider] = useState<'sepay' | 'casso'>('sepay');
  const [made, setMade] = useState<{ provider: string; hookId: string; secret: string; path: string } | null>(null);
  const [sure, setSure] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => {
    if (!token) return;
    apiFetch<BankFeed>('/restaurant/bank-feed', { token }).then((f) => { setFeed(f); if (f.provider === 'casso') setProvider('casso'); }).catch(() => undefined);
  }, [token]);
  async function setup() {
    if (feed?.configured && !sure) { setSure(true); return; }
    setErr('');
    try {
      const r = await apiFetch<{ provider: string; hookId: string; secret: string; path: string }>('/restaurant/bank-feed', { method: 'POST', token, body: { provider } });
      setMade(r); setSure(false);
      setFeed({ configured: true, provider: r.provider, hookId: r.hookId, lastAt: feed?.lastAt ?? null });
    } catch (e) { setErr(tillError(e instanceof Error ? e.message : String(e), vi)); }
  }
  const copy = (t: string) => { try { void navigator.clipboard.writeText(t); } catch { /* no clipboard */ } };
  const url = made ? `${API_URL}${made.path}` : feed?.hookId ? `${API_URL}/public/bank-feed/${feed.hookId}` : '';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 12, borderRadius: 14, background: C.raised }}>
      <b>{L('Tự xác nhận tiền về (SePay / Casso)', 'Confirm transfers automatically (SePay / Casso)')}</b>
      <span style={{ fontSize: 12.5, color: C.muted }}>
        {feed?.configured
          ? L(`Đã nối ${feed.provider === 'casso' ? 'Casso' : 'SePay'}${feed.lastAt ? ` · lần nhận gần nhất ${new Date(feed.lastAt).toLocaleString('vi-VN')}` : ' · chưa nhận giao dịch nào'}.`, `Connected to ${feed.provider === 'casso' ? 'Casso' : 'SePay'}${feed.lastAt ? ` · last ${new Date(feed.lastAt).toLocaleString()}` : ' · nothing received yet'}.`)
          : L('Chưa nối. Không nối vẫn dùng được VietQR, thu ngân tự kiểm tra app ngân hàng.', 'Not connected. VietQR still works; the cashier checks the banking app.')}
      </span>
      <div style={{ display: 'flex', gap: 6 }}>
        {(['sepay', 'casso'] as const).map((p) => <button key={p} type="button" onClick={() => setProvider(p)} style={chip(provider === p)}>{p === 'sepay' ? 'SePay' : 'Casso'}</button>)}
      </div>
      <button type="button" onClick={() => void setup()} style={{ ...btn, ...(sure ? { borderColor: '#b91c1c', color: 'var(--ink-bad)' } : {}) }}>
        {sure ? L('Chắc chắn? Khoá cũ sẽ ngừng hoạt động', 'Sure? The old secret stops working') : feed?.configured ? L('Tạo khoá mới', 'New secret') : L('Tạo địa chỉ & khoá kết nối', 'Create address & secret')}
      </button>
      {url && (
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 12.5, color: C.muted, fontWeight: 600 }}>{L('Địa chỉ webhook', 'Webhook URL')}</span>
          <span style={{ display: 'flex', gap: 6 }}><input readOnly value={url} style={{ ...field, flex: 1, fontSize: 12.5 }} /><button type="button" onClick={() => copy(url)} style={btn}>{L('Chép', 'Copy')}</button></span>
        </label>
      )}
      {made && (
        <>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 12.5, color: 'var(--ink-warn)', fontWeight: 700 }}>{L('Khoá bí mật (chỉ hiện một lần, chép ngay)', 'Secret (shown once, copy it now)')}</span>
            <span style={{ display: 'flex', gap: 6 }}><input readOnly value={made.secret} style={{ ...field, flex: 1, fontFamily: 'monospace' }} /><button type="button" onClick={() => copy(made.secret)} style={btn}>{L('Chép', 'Copy')}</button></span>
          </label>
          <span style={{ fontSize: 12.5, whiteSpace: 'pre-line' }}>
            {made.provider === 'casso'
              ? L('Casso › Webhook: dán địa chỉ trên, dán khoá vào ô “Khoá bảo mật / secure token”. Lưu và bấm gửi thử.', 'Casso › Webhook: paste the URL, and the secret as the “secure token”. Save and send a test.')
              : L('SePay › Tích hợp WebHooks › Thêm: dán địa chỉ trên, chọn chứng thực “API Key”, dán khoá vào ô API Key, chỉ nhận tiền vào. Lưu và bấm gửi thử.', 'SePay › WebHooks › Add: paste the URL, pick “API Key” authentication, paste the secret as the key, money in only. Save and send a test.')}
          </span>
        </>
      )}
      {err && <span style={{ color: 'var(--ink-bad)' }}>{err}</span>}
    </div>
  );
}

interface Part { method: PayMethod; amount: string }

const EMPTY_INVOICE: InvoiceInfo = { company: '', taxCode: '', address: '', email: '' };

function PayModal({ vi, token, check, dueCents, taxCents, currency, fmt, methods, payInfo, profile, bank, shiftRequired, onOpenShift, onRefresh, onClose, onPaid }: {
  vi: boolean; token: string | null; check: CheckView; dueCents: number; taxCents: number; currency: string; fmt: (c: number) => string;
  methods: PayMethod[]; payInfo: Record<string, { instructions?: string; qrUrl?: string }>; profile: ReceiptProfile | null; bank: BankAccount | null;
  shiftRequired: boolean; onOpenShift: () => void; onRefresh: () => Promise<void> | void; onClose: () => void; onPaid: () => void;
}) {
  const L = (v: string, e: string) => (vi ? v : e);
  const first = methods[0] ?? 'CASH';
  const bankMethod: PayMethod | null = methods.includes('VIETQR') ? 'VIETQR' : methods.includes('TRANSFER') ? 'TRANSFER' : null;
  const [parts, setParts] = useState<Part[]>([{ method: first, amount: '' }]);
  const [print, setPrint] = useState(() => { try { return localStorage.getItem('lumio_rt_print') !== '0'; } catch { return true; } });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [inv, setInv] = useState<InvoiceInfo>(() => ({ ...EMPTY_INVOICE, ...(check.invoiceInfo ?? {}) }));
  const [showInv, setShowInv] = useState(() => !!check.invoiceInfo);
  const single = parts.length === 1;
  // One method: an empty amount means "exactly the total"; cash can be more (change).
  const amounts = parts.map((p) => (p.amount.trim() ? parseMoney(p.amount, currency) : single ? dueCents : 0));
  const tendered = amounts.reduce((a, b) => a + b, 0);
  const cashIn = parts.reduce((s, p, i) => s + (p.method === 'CASH' ? amounts[i] : 0), 0);
  const nonCash = tendered - cashIn;
  const short = tendered < dueCents;
  const overNonCash = nonCash > dueCents;
  const change = !short && cashIn > 0 ? Math.min(cashIn, tendered - dueCents) : 0;
  const info = single ? (payInfo[parts[0].method] ?? {}) : {};
  const setPart = (i: number, p: Partial<Part>) => setParts((xs) => xs.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const splitEven = (n: number) => setParts(evenShares(dueCents, n).map((c) => ({ method: first, amount: toInput(c, currency) })));

  // The bank QR asks for exactly what is still owed and carries the bill code;
  // with SePay / Casso connected the money shows up here by itself.
  const bankPaid = check.bankPaidCents ?? 0;
  const owed = Math.max(0, dueCents - bankPaid);
  const bankPick = single && (parts[0].method === 'VIETQR' || parts[0].method === 'TRANSFER');
  const dynQr = bankPick && owed > 0 ? vietQr(bank, owed, check.payCode ?? '', currency) : null;
  const covered = bankPaid > 0 && bankPaid >= dueCents;
  const watch = !!vietQr(bank, 1, 'LM0', currency) && (bankPick || bankPaid > 0) && !covered;
  const refresh = useRef(onRefresh);
  refresh.current = onRefresh;
  useEffect(() => {
    if (!watch) return;
    const t = setInterval(() => { void refresh.current(); }, 4000);
    return () => clearInterval(t);
  }, [watch]);
  useEffect(() => {
    // The transfer landed: the bill is paid by bank, one tap closes it.
    if (covered && bankMethod) setParts([{ method: bankMethod, amount: '' }]);
  }, [covered, bankMethod]);

  async function pay() {
    if (!token || short || overNonCash) return;
    setBusy(true); setErr('');
    try {
      const tenders = parts.map((p, i) => ({ method: p.method, amountCents: amounts[i] })).filter((t) => t.amountCents > 0);
      const invoice = showInv && (inv.company.trim() || inv.taxCode.trim()) ? inv : undefined;
      const r = await apiFetch<{ order: { id: string; orderNumber?: number } }>(`/restaurant/checks/${check.id}/pay`, {
        method: 'POST', token, body: { tenders, allowUnsent: true, ...(invoice ? { invoice } : {}) },
      });
      try { localStorage.setItem('lumio_rt_print', print ? '1' : '0'); } catch { /* private mode */ }
      if (print && profile) {
        const live = check.lines.filter((l) => l.state !== 'VOID' && l.state !== 'PENDING');
        const service = check.serviceCents ?? 0;
        const text = buildReceiptText({
          orderNumber: r.order.orderNumber ?? check.number,
          when: new Date().toLocaleString(vi ? 'vi-VN' : 'en-US'),
          lines: [...live.map((l) => {
            const extra = [...(l.options ?? []), ...(l.note ? [l.note] : [])].join(', ');
            return { qty: l.quantity, name: extra ? `${l.name} (${extra})` : l.name, amountCents: l.quantity * l.unitPriceCents };
          }), ...(service > 0 ? [{ qty: 1, name: `${L('Phí phục vụ', 'Service charge')} ${check.serviceChargePercent ?? 0}%`, amountCents: service }] : [])],
          subtotal: check.subtotalCents + service, tax: taxCents || undefined, total: dueCents,
          paid: tenders.map((t) => ({ method: t.method, cents: t.amountCents })), change: change || undefined,
        }, profile.shop, profile.design, fmt);
        const vat = (check.vatCents ?? 0) > 0 ? `\n${L('Đã gồm VAT', 'Incl. VAT')} ${check.vatPercent ?? 0}%: ${fmt(check.vatCents ?? 0)}` : '';
        const invText = invoice ? `\n${L('Xuất hoá đơn VAT cho', 'VAT invoice for')}: ${invoice.company}${invoice.taxCode ? ` · MST ${invoice.taxCode}` : ''}` : '';
        await apiFetch('/print-jobs', { method: 'POST', token, body: { title: `${L('Hoá đơn', 'Receipt')} #${r.order.orderNumber ?? ''} · ${check.tables}`, text: text + vat + invText, drawer: cashIn > 0 } }).catch(() => undefined);
      }
      // Cash taken but no receipt printed: the drawer still has to open for the change.
      if (cashIn > 0 && !(print && profile)) await apiFetch('/print-jobs/drawer', { method: 'POST', token, body: { reason: 'cash' } }).catch(() => undefined);
      onPaid();
    } catch (e) {
      setErr(tillError(e instanceof Error ? e.message : String(e), vi));
    } finally { setBusy(false); }
  }

  const invField = (k: keyof InvoiceInfo, label: string, mode?: 'numeric' | 'email') => (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 12.5, color: C.muted, fontWeight: 600 }}>{label}</span>
      <input value={inv[k]} inputMode={mode} maxLength={k === 'taxCode' ? 20 : 200} onChange={(e) => setInv({ ...inv, [k]: e.target.value })} style={field} />
    </label>
  );

  return (
    <Modal vi={vi} title={L(`Thanh toán · ${check.tables}`, `Pay · ${check.tables}`)} onClose={onClose} width={540}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span style={{ color: C.muted, fontWeight: 700 }}>{L('Phải thu', 'Amount due')}</span>
        <b style={{ fontSize: 30, color: C.strong }}>{fmt(dueCents)}</b>
      </div>
      {((check.serviceCents ?? 0) > 0 || taxCents > 0 || (check.vatCents ?? 0) > 0) && (
        <span style={{ fontSize: 12.5, color: C.muted }}>
          {[
            (check.serviceCents ?? 0) > 0 ? `${L('Phí phục vụ', 'Service')} ${check.serviceChargePercent ?? 0}% ${fmt(check.serviceCents ?? 0)}` : '',
            taxCents > 0 ? `${L('Thuế', 'Tax')} ${fmt(taxCents)}` : '',
            (check.vatCents ?? 0) > 0 ? `${L('Đã gồm VAT', 'Incl. VAT')} ${check.vatPercent ?? 0}% ${fmt(check.vatCents ?? 0)}` : '',
          ].filter(Boolean).join(' · ')}
        </span>
      )}
      {shiftRequired && (
        <div style={{ padding: 10, borderRadius: 12, background: 'var(--c451a03)', color: 'var(--cfde68a)', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ flex: 1 }}>{L('Chưa mở ca thu ngân.', 'No cashier shift open.')}</span>
          <button type="button" onClick={onOpenShift} style={btn}>{L('Mở ca', 'Open shift')}</button>
        </div>
      )}
      {bankPaid > 0 && (
        <div role="status" style={{ padding: 12, borderRadius: 12, border: '2px solid #16a34a', fontWeight: 800, color: 'var(--ink-good)' }}>
          {covered
            ? L(`Đã nhận đủ ${fmt(bankPaid)} qua chuyển khoản. Bấm nút dưới để đóng bill.`, `${fmt(bankPaid)} received by bank transfer. Tap below to close the bill.`)
            : L(`Đã nhận ${fmt(bankPaid)} qua chuyển khoản · còn ${fmt(owed)}`, `${fmt(bankPaid)} received by transfer · ${fmt(owed)} to go`)}
        </div>
      )}
      {single ? (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(4, methods.length)}, minmax(0,1fr))`, gap: 8 }}>
            {methods.map((m) => (
              <button key={m} type="button" onClick={() => setPart(0, { method: m })} style={{ ...btn, minHeight: 52, ...picked(m === parts[0].method) }}>{payLabel(m, vi ? 'vi' : 'en')}</button>
            ))}
          </div>
          {parts[0].method === 'CASH' && (
            <>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 12.5, color: C.muted, fontWeight: 600 }}>{L('Khách đưa', 'Cash given')}</span>
                <input inputMode="decimal" value={parts[0].amount} onChange={(e) => setPart(0, { amount: e.target.value })} placeholder={fmt(dueCents)} style={{ ...field, minHeight: 50, fontSize: 20, fontWeight: 700 }} />
              </label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {cashQuickAmounts(dueCents, currency).map((a) => <button key={a} type="button" onClick={() => setPart(0, { amount: toInput(a, currency) })} style={chip(parts[0].amount !== '' && amounts[0] === a)}>{fmt(a)}</button>)}
              </div>
            </>
          )}
          {dynQr ? (
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', padding: 12, borderRadius: 14, background: C.raised, flexWrap: 'wrap' }}>
              <img src={dynQr} alt={L('Mã VietQR đúng số tiền', 'VietQR for the exact amount')} style={{ width: 180, height: 180, objectFit: 'contain', background: '#fff', borderRadius: 10 }} />
              <span style={{ flex: '1 1 160px', fontSize: 13.5, display: 'flex', flexDirection: 'column', gap: 4 }}>
                <b style={{ fontSize: 18, color: C.strong }}>{fmt(owed)}</b>
                <span>{L('Nội dung CK', 'Transfer note')}: <b style={{ fontSize: 16, letterSpacing: '.04em' }}>{check.payCode}</b></span>
                <span style={{ color: C.muted }}>{L('Khách quét bằng app ngân hàng: số tiền và nội dung đã điền sẵn. Nếu đã nối SePay / Casso, tiền về sẽ tự hiện ở đây.', 'Guests scan with their banking app; amount and note are filled in. With SePay / Casso connected, the money shows up here by itself.')}</span>
              </span>
            </div>
          ) : parts[0].method !== 'CASH' && (info.qrUrl || info.instructions) && (
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', padding: 12, borderRadius: 14, background: C.raised }}>
              {info.qrUrl && <img src={info.qrUrl} alt={L('Mã chuyển khoản', 'Payment QR')} style={{ width: 140, height: 140, objectFit: 'contain', background: '#fff', borderRadius: 10 }} />}
              {info.instructions && <span style={{ whiteSpace: 'pre-line', fontSize: 13.5 }}>{info.instructions}</span>}
            </div>
          )}
        </>
      ) : (
        parts.map((p, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <select value={p.method} onChange={(e) => setPart(i, { method: e.target.value as PayMethod })} aria-label={L('Cách trả', 'Method')} style={{ ...field, flex: '0 0 150px' }}>
              {methods.map((m) => <option key={m} value={m}>{payLabel(m, vi ? 'vi' : 'en')}</option>)}
            </select>
            <input inputMode="decimal" value={p.amount} onChange={(e) => setPart(i, { amount: e.target.value })} aria-label={L('Số tiền', 'Amount')} style={{ ...field, flex: 1, fontWeight: 700 }} />
            <button type="button" aria-label={L('Bỏ dòng', 'Remove')} onClick={() => setParts((xs) => (xs.length > 1 ? xs.filter((_, j) => j !== i) : xs))} style={{ ...btn, width: 44, padding: 0 }}>×</button>
          </div>
        ))
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
        <button type="button" onClick={() => setParts((xs) => [...xs, { method: first, amount: '' }])} style={chip(false)}>+ {L('Trả nhiều cách', 'Split tender')}</button>
        <span style={{ fontSize: 12.5, color: C.muted }}>{L('Chia đều:', 'Split evenly:')}</span>
        {[2, 3, 4, 5, 6].map((n) => <button key={n} type="button" onClick={() => splitEven(n)} style={chip(!single && parts.length === n)}>{n}</button>)}
        {!single && <button type="button" onClick={() => setParts([{ method: first, amount: '' }])} style={chip(false)}>{L('Một lần', 'One payment')}</button>}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 800, fontSize: 17 }}>
        <span>{short ? L('Còn thiếu', 'Still due') : L('Tiền thối', 'Change')}</span>
        <span style={{ color: short ? 'var(--ink-bad)' : 'var(--ink-good)' }}>{short ? fmt(dueCents - tendered) : fmt(change)}</span>
      </div>
      {overNonCash && <span style={{ color: 'var(--ink-bad)', fontSize: 13 }}>{L('Thẻ / chuyển khoản không được vượt số phải thu.', 'Card / transfer cannot exceed the amount due.')}</span>}
      <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input type="checkbox" checked={showInv} onChange={(e) => setShowInv(e.target.checked)} style={{ width: 20, height: 20 }} />
        <span>{L('Khách lấy hoá đơn VAT (hoá đơn đỏ)', 'Guest wants a VAT invoice')}</span>
      </label>
      {showInv && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 12, borderRadius: 14, background: C.raised }}>
          {invField('company', L('Tên công ty', 'Company name'))}
          {invField('taxCode', L('Mã số thuế', 'Tax code'), 'numeric')}
          {invField('address', L('Địa chỉ', 'Address'))}
          {invField('email', L('Email nhận hoá đơn', 'Email for the invoice'), 'email')}
          <span style={{ fontSize: 12, color: C.muted }}>{L('Lưu theo bill và in trên hoá đơn để kế toán xuất hoá đơn điện tử.', 'Kept with the bill and printed on the receipt so the accountant can issue the e-invoice.')}</span>
        </div>
      )}
      <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input type="checkbox" checked={print} onChange={(e) => setPrint(e.target.checked)} style={{ width: 20, height: 20 }} />
        <span>{L('In hoá đơn ra máy quầy', 'Print the receipt at the counter')}</span>
      </label>
      {err && <span style={{ color: 'var(--ink-bad)', fontWeight: 700 }}>{err}</span>}
      <button type="button" disabled={busy || short || overNonCash} onClick={() => void pay()} style={{ ...primary, minHeight: 56, fontSize: 16, opacity: busy || short || overNonCash ? 0.6 : 1 }}>
        {busy ? L('Đang thu…', 'Taking payment…') : covered ? L('Đã nhận chuyển khoản · đóng bill', 'Paid by transfer · close bill') : L(`Thu ${fmt(dueCents)} · đóng bill`, `Take ${fmt(dueCents)} · close bill`)}
      </button>
    </Modal>
  );
}
