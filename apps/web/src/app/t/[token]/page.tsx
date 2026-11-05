'use client';

import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { useParams } from 'next/navigation';
import {
  addToCart, cartKey, cartToOrder, cartTotal, formatMoney, optionsReady, priceWith,
  type CartLine, type OptionGroup,
} from '../../../lib/restaurant-till';
import { useLiveEvents } from '../../../lib/useLiveEvents';
import { guestProgress, menuSections, quickQty, tintFor } from '../../../lib/guest-order';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8005/api';

/**
 * /t/<token> — the guest's own phone at the table, from the QR code printed
 * for that table. See the menu, pick dishes (with their options), send the
 * order, see what the table has ordered and how far the kitchen is, and call
 * a server or ask for the bill. No login: the token names one table of one
 * restaurant, and the server takes only dish ids and quantities from here —
 * names and prices always come from the restaurant's own menu.
 *
 * Nov 2026 redesign (approved mockup "Sơ đồ bàn & Đặt món"): the restaurant's
 * own colour and logo, a dish without options goes in with one tap (and its
 * row turns into a − n + stepper), options as clear rows, a dark cart bar,
 * and "Đã gọi" shows each dish moving through the kitchen.
 */

interface GuestDish { id: string; name: string; category: string | null; priceCents: number; imageUrl: string | null; description?: string | null; options: OptionGroup[]; soldOut: boolean }
interface Ordered { name: string; quantity: number; status: 'waiting' | 'ordered' | 'cooking' | 'ready' }
interface TableMenu {
  restaurant: string; table: string; currency: string; lang: string; mode: 'confirm' | 'auto' | 'off';
  accent?: string | null; logoUrl?: string | null;
  menu: GuestDish[]; ordered: Ordered[]; totalCents: number;
}

const P = { bg: '#f6f7fb', card: '#ffffff', ink: '#0f172a', soft: '#64748b', line: '#e6e8f0', good: '#047857', bad: '#b91c1c', dark: '#0f172a' };
const FONT = '"Be Vietnam Pro", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[đĐ]/g, 'd').toLowerCase();

