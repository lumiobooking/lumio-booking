'use client';

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useParams } from 'next/navigation';
import {
  addToCart, cartToOrder, cartTotal, formatMoney, optionsReady, priceWith,
  type CartLine, type OptionGroup,
} from '../../../lib/restaurant-till';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8005/api';

/**
 * /t/<token> — the guest's own phone at the table, from the QR code printed
 * for that table. See the menu, pick dishes (with their options), send the
 * order, see what the table has ordered and how far the kitchen is, and call
 * a server or ask for the bill. No login: the token names one table of one
 * restaurant, and the server takes only dish ids and quantities from here —
 * names and prices always come from the restaurant's own menu.
 */

interface GuestDish { id: string; name: string; category: string | null; priceCents: number; imageUrl: string | null; description?: string | null; options: OptionGroup[]; soldOut: boolean }
interface Ordered { name: string; quantity: number; status: 'waiting' | 'ordered' | 'cooking' | 'ready' }
interface TableMenu { restaurant: string; table: string; currency: string; lang: string; mode: 'confirm' | 'auto' | 'off'; menu: GuestDish[]; ordered: Ordered[]; totalCents: number }

const P = { bg: '#fffaf5', card: '#ffffff', ink: '#1f1a17', soft: '#6f6660', line: '#eadfd5', accent: '#c2410c', accentSoft: '#fff1e6', good: '#15803d', bad: '#b91c1c' };
const btn: CSSProperties = { minHeight: 46, padding: '0 16px', borderRadius: 14, border: `1px solid ${P.line}`, background: P.card, color: P.ink, fontWeight: 700, fontSize: 15, cursor: 'pointer', fontFamily: 'inherit' };
const primary: CSSProperties = { ...btn, border: 'none', background: P.accent, color: '#ffffff' };
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[đĐ]/g, 'd').toLowerCase();

const T = {
  vi: {
    loading: 'Đang mở thực đơn…', gone: 'Mã QR này không còn dùng được. Vui lòng gọi nhân viên.', off: 'Nhà hàng chưa bật gọi món bằng QR. Vui lòng gọi nhân viên.',
    table: 'Bàn', menu: 'Thực đơn', ordered: 'Đã gọi', all: 'Tất cả', search: 'Tìm món', soldOut: 'Hết món', add: 'Thêm', required: 'Bắt buộc', optional: 'Tuỳ chọn',
    pick1: 'chọn 1', upTo: (n: number) => `tối đa ${n}`, note: 'Ghi chú cho bếp (không bắt buộc)', addToCart: 'Thêm vào giỏ', cart: 'Giỏ món', send: 'Gửi gọi món',
    sentWait: 'Đã gửi! Nhân viên sẽ xác nhận trong giây lát.', sentKitchen: 'Đã gửi! Bếp đã nhận món.', skipped: (x: string) => `Hết món, không gửi: ${x}`,
    callStaff: 'Gọi nhân viên', bill: 'Xin thanh toán', water: 'Thêm nước', cutlery: 'Thêm chén đũa', called: 'Đã báo nhân viên, vui lòng chờ một chút.',
    empty: 'Bàn chưa gọi món nào.', total: 'Tạm tính', status: { waiting: 'Chờ xác nhận', ordered: 'Đã nhận', cooking: 'Đang làm', ready: 'Đã xong' } as Record<Ordered['status'], string>,
    tooFast: 'Bạn thao tác hơi nhanh, đợi một phút rồi thử lại nhé.', fail: 'Không gửi được, thử lại hoặc gọi nhân viên.', items: 'món', remove: 'Bỏ', confirmHint: 'Món sẽ được nhân viên xác nhận trước khi vào bếp.',
    other: 'Khác', priceNote: 'Giá chưa gồm phí phục vụ (nếu có).',
  },
  en: {
    loading: 'Opening the menu…', gone: 'This QR code no longer works. Please ask a server.', off: 'Ordering by QR is not turned on here. Please ask a server.',
    table: 'Table', menu: 'Menu', ordered: 'Ordered', all: 'All', search: 'Search', soldOut: 'Sold out', add: 'Add', required: 'Required', optional: 'Optional',
    pick1: 'pick 1', upTo: (n: number) => `up to ${n}`, note: 'Note for the kitchen (optional)', addToCart: 'Add to order', cart: 'Your order', send: 'Send order',
    sentWait: 'Sent! A server will confirm it in a moment.', sentKitchen: 'Sent! The kitchen has it.', skipped: (x: string) => `Sold out, not sent: ${x}`,
    callStaff: 'Call a server', bill: 'The bill, please', water: 'More water', cutlery: 'Cutlery', called: 'A server is on the way.',
    empty: 'Nothing ordered yet.', total: 'So far', status: { waiting: 'Waiting', ordered: 'Ordered', cooking: 'Cooking', ready: 'Ready' } as Record<Ordered['status'], string>,
    tooFast: 'That was a bit fast. Please wait a minute and try again.', fail: 'Could not send. Try again or ask a server.', items: 'items', remove: 'Remove', confirmHint: 'A server confirms your order before it goes to the kitchen.',
    other: 'Other', priceNote: 'Prices before any service charge.',
  },
};

