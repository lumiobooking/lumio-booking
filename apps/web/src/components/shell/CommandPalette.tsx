'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '../../lib/api';
import { formatPrice } from '../../lib/ui';
import { fmtInTz } from '../../lib/datetime';
import { matchesQuery } from '../../lib/search-fold';
import { NavIcon } from '../NavIcon';
import { ind } from '../../lib/ui-industry';

/**
 * The header search (Ctrl+K / ⌘K, or the search box): one place to jump to a
 * screen, a client, a booking, a service or a bill.
 *
 * Screens are matched here, instantly, from the menu the person is allowed to
 * see. Records come from GET /search, which is pinned to the salon and
 * filtered by role on the server — this component never decides who may see
 * a client.
 *
 * Desktop: a centred panel. Phone: the whole screen, input at the top where
 * the thumb and the keyboard are.
 */
export interface PaletteItem { href: string; label: string; icon: string; section: string }

interface SearchResults {
  customers: { id: string; name: string; phone: string | null; email: string | null }[];
  appointments: { id: string; startTime: string; status: string; customer: string; service: string | null }[];
  services: { id: string; name: string; priceCents: number; durationMinutes: number }[];
  orders: { id: string; orderNumber: number; status: string; totalCents: number; createdAt: string }[];
}

interface Row { key: string; group: string; icon: string; title: string; sub?: string; href: string }

