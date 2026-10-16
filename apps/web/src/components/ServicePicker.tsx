'use client';

import { useMemo, useState } from 'react';
import { ui } from '../lib/ui';
import { formatPrice } from '../lib/money';
import type { CustomerHistoryView } from './CustomerPicker';

/**
 * PICKING SERVICES WITHOUT SCROLLING A FIFTY-LINE LIST.
 *
 * Three ways in, fastest first: "same as last time" for a returning
 * customer (one tap, her exact services), the group tabs the menu is already
 * organised in (Hay làm · Manicure · Pedicure …), and the search box for the
 * one-off. Each service is a card with its length and price, so the desk
 * quotes while picking; what is picked stays visible as chips above.
 */

export interface PickerService {
  id: string; name: string; durationMinutes: number;
  priceCents?: number; isActive?: boolean; walkInOnly?: boolean;
  category?: { id: string; name: string } | null;
}

export function ServicePicker({ services, selected, onToggle, onSet, history, currency, vi, label, hideWalkInOnly = false, maxHeight = 300 }: {
  services: PickerService[];
  selected: string[];
  onToggle: (id: string) => void;
  /** Replace the whole selection ("same as last time"). */
  onSet: (ids: string[]) => void;
  history?: CustomerHistoryView | null;
  currency?: string;
  vi: boolean;
  /** Whose services these are, in a party. */
  label?: string;
  hideWalkInOnly?: boolean;
  maxHeight?: number;
}) {
  const L = (v: string, e: string) => (vi ? v : e);
  const [q, setQ] = useState('');
  const [tab, setTab] = useState<string | null>(null);
  const byId = useMemo(() => new Map(services.map((s) => [s.id, s])), [services]);
  const usable = useMemo(() => services.filter((s) => s.isActive !== false && !(hideWalkInOnly && s.walkInOnly)), [services, hideWalkInOnly]);
  const cats = useMemo(() => {
    const seen: string[] = [];
    for (const s of usable) { const n = s.category?.name?.trim(); if (n && !seen.includes(n)) seen.push(n); }
    return seen;
  }, [usable]);
  const fav = useMemo(() => (history?.topServices ?? []).map((t) => byId.get(t.id)).filter((s): s is PickerService => Boolean(s && s.isActive !== false)), [history, byId]);
  const lastIds = useMemo(() => (history?.last?.services ?? []).map((s) => s.id).filter((id) => byId.has(id) && byId.get(id)!.isActive !== false), [history, byId]);
  const lastSame = lastIds.length > 0 && lastIds.length === selected.length && lastIds.every((id) => selected.includes(id));

  // Which tab opens: hers when she has one, else all (search still works everywhere).
  const active = tab ?? (fav.length ? '__fav' : '__all');
  const term = q.trim().toLowerCase();
  const shown = term
    ? usable.filter((s) => s.name.toLowerCase().includes(term))
    : active === '__fav' ? fav
    : active === '__all' ? usable
    : usable.filter((s) => s.category?.name === active);

  const mins = (ids: string[]) => ids.reduce((n, id) => n + (byId.get(id)?.durationMinutes ?? 0), 0);
  const cents = (ids: string[]) => ids.reduce((n, id) => n + (byId.get(id)?.priceCents ?? 0), 0);
  const hasPrice = usable.some((s) => typeof s.priceCents === 'number');
  const money = (c: number) => formatPrice(c, currency);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {lastIds.length > 0 && history?.last && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 10, background: 'var(--wash-amber)', border: '1px solid rgba(245,158,11,.4)' }}>
          <span style={{ fontSize: 16 }}>🔁</span>
          <span style={{ flex: 1, fontSize: 13, color: 'var(--ccbd5e1)', minWidth: 0 }}>
            <b style={{ color: 'var(--ce2e8f0)' }}>{L('Lần trước', 'Last time')}:</b> {lastIds.map((id) => byId.get(id)!.name).join(' + ')} · {mins(lastIds)}′{hasPrice ? ` · ${money(cents(lastIds))}` : ''}{history.last.staff ? ` · ${history.last.staff.name}` : ''}
          </span>
          <button type="button" onClick={() => onSet(lastSame ? [] : lastIds)} style={{ ...ghost, ...(lastSame ? { borderColor: '#6366f1', color: 'var(--ink-link)' } : {}) }}>
            {lastSame ? `✓ ${L('Đã chọn', 'Chosen')}` : L('Chọn giống lần trước', 'Same as last time')}
          </button>
        </div>
      )}

      {selected.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
          {label && <span style={{ fontSize: 12, color: 'var(--c94a3b8)', marginRight: 2 }}>{label}:</span>}
          {selected.map((id) => {
            const s = byId.get(id);
            if (!s) return null;
            return (
              <span key={id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'var(--c312e81)', color: 'var(--cc7d2fe)', borderRadius: 999, padding: '4px 6px 4px 11px', fontSize: 12.5, fontWeight: 600 }}>
                {s.name}{typeof s.priceCents === 'number' ? <span style={{ opacity: 0.8, fontWeight: 500 }}>{money(s.priceCents)}</span> : null}
                <button type="button" onClick={() => onToggle(id)} aria-label={L(`Bỏ ${s.name}`, `Remove ${s.name}`)} style={{ width: 20, height: 20, borderRadius: 999, border: 0, background: 'rgba(255,255,255,.12)', color: 'var(--cc7d2fe)', cursor: 'pointer', fontSize: 12, lineHeight: 1, padding: 0 }}>✕</button>
              </span>
            );
          })}
          <span style={{ fontSize: 12.5, color: 'var(--c94a3b8)', marginLeft: 4 }}>= {mins(selected)}′{hasPrice ? ` · ${money(cents(selected))}` : ''}</span>
        </div>
      )}

      <div style={{ position: 'relative' }}>
        <span style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: 'var(--c64748b)', fontSize: 14, pointerEvents: 'none' }}>🔍</span>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={L('Gõ tên dịch vụ… (gel, pedi, dip)', 'Type a service… (gel, pedi, dip)')} aria-label={L('Tìm dịch vụ', 'Search services')} style={{ ...ui.input, paddingLeft: 32 }} />
      </div>

      {!term && (cats.length > 0 || fav.length > 0) && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {fav.length > 0 && <TabBtn on={active === '__fav'} onClick={() => setTab('__fav')}>★ {L('Hay làm', 'Her usual')}</TabBtn>}
          {cats.map((c) => <TabBtn key={c} on={active === c} onClick={() => setTab(c)}>{c}</TabBtn>)}
          <TabBtn on={active === '__all'} onClick={() => setTab('__all')}>{L('Tất cả', 'All')} <span style={{ opacity: 0.7, fontWeight: 500 }}>{usable.length}</span></TabBtn>
        </div>
      )}

      <div style={{ maxHeight, overflowY: 'auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 8, paddingRight: 2 }}>
        {shown.length === 0 && <span style={{ color: 'var(--c94a3b8)', fontSize: 13, padding: '6px 2px' }}>{term ? L('Không có dịch vụ nào khớp.', 'No service matches.') : L('Chưa có dịch vụ trong nhóm này.', 'Nothing in this group yet.')}</span>}
        {shown.map((s) => {
          const on = selected.includes(s.id);
          return (
            <button key={s.id} type="button" onClick={() => onToggle(s.id)} aria-pressed={on}
              style={{ display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left', padding: '9px 10px 9px 12px', borderRadius: 11, cursor: 'pointer', fontFamily: 'inherit', minHeight: 54,
                border: `1px solid ${on ? '#6366f1' : 'var(--c334155)'}`, background: on ? 'var(--c312e81)' : 'var(--c0f172a)' }}>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 13.5, fontWeight: 700, color: on ? 'var(--cc7d2fe)' : 'var(--ce2e8f0)', lineHeight: 1.25 }}>{s.name}</span>
                <span style={{ display: 'block', fontSize: 12, color: on ? 'var(--cc7d2fe)' : 'var(--c94a3b8)', marginTop: 2, opacity: on ? 0.85 : 1 }}>
                  {s.durationMinutes}′{typeof s.priceCents === 'number' ? ` · ${money(s.priceCents)}` : ''}{s.walkInOnly ? ` · ${L('chỉ walk-in', 'walk-in only')}` : ''}
                </span>
              </span>
              <span aria-hidden="true" style={{ width: 28, height: 28, borderRadius: 8, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, fontWeight: 800, flexShrink: 0, background: on ? '#6366f1' : 'transparent', color: on ? '#fff' : 'var(--ink-link)', border: on ? 0 : '1px solid var(--c334155)' }}>{on ? '✓' : '+'}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function TabBtn({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} style={{ height: 30, padding: '0 12px', borderRadius: 999, border: `1px solid ${on ? '#6366f1' : 'var(--c334155)'}`, background: on ? '#6366f1' : 'transparent', color: on ? '#fff' : 'var(--ccbd5e1)', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
      {children}
    </button>
  );
}

const ghost: React.CSSProperties = { height: 30, padding: '0 10px', borderRadius: 8, border: '1px solid var(--c334155)', background: 'transparent', color: 'var(--ccbd5e1)', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap', flexShrink: 0 };