async function call<R>(path: string, body?: unknown): Promise<R> {
  const r = await fetch(`${API_URL}${path}`, body === undefined ? undefined : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const m = (data as { message?: unknown }).message;
    throw Object.assign(new Error(Array.isArray(m) ? String(m[0]) : String(m ?? r.status)), { status: r.status });
  }
  return data as R;
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
    const t = setInterval(() => { void load(); }, 20000);
    return () => clearInterval(t);
  }, [load]);

  const vi = (lang ?? (data?.lang === 'en' ? 'en' : 'vi')) === 'vi';
  const t = vi ? T.vi : T.en;
  const fmt = useCallback((c: number) => formatMoney(c, data?.currency ?? 'VND'), [data]);
  const categories = useMemo(() => [...new Set((data?.menu ?? []).map((m) => m.category || ''))], [data]);
  const shown = useMemo(() => {
    const f = fold(q.trim());
    return (data?.menu ?? []).filter((m) => (!cat || (m.category || '') === cat) && (!f || fold(m.name).includes(f)));
  }, [data, cat, q]);
  const total = cartTotal(cart);

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
    try { await call(`/public/table/${encodeURIComponent(token)}/call`, { reason }); say(true, t.called); }
    catch (e) { say(false, failText(e)); }
    finally { setBusy(false); }
  }

  const shell: CSSProperties = { minHeight: '100dvh', background: P.bg, color: P.ink, fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' };
  if (state !== 'ok' || !data) {
    return (
      <main style={{ ...shell, display: 'grid', placeItems: 'center', padding: 24, textAlign: 'center' }}>
        <p style={{ fontSize: 16, lineHeight: 1.5, color: P.soft, maxWidth: 320 }}>{state === 'loading' ? t.loading : state === 'off' ? t.off : t.gone}</p>
      </main>
    );
  }

  return (
    <main style={shell}>
      <div style={{ maxWidth: 560, margin: '0 auto', padding: '14px 14px 120px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <header style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, color: P.soft, fontWeight: 600 }}>{data.restaurant}</div>
            <h1 style={{ margin: 0, fontSize: 24 }}>{t.table} {data.table}</h1>
          </div>
          <button type="button" onClick={() => setLang(vi ? 'en' : 'vi')} style={{ ...btn, minHeight: 38, padding: '0 12px', fontSize: 13 }}>{vi ? 'EN' : 'VI'}</button>
        </header>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: 8 }}>
          <button type="button" disabled={busy} onClick={() => void callStaff('staff')} style={btn}>{t.callStaff}</button>
          <button type="button" disabled={busy} onClick={() => void callStaff('bill')} style={btn}>{t.bill}</button>
          <button type="button" disabled={busy} onClick={() => void callStaff('water')} style={{ ...btn, minHeight: 40, fontSize: 13.5 }}>{t.water}</button>
          <button type="button" disabled={busy} onClick={() => void callStaff('cutlery')} style={{ ...btn, minHeight: 40, fontSize: 13.5 }}>{t.cutlery}</button>
        </div>

        {msg && <div role="status" style={{ padding: '12px 14px', borderRadius: 14, fontWeight: 700, background: msg.ok ? '#dcfce7' : '#fee2e2', color: msg.ok ? P.good : P.bad }}>{msg.text}</div>}

        <div role="tablist" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: 6, padding: 4, borderRadius: 16, background: P.accentSoft }}>
          {(['menu', 'ordered'] as const).map((k) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
              style={{ minHeight: 42, borderRadius: 12, border: 'none', fontWeight: 800, fontSize: 15, fontFamily: 'inherit', cursor: 'pointer', background: tab === k ? P.card : 'transparent', color: tab === k ? P.accent : P.soft }}>
              {k === 'menu' ? t.menu : `${t.ordered}${data.ordered.length ? ` (${data.ordered.reduce((s, o) => s + o.quantity, 0)})` : ''}`}
            </button>
          ))}
        </div>

        {tab === 'menu' ? (
          <>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.search} aria-label={t.search}
              style={{ minHeight: 46, borderRadius: 14, border: `1px solid ${P.line}`, padding: '0 14px', fontSize: 16, background: P.card, color: P.ink, fontFamily: 'inherit' }} />
            <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 2 }}>
              {['', ...categories.filter(Boolean)].map((c) => (
                <button key={c || '_all'} type="button" onClick={() => setCat(c)}
                  style={{ minHeight: 38, padding: '0 14px', borderRadius: 999, whiteSpace: 'nowrap', fontWeight: 700, fontSize: 13.5, fontFamily: 'inherit', cursor: 'pointer', border: cat === c ? 'none' : `1px solid ${P.line}`, background: cat === c ? P.accent : P.card, color: cat === c ? '#ffffff' : P.ink }}>
                  {c || t.all}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {shown.map((d) => (
                <button key={d.id} type="button" disabled={d.soldOut} onClick={() => setPick(d)}
                  style={{ display: 'flex', gap: 12, alignItems: 'center', padding: 10, borderRadius: 16, border: `1px solid ${P.line}`, background: P.card, color: P.ink, textAlign: 'left', fontFamily: 'inherit', cursor: d.soldOut ? 'default' : 'pointer', opacity: d.soldOut ? 0.55 : 1 }}>
                  {d.imageUrl && <img src={d.imageUrl} alt="" loading="lazy" style={{ width: 72, height: 72, borderRadius: 12, objectFit: 'cover', flex: '0 0 72px' }} />}
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <b style={{ fontSize: 16 }}>{d.name}</b>
                    {d.description && <><br /><span style={{ fontSize: 13, color: P.soft }}>{d.description}</span></>}
                    <br /><span style={{ fontWeight: 800, color: d.soldOut ? P.bad : P.accent }}>{d.soldOut ? t.soldOut : fmt(d.priceCents)}</span>
                  </span>
                  {!d.soldOut && <span aria-hidden style={{ width: 36, height: 36, borderRadius: 999, background: P.accent, color: '#ffffff', display: 'grid', placeItems: 'center', fontSize: 22, fontWeight: 800 }}>+</span>}
                </button>
              ))}
            </div>
            <span style={{ fontSize: 12, color: P.soft }}>{t.priceNote}</span>
          </>
        ) : (
          <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {data.ordered.length === 0 && <p style={{ color: P.soft }}>{t.empty}</p>}
            {data.ordered.map((o, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 14, background: P.card, border: `1px solid ${P.line}` }}>
                <b style={{ minWidth: 30 }}>{o.quantity}×</b>
                <span style={{ flex: 1, minWidth: 0 }}>{o.name}</span>
                <span style={{ fontSize: 12.5, fontWeight: 800, color: o.status === 'ready' ? P.good : o.status === 'waiting' ? P.accent : P.soft }}>{t.status[o.status]}</span>
              </div>
            ))}
            {data.totalCents > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 800, fontSize: 17, padding: '4px 4px' }}><span>{t.total}</span><span>{fmt(data.totalCents)}</span></div>}
          </section>
        )}
      </div>

      {total.count > 0 && !showCart && !pick && (
        <div style={{ position: 'fixed', left: 0, right: 0, bottom: 0, padding: '10px 14px calc(10px + env(safe-area-inset-bottom))', background: 'rgba(255,250,245,.96)', borderTop: `1px solid ${P.line}` }}>
          <button type="button" onClick={() => setShowCart(true)} style={{ ...primary, width: '100%', maxWidth: 560, margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center', minHeight: 54, fontSize: 16 }}>
            <span>{t.cart} · {total.count} {t.items}</span><span>{fmt(total.cents)}</span>
          </button>
        </div>
      )}

      {pick && <DishSheet dish={pick} t={t} fmt={fmt} onClose={() => setPick(null)} onAdd={(line) => { setCart((c) => addToCart(c, line)); setPick(null); }} />}

      {showCart && (
        <Sheet onClose={() => setShowCart(false)} title={t.cart}>
          {cart.map((c) => (
            <div key={c.key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ flex: 1, minWidth: 0 }}>
                <b>{c.name}</b>
                {(c.optionNames.length > 0 || c.note) && <><br /><span style={{ fontSize: 13, color: P.soft }}>{[...c.optionNames, ...(c.note ? [`“${c.note}”`] : [])].join(' · ')}</span></>}
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'center', border: `1px solid ${P.line}`, borderRadius: 12 }}>
                <button type="button" aria-label="-" onClick={() => setCart((xs) => xs.map((x) => (x.key === c.key ? { ...x, quantity: x.quantity - 1 } : x)).filter((x) => x.quantity > 0))} style={{ width: 40, height: 40, border: 0, background: 'none', fontSize: 20, fontWeight: 800, color: P.ink }}>−</button>
                <b style={{ minWidth: 22, textAlign: 'center' }}>{c.quantity}</b>
                <button type="button" aria-label="+" onClick={() => setCart((xs) => xs.map((x) => (x.key === c.key ? { ...x, quantity: Math.min(20, x.quantity + 1) } : x)))} style={{ width: 40, height: 40, border: 0, background: 'none', fontSize: 20, fontWeight: 800, color: P.ink }}>+</button>
              </span>
              <b style={{ minWidth: 80, textAlign: 'right' }}>{fmt(c.quantity * c.unitPriceCents)}</b>
            </div>
          ))}
          <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 800, fontSize: 18 }}><span>{t.total}</span><span>{fmt(total.cents)}</span></div>
          {data.mode === 'confirm' && <span style={{ fontSize: 13, color: P.soft }}>{t.confirmHint}</span>}
          <button type="button" disabled={busy || !cart.length} onClick={() => void send()} style={{ ...primary, minHeight: 54, fontSize: 16, opacity: busy ? 0.6 : 1 }}>{t.send}</button>
        </Sheet>
      )}
    </main>
  );
}

