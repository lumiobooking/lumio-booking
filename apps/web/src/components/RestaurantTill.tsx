'use client';

/**
 * THE RESTAURANT TILL — tables first.
 *
 * A salon rings up a visit when it ends; a restaurant runs a bill on a table
 * for an hour. So this till opens on the floor: tap a table, say how many
 * guests, add dishes, send the NEW ones to the kitchen (each prep station gets
 * its own ticket), print the guest check, take the money. A dish the kitchen
 * already has is locked — taking it back needs a reason and, per the
 * restaurant's rule, a manager — because that is where food and money leak.
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
  cashQuickAmounts, lineGroups, minutesOpen, tableState, tillError, timerTone,
  type CheckLine, type CheckView, type FloorCheck, type TableState,
} from '../lib/restaurant-till';

interface Station { key: string; name: string }
interface Settings { stations: Station[]; byCategory: Record<string, string>; defaultStation: string; printVoid: boolean; printMove: boolean; voidNeedsApproval: boolean; warnMinutes: number; lateMinutes: number }
interface Table { id: string; name: string; seats: number; area: string | null }
interface Floor { currency: string; settings: Settings; tables: Table[]; checks: FloorCheck[] }
interface Dish { id: string; name: string; category: string | null; priceCents: number; imageUrl: string | null; station: string }
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
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();

// ---- look --------------------------------------------------------------------
const C = {
  page: 'var(--c0b1120)', panel: 'var(--c0f172a)', raised: 'var(--c1e293b)', line: 'var(--line)', border: 'var(--c334155)',
  text: 'var(--ce2e8f0)', strong: 'var(--cf1f5f9)', muted: 'var(--c94a3b8)',
};
const btn: CSSProperties = { minHeight: 44, padding: '0 14px', borderRadius: 12, border: `1px solid ${C.border}`, background: C.panel, color: C.text, fontWeight: 700, fontSize: 14, cursor: 'pointer', fontFamily: 'inherit' };
const primary: CSSProperties = { ...btn, border: 'none', background: '#4f46e5', color: '#fff' };
const card: CSSProperties = { background: C.panel, border: `1px solid ${C.line}`, borderRadius: 16 };
const chip = (on: boolean): CSSProperties => (on
  ? { minHeight: 40, padding: '0 14px', borderRadius: 999, border: 'none', background: '#4f46e5', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }
  : { minHeight: 40, padding: '0 14px', borderRadius: 999, border: `1px solid ${C.border}`, background: C.panel, color: C.text, fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' });

const TILE: Record<TableState, CSSProperties> = {
  free: { background: C.panel, border: `1.5px solid ${C.border}`, color: C.text },
  seated: { background: 'var(--c1e1b4b)', border: '1.5px solid var(--c818cf8)', color: 'var(--ce0e7ff)' },
  ordered: { background: '#4f46e5', border: '1.5px solid #4f46e5', color: '#fff' },
  unsent: { background: 'var(--c451a03)', border: '2px solid #ea580c', color: 'var(--cfde68a)' },
  prebilled: { background: '#0f766e', border: '1.5px solid #0f766e', color: '#fff' },
  paying: { background: '#0f766e', border: '1.5px dashed #0f766e', color: '#fff' },
};

function Modal({ title, onClose, children, width = 460 }: { title: string; onClose: () => void; children: ReactNode; width?: number }) {
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(2,6,23,0.6)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()} style={{ ...card, width: `min(${width}px, 96vw)`, maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', borderBottom: `1px solid ${C.line}` }}>
          <b style={{ flex: 1, fontSize: 17, color: C.strong }}>{title}</b>
          <button type="button" aria-label="Close" onClick={onClose} style={{ ...btn, width: 44, padding: 0, fontSize: 18 }}>×</button>
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
  const [voidLine, setVoidLine] = useState<CheckLine | null>(null);
  const [noteLine, setNoteLine] = useState<CheckLine | null>(null);
  const [showMove, setShowMove] = useState(false);
  const [showVoidCheck, setShowVoidCheck] = useState(false);
  const [showGuests, setShowGuests] = useState(false);
  const [showPay, setShowPay] = useState(false);
  const [showPrints, setShowPrints] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
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

  const loadCheck = useCallback(async (id: string) => {
    if (!token) return;
    try { setCheck(await apiFetch<CheckView>(`/restaurant/checks/${encodeURIComponent(id)}`, { token })); } catch (e) { fail(e); }
  }, [token, fail]);

  useEffect(() => {
    if (!token) return;
    void loadFloor();
    apiFetch<Dish[]>('/restaurant/menu', { token }).then(setMenu).catch(fail);
    apiFetch<{ pos?: { taxRatePercent?: number; resolvedPaymentMethods?: string[]; paymentDetails?: Record<string, { instructions?: string; qrUrl?: string }> } }>('/settings', { token })
      .then((s) => { setTaxRate(Math.max(0, s.pos?.taxRatePercent ?? 0)); setMethods(tillMethodsFrom(s.pos?.resolvedPaymentMethods)); setPayInfo(s.pos?.paymentDetails ?? {}); })
      .catch(() => undefined);
    apiFetch<ReceiptProfile>('/pos/receipt-profile', { token }).then(setProfile).catch(() => undefined);
  }, [token, loadFloor, fail]);

  // The floor and the open bill follow what the other devices do.
  useEffect(() => {
    const t = setInterval(() => {
      setNow(new Date());
      if (check) void loadCheck(check.id); else void loadFloor();
    }, 15000);
    return () => clearInterval(t);
  }, [check, loadCheck, loadFloor]);

  const checkByTable = useMemo(() => {
    const m = new Map<string, FloorCheck>();
    for (const c of floor?.checks ?? []) for (const id of c.tableIds) m.set(id, c);
    return m;
  }, [floor]);
  const areas = useMemo(() => [...new Set((floor?.tables ?? []).map((t) => t.area || ''))], [floor]);
  const categories = useMemo(() => [...new Set(menu.map((m) => m.category || ''))], [menu]);
  const shownDishes = useMemo(() => {
    const f = fold(q.trim());
    return menu.filter((m) => (!cat || (m.category || '') === cat) && (!f || fold(m.name).includes(f)));
  }, [menu, cat, q]);
  const stationName = useCallback((k: string) => floor?.settings.stations.find((s) => s.key === k)?.name ?? k, [floor]);
  const taxCents = useMemo(() => Math.round(((check?.subtotalCents ?? 0) * taxRate) / 100), [check, taxRate]);
  const dueCents = (check?.subtotalCents ?? 0) + taxCents;

  async function call<T>(path: string, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', body?: unknown): Promise<T | null> {
    if (!token) return null;
    setBusy(true);
    try { return await apiFetch<T>(path, { method, token, body }); } catch (e) { fail(e); return null; } finally { setBusy(false); }
  }

  async function openTable(t: Table, guests: number) {
    const c = await call<CheckView>('/restaurant/checks', 'POST', { tableIds: [t.id], guests });
    setOpenFor(null);
    if (c) { setCheck(c); setTab('menu'); setQ(''); }
    else void loadFloor();
  }
  function tapTable(t: Table) {
    const c = checkByTable.get(t.id);
    if (c) { void loadCheck(c.id); setTab(mobile ? 'bill' : 'menu'); setQ(''); } else setOpenFor(t);
  }
  function backToFloor() { setCheck(null); void loadFloor(); }

  async function addDish(d: Dish) {
    if (!check) return;
    const c = await call<CheckView>(`/restaurant/checks/${check.id}/lines`, 'POST', { menuItemId: d.id, quantity: 1 });
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
  function startPay() {
    if (!check) return;
    if (check.unsentCount > 0) { setUnsentAsk(true); return; }
    setShowPay(true);
  }

  // ---------------------------------------------------------------- floor ----
  if (!check) {
    const tables = (floor?.tables ?? []).filter((t) => !area || (t.area || '') === area);
    const groups = [...new Set(tables.map((t) => t.area || ''))];
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, color: C.text }}>
        <TillHeader vi={vi} cashier={user?.firstName ?? ''} shiftOpen={!!shiftCtl.state?.shift} failed={failed.length}
          onShift={() => setShowShift(true)} onPrints={() => setShowPrints(true)} onQuick={onQuickSale} onSettings={isOwner ? () => setShowSettings(true) : undefined} />
        {msg && <Toast {...msg} />}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <button type="button" onClick={() => setArea('')} style={chip(!area)}>{L('Tất cả', 'All')} · {floor?.tables.length ?? 0}</button>
          {areas.filter(Boolean).map((a) => (
            <button key={a} type="button" onClick={() => setArea(a)} style={chip(area === a)}>{a}</button>
          ))}
          <span style={{ marginLeft: 'auto', fontSize: 12.5, color: C.muted }}>{L(`${floor?.checks.length ?? 0} bàn đang phục vụ`, `${floor?.checks.length ?? 0} tables seated`)}</span>
        </div>
        <Legend vi={vi} />
        {!floor && <p style={{ color: C.muted }}>{L('Đang tải sơ đồ bàn…', 'Loading tables…')}</p>}
        {floor && floor.tables.length === 0 && (
          <div style={{ ...card, padding: 20 }}>
            <b>{L('Chưa có bàn nào.', 'No tables yet.')}</b>
            <p style={{ margin: '6px 0 0', color: C.muted }}>{L('Thêm bàn ở mục Bàn, rồi quay lại đây để gọi món.', 'Add tables under Tables, then come back to take orders.')} <a href="/salon/tables">{L('Mở mục Bàn', 'Open Tables')}</a></p>
          </div>
        )}
        {groups.map((g) => (
          <section key={g || '_'} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {groups.length > 1 && <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '.06em', color: C.muted }}>{(g || L('Khác', 'Other')).toUpperCase()}</div>}
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(${mobile ? 104 : 150}px, 1fr))`, gap: 10 }}>
              {tables.filter((t) => (t.area || '') === g).map((t) => {
                const c = checkByTable.get(t.id) ?? null;
                const st = tableState(c);
                const mins = c ? minutesOpen(c.openedAt, now) : 0;
                const tone = c ? timerTone(mins, floor?.settings.warnMinutes, floor?.settings.lateMinutes) : 'ok';
                return (
                  <button key={t.id} type="button" onClick={() => tapTable(t)} aria-label={`${t.name}`}
                    style={{ ...TILE[st], minHeight: mobile ? 92 : 112, borderRadius: 14, padding: 10, textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: 4 }}>
                    <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
                      <b style={{ fontSize: 18 }}>{c && c.tableIds.length > 1 ? c.tables : t.name}</b>
                      {c && <span style={{ fontSize: 11.5, fontWeight: 800, padding: '2px 7px', borderRadius: 999, ...(tone === 'late' ? { background: '#b91c1c', color: '#fff' } : tone === 'warn' ? { background: '#f59e0b', color: '#1c1917' } : { background: 'rgba(127,127,127,.18)' }) }}>{mins}′</span>}
                    </span>
                    <span style={{ fontSize: 12, fontWeight: 600 }}>
                      {!c ? L(`Trống · ${t.seats} ghế`, `Free · ${t.seats} seats`)
                        : st === 'unsent' ? L(`${c.unsentCount} món chưa báo bếp`, `${c.unsentCount} not sent`)
                          : st === 'seated' ? L(`${c.guests} khách · chưa gọi`, `${c.guests} guests · no order`)
                            : st === 'prebilled' ? L('Đã in tạm tính', 'Check printed')
                              : st === 'paying' ? L('Đang thanh toán', 'Paying')
                                : `${c.guests} ${L('khách', 'guests')}${c.serverName ? ` · ${c.serverName}` : ''}`}
                    </span>
                    {c && c.subtotalCents > 0 && <b style={{ fontSize: 14 }}>{fmt(c.subtotalCents)}</b>}
                  </button>
                );
              })}
            </div>
          </section>
        ))}
        {openFor && (
          <Modal title={L(`Mở bàn ${openFor.name}`, `Open ${openFor.name}`)} onClose={() => setOpenFor(null)}>
            <span style={{ color: C.muted }}>{L('Bao nhiêu khách?', 'How many guests?')}</span>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: 8 }}>
              {Array.from({ length: Math.max(8, Math.min(16, openFor.seats + 2)) }, (_, i) => i + 1).map((n) => (
                <button key={n} type="button" disabled={busy} onClick={() => void openTable(openFor, n)} style={{ ...btn, minHeight: 52, fontSize: 17, ...(n === openFor.seats ? { borderColor: '#4f46e5' } : {}) }}>{n}</button>
              ))}
            </div>
          </Modal>
        )}
        {showPrints && <PrintsModal vi={vi} jobs={failed} onClose={() => setShowPrints(false)} onRetry={async (id) => { await call(`/restaurant/prints/${id}/retry`, 'POST'); void loadFloor(); }} />}
        {showSettings && floor && <SettingsModal vi={vi} token={token} settings={floor.settings} categories={categories} onClose={() => setShowSettings(false)} onSaved={() => { setShowSettings(false); void loadFloor(); if (token) apiFetch<Dish[]>('/restaurant/menu', { token }).then(setMenu).catch(() => undefined); }} />}
        {showShift && typeof document !== 'undefined' && createPortal(
          <CashShiftPanel token={token} vi={vi} currency={currency} fmt={fmt} salonName={profile?.shop.name} cashierName={user?.firstName || undefined}
            onState={shiftCtl.setState} onClose={() => setShowShift(false)} onHistory={() => { window.location.href = '/salon/pos/shifts'; }} />, document.body)}
      </div>
    );
  }

  // ---------------------------------------------------------------- order ----
  const groups = lineGroups(check.lines);
  const unsent = check.unsentCount;
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
          <button key={d.id} type="button" disabled={busy} onClick={() => void addDish(d)}
            style={{ minHeight: 92, borderRadius: 14, border: `1px solid ${C.line}`, background: C.panel, color: C.text, textAlign: 'left', padding: 10, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: 6 }}>
            <b style={{ fontSize: 14.5, lineHeight: 1.3 }}>{d.name}</b>
            <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 11.5, fontWeight: 700, color: d.station === 'BAR' ? 'var(--ca5f3fc)' : C.muted }}>{stationName(d.station)}</span>
              <b style={{ fontSize: 13.5 }}>{fmt(d.priceCents)}</b>
            </span>
          </button>
        ))}
      </div>
    </section>
  );

  const billPane = (
    <aside aria-label={L('Bill', 'Bill')} style={{ flex: '1 1 360px', minWidth: 0, maxWidth: mobile ? undefined : 460, ...card, display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '12px 14px', borderBottom: `1px solid ${C.line}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <b style={{ fontSize: 12.5, letterSpacing: '.06em', color: C.muted }}>{L('BILL BÀN', 'CHECK')} #{check.number} · {check.itemCount} {L('MÓN', 'ITEMS')}</b>
        {check.changedAfterPrebill && <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--ink-warn)' }}>{L('Sửa sau tạm tính', 'Changed after check printed')}</span>}
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 12, minHeight: 200 }}>
        {check.lines.length === 0 && <p style={{ color: C.muted, textAlign: 'center', margin: '30px 0' }}>{L('Chạm món bên trái để thêm vào bill.', 'Tap a dish to add it.')}</p>}
        {groups.map((g) => g.key === 'unsent' ? (
          <section key={g.key} style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 10, borderRadius: 14, border: '2px solid #ea580c', background: 'var(--c451a03)' }}>
            <b style={{ fontSize: 12, letterSpacing: '.04em', color: 'var(--cfde68a)' }}>{L('CHƯA BÁO BẾP · SỬA THOẢI MÁI', 'NOT SENT YET · EDIT FREELY')}</b>
            {g.lines.map((l) => (
              <div key={l.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <b style={{ color: C.strong }}>{l.name}</b>
                  <br />
                  <button type="button" onClick={() => setNoteLine(l)} style={{ border: 0, background: 'none', padding: 0, color: 'var(--ink-link)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}>{l.note ? `“${l.note}”` : L('+ Ghi chú cho bếp', '+ Note for the kitchen')}</button>
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
                  {l.note && <><br /><span style={{ fontSize: 12.5, color: C.muted }}>{l.note}</span></>}
                  {l.state === 'VOID' && <><br /><span style={{ fontSize: 12.5, color: 'var(--ink-bad)', fontWeight: 600 }}>{L('Đã huỷ', 'Cancelled')}{l.voidReason ? ` · ${l.voidReason}` : ''}</span></>}
                </span>
                <span style={{ fontWeight: 700, textDecoration: l.state === 'VOID' ? 'line-through' : undefined }}>{fmt(l.quantity * l.unitPriceCents)}</span>
                {l.state === 'SENT' && <button type="button" aria-label={L('Huỷ món', 'Cancel dish')} onClick={() => setVoidLine(l)} style={{ ...btn, width: 40, minHeight: 40, padding: 0 }}>⋯</button>}
              </div>
            ))}
          </section>
        ))}
      </div>
      <div style={{ padding: 12, borderTop: `1px solid ${C.line}`, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {taxCents > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', color: C.muted }}><span>{L('Thuế', 'Tax')} {taxRate}%</span><span>{fmt(taxCents)}</span></div>}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}><b style={{ fontSize: 16 }}>{L('Tổng', 'Total')}</b><b style={{ fontSize: 26, color: C.strong }}>{fmt(dueCents)}</b></div>
        <button type="button" disabled={busy || unsent === 0} onClick={() => void send()}
          style={{ ...btn, minHeight: 52, border: 'none', fontSize: 15.5, ...(unsent > 0 ? { background: '#ea580c', color: '#fff' } : { opacity: 0.55 }) }}>
          {unsent > 0 ? L(`Báo bếp · ${unsent} món mới`, `Send to kitchen · ${unsent} new`) : L('Không có món mới', 'Nothing new to send')}
        </button>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: 8 }}>
          <button type="button" disabled={busy || check.itemCount === 0} onClick={() => void prebill()} style={{ ...btn, minHeight: 50 }}>{L('In tạm tính', 'Print check')}{check.preBillCount ? ` (${check.preBillCount})` : ''}</button>
          <button type="button" disabled={busy || check.itemCount === 0} onClick={startPay} style={{ ...primary, minHeight: 50, opacity: check.itemCount === 0 ? 0.55 : 1 }}>{L('Thanh toán', 'Pay')}</button>
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
          <div style={{ fontWeight: 800, fontSize: 18, color: C.strong }}>{L('Bàn', 'Table')} {check.tables}</div>
          <div style={{ fontSize: 12.5, color: C.muted }}>{L('Mở', 'Opened')} {new Date(check.openedAt).toLocaleTimeString(vi ? 'vi-VN' : 'en-US', { hour: '2-digit', minute: '2-digit' })} · {minutesOpen(check.openedAt, now)}′{check.serverName ? ` · ${check.serverName}` : ''}</div>
        </div>
        <button type="button" onClick={() => setShowGuests(true)} style={btn}>{check.guests} {L('khách', 'guests')} ▾</button>
        <button type="button" onClick={() => setShowMove(true)} style={btn}>{L('Chuyển bàn', 'Move')}</button>
        <button type="button" onClick={() => setShowVoidCheck(true)} style={{ ...btn, color: 'var(--ink-bad)' }}>{L('Huỷ bàn', 'Void')}</button>
      </div>
      {msg && <Toast {...msg} />}
      {mobile && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: 6 }}>
          <button type="button" onClick={() => setTab('menu')} style={chip(tab === 'menu')}>{L('Thực đơn', 'Menu')}</button>
          <button type="button" onClick={() => setTab('bill')} style={chip(tab === 'bill')}>{L('Bill', 'Bill')} · {check.itemCount}{check.unsentCount ? ` (${check.unsentCount} ${L('mới', 'new')})` : ''}</button>
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

      {noteLine && <NoteModal vi={vi} line={noteLine} onClose={() => setNoteLine(null)} onSave={(n) => void saveNote(noteLine, n)} />}
      {voidLine && <VoidModal vi={vi} line={voidLine} needPin={!!floor?.settings.voidNeedsApproval && !canVoid} busy={busy} fmt={fmt}
        onClose={() => setVoidLine(null)}
        onConfirm={async (quantity, reason, approvalPin) => {
          const c = await call<CheckView>(`/restaurant/checks/${check.id}/lines/${voidLine.id}/void`, 'POST', { quantity, reason, ...(approvalPin ? { approvalPin } : {}) });
          if (c) { setCheck(c); setVoidLine(null); say(true, L('Đã huỷ món, bếp nhận phiếu huỷ.', 'Cancelled; the kitchen got a cancel ticket.')); }
        }} />}
      {showGuests && (
        <Modal title={L('Số khách', 'Guests')} onClose={() => setShowGuests(false)}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: 8 }}>
            {Array.from({ length: 16 }, (_, i) => i + 1).map((n) => (
              <button key={n} type="button" onClick={async () => { const c = await call<CheckView>(`/restaurant/checks/${check.id}`, 'PATCH', { guests: n }); setShowGuests(false); if (c) setCheck(c); }} style={{ ...btn, minHeight: 52, ...(n === check.guests ? { borderColor: '#4f46e5' } : {}) }}>{n}</button>
            ))}
          </div>
        </Modal>
      )}
      {showMove && floor && (
        <Modal title={L(`Chuyển bàn ${check.tables} sang…`, `Move ${check.tables} to…`)} onClose={() => setShowMove(false)}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(90px, 1fr))', gap: 8 }}>
            {floor.tables.filter((t) => !checkByTable.has(t.id)).map((t) => (
              <button key={t.id} type="button" disabled={busy} onClick={async () => { const c = await call<CheckView>(`/restaurant/checks/${check.id}/move`, 'POST', { tableIds: [t.id] }); setShowMove(false); if (c) { setCheck(c); say(true, L(`Đã chuyển sang ${t.name}.`, `Moved to ${t.name}.`)); void loadFloor(); } }} style={{ ...btn, minHeight: 56 }}>{t.name}<br /><span style={{ fontSize: 11.5, color: C.muted }}>{t.seats} {L('ghế', 'seats')}</span></button>
            ))}
          </div>
          {floor.tables.every((t) => checkByTable.has(t.id)) && <p style={{ color: C.muted }}>{L('Không còn bàn trống.', 'No free table.')}</p>}
        </Modal>
      )}
      {showVoidCheck && <VoidCheckModal vi={vi} hasSent={check.sentCount > 0} needPin={!!floor?.settings.voidNeedsApproval && !canVoid && check.sentCount > 0} busy={busy}
        onClose={() => setShowVoidCheck(false)}
        onConfirm={async (reason, approvalPin) => {
          const c = await call<CheckView>(`/restaurant/checks/${check.id}/void`, 'POST', { ...(reason ? { reason } : {}), ...(approvalPin ? { approvalPin } : {}) });
          if (c) { setShowVoidCheck(false); say(true, L('Đã huỷ bàn.', 'Table voided.')); backToFloor(); }
        }} />}
      {unsentAsk && (
        <Modal title={L('Còn món chưa báo bếp', 'Dishes not sent yet')} onClose={() => setUnsentAsk(false)}>
          <span>{L(`${check.unsentCount} món chưa gửi bếp. Báo bếp trước, hay thu tiền luôn (ví dụ nước lấy tại quầy)?`, `${check.unsentCount} dishes were never sent. Send them first, or take payment as is?`)}</span>
          <button type="button" onClick={async () => { setUnsentAsk(false); await send(); setShowPay(true); }} style={{ ...btn, minHeight: 50, border: 'none', background: '#ea580c', color: '#fff' }}>{L('Báo bếp rồi thu tiền', 'Send, then pay')}</button>
          <button type="button" onClick={() => { setUnsentAsk(false); setShowPay(true); }} style={{ ...btn, minHeight: 50 }}>{L('Thu tiền luôn, không báo bếp', 'Pay without sending')}</button>
        </Modal>
      )}
      {showPay && <PayModal vi={vi} token={token} check={check} dueCents={dueCents} taxCents={taxCents} currency={currency} fmt={fmt} methods={methods} payInfo={payInfo} profile={profile}
        shiftRequired={!!shiftCtl.mustOpen} onOpenShift={() => setShowShift(true)}
        onClose={() => setShowPay(false)}
        onPaid={() => { setShowPay(false); say(true, L('Đã thu tiền, bàn đã trống.', 'Paid; the table is free.')); backToFloor(); }} />}
      {showShift && typeof document !== 'undefined' && createPortal(
        <CashShiftPanel token={token} vi={vi} currency={currency} fmt={fmt} salonName={profile?.shop.name} cashierName={user?.firstName || undefined}
          onState={shiftCtl.setState} onClose={() => setShowShift(false)} onHistory={() => { window.location.href = '/salon/pos/shifts'; }} />, document.body)}
    </div>
  );
}

function Toast({ ok, text }: { ok: boolean; text: string }) {
  return (
    <div role="status" style={{ padding: '10px 14px', borderRadius: 12, fontWeight: 700, fontSize: 14, ...(ok ? { background: 'var(--c052e16)', color: 'var(--c86efac)' } : { background: 'var(--c450a0a)', color: 'var(--cfca5a5)' }) }}>{text}</div>
  );
}

function TillHeader({ vi, cashier, shiftOpen, failed, onShift, onPrints, onQuick, onSettings }: { vi: boolean; cashier: string; shiftOpen: boolean; failed: number; onShift: () => void; onPrints: () => void; onQuick: () => void; onSettings?: () => void }) {
  const L = (v: string, e: string) => (vi ? v : e);
  return (
    <div style={{ ...card, padding: '10px 12px', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
      <div style={{ flex: '1 1 180px', minWidth: 0 }}>
        <div style={{ fontWeight: 800, fontSize: 17, color: C.strong }}>{L('Sơ đồ bàn', 'Tables')}</div>
        <div style={{ fontSize: 12.5, color: C.muted }}>{L('Quầy thu ngân', 'Checkout')}{cashier ? ` · ${L('Thu ngân', 'Cashier')}: ${cashier}` : ''}</div>
      </div>
      <button type="button" onClick={onShift} style={{ ...btn, ...(shiftOpen ? { color: 'var(--ink-good)' } : { color: 'var(--ink-warn)' }) }}>{shiftOpen ? L('Ca đang mở', 'Shift open') : L('Chưa mở ca', 'No shift')}</button>
      {failed > 0 && <button type="button" onClick={onPrints} style={{ ...btn, color: 'var(--ink-bad)' }}>⚠ {L(`${failed} phiếu in lỗi`, `${failed} print failed`)}</button>}
      <button type="button" onClick={onQuick} style={btn}>{L('Mang về · Bán nhanh', 'Takeaway · Quick sale')}</button>
      {onSettings && <button type="button" onClick={onSettings} style={btn}>{L('Bếp & máy in', 'Kitchen & printers')}</button>}
    </div>
  );
}

function Legend({ vi }: { vi: boolean }) {
  const L = (v: string, e: string) => (vi ? v : e);
  const items: [TableState, string][] = [
    ['free', L('Trống', 'Free')], ['seated', L('Có khách, chưa gọi', 'Seated')], ['ordered', L('Đã báo bếp', 'Ordered')],
    ['unsent', L('Có món chưa báo bếp', 'Not sent')], ['prebilled', L('Đã in tạm tính', 'Check printed')],
  ];
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, fontSize: 12.5, fontWeight: 600, color: C.muted }}>
      {items.map(([k, label]) => (
        <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><i style={{ width: 14, height: 14, borderRadius: 4, ...TILE[k] }} />{label}</span>
      ))}
    </div>
  );
}

function NoteModal({ vi, line, onClose, onSave }: { vi: boolean; line: CheckLine; onClose: () => void; onSave: (note: string) => void }) {
  const L = (v: string, e: string) => (vi ? v : e);
  const [note, setNote] = useState(line.note ?? '');
  const quick = vi ? ['Ít hành', 'Không hành', 'Không cay', 'Cay', 'Ít đá', 'Mang về'] : ['No onion', 'Mild', 'Spicy', 'Less ice', 'To go', 'No sauce'];
  return (
    <Modal title={`${L('Ghi chú', 'Note')} · ${line.name}`} onClose={onClose}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {quick.map((x) => <button key={x} type="button" onClick={() => setNote((n) => (n ? `${n}, ${x}` : x))} style={chip(false)}>{x}</button>)}
      </div>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 12.5, color: C.muted, fontWeight: 600 }}>{L('Ghi chú cho bếp (không tính tiền)', 'Note for the kitchen (free)')}</span>
        <input value={note} maxLength={140} onChange={(e) => setNote(e.target.value)} style={{ minHeight: 46, borderRadius: 12, border: `1px solid ${C.border}`, padding: '0 12px', background: C.panel, color: C.text, fontSize: 15, fontFamily: 'inherit' }} />
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
    <Modal title={L('Huỷ món đã báo bếp', 'Cancel a sent dish')} onClose={onClose}>
      <b style={{ fontSize: 17 }}>{line.quantity}× {line.name}</b>
      {line.quantity > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span>{L('Huỷ', 'Cancel')}</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', borderRadius: 12, border: `1px solid ${C.border}` }}>
            <button type="button" aria-label="-" onClick={() => setN((x) => Math.max(1, x - 1))} style={{ width: 44, height: 46, border: 0, background: 'none', color: C.text, fontSize: 18, fontWeight: 800 }}>−</button>
            <b style={{ minWidth: 24, textAlign: 'center' }}>{n}</b>
            <button type="button" aria-label="+" onClick={() => setN((x) => Math.min(line.quantity, x + 1))} style={{ width: 44, height: 46, border: 0, background: 'none', color: C.text, fontSize: 18, fontWeight: 800 }}>+</button>
          </span>
          <span style={{ color: C.muted }}>{L(`trên ${line.quantity}`, `of ${line.quantity}`)}</span>
        </div>
      )}
      <span style={{ fontWeight: 700 }}>{L('Lý do (bắt buộc)', 'Reason (required)')}</span>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: 8 }}>
        {reasons.map((r) => <button key={r} type="button" onClick={() => setReason(r)} style={{ ...btn, minHeight: 48, ...(reason === r ? { borderColor: '#4f46e5', borderWidth: 2 } : {}) }}>{r}</button>)}
      </div>
      <input value={reason} maxLength={140} onChange={(e) => setReason(e.target.value)} placeholder={L('Hoặc gõ lý do khác', 'Or type another reason')} aria-label={L('Lý do', 'Reason')} style={{ minHeight: 46, borderRadius: 12, border: `1px solid ${C.border}`, padding: '0 12px', background: C.panel, color: C.text, fontSize: 15, fontFamily: 'inherit' }} />
      {needPin && (
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontWeight: 700 }}>{L('PIN quản lý', 'Manager PIN')}</span>
          <span style={{ fontSize: 12.5, color: C.muted }}>{L('Bạn không có quyền huỷ món. Quản lý nhập PIN tại đây.', 'You cannot cancel dishes yourself. A manager types their PIN here.')}</span>
          <input type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value)} style={{ minHeight: 48, borderRadius: 12, border: `1px solid ${C.border}`, padding: '0 12px', background: C.panel, color: C.text, fontSize: 18, letterSpacing: '.3em', fontFamily: 'inherit' }} />
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
    <Modal title={L('Huỷ cả bàn', 'Void the whole table')} onClose={onClose}>
      <span>{hasSent ? L('Bàn có món đã báo bếp. Cần lý do; bếp nhận phiếu huỷ.', 'Dishes were sent. A reason is required; the kitchen gets cancel tickets.') : L('Bàn chưa báo bếp món nào. Huỷ để trả bàn trống.', 'Nothing was sent. Voiding frees the table.')}</span>
      <input value={reason} maxLength={140} onChange={(e) => setReason(e.target.value)} placeholder={L('Lý do (VD: khách bỏ về, mở nhầm bàn)', 'Reason (guests left, wrong table)')} aria-label={L('Lý do', 'Reason')} style={{ minHeight: 46, borderRadius: 12, border: `1px solid ${C.border}`, padding: '0 12px', background: C.panel, color: C.text, fontSize: 15, fontFamily: 'inherit' }} />
      {needPin && <input type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value)} placeholder={L('PIN quản lý', 'Manager PIN')} aria-label={L('PIN quản lý', 'Manager PIN')} style={{ minHeight: 48, borderRadius: 12, border: `1px solid ${C.border}`, padding: '0 12px', background: C.panel, color: C.text, fontSize: 18, fontFamily: 'inherit' }} />}
      <button type="button" disabled={!ok || busy} onClick={() => onConfirm(reason.trim(), pin.trim())} style={{ ...btn, minHeight: 52, border: 'none', background: '#b91c1c', color: '#fff', opacity: ok ? 1 : 0.5 }}>{L('Huỷ bàn', 'Void table')}</button>
    </Modal>
  );
}

function PrintsModal({ vi, jobs, onClose, onRetry }: { vi: boolean; jobs: FailedJob[]; onClose: () => void; onRetry: (id: string) => void }) {
  const L = (v: string, e: string) => (vi ? v : e);
  return (
    <Modal title={L('Phiếu in lỗi', 'Failed prints')} onClose={onClose}>
      {jobs.length === 0 && <span style={{ color: C.muted }}>{L('Không có phiếu lỗi.', 'Nothing failed.')}</span>}
      {jobs.map((j) => (
        <div key={j.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 10, borderRadius: 12, background: C.raised }}>
          <span style={{ flex: 1, minWidth: 0 }}><b>{j.title || j.id}</b><br /><span style={{ fontSize: 12.5, color: C.muted }}>{j.error || ''}</span></span>
          <button type="button" onClick={() => onRetry(j.id)} style={btn}>{L('In lại', 'Retry')}</button>
        </div>
      ))}
      <span style={{ fontSize: 12.5, color: C.muted }}>{L('Kiểm tra máy in còn giấy và máy tính chạy Lumio Print còn mở.', 'Check the printer has paper and the Lumio Print PC is running.')}</span>
    </Modal>
  );
}

function SettingsModal({ vi, token, settings, categories, onClose, onSaved }: { vi: boolean; token: string | null; settings: Settings; categories: string[]; onClose: () => void; onSaved: () => void }) {
  const L = (v: string, e: string) => (vi ? v : e);
  const [s, setS] = useState<Settings>(settings);
  const [newName, setNewName] = useState('');
  const [err, setErr] = useState('');
  const catKey = (c: string) => c.trim().toLowerCase().replace(/\s+/g, ' ');
  async function save() {
    try {
      await apiFetch('/restaurant/settings', { method: 'PATCH', token, body: { settings: s } });
      onSaved();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  }
  function addStation() {
    const name = newName.trim();
    if (!name) return;
    const key = (name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[đĐ]/g, 'D').toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '') || 'ST').slice(0, 16);
    const unique = s.stations.some((x) => x.key === key) ? `${key.slice(0, 13)}_${s.stations.length + 1}` : key.length < 2 ? `${key}_X` : key;
    setS({ ...s, stations: [...s.stations, { key: unique, name }] });
    setNewName('');
  }
  const toggle = (k: 'printVoid' | 'printMove' | 'voidNeedsApproval', label: string) => (
    <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
      <span>{label}</span>
      <input type="checkbox" checked={s[k]} onChange={(e) => setS({ ...s, [k]: e.target.checked })} style={{ width: 22, height: 22 }} />
    </label>
  );
  return (
    <Modal title={L('Bếp & máy in', 'Kitchen & printers')} onClose={onClose} width={560}>
      <b>{L('Khu chế biến', 'Prep stations')}</b>
      {s.stations.map((st, i) => (
        <div key={st.key} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input value={st.name} aria-label={st.key} onChange={(e) => setS({ ...s, stations: s.stations.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} style={{ flex: 1, minHeight: 44, borderRadius: 10, border: `1px solid ${C.border}`, padding: '0 10px', background: C.panel, color: C.text, fontFamily: 'inherit' }} />
          <code style={{ fontSize: 12, color: C.muted }}>{st.key}</code>
          {s.stations.length > 1 && <button type="button" onClick={() => setS({ ...s, stations: s.stations.filter((_, j) => j !== i) })} style={{ ...btn, width: 44, padding: 0 }} aria-label={L('Xoá', 'Remove')}>×</button>}
        </div>
      ))}
      <div style={{ display: 'flex', gap: 8 }}>
        <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={L('Thêm khu (VD: Bếp nướng)', 'Add a station (e.g. Grill)')} aria-label={L('Tên khu mới', 'New station')} style={{ flex: 1, minHeight: 44, borderRadius: 10, border: `1px solid ${C.border}`, padding: '0 10px', background: C.panel, color: C.text, fontFamily: 'inherit' }} />
        <button type="button" onClick={addStation} style={btn}>{L('Thêm', 'Add')}</button>
      </div>
      <b>{L('Nhóm món → khu', 'Menu group → station')}</b>
      {categories.filter(Boolean).map((c0) => (
        <label key={c0} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <span>{c0}</span>
          <select value={s.byCategory[catKey(c0)] ?? ''} onChange={(e) => { const next = { ...s.byCategory }; if (e.target.value) next[catKey(c0)] = e.target.value; else delete next[catKey(c0)]; setS({ ...s, byCategory: next }); }}
            style={{ minHeight: 40, borderRadius: 10, border: `1px solid ${C.border}`, background: C.panel, color: C.text, padding: '0 8px', fontFamily: 'inherit' }}>
            <option value="">{L('Tự động', 'Automatic')}</option>
            {s.stations.map((st) => <option key={st.key} value={st.key}>{st.name}</option>)}
          </select>
        </label>
      ))}
      <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <span>{L('Món chưa có nhóm in ở', 'Dishes with no group go to')}</span>
        <select value={s.defaultStation} onChange={(e) => setS({ ...s, defaultStation: e.target.value })} style={{ minHeight: 40, borderRadius: 10, border: `1px solid ${C.border}`, background: C.panel, color: C.text, padding: '0 8px', fontFamily: 'inherit' }}>
          {s.stations.map((st) => <option key={st.key} value={st.key}>{st.name}</option>)}
        </select>
      </label>
      <b>{L('Quy tắc', 'Rules')}</b>
      {toggle('printVoid', L('In phiếu HUỶ MÓN cho bếp', 'Print a CANCEL ticket'))}
      {toggle('printMove', L('In phiếu CHUYỂN BÀN cho bếp', 'Print a TABLE MOVED ticket'))}
      {toggle('voidNeedsApproval', L('Huỷ món đã báo bếp cần quản lý duyệt', 'Cancelling a sent dish needs a manager'))}
      <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <span>{L('Bàn đổi vàng / đỏ sau (phút)', 'Table turns yellow / red after (min)')}</span>
        <span style={{ display: 'flex', gap: 6 }}>
          <input type="number" value={s.warnMinutes} aria-label="warn" onChange={(e) => setS({ ...s, warnMinutes: Number(e.target.value) })} style={{ width: 70, minHeight: 40, borderRadius: 10, border: `1px solid ${C.border}`, background: C.panel, color: C.text, textAlign: 'center' }} />
          <input type="number" value={s.lateMinutes} aria-label="late" onChange={(e) => setS({ ...s, lateMinutes: Number(e.target.value) })} style={{ width: 70, minHeight: 40, borderRadius: 10, border: `1px solid ${C.border}`, background: C.panel, color: C.text, textAlign: 'center' }} />
        </span>
      </label>
      <div style={{ fontSize: 12.5, color: C.muted }}>{L('Máy in: cài Lumio Print trên máy tính ở quầy, ghi máy in cho từng mã khu (COUNTER, KITCHEN, BAR…) trong config.json.', 'Printers: run Lumio Print on the counter PC and map each station code (COUNTER, KITCHEN, BAR…) to a printer in config.json.')}</div>
      {err && <span style={{ color: 'var(--ink-bad)' }}>{err}</span>}
      <button type="button" onClick={() => void save()} style={{ ...primary, minHeight: 50 }}>{L('Lưu', 'Save')}</button>
    </Modal>
  );
}

function PayModal({ vi, token, check, dueCents, taxCents, currency, fmt, methods, payInfo, profile, shiftRequired, onOpenShift, onClose, onPaid }: {
  vi: boolean; token: string | null; check: CheckView; dueCents: number; taxCents: number; currency: string; fmt: (c: number) => string;
  methods: PayMethod[]; payInfo: Record<string, { instructions?: string; qrUrl?: string }>; profile: ReceiptProfile | null;
  shiftRequired: boolean; onOpenShift: () => void; onClose: () => void; onPaid: () => void;
}) {
  const L = (v: string, e: string) => (vi ? v : e);
  const [method, setMethod] = useState<PayMethod>(methods[0] ?? 'CASH');
  const [given, setGiven] = useState('');
  const [print, setPrint] = useState(() => { try { return localStorage.getItem('lumio_rt_print') !== '0'; } catch { return true; } });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const givenCents = method === 'CASH' ? (given ? parseMoney(given, currency) : dueCents) : dueCents;
  const change = method === 'CASH' ? Math.max(0, givenCents - dueCents) : 0;
  const short = method === 'CASH' && givenCents < dueCents;
  const info = payInfo[method] ?? {};

  async function pay() {
    if (!token || short) return;
    setBusy(true); setErr('');
    try {
      const r = await apiFetch<{ order: { id: string; orderNumber?: number } }>(`/restaurant/checks/${check.id}/pay`, {
        method: 'POST', token, body: { tenders: [{ method, amountCents: givenCents }], allowUnsent: true },
      });
      try { localStorage.setItem('lumio_rt_print', print ? '1' : '0'); } catch { /* private mode */ }
      if (print && profile) {
        const live = check.lines.filter((l) => l.state !== 'VOID');
        const text = buildReceiptText({
          orderNumber: r.order.orderNumber ?? check.number,
          when: new Date().toLocaleString(vi ? 'vi-VN' : 'en-US'),
          lines: live.map((l) => ({ qty: l.quantity, name: l.note ? `${l.name} (${l.note})` : l.name, amountCents: l.quantity * l.unitPriceCents })),
          subtotal: check.subtotalCents, tax: taxCents || undefined, total: dueCents,
          paid: [{ method, cents: givenCents }], change: change || undefined,
        }, profile.shop, profile.design, fmt);
        await apiFetch('/print-jobs', { method: 'POST', token, body: { title: `${L('Hoá đơn', 'Receipt')} #${r.order.orderNumber ?? ''} · ${check.tables}`, text } }).catch(() => undefined);
      }
      onPaid();
    } catch (e) {
      setErr(tillError(e instanceof Error ? e.message : String(e), vi));
    } finally { setBusy(false); }
  }

  return (
    <Modal title={L(`Thanh toán · Bàn ${check.tables}`, `Pay · ${check.tables}`)} onClose={onClose} width={520}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span style={{ color: C.muted, fontWeight: 700 }}>{L('Phải thu', 'Amount due')}</span>
        <b style={{ fontSize: 30, color: C.strong }}>{fmt(dueCents)}</b>
      </div>
      {taxCents > 0 && <span style={{ fontSize: 12.5, color: C.muted }}>{L('Gồm thuế', 'Includes tax')} {fmt(taxCents)}</span>}
      {shiftRequired && (
        <div style={{ padding: 10, borderRadius: 12, background: 'var(--c451a03)', color: 'var(--cfde68a)', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ flex: 1 }}>{L('Chưa mở ca thu ngân.', 'No cashier shift open.')}</span>
          <button type="button" onClick={onOpenShift} style={btn}>{L('Mở ca', 'Open shift')}</button>
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(4, methods.length)}, minmax(0,1fr))`, gap: 8 }}>
        {methods.map((m) => (
          <button key={m} type="button" onClick={() => setMethod(m)} style={{ ...btn, minHeight: 52, ...(m === method ? { borderColor: '#4f46e5', borderWidth: 2, color: 'var(--ce0e7ff)', background: 'var(--c1e1b4b)' } : {}) }}>{payLabel(m, vi ? 'vi' : 'en')}</button>
        ))}
      </div>
      {method === 'CASH' && (
        <>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 12.5, color: C.muted, fontWeight: 600 }}>{L('Khách đưa', 'Cash given')}</span>
            <input inputMode="decimal" value={given} onChange={(e) => setGiven(e.target.value)} placeholder={fmt(dueCents)} style={{ minHeight: 50, borderRadius: 12, border: `1px solid ${C.border}`, padding: '0 12px', background: C.panel, color: C.text, fontSize: 20, fontWeight: 700, fontFamily: 'inherit' }} />
          </label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {cashQuickAmounts(dueCents, currency).map((a) => <button key={a} type="button" onClick={() => setGiven(String((currency || '').toUpperCase() === 'VND' ? a : a / 100))} style={chip(givenCents === a)}>{fmt(a)}</button>)}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 800, fontSize: 17 }}><span>{L('Tiền thối', 'Change')}</span><span style={{ color: short ? 'var(--ink-bad)' : 'var(--ink-good)' }}>{short ? L('Chưa đủ', 'Not enough') : fmt(change)}</span></div>
        </>
      )}
      {method !== 'CASH' && (info.qrUrl || info.instructions) && (
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', padding: 12, borderRadius: 14, background: C.raised }}>
          {info.qrUrl && <img src={info.qrUrl} alt={L('Mã chuyển khoản', 'Payment QR')} style={{ width: 140, height: 140, objectFit: 'contain', background: '#fff', borderRadius: 10 }} />}
          {info.instructions && <span style={{ whiteSpace: 'pre-line', fontSize: 13.5 }}>{info.instructions}</span>}
        </div>
      )}
      <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input type="checkbox" checked={print} onChange={(e) => setPrint(e.target.checked)} style={{ width: 20, height: 20 }} />
        <span>{L('In hoá đơn ra máy quầy', 'Print the receipt at the counter')}</span>
      </label>
      {err && <span style={{ color: 'var(--ink-bad)', fontWeight: 700 }}>{err}</span>}
      <button type="button" disabled={busy || short} onClick={() => void pay()} style={{ ...primary, minHeight: 56, fontSize: 16, opacity: busy || short ? 0.6 : 1 }}>
        {busy ? L('Đang thu…', 'Taking payment…') : L(`Thu ${fmt(dueCents)} · đóng bàn`, `Take ${fmt(dueCents)} · close table`)}
      </button>
    </Modal>
  );
}
