'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../../lib/auth';
import { apiFetch } from '../../../lib/api';
import { ui, formatPrice } from '../../../lib/ui';
import { useLang, tr } from '../../../lib/i18n';

interface Addon { id: string; name: string; priceCents: number; kind?: string }
interface Booking {
  id: string;
  status: string;
  startTime: string;
  endTime: string;
  priceCents: number;
  currency: string;
  notes: string | null;
  source?: string | null;
  partySize?: number;
  addons?: Addon[];
  payments?: { status: string; amountCents: number }[];
  customer: { id: string; firstName: string; lastName: string | null; email: string | null; phone: string | null } | null;
  service: { id: string; name: string; durationMinutes: number } | null;
  assignedStaff: { id: string; firstName: string; lastName: string | null } | null;
  tableId?: string | null;
  table?: { id: string; name: string; seats: number } | null;
}
interface TableLite { id: string; name: string; seats: number; area: string | null; isActive: boolean; sortOrder: number }

const STATUS_COLOR: Record<string, string> = {
  PENDING: '#f59e0b', ASSIGNED: '#f59e0b', REJECTED: '#f59e0b',
  ACCEPTED: '#3b82f6', CONFIRMED: '#3b82f6',
  ARRIVED: '#10b981', COMPLETED: '#8b5cf6', NO_SHOW: '#ef4444', CANCELLED: '#64748b',
};
const sc = (s: string) => STATUS_COLOR[s] ?? '#f59e0b';
const paidOf = (b: Booking) => (b.payments ?? []).filter((p) => p.status === 'PAID').reduce((s, p) => s + p.amountCents, 0);