function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(31,26,23,.45)', zIndex: 50, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}
        style={{ width: '100%', maxWidth: 560, maxHeight: '88dvh', overflowY: 'auto', background: P.bg, color: P.ink, borderRadius: '20px 20px 0 0', padding: '16px 16px calc(16px + env(safe-area-inset-bottom))', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <b style={{ flex: 1, fontSize: 18 }}>{title}</b>
          <button type="button" aria-label="×" onClick={onClose} style={{ ...btn, width: 44, padding: 0, fontSize: 20 }}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function DishSheet({ dish, t, fmt, onClose, onAdd }: {
  dish: GuestDish; t: typeof T.vi; fmt: (c: number) => string; onClose: () => void;
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
      if (cur.includes(id)) return { ...p, [g.id]: cur.filter((x) => x !== id) };
      if (g.max === 1) return { ...p, [g.id]: [id] };
      return cur.length >= g.max ? p : { ...p, [g.id]: [...cur, id] };
    });
  }
  const names = dish.options.flatMap((g) => (picked[g.id] ?? []).map((id) => g.choices.find((c) => c.id === id)?.name ?? '')).filter(Boolean);
  return (
    <Sheet title={dish.name} onClose={onClose}>
      {dish.imageUrl && <img src={dish.imageUrl} alt="" style={{ width: '100%', maxHeight: 220, objectFit: 'cover', borderRadius: 14 }} />}
      {dish.description && <span style={{ color: P.soft, fontSize: 14 }}>{dish.description}</span>}
      {dish.options.map((g) => (
        <fieldset key={g.id} style={{ border: 0, margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <legend style={{ display: 'flex', justifyContent: 'space-between', width: '100%', padding: 0, marginBottom: 8 }}>
            <b>{g.name}</b>
            <span style={{ fontSize: 12, fontWeight: 800, color: g.required ? P.bad : P.soft }}>{g.required ? t.required : t.optional} · {g.max === 1 ? t.pick1 : t.upTo(g.max)}</span>
          </legend>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: 8 }}>
            {g.choices.map((c) => {
              const on = (picked[g.id] ?? []).includes(c.id);
              return (
                <button key={c.id} type="button" aria-pressed={on} onClick={() => tap(g, c.id)}
                  style={{ ...btn, minHeight: 50, ...(on ? { border: `2px solid ${P.accent}`, background: P.accentSoft, color: P.accent } : {}) }}>
                  {c.name}{c.priceCents ? ` +${fmt(c.priceCents)}` : ''}
                </button>
              );
            })}
          </div>
        </fieldset>
      ))}
      <input value={note} maxLength={140} onChange={(e) => setNote(e.target.value)} placeholder={t.note} aria-label={t.note}
        style={{ minHeight: 46, borderRadius: 14, border: `1px solid ${P.line}`, padding: '0 14px', fontSize: 15, background: P.card, color: P.ink, fontFamily: 'inherit' }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', border: `1px solid ${P.line}`, borderRadius: 14, background: P.card }}>
          <button type="button" aria-label="-" onClick={() => setQty((n) => Math.max(1, n - 1))} style={{ width: 48, height: 50, border: 0, background: 'none', fontSize: 22, fontWeight: 800, color: P.ink }}>−</button>
          <b style={{ minWidth: 26, textAlign: 'center', fontSize: 17 }}>{qty}</b>
          <button type="button" aria-label="+" onClick={() => setQty((n) => Math.min(20, n + 1))} style={{ width: 48, height: 50, border: 0, background: 'none', fontSize: 22, fontWeight: 800, color: P.ink }}>+</button>
        </span>
        <button type="button" disabled={!ready} onClick={() => onAdd({
          menuItemId: dish.id, name: dish.name, unitPriceCents: unit, quantity: qty,
          options: Object.entries(picked).map(([groupId, choiceIds]) => ({ groupId, choiceIds })), optionNames: names, note: note.trim(),
        })} style={{ ...primary, flex: 1, minHeight: 52, opacity: ready ? 1 : 0.5 }}>
          {t.addToCart} · {fmt(unit * qty)}
        </button>
      </div>
    </Sheet>
  );
}