export function CommandPalette({ open, onClose, token, vi, pages, phone }: {
  open: boolean; onClose: () => void; token: string | null; vi: boolean; pages: PaletteItem[]; phone: boolean;
}) {
  const router = useRouter();
  const L = (v: string, e: string) => ind(vi ? v : e);
  const [q, setQ] = useState('');
  const [res, setRes] = useState<SearchResults | null>(null);
  const [busy, setBusy] = useState(false);
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const seq = useRef(0);

  // Fresh every time it opens.
  useEffect(() => {
    if (!open) return;
    setQ(''); setRes(null); setSel(0);
    const t = setTimeout(() => inputRef.current?.focus(), 30);
    return () => clearTimeout(t);
  }, [open]);

  // Records: debounced, and only the newest answer is kept.
  useEffect(() => {
    if (!open) return;
    const term = q.trim();
    if (term.length < 2 || !token) { setRes(null); setBusy(false); return; }
    const mine = ++seq.current;
    setBusy(true);
    const t = setTimeout(() => {
      apiFetch<SearchResults>(`/search?q=${encodeURIComponent(term)}`, { token })
        .then((r) => { if (seq.current === mine) setRes(r); })
        .catch(() => { if (seq.current === mine) setRes(null); })
        .finally(() => { if (seq.current === mine) setBusy(false); });
    }, 220);
    return () => clearTimeout(t);
  }, [q, open, token]);

  const rows = useMemo<Row[]>(() => {
    const term = q.trim();
    const out: Row[] = [];
    // Records first: a two-letter search is almost always a client's name.
    // Screens match on their own name only — matching the area name too made
    // "an" list every screen under "Vận hành".
    if (res) {
      for (const c of res.customers) out.push({ key: 'c' + c.id, group: L('Khách hàng', 'Clients'), icon: 'users', title: c.name || c.phone || '—', sub: [c.phone, c.email].filter(Boolean).join(' · '), href: `/salon/customers?q=${encodeURIComponent(c.phone || c.name)}` });
      for (const a of res.appointments) out.push({ key: 'a' + a.id, group: L('Lịch hẹn', 'Bookings'), icon: 'calendarCheck', title: a.customer || '—', sub: `${fmtInTz(a.startTime, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}${a.service ? ` · ${a.service}` : ''}`, href: `/salon/bookings?q=${encodeURIComponent(a.customer)}` });
      for (const s of res.services) out.push({ key: 's' + s.id, group: L('Dịch vụ', 'Services'), icon: 'sparkle', title: s.name, sub: `${formatPrice(s.priceCents)} · ${s.durationMinutes} ${L('phút', 'min')}`, href: `/salon/services?q=${encodeURIComponent(s.name)}` });
      for (const o of res.orders) out.push({ key: 'o' + o.id, group: L('Hoá đơn', 'Bills'), icon: 'receipt', title: `#${o.orderNumber}`, sub: `${formatPrice(o.totalCents)} · ${o.status}`, href: `/salon/orders?q=${o.orderNumber}` });
    }
    const pageHits = term ? pages.filter((p) => matchesQuery(p.label, term)) : pages.slice(0, 7);
    for (const p of pageHits.slice(0, term ? 5 : 7)) {
      out.push({ key: 'p' + p.href, group: term ? L('Trang', 'Screens') : L('Đi tới', 'Go to'), icon: p.icon, title: p.label, sub: p.section, href: p.href });
    }
    return out;
  }, [q, res, pages, vi]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { setSel(0); }, [rows.length, q]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-i="${sel}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [sel]);

  if (!open) return null;

  const go = (r: Row | undefined) => { if (!r) return; onClose(); router.push(r.href); };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setSel((i) => Math.min(rows.length - 1, i + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((i) => Math.max(0, i - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); go(rows[sel]); }
  };

  const term = q.trim();
  let lastGroup = '';
  return (
    <div role="dialog" aria-modal="true" aria-label={L('Tìm kiếm', 'Search')} onKeyDown={onKey}
      style={{ position: 'fixed', inset: 0, zIndex: 90, display: 'flex', justifyContent: 'center', alignItems: phone ? 'stretch' : 'flex-start', paddingTop: phone ? 0 : '11vh' }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)' }} />
      <div style={{
        position: 'relative', width: phone ? '100%' : 'min(640px, calc(100vw - 32px))', maxHeight: phone ? '100%' : '72vh',
        display: 'flex', flexDirection: 'column', background: 'var(--c111827)', border: phone ? 'none' : '1px solid var(--line)',
        borderRadius: phone ? 0 : 16, boxShadow: '0 24px 60px rgba(0,0,0,0.35)', overflow: 'hidden',
        paddingTop: phone ? 'env(safe-area-inset-top, 0px)' : 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderBottom: '1px solid var(--line)' }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" style={{ color: 'var(--c94a3b8)', flexShrink: 0 }} aria-hidden><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
          <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} enterKeyHint="go"
            placeholder={L('Tìm khách, số điện thoại, dịch vụ, mã bill, trang…', 'Search clients, phone, services, bill #, screens…')}
            aria-label={L('Tìm kiếm', 'Search')}
            style={{ flex: 1, minWidth: 0, border: 'none', outline: 'none', background: 'transparent', color: 'var(--ce2e8f0)', fontSize: phone ? 16 : 15.5, padding: '6px 0' }} />
          {busy && <span style={{ fontSize: 12, color: 'var(--c94a3b8)' }}>…</span>}
          <button type="button" onClick={onClose} aria-label={L('Đóng', 'Close')}
            style={{ border: '1px solid var(--line)', background: 'transparent', color: 'var(--c94a3b8)', borderRadius: 8, padding: phone ? '8px 12px' : '3px 8px', fontSize: 12, cursor: 'pointer', fontWeight: 600 }}>
            {phone ? L('Đóng', 'Close') : 'Esc'}
          </button>
        </div>
        <div ref={listRef} style={{ overflowY: 'auto', padding: '6px 8px 10px', flex: 1 }}>
          {rows.length === 0 && (
            <div style={{ padding: '26px 12px', textAlign: 'center', color: 'var(--c94a3b8)', fontSize: 13.5 }}>
              {term.length < 2 ? L('Gõ ít nhất 2 ký tự.', 'Type at least 2 characters.') : busy ? L('Đang tìm…', 'Searching…') : L(`Không thấy “${term}”.`, `Nothing for “${term}”.`)}
            </div>
          )}
          {rows.map((r, i) => {
            const head = r.group !== lastGroup ? r.group : null;
            lastGroup = r.group;
            const on = i === sel;
            return (
              <div key={r.key}>
                {head && <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase', color: 'var(--c64748b)', padding: '10px 10px 4px' }}>{head}</div>}
                <button type="button" data-i={i} onClick={() => go(r)} onMouseMove={() => setSel(i)}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: phone ? '12px 10px' : '9px 10px', borderRadius: 10, border: 'none', cursor: 'pointer', textAlign: 'left',
                    background: on ? 'var(--c1e1b4b)' : 'transparent', color: on ? 'var(--ca5b4fc)' : 'var(--ce2e8f0)' }}>
                  <span style={{ width: 30, height: 30, borderRadius: 9, display: 'grid', placeItems: 'center', border: '1px solid var(--line)', color: on ? 'var(--ca5b4fc)' : 'var(--c94a3b8)', flexShrink: 0 }}><NavIcon name={r.icon} size={16} /></span>
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <span style={{ display: 'block', fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.title}</span>
                    {r.sub && <span style={{ display: 'block', fontSize: 12, color: 'var(--c94a3b8)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.sub}</span>}
                  </span>
                  {on && !phone && <span style={{ fontSize: 11, color: 'var(--c94a3b8)' }}>↵</span>}
                </button>
              </div>
            );
          })}
        </div>
        {!phone && (
          <div style={{ display: 'flex', gap: 14, padding: '8px 14px', borderTop: '1px solid var(--line)', fontSize: 11.5, color: 'var(--c64748b)' }}>
            <span>↑ ↓ {L('chọn', 'move')}</span><span>↵ {L('mở', 'open')}</span><span>Esc {L('đóng', 'close')}</span>
          </div>
        )}
      </div>
    </div>
  );
}