// Restaurant day view: one column per table (the "resource"), an "unassigned"
// lane for reservations not yet seated. Drag a card onto a table to re-seat.
export function TableDayView({ date, items, tz, isMobile, onOpen, today, onChanged }: {
  date: Date; items: Booking[]; tz?: string; isMobile: boolean; onOpen: (b: Booking) => void; today: Date; onChanged?: () => void;
}) {
  const { token } = useAuth();
  const { lang } = useLang();
  const t = (k: string) => tr(k, lang);
  const [tables, setTables] = useState<TableLite[]>([]);
  const [focus, setFocus] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadTables = useCallback(() => {
    if (!token) return;
    apiFetch<TableLite[]>('/tables', { token }).then(setTables).catch(() => undefined);
  }, [token]);
  useEffect(() => { loadTables(); }, [loadTables]);

  const fmtT = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', ...(tz ? { timeZone: tz } : {}) });
  const minInTz = (iso: string) => {
    const d = new Date(iso);
    if (!tz) return d.getHours() * 60 + d.getMinutes();
    const p = new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz }).formatToParts(d);
    return (Number(p.find((x) => x.type === 'hour')?.value ?? 0) % 24) * 60 + Number(p.find((x) => x.type === 'minute')?.value ?? 0);
  };

  const isToday = date.getTime() === today.getTime();
  const currency = items[0]?.currency ?? 'USD';
  const revenue = items.reduce((s, b) => s + (b.status === 'CANCELLED' || b.status === 'NO_SHOW' ? 0 : b.priceCents), 0);
  const covers = items.reduce((s, b) => s + (b.status === 'CANCELLED' || b.status === 'NO_SHOW' ? 0 : (b.partySize ?? 1)), 0);

  const activeTables = useMemo(
    () => tables.filter((tb) => tb.isActive).sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)),
    [tables],
  );

  const columns = useMemo(() => {
    const byTable = new Map<string, Booking[]>();
    const unassigned: Booking[] = [];
    for (const b of items) {
      const id = b.table?.id;
      if (!id) { unassigned.push(b); continue; }
      const arr = byTable.get(id) ?? [];
      arr.push(b); byTable.set(id, arr);
    }
    const seen = new Set<string>();
    const cols: { id: string; name: string; seats: number | null; items: Booking[] }[] = [];
    for (const tb of activeTables) {
      seen.add(tb.id);
      cols.push({ id: tb.id, name: tb.name, seats: tb.seats, items: byTable.get(tb.id) ?? [] });
    }
    for (const [id, arr] of byTable) {
      if (seen.has(id)) continue;
      cols.push({ id, name: arr[0].table?.name ?? '—', seats: arr[0].table?.seats ?? null, items: arr });
    }
    const shown = focus ? cols.filter((c) => c.id === focus) : cols;
    return (!focus && unassigned.length)
      ? [{ id: '__un', name: t('cal.unassignedCol'), seats: null, items: unassigned }, ...shown]
      : shown;
  }, [items, activeTables, focus, t]);

  let startH = 10, endH = 22;
  for (const b of items) {
    const s = minInTz(b.startTime);
    let e = minInTz(b.endTime); if (e <= s) e = s + 30;
    startH = Math.min(startH, Math.floor(s / 60));
    endH = Math.max(endH, Math.ceil(e / 60));
  }
  startH = Math.max(7, startH); endH = Math.min(24, Math.max(endH, startH + 4));
  const gStart = startH * 60;
  const HP = isMobile ? 52 : 62;
  const railW = 50;
  const colW = isMobile ? 138 : 168;
  const headH = 46;
  const total = (endH - startH) * HP;
  const nowMin = isToday ? minInTz(new Date().toISOString()) : -1;
  const nowTop = nowMin >= gStart && nowMin <= endH * 60 ? (nowMin - gStart) / 60 * HP : -1;

  const place = (list: Booking[]) => {
    const ev = list.map((b) => {
      const s = minInTz(b.startTime);
      let e = minInTz(b.endTime); if (e <= s) e = s + (b.service?.durationMinutes || 90);
      return { b, s, e };
    }).sort((a, z) => a.s - z.s || a.e - z.e);
    type P = { b: Booking; s: number; e: number; col: number; cols: number };
    const out: P[] = [];
    let cluster: { b: Booking; s: number; e: number; col: number }[] = [];
    let clusterEnd = -1;
    const laneEnds: number[] = [];
    const flush = () => {
      const cols = Math.max(1, ...cluster.map((c) => c.col + 1));
      for (const c of cluster) out.push({ ...c, cols });
      cluster = []; laneEnds.length = 0;
    };
    for (const x of ev) {
      if (cluster.length && x.s >= clusterEnd) flush();
      let col = laneEnds.findIndex((end) => end <= x.s);
      if (col === -1) { col = laneEnds.length; laneEnds.push(x.e); } else laneEnds[col] = x.e;
      cluster.push({ b: x.b, s: x.s, e: x.e, col });
      clusterEnd = cluster.length === 1 ? x.e : Math.max(clusterEnd, x.e);
    }
    if (cluster.length) flush();
    return out;
  };

  const reassign = async (bookingId: string, tableId: string, tableName: string) => {
    setBusy(true); setNote(null);
    try {
      await apiFetch(`/bookings/${bookingId}/table`, { method: 'POST', token, body: { tableId } });
      setNote(t('cal.reassigned').replace('{name}', tableName));
      onChanged?.();
    } catch (e) {
      setNote(e instanceof Error ? e.message : t('cal.reassignFail'));
    } finally {
      setBusy(false); setDragId(null); setOverCol(null);
      setTimeout(() => setNote(null), 2600);
    }
  };
  const onDrop = (col: { id: string; name: string; items: Booking[] }) => {
    const id = dragId; setDragId(null); setOverCol(null);
    if (!id || col.id === '__un') return;
    const b = items.find((x) => x.id === id);
    if (!b || b.table?.id === col.id) return;
    reassign(id, col.id, col.name);
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10, padding: '10px 14px', background: '#111827', border: '1px solid #1f2937', borderRadius: 10 }}>
        <span style={{ fontSize: 14 }}><strong style={{ fontSize: 18 }}>{items.length}</strong> <span style={{ color: '#94a3b8' }}>{t('cal.reservations')}</span></span>
        <span style={{ color: '#334155' }}>|</span>
        <span style={{ fontSize: 14 }}><span style={{ color: '#94a3b8' }}>{t('cal.covers')}: </span><strong style={{ color: '#e2e8f0' }}>{covers}</strong></span>
        <span style={{ color: '#334155' }}>|</span>
        <span style={{ fontSize: 14 }}><span style={{ color: '#94a3b8' }}>{t('cal.expected')}: </span><strong style={{ color: '#22c55e' }}>{formatPrice(revenue, currency)}</strong></span>
        {note && <span style={{ marginLeft: 'auto', fontSize: 13, color: '#a7f3d0', background: '#064e3b', padding: '3px 10px', borderRadius: 6 }}>{note}</span>}
      </div>

      {activeTables.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10, alignItems: 'center' }}>
          <button onClick={() => setFocus(null)} style={chip(!focus)}>{t('cal.allTables')}</button>
          {activeTables.map((tb) => (
            <button key={tb.id} onClick={() => setFocus(focus === tb.id ? null : tb.id)} style={chip(focus === tb.id)}>{tb.name}</button>
          ))}
          <span style={{ fontSize: 11.5, color: '#64748b', marginLeft: 6 }}>{t('cal.dragTableHint')}</span>
        </div>
      )}

      {activeTables.length === 0 ? (
        <div style={{ ...ui.card, textAlign: 'center', color: '#64748b', padding: '30px 16px', fontSize: 14 }}>{t('cal.noTables')}</div>
      ) : items.length === 0 ? (
        <div style={{ ...ui.card, textAlign: 'center', color: '#64748b', padding: '44px 0', fontSize: 14 }}>{t('cal.noAppts')}</div>
      ) : (
        <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch', border: '1px solid #1f2937', borderRadius: 12, background: '#0f172a', opacity: busy ? 0.6 : 1, transition: 'opacity .15s' }}>
          <div style={{ position: 'relative', display: 'flex', minWidth: railW + columns.length * colW }}>
            <div style={{ position: 'sticky', left: 0, zIndex: 4, width: railW, flexShrink: 0, background: '#0f172a', borderRight: '1px solid #1f2937' }}>
              <div style={{ height: headH }} />
              <div style={{ position: 'relative', height: total }}>
                {Array.from({ length: endH - startH + 1 }, (_, i) => startH + i).map((h) => (
                  <div key={h} style={{ position: 'absolute', top: (h - startH) * HP - 6, right: 7, fontSize: 11, color: '#64748b' }}>
                    {((h % 12) || 12)}{h < 12 || h === 24 ? 'a' : 'p'}
                  </div>
                ))}
              </div>
            </div>

            {columns.map((c) => {
              const pos = place(c.items);
              const un = c.id === '__un';
              const isTarget = overCol === c.id && !un && dragId !== null;
              return (
                <div key={c.id}
                  onDragOver={(e) => { if (!un && dragId) { e.preventDefault(); setOverCol(c.id); } }}
                  onDragLeave={() => setOverCol((o) => (o === c.id ? null : o))}
                  onDrop={(e) => { e.preventDefault(); onDrop(c); }}
                  style={{ width: colW, flexShrink: 0, borderRight: '1px solid #1f2937', background: isTarget ? 'rgba(99,102,241,0.12)' : un ? 'rgba(99,102,241,0.05)' : 'transparent', outline: isTarget ? '2px dashed #6366f1' : 'none', outlineOffset: -2 }}>
                  <div style={{ height: headH, display: 'flex', alignItems: 'center', gap: 8, padding: '0 10px', borderBottom: '1px solid #1f2937', boxSizing: 'border-box' }}>
                    <div style={{ width: 30, height: 26, borderRadius: 6, flexShrink: 0, background: un ? '#334155' : '#1e293b', border: '1px solid #334155', color: '#e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700 }}>
                      {un ? '?' : (c.seats ?? '')}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 700, color: '#e2e8f0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.name}</div>
                      <div style={{ fontSize: 10.5, color: '#64748b' }}>{un ? c.items.length + ' ' + t('cal.reservations') : (c.seats ?? '?') + ' ' + t('cal.seats')}</div>
                    </div>
                  </div>
                  <div style={{ position: 'relative', height: total }}>
                    {Array.from({ length: endH - startH }, (_, i) => i + 1).map((i) => (
                      <div key={i} style={{ position: 'absolute', top: i * HP, left: 0, right: 0, borderTop: '1px solid #1e293b' }} />
                    ))}
                    {pos.map(({ b, s, e, col, cols }) => {
                      const cc = sc(b.status);
                      const topPx = (s - gStart) / 60 * HP;
                      const h = Math.max(38, (e - s) / 60 * HP - 3);
                      const dim = b.status === 'CANCELLED' || b.status === 'NO_SHOW';
                      const w = 100 / cols;
                      const paid = paidOf(b);
                      return (
                        <div key={b.id} draggable={!dim} onDragStart={(ev) => { setDragId(b.id); ev.dataTransfer.effectAllowed = 'move'; ev.dataTransfer.setData('text/plain', b.id); }} onDragEnd={() => { setDragId(null); setOverCol(null); }}
                          onClick={() => onOpen(b)} title={`${fmtT(b.startTime)} · ${b.customer?.firstName ?? ''} · ${b.partySize ?? 1}p`}
                          style={{ position: 'absolute', top: topPx, height: h, left: `calc(${col * w}% + 3px)`, width: `calc(${w}% - 6px)`, boxSizing: 'border-box', background: dim ? '#18202f' : `${cc}22`, border: `1px solid ${cc}66`, borderRadius: 8, padding: '3px 7px', overflow: 'hidden', cursor: dim ? 'pointer' : 'grab', opacity: dim ? 0.7 : dragId === b.id ? 0.4 : 1 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 4 }}>
                            <span style={{ fontSize: 10.5, fontWeight: 700, color: cc, whiteSpace: 'nowrap' }}>{fmtT(b.startTime)}</span>
                            <span style={{ fontSize: 10.5, fontWeight: 700, color: '#e2e8f0', background: '#334155', borderRadius: 4, padding: '0 5px', whiteSpace: 'nowrap' }}>{b.partySize ?? 1}p</span>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 4 }}>
                            <span style={{ fontSize: 12, fontWeight: 700, color: '#e2e8f0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', textDecoration: b.status === 'CANCELLED' ? 'line-through' : 'none' }}>
                              {b.customer ? `${b.customer.firstName}${b.customer.lastName ? ' ' + b.customer.lastName : ''}` : '—'}
                            </span>
                            {paid > 0 && <span title={formatPrice(paid, b.currency)} style={{ width: 7, height: 7, borderRadius: '50%', background: '#22c55e', flexShrink: 0 }} />}
                          </div>
                          {h > 48 && b.priceCents > 0 && <div style={{ fontSize: 11, color: '#94a3b8', whiteSpace: 'nowrap' }}>{formatPrice(b.priceCents, b.currency)}</div>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}

            {nowTop >= 0 && (
              <div style={{ position: 'absolute', top: headH + nowTop, left: railW, right: 0, height: 0, borderTop: '2px solid #ef4444', zIndex: 5, pointerEvents: 'none' }}>
                <span style={{ position: 'absolute', left: 0, top: -4, width: 7, height: 7, borderRadius: '50%', background: '#ef4444' }} />
              </div>
            )}
          </div>
        </div>
      )}
      <p style={{ color: '#64748b', fontSize: 12, marginTop: 10 }}>{t('cal.staffHint')}</p>
    </div>
  );
}

function chip(active: boolean): React.CSSProperties {
  return { padding: '4px 11px', borderRadius: 999, fontSize: 12, cursor: 'pointer', fontWeight: 600, border: `1px solid ${active ? '#6366f1' : '#334155'}`, background: active ? '#6366f1' : 'transparent', color: active ? '#fff' : '#94a3b8' };
}