const T = {
  vi: {
    loading: 'Đang mở thực đơn…', gone: 'Mã QR này không còn dùng được. Vui lòng gọi nhân viên.', off: 'Nhà hàng chưa bật gọi món bằng QR. Vui lòng gọi nhân viên.',
    table: 'Bàn', menu: 'Thực đơn', ordered: 'Đã gọi', all: 'Tất cả', search: 'Tìm món…', soldOut: 'Hết món', add: 'Thêm', required: 'Bắt buộc', optional: 'Tuỳ chọn',
    pick1: 'chọn 1', upTo: (n: number) => `chọn tối đa ${n}`, noteLabel: 'Ghi chú cho bếp', note: 'vd: ít hành, không cay', addToCart: 'Thêm vào món', cart: 'Món đã chọn', send: 'Gửi món cho bếp',
    sentWait: 'Đã gửi! Nhân viên sẽ xác nhận trong giây lát.', sentKitchen: 'Đã gửi! Bếp đã nhận món.', skipped: (x: string) => `Hết món, không gửi: ${x}`,
    callStaff: 'Gọi nhân viên', bill: 'Xin thanh toán', water: 'Thêm nước', cutlery: 'Thêm chén đũa', called: 'Đã báo nhân viên, vui lòng chờ một chút.',
    empty: 'Bàn chưa gọi món nào.', total: 'Tạm tính', tableTotal: 'Tổng bàn',
    status: { waiting: 'Chờ xác nhận', ordered: 'Đã nhận', cooking: 'Đang làm', ready: 'Đã ra' } as Record<Ordered['status'], string>,
    tooFast: 'Bạn thao tác hơi nhanh, đợi một phút rồi thử lại nhé.', fail: 'Không gửi được, thử lại hoặc gọi nhân viên.', items: 'món', confirmHint: 'Nhân viên xác nhận món trước khi vào bếp.',
    other: 'Khác', priceNote: 'Giá chưa gồm phí phục vụ (nếu có).', view: 'Xem món đã chọn', more: '+ Gọi thêm món', chooseMore: '+ Chọn thêm món',
    help: 'Bạn cần gì?', payLater: 'Chưa trừ tiền khi gửi món — thanh toán tại quầy hoặc gọi nhân viên.', orderedCount: (n: number) => `${n} món đã gọi`, close: 'Đóng',
    less: 'Bớt', more1: 'Thêm', noMatch: 'Không có món nào khớp.',
  },
  en: {
    loading: 'Opening the menu…', gone: 'This QR code no longer works. Please ask a server.', off: 'Ordering by QR is not turned on here. Please ask a server.',
    table: 'Table', menu: 'Menu', ordered: 'Ordered', all: 'All', search: 'Search dishes…', soldOut: 'Sold out', add: 'Add', required: 'Required', optional: 'Optional',
    pick1: 'pick 1', upTo: (n: number) => `up to ${n}`, noteLabel: 'Note for the kitchen', note: 'e.g. no onion, mild', addToCart: 'Add to order', cart: 'Your order', send: 'Send to the kitchen',
    sentWait: 'Sent! A server will confirm it in a moment.', sentKitchen: 'Sent! The kitchen has it.', skipped: (x: string) => `Sold out, not sent: ${x}`,
    callStaff: 'Call a server', bill: 'The bill, please', water: 'More water', cutlery: 'Cutlery', called: 'A server is on the way.',
    empty: 'Nothing ordered yet.', total: 'Subtotal', tableTotal: 'Table total',
    status: { waiting: 'Waiting', ordered: 'Received', cooking: 'Cooking', ready: 'Served' } as Record<Ordered['status'], string>,
    tooFast: 'That was a bit fast. Please wait a minute and try again.', fail: 'Could not send. Try again or ask a server.', items: 'items', confirmHint: 'A server confirms your order before it goes to the kitchen.',
    other: 'Other', priceNote: 'Prices before any service charge.', view: 'View your order', more: '+ Order more', chooseMore: '+ Add more dishes',
    help: 'What do you need?', payLater: 'Nothing is charged when you send — pay at the counter or ask a server.', orderedCount: (n: number) => `${n} ordered`, close: 'Close',
    less: 'Less', more1: 'More', noMatch: 'No dish matches.',
  },
};
type Tx = typeof T.vi;

async function call<R>(path: string, body?: unknown): Promise<R> {
  const r = await fetch(`${API_URL}${path}`, body === undefined ? undefined : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const m = (data as { message?: unknown }).message;
    throw Object.assign(new Error(Array.isArray(m) ? String(m[0]) : String(m ?? r.status)), { status: r.status });
  }
  return data as R;
}

const btn: CSSProperties = { minHeight: 46, padding: '0 16px', borderRadius: 14, border: `1px solid ${P.line}`, background: P.card, color: P.ink, fontWeight: 700, fontSize: 15, cursor: 'pointer', fontFamily: 'inherit' };

/** The dish's photo, or a calm tile with its first letter when there is none. */
function Thumb({ d, size, radius = 14 }: { d: { name: string; imageUrl: string | null }; size: number | string; radius?: number }) {
  const box: CSSProperties = { width: size, height: typeof size === 'number' ? size : d.imageUrl ? 220 : 110, borderRadius: radius, flexShrink: 0, overflow: 'hidden' };
  if (d.imageUrl) return <img src={d.imageUrl} alt="" loading="lazy" style={{ ...box, objectFit: 'cover', display: 'block' }} />;
  const c = tintFor(d.name);
  return <span aria-hidden style={{ ...box, background: c.bg, color: c.fg, display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: typeof size === 'number' ? Math.round(size / 2.6) : 56 }}>{(d.name.trim()[0] ?? '·').toUpperCase()}</span>;
}

function Stepper({ qty, onLess, onMore, accent, t, solid }: { qty: number; onLess: () => void; onMore: () => void; accent: string; t: Tx; solid?: boolean }) {
  const fg = solid ? '#ffffff' : P.ink;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', borderRadius: 14, background: solid ? accent : P.card, border: solid ? 'none' : `1px solid ${P.line}`, flexShrink: 0 }}>
      <button type="button" aria-label={t.less} onClick={onLess} style={{ width: 40, height: 44, border: 0, background: 'none', fontSize: 20, fontWeight: 800, color: fg, cursor: 'pointer' }}>−</button>
      <b style={{ minWidth: 20, textAlign: 'center', color: fg }}>{qty}</b>
      <button type="button" aria-label={t.more1} onClick={onMore} style={{ width: 40, height: 44, border: 0, background: 'none', fontSize: 20, fontWeight: 800, color: solid ? '#ffffff' : accent, cursor: 'pointer' }}>+</button>
    </span>
  );
}

export default function TablePage() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<TableMenu | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'gone' | 'off'>('loading');
  const [lang, setLang] = useState<'vi' | 'en' | null>(null);
  const [tab, setTab] = useState<'menu' | 'ordered'>('menu');
  const [cat, setCat] = useState('');
  const [q, setQ] = useState('');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [pick, setPick] = useState<GuestDish | null>(null);
  const [showCart, setShowCart] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const d = await call<TableMenu>(`/public/table/${encodeURIComponent(token)}`);
      setData(d); setState('ok');
    } catch (e) {
      setState((e as Error).message === 'QR_OFF' ? 'off' : 'gone');
    }
  }, [token]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const t = setInterval(() => { void load(); }, 60000);
    return () => clearInterval(t);
  }, [load]);
  // Live: the server nudges this phone the moment THIS table changes — the
  // staff accepted the order, the kitchen started or finished a dish, a dish
  // sold out. The minute poll above is only the safety net.
  useLiveEvents(token ? `/public/table/${encodeURIComponent(token)}/stream` : null, null, () => { void load(); }, { anonymous: true });

  const vi = (lang ?? (data?.lang === 'en' ? 'en' : 'vi')) === 'vi';
  const t = vi ? T.vi : T.en;
  const A = data?.accent || '#4f46e5';
  const fmt = useCallback((c: number) => formatMoney(c, data?.currency ?? 'VND'), [data]);
  const categories = useMemo(() => [...new Set((data?.menu ?? []).map((m) => m.category || ''))], [data]);
  const shown = useMemo(() => {
    const f = fold(q.trim());
    return (data?.menu ?? []).filter((m) => (!cat || (m.category || '') === cat) && (!f || fold(`${m.name} ${m.description ?? ''}`).includes(f)));
  }, [data, cat, q]);
  const sections = useMemo(() => menuSections(shown, !cat && !q.trim(), t.other), [shown, cat, q, t.other]);
  const total = cartTotal(cart);
  const orderedCount = (data?.ordered ?? []).reduce((s, o) => s + o.quantity, 0);

  function say(ok: boolean, text: string) {
    setMsg({ ok, text });
    setTimeout(() => setMsg(null), ok ? 4000 : 6000);
  }
  function failText(e: unknown): string {
    const status = (e as { status?: number }).status;
    if (status === 429) return t.tooFast;
    const m = (e as Error).message;
    if (m === 'SOLD_OUT') return t.skipped('');
    if (m === 'QR_OFF') return t.off;
    return t.fail;
  }
  /** One tap: a dish with no options goes straight in (its row becomes a stepper). */
  function quickAdd(d: GuestDish) {
    if (d.soldOut) return;
    if (d.options.length) { setPick(d); return; }
    setCart((c) => addToCart(c, { menuItemId: d.id, name: d.name, unitPriceCents: d.priceCents, quantity: 1, options: [], optionNames: [], note: '' }));
  }
  function quickLess(d: GuestDish) {
    const key = cartKey(d.id, [], '');
    setCart((xs) => xs.map((x) => (x.key === key ? { ...x, quantity: x.quantity - 1 } : x)).filter((x) => x.quantity > 0));
  }
  function bump(key: string, by: number) {
    setCart((xs) => xs.map((x) => (x.key === key ? { ...x, quantity: Math.min(20, x.quantity + by) } : x)).filter((x) => x.quantity > 0));
  }

  async function send() {
    if (!token || !cart.length) return;
    setBusy(true);
    try {
      const r = await call<{ added: number; skipped: string[]; waitingForStaff: boolean }>(`/public/table/${encodeURIComponent(token)}/order`, { lines: cartToOrder(cart) });
      setCart([]); setShowCart(false); setTab('ordered');
      say(true, (r.waitingForStaff ? t.sentWait : t.sentKitchen) + (r.skipped.length ? ` ${t.skipped(r.skipped.join(', '))}` : ''));
      void load();
    } catch (e) { say(false, failText(e)); }
    finally { setBusy(false); }
  }
  async function callStaff(reason: 'staff' | 'bill' | 'water' | 'cutlery') {
    if (!token) return;
    setBusy(true);
    try { await call(`/public/table/${encodeURIComponent(token)}/call`, { reason }); setShowHelp(false); say(true, t.called); }
    catch (e) { say(false, failText(e)); }
    finally { setBusy(false); }
  }

  const shell: CSSProperties = { minHeight: '100dvh', background: P.bg, color: P.ink, fontFamily: FONT };
  if (state !== 'ok' || !data) {
    return (
      <main style={{ ...shell, display: 'grid', placeItems: 'center', padding: 24, textAlign: 'center' }}>
        <p style={{ fontSize: 16, lineHeight: 1.5, color: P.soft, maxWidth: 320 }}>{state === 'loading' ? t.loading : state === 'off' ? t.off : t.gone}</p>
      </main>
    );
  }
  const initials = data.restaurant.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '·';
  const chip = (on: boolean): CSSProperties => ({ minHeight: 40, padding: '0 15px', borderRadius: 999, whiteSpace: 'nowrap', flexShrink: 0, fontWeight: 700, fontSize: 13.5, fontFamily: 'inherit', cursor: 'pointer', border: on ? 'none' : `1px solid ${P.line}`, background: on ? A : P.card, color: on ? '#ffffff' : P.ink });

  return (
    <main style={shell}>
      <header style={{ position: 'sticky', top: 0, zIndex: 20, background: 'rgba(255,255,255,.97)', borderBottom: `1px solid ${P.line}`, backdropFilter: 'blur(8px)' }}>
        <div style={{ maxWidth: 600, margin: '0 auto', padding: '12px 16px 10px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {data.logoUrl
              ? <img src={data.logoUrl} alt="" style={{ width: 44, height: 44, borderRadius: 14, objectFit: 'cover', flexShrink: 0, background: P.card, border: `1px solid ${P.line}` }} />
              : <span aria-hidden style={{ width: 44, height: 44, borderRadius: 14, background: P.dark, color: '#fbbf24', display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: 15, flexShrink: 0 }}>{initials}</span>}
            <div style={{ flex: 1, minWidth: 0 }}>
              <h1 style={{ margin: 0, fontSize: 17, fontWeight: 800, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{data.restaurant}</h1>
              <div style={{ fontSize: 12.5, color: P.soft }}>{orderedCount ? t.orderedCount(orderedCount) : t.menu}</div>
            </div>
            <span style={{ fontSize: 13, fontWeight: 800, color: A, background: `color-mix(in srgb, ${A} 12%, #ffffff)`, borderRadius: 999, padding: '6px 12px', whiteSpace: 'nowrap' }}>{t.table} {data.table}</span>
            <button type="button" onClick={() => setLang(vi ? 'en' : 'vi')} aria-label={vi ? 'English' : 'Tiếng Việt'} style={{ ...btn, minHeight: 36, padding: '0 10px', fontSize: 12.5, borderRadius: 10 }}>{vi ? 'EN' : 'VI'}</button>
          </div>
          <div role="tablist" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 6 }}>
            {(['menu', 'ordered'] as const).map((k) => (
              <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
                style={{ minHeight: 40, borderRadius: 12, border: 'none', fontWeight: 800, fontSize: 14, fontFamily: 'inherit', cursor: 'pointer', background: tab === k ? P.dark : '#eef0f5', color: tab === k ? '#ffffff' : P.soft }}>
                {k === 'menu' ? t.menu : `${t.ordered}${orderedCount ? ` · ${orderedCount}` : ''}`}
              </button>
            ))}
            <button type="button" onClick={() => setShowHelp(true)} aria-label={t.callStaff}
              style={{ minHeight: 40, borderRadius: 12, border: `1px solid ${P.line}`, background: P.card, color: P.ink, fontWeight: 700, fontSize: 13.5, fontFamily: 'inherit', cursor: 'pointer', padding: '0 12px', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M6 8a6 6 0 0112 0c0 7 3 9 3 9H3s3-2 3-9"></path><path d="M10.3 21a1.94 1.94 0 003.4 0"></path></svg>
              {t.callStaff}
            </button>
          </div>
          {tab === 'menu' && (
            <>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#f1f2f7', borderRadius: 12, padding: '0 12px', minHeight: 44, color: P.soft }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><path d="M21 21l-4-4"></path></svg>
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.search} aria-label={t.search}
                  style={{ flex: 1, border: 0, outline: 0, background: 'transparent', fontSize: 16, color: P.ink, fontFamily: 'inherit', minWidth: 0 }} />
              </label>
              {categories.length > 1 && (
                <div style={{ display: 'flex', gap: 8, overflowX: 'auto', scrollbarWidth: 'none', margin: '0 -16px', padding: '0 16px 2px' }}>
                  {['', ...categories.filter(Boolean)].map((c) => (
                    <button key={c || '_all'} type="button" onClick={() => setCat(c)} style={chip(cat === c)}>{c || t.all}</button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </header>

      {msg && (
        <div role="status" style={{ position: 'fixed', top: 12, left: 12, right: 12, zIndex: 80, maxWidth: 576, margin: '0 auto', padding: '13px 16px', borderRadius: 16, fontWeight: 700, background: msg.ok ? '#ecfdf5' : '#fef2f2', color: msg.ok ? P.good : P.bad, border: `1px solid ${msg.ok ? '#a7f3d0' : '#fecaca'}`, boxShadow: '0 10px 28px rgba(15,23,42,.14)' }}>{msg.text}</div>
      )}

      <div style={{ maxWidth: 600, margin: '0 auto', padding: '14px 16px 130px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {tab === 'menu' ? (
          <>
            {sections.map((sec) => (
              <section key={sec.title || '_'} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {sec.title && <h2 style={{ margin: '8px 0 0', fontSize: 16, fontWeight: 800 }}>{sec.title} <span style={{ fontSize: 12.5, fontWeight: 600, color: P.soft }}>· {sec.items.length}</span></h2>}
                {sec.items.map((d) => {
                  const n = d.options.length ? 0 : quickQty(cart, d.id);
                  return (
                    <div key={d.id} style={{ display: 'flex', gap: 12, alignItems: 'center', padding: 10, borderRadius: 18, border: `1px solid ${P.line}`, background: P.card, opacity: d.soldOut ? 0.55 : 1 }}>
                      <button type="button" disabled={d.soldOut} onClick={() => setPick(d)} aria-label={d.name}
                        style={{ display: 'flex', gap: 12, alignItems: 'center', flex: 1, minWidth: 0, border: 0, background: 'none', padding: 0, textAlign: 'left', fontFamily: 'inherit', color: P.ink, cursor: d.soldOut ? 'default' : 'pointer' }}>
                        <Thumb d={d} size={76} />
                        <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
                          <b style={{ fontSize: 15, lineHeight: 1.3 }}>{d.name}</b>
                          {d.description && <span style={{ fontSize: 12.5, color: P.soft, lineHeight: 1.4, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{d.description}</span>}
                          <span style={{ fontWeight: 800, fontSize: 14.5, color: d.soldOut ? P.bad : P.ink }}>{d.soldOut ? t.soldOut : fmt(d.priceCents)}{d.options.length > 0 && !d.soldOut && <span style={{ fontSize: 11.5, fontWeight: 600, color: P.soft }}> · {t.optional.toLowerCase()}</span>}</span>
                        </span>
                      </button>
                      {!d.soldOut && (n > 0
                        ? <Stepper qty={n} solid accent={A} t={t} onLess={() => quickLess(d)} onMore={() => quickAdd(d)} />
                        : <button type="button" onClick={() => quickAdd(d)} aria-label={`${t.add} ${d.name}`}
                          style={{ width: 44, height: 44, borderRadius: 14, border: 'none', background: `color-mix(in srgb, ${A} 12%, #ffffff)`, color: A, fontSize: 24, fontWeight: 600, cursor: 'pointer', flexShrink: 0 }}>+</button>)}
                    </div>
                  );
                })}
              </section>
            ))}
            {shown.length === 0 && <p style={{ color: P.soft, textAlign: 'center' }}>{t.noMatch}</p>}
            <span style={{ fontSize: 12, color: P.soft, textAlign: 'center' }}>{t.priceNote}</span>
          </>
        ) : (
          <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {data.ordered.length === 0 && <p style={{ color: P.soft, textAlign: 'center', margin: '24px 0' }}>{t.empty}</p>}
            {data.ordered.length > 0 && (
              <div style={{ background: P.card, border: `1px solid ${P.line}`, borderRadius: 18, padding: '4px 14px' }}>
                {data.ordered.map((o, i) => {
                  const g = guestProgress(o.status);
                  return (
                    <div key={i} style={{ padding: '12px 0', borderBottom: i < data.ordered.length - 1 ? '1px solid #f1f2f7' : 'none' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <b style={{ minWidth: 30 }}>{o.quantity}×</b>
                        <span style={{ flex: 1, minWidth: 0, fontWeight: 700 }}>{o.name}</span>
                        <span style={{ fontSize: 11.5, fontWeight: 800, color: g.fg, background: g.bg, borderRadius: 999, padding: '3px 10px', whiteSpace: 'nowrap' }}>{t.status[o.status]}</span>
                      </div>
                      <div aria-hidden style={{ display: 'flex', gap: 4, margin: '9px 0 0 40px' }}>
                        {[0, 1, 2, 3].map((s) => <span key={s} style={{ flex: 1, height: 5, borderRadius: 3, background: s <= g.step ? g.bar : '#e6e8f0' }} />)}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            {data.totalCents > 0 && (
              <div style={{ background: P.card, border: `1px solid ${P.line}`, borderRadius: 18, padding: 14, display: 'flex', justifyContent: 'space-between', fontWeight: 800, fontSize: 18 }}>
                <span>{t.tableTotal}</span><span>{fmt(data.totalCents)}</span>
              </div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <button type="button" onClick={() => setTab('menu')} style={{ ...btn, minHeight: 52, border: `1.5px solid ${A}`, color: A }}>{t.more}</button>
              <button type="button" disabled={busy} onClick={() => void callStaff('bill')} style={{ ...btn, minHeight: 52, border: 'none', background: P.dark, color: '#ffffff' }}>{t.bill}</button>
            </div>
          </section>
        )}
      </div>

      {total.count > 0 && !showCart && !pick && (
        <div style={{ position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 30, padding: '10px 14px calc(14px + env(safe-area-inset-bottom))' }}>
          <button type="button" onClick={() => setShowCart(true)}
            style={{ width: '100%', maxWidth: 572, margin: '0 auto', minHeight: 60, borderRadius: 18, border: 'none', background: P.dark, color: '#ffffff', display: 'flex', alignItems: 'center', gap: 12, padding: '0 8px 0 16px', fontFamily: 'inherit', cursor: 'pointer', boxShadow: '0 12px 28px rgba(15,23,42,.28)' }}>
            <span style={{ minWidth: 30, height: 30, borderRadius: 10, background: A, display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: 14, padding: '0 6px', boxSizing: 'border-box' }}>{total.count}</span>
            <b style={{ fontSize: 15 }}>{t.view}</b>
            <span style={{ marginLeft: 'auto', background: '#ffffff', color: P.ink, borderRadius: 12, padding: '10px 14px', fontWeight: 800, fontSize: 14.5 }}>{fmt(total.cents)}</span>
          </button>
        </div>
      )}

      {pick && <DishSheet dish={pick} t={t} fmt={fmt} accent={A} onClose={() => setPick(null)} onAdd={(line) => { setCart((c) => addToCart(c, line)); setPick(null); }} />}

      {showHelp && (
        <Sheet title={t.help} onClose={() => setShowHelp(false)} t={t}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {([['staff', t.callStaff], ['bill', t.bill], ['water', t.water], ['cutlery', t.cutlery]] as const).map(([k, label]) => (
              <button key={k} type="button" disabled={busy} onClick={() => void callStaff(k)} style={{ ...btn, minHeight: 64, fontSize: 15.5, ...(k === 'bill' ? { background: P.dark, color: '#ffffff', border: 'none' } : {}) }}>{label}</button>
            ))}
          </div>
        </Sheet>
      )}

      {showCart && (
        <Sheet onClose={() => setShowCart(false)} title={t.cart} t={t}
          footer={(
            <button type="button" disabled={busy || !cart.length} onClick={() => void send()}
              style={{ ...btn, width: '100%', minHeight: 56, border: 'none', background: A, color: '#ffffff', fontSize: 16, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, opacity: busy ? 0.6 : 1 }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true"><path d="M22 2L11 13"></path><path d="M22 2l-7 20-4-9-9-4 20-7z"></path></svg>
              {t.send} · {fmt(total.cents)}
            </button>
          )}>
          <div style={{ background: P.card, border: `1px solid ${P.line}`, borderRadius: 18, padding: '2px 14px' }}>
            {cart.map((c) => {
              const d = data.menu.find((m) => m.id === c.menuItemId);
              return (
                <div key={c.key} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderBottom: '1px solid #f1f2f7' }}>
                  <Thumb d={{ name: c.name, imageUrl: d?.imageUrl ?? null }} size={52} radius={12} />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <b style={{ fontSize: 14.5 }}>{c.name}</b>
                    {(c.optionNames.length > 0 || c.note) && <span style={{ display: 'block', fontSize: 12.5, color: P.soft }}>{[...c.optionNames, ...(c.note ? [`“${c.note}”`] : [])].join(' · ')}</span>}
                    <b style={{ display: 'block', fontSize: 14, marginTop: 2 }}>{fmt(c.quantity * c.unitPriceCents)}</b>
                  </span>
                  <Stepper qty={c.quantity} accent={A} t={t} onLess={() => bump(c.key, -1)} onMore={() => bump(c.key, 1)} />
                </div>
              );
            })}
            <button type="button" onClick={() => setShowCart(false)} style={{ border: 0, background: 'none', color: A, fontWeight: 800, fontSize: 14, padding: '14px 0', cursor: 'pointer', fontFamily: 'inherit' }}>{t.chooseMore}</button>
          </div>
          <div style={{ background: P.card, border: `1px solid ${P.line}`, borderRadius: 18, padding: 14, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, color: P.soft }}><span>{t.total} · {total.count} {t.items}</span><span>{fmt(total.cents)}</span></div>
            {data.totalCents > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 800, fontSize: 17 }}><span>{t.tableTotal}</span><span>{fmt(data.totalCents + total.cents)}</span></div>}
            <span style={{ fontSize: 12.5, color: P.soft }}>{data.mode === 'confirm' ? `${t.confirmHint} ` : ''}{t.payLater}</span>
          </div>
        </Sheet>
      )}
    </main>
  );
}

function Sheet({ title, onClose, children, footer, t }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; t: Tx }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.45)', zIndex: 50, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', fontFamily: FONT }}>
      <div role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}
        style={{ width: '100%', maxWidth: 600, maxHeight: '90dvh', display: 'flex', flexDirection: 'column', background: P.bg, color: P.ink, borderRadius: '24px 24px 0 0', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', background: P.card, borderBottom: `1px solid ${P.line}` }}>
          <b style={{ flex: 1, fontSize: 18 }}>{title}</b>
          <button type="button" aria-label={t.close} onClick={onClose} style={{ ...btn, width: 44, padding: 0, fontSize: 20 }}>×</button>
        </div>
        <div style={{ overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>{children}</div>
        {footer && <div style={{ padding: '12px 16px calc(14px + env(safe-area-inset-bottom))', background: P.card, borderTop: `1px solid ${P.line}` }}>{footer}</div>}
      </div>
    </div>
  );
}

function DishSheet({ dish, t, fmt, accent, onClose, onAdd }: {
  dish: GuestDish; t: Tx; fmt: (c: number) => string; accent: string; onClose: () => void;
  onAdd: (line: Omit<CartLine, 'key'>) => void;
}) {
  const [picked, setPicked] = useState<Record<string, string[]>>(() => {
    const p: Record<string, string[]> = {};
    for (const g of dish.options) if (g.required && g.max === 1 && g.choices.length) p[g.id] = [g.choices[0].id];
    return p;
  });
  const [qty, setQty] = useState(1);
  const [note, setNote] = useState('');
  const ready = optionsReady(dish.options, picked);
  const unit = priceWith(dish.priceCents, dish.options, picked);
  function tap(g: OptionGroup, id: string) {
    setPicked((p) => {
      const cur = p[g.id] ?? [];
      if (cur.includes(id)) return g.required && g.max === 1 ? p : { ...p, [g.id]: cur.filter((x) => x !== id) };
      if (g.max === 1) return { ...p, [g.id]: [id] };
      return cur.length >= g.max ? p : { ...p, [g.id]: [...cur, id] };
    });
  }
  const names = dish.options.flatMap((g) => (picked[g.id] ?? []).map((id) => g.choices.find((c) => c.id === id)?.name ?? '')).filter(Boolean);
  return (
    <Sheet title={dish.name} onClose={onClose} t={t}
      footer={(
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Stepper qty={qty} accent={accent} t={t} onLess={() => setQty((n) => Math.max(1, n - 1))} onMore={() => setQty((n) => Math.min(20, n + 1))} />
          <button type="button" disabled={!ready} onClick={() => onAdd({
            menuItemId: dish.id, name: dish.name, unitPriceCents: unit, quantity: qty,
            options: Object.entries(picked).map(([groupId, choiceIds]) => ({ groupId, choiceIds })), optionNames: names, note: note.trim(),
          })} style={{ ...btn, flex: 1, minHeight: 52, border: 'none', background: accent, color: '#ffffff', fontWeight: 800, opacity: ready ? 1 : 0.5 }}>
            {t.addToCart} · {fmt(unit * qty)}
          </button>
        </div>
      )}>
      <Thumb d={dish} size="100%" radius={18} />
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <span style={{ flex: 1, color: P.soft, fontSize: 14, lineHeight: 1.55 }}>{dish.description || ''}</span>
        <b style={{ fontSize: 18 }}>{fmt(dish.priceCents)}</b>
      </div>
      {dish.options.map((g) => (
        <fieldset key={g.id} style={{ border: 0, margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <legend style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', padding: 0, marginBottom: 8 }}>
            <b style={{ fontSize: 15.5 }}>{g.name}</b>
            <span style={{ fontSize: 11.5, fontWeight: 700, borderRadius: 6, padding: '2px 8px', ...(g.required ? { color: '#9a3412', background: '#fff4e5' } : { color: P.soft, background: '#eef0f5' }) }}>
              {g.required ? t.required : t.optional} · {g.max === 1 ? t.pick1 : t.upTo(g.max)}
            </span>
          </legend>
          {g.choices.map((c) => {
            const on = (picked[g.id] ?? []).includes(c.id);
            return (
              <button key={c.id} type="button" role={g.max === 1 ? 'radio' : 'checkbox'} aria-checked={on} onClick={() => tap(g, c.id)}
                style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 52, padding: '0 14px', borderRadius: 14, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', color: P.ink,
                  border: on ? `2px solid ${accent}` : `1px solid ${P.line}`, background: on ? `color-mix(in srgb, ${accent} 7%, #ffffff)` : P.card }}>
                <span aria-hidden style={{ width: 20, height: 20, flexShrink: 0, borderRadius: g.max === 1 ? 999 : 6, border: on ? `6px solid ${accent}` : '2px solid #cbd5e1', boxSizing: 'border-box', background: '#ffffff' }} />
                <span style={{ flex: 1, fontWeight: 600, fontSize: 14.5 }}>{c.name}</span>
                <span style={{ fontSize: 13.5, fontWeight: 600, color: P.soft }}>{c.priceCents ? `+${fmt(c.priceCents)}` : ''}</span>
              </button>
            );
          })}
        </fieldset>
      ))}
      <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, fontWeight: 700 }}>
        {t.noteLabel}
        <input value={note} maxLength={140} onChange={(e) => setNote(e.target.value)} placeholder={t.note}
          style={{ minHeight: 46, borderRadius: 14, border: `1px solid ${P.line}`, padding: '0 14px', fontSize: 16, background: P.card, color: P.ink, fontFamily: 'inherit', fontWeight: 400 }} />
      </label>
    </Sheet>
  );
}
