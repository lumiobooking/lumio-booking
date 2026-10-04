'use client';

import { useMemo, useState, type CSSProperties } from 'react';
import { ui, formatPrice } from '../../../lib/ui';
import { PartyChip } from '../../../components/PartyChip';

/**
 * The walk-in board, two more ways of looking at the same data the list shows.
 *
 *   FloorStats  — one strip on top: how many wait, how many are in a chair,
 *                 who is free, who is up next, and the one customer who has
 *                 waited too long (tap → their row).
 *   TechBoard   — "Theo thợ": a column per technician with what she is doing
 *                 now, the queue in its own column on the left. Assign by the
 *                 button on each card (works with a finger, on an iPad, with
 *                 any number of techs) or by dragging a card onto a column
 *                 (a mouse at the front desk).
 *
 * Nothing here talks to the API: the page passes its own actions in, so the
 * rules (legs, skills, pay guard) stay where they are.
 */

import { fmtTurns, floorSummary, LONG_WAIT_MIN, mins, techColor, techsOn, type BoardData, type BoardWalkIn } from '../../../lib/walkin-floor';

export type { BoardData } from '../../../lib/walkin-floor';

export function FloorStats({ board, vi, onLongest }: { board: BoardData; vi: boolean; onLongest: (id: string) => void }) {
  const L = (v: string, e: string) => (vi ? v : e);
  const s = floorSummary(board);
  const stat = (n: number | string, label: string, tone?: string) => (
    <div style={{ display: 'grid', gap: 1, minWidth: 0 }}>
      <span style={{ fontSize: 22, fontWeight: 800, lineHeight: 1.1, color: tone ?? 'var(--cf8fafc)', fontVariantNumeric: 'tabular-nums' }}>{n}</span>
      <span style={{ fontSize: 12, color: 'var(--c94a3b8)', whiteSpace: 'nowrap' }}>{label}</span>
    </div>
  );
  return (
    <div style={{ ...ui.card, padding: '12px 16px', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 22, flexWrap: 'wrap' }}>
      {stat(s.waiting, L('Đang chờ', 'Waiting'), s.waiting ? 'var(--ink-warn)' : undefined)}
      {stat(s.inChair, L('Đang làm', 'In a chair'), s.inChair ? 'var(--ink-good)' : undefined)}
      {s.between > 0 && stat(s.between, L('Chờ phần tiếp', 'Between parts'), 'var(--ink-warn)')}
      {stat(`${s.free}/${board.staff.length}`, L('Thợ rảnh', 'Techs free'))}
      {s.next && (
        <div style={{ display: 'grid', gap: 1, minWidth: 0 }}>
          <span style={{ fontSize: 15, fontWeight: 800, color: 'var(--ink-good)', whiteSpace: 'nowrap', lineHeight: 1.45 }}>● {s.next.name}</span>
          <span style={{ fontSize: 12, color: 'var(--c94a3b8)' }}>{L('Tới lượt', 'Up next')}</span>
        </div>
      )}
      {s.longest && (
        <button type="button" onClick={() => onLongest(s.longest!.w.id)}
          style={{ marginLeft: 'auto', border: '1px solid #f59e0b', background: 'var(--wash-amber-2)', color: 'var(--ink-warn)', borderRadius: 999, padding: '7px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>
          ⚠ {(s.longest.w.customerName || L('Khách', 'A client'))} {L('chờ', 'waiting')} {s.longest.m}′
        </button>
      )}
    </div>
  );
}

export function TechBoard({ board, vi, currency, isMobile, onAssign, onOpen, onCancel, focusId }: {
  board: BoardData; vi: boolean; currency: string; isMobile: boolean;
  onAssign: (walkInId: string, staffId: string) => void;
  onOpen: (walkInId: string) => void;
  onCancel: (walkInId: string) => void;
  focusId?: string | null;
}) {
  const L = (v: string, e: string) => (vi ? v : e);
  const { staff, nextUpStaffId } = board;
  const [pick, setPick] = useState<Record<string, string>>({});
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  const between = board.serving.filter((w) => w.phase === 'BETWEEN');
  const byTech = useMemo(() => {
    const m = new Map<string, BoardWalkIn[]>();
    for (const w of board.serving) for (const id of techsOn(w)) m.set(id, [...(m.get(id) ?? []), w]);
    return m;
  }, [board.serving]);

  const colW = isMobile ? 'min(84vw, 320px)' : 'minmax(220px, 1fr)';
  const queue = [...board.waiting, ...between];

  const waitCard = (w: BoardWalkIn) => {
    const isBetween = w.phase === 'BETWEEN';
    const waited = mins(isBetween ? (w.assignedAt ?? w.createdAt) : w.createdAt);
    const sel = pick[w.id] ?? nextUpStaffId ?? '';
    const names = (w.items ?? []).map((i) => i.name).join(' · ') || w.service?.name || L('Chưa chọn dịch vụ', 'No service yet');
    const late = waited >= LONG_WAIT_MIN;
    return (
      <div key={w.id} draggable={!isMobile && !isBetween} onDragStart={(e) => { setDragId(w.id); e.dataTransfer.setData('text/plain', w.id); e.dataTransfer.effectAllowed = 'move'; }}
        onDragEnd={() => { setDragId(null); setOverId(null); }}
        style={{ ...card, cursor: !isMobile && !isBetween ? 'grab' : 'default', opacity: dragId === w.id ? 0.5 : 1,
          outline: focusId === w.id ? '2px solid #f59e0b' : 'none', outlineOffset: 2 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <b style={{ fontSize: 14, color: 'var(--cf1f5f9)', minWidth: 0, flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {w.customerName || 'Walk-in'}{!w.group && w.partySize > 1 ? ` · ${w.partySize}` : ''}
          </b>
          <PartyChip group={w.group} />
          <span style={{ fontSize: 12, fontWeight: 700, color: late ? 'var(--ink-bad)' : 'var(--c94a3b8)', whiteSpace: 'nowrap', flexShrink: 0 }}>⏱ {waited}′</span>
          {!isBetween && (
            <button type="button" onClick={() => onCancel(w.id)} aria-label={L('Huỷ', 'Cancel')} title={L('Huỷ khách này', 'Cancel this walk-in')}
              style={{ flexShrink: 0, width: 26, height: 26, display: 'grid', placeItems: 'center', borderRadius: 8, border: '1px solid var(--line)', background: 'transparent', color: 'var(--ink-bad)', fontSize: 12, lineHeight: 1, cursor: 'pointer', padding: 0 }}>✕</button>
          )}
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--c94a3b8)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{names}</div>
        {isBetween ? (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--ink-warn)', flex: '1 1 0', minWidth: 0 }}>⏸ {L('Xong phần đầu, chờ thợ', 'Part done, needs a tech')}</span>
            <button type="button" onClick={() => onOpen(w.id)} style={ghostBtn}>{L('Giao phần', 'Assign part')} ›</button>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <select value={sel} onChange={(e) => setPick({ ...pick, [w.id]: e.target.value })} aria-label={L('Chọn thợ', 'Pick a tech')}
              style={{ ...ui.input, padding: '7px 8px', fontSize: 12.5, flex: '1 1 0', minWidth: 0, width: 0, boxSizing: 'border-box' }}>
              <option value="">{L('Chọn thợ…', 'Pick a tech…')}</option>
              {staff.map((s) => <option key={s.id} value={s.id}>{s.name}{s.nextUp ? ' ★' : s.busy ? ' ·' : ''}</option>)}
            </select>
            <button type="button" disabled={!sel} onClick={() => sel && onAssign(w.id, sel)}
              style={{ ...ui.primaryBtn, padding: '8px 12px', fontSize: 13, opacity: sel ? 1 : 0.5, flexShrink: 0, whiteSpace: 'nowrap' }}>
              {L('Giao', 'Assign')}
            </button>
            <button type="button" onClick={() => onOpen(w.id)} aria-label={L('Chi tiết', 'Details')} title={L('Chi tiết', 'Details')} style={{ ...ghostBtn, padding: '7px 9px', flexShrink: 0 }}>⋯</button>
          </div>
        )}
      </div>
    );
  };

  const chairCard = (w: BoardWalkIn, techId: string) => {
    const legs = (w.legs ?? []).filter((l) => !l.legacy || l.lineIds.length > 0);
    const mine = legs.find((l) => l.status === 'SERVING' && l.staffId === techId);
    const part = legs.length > 1 && mine ? (mine.zone === 'HAND' ? L('✋ Tay', '✋ Hands') : mine.zone === 'FOOT' ? L('🦶 Chân', '🦶 Feet') : mine.names[0]) : null;
    const total = (w.items ?? []).reduce((s, i) => s + (i.priceCents || 0), 0);
    const names = (w.items ?? []).map((i) => i.name).join(' · ') || w.service?.name || '—';
    const href = `/salon/pos?walkInId=${w.id}&serviceId=${w.service?.id ?? ''}&staffId=${w.assignedStaff?.id ?? ''}&customerId=${w.customerId ?? ''}&customer=${encodeURIComponent(w.customerName || '')}`;
    return (
      <div key={w.id + techId} style={{ ...card, boxShadow: `inset 3px 0 0 ${techColor(staff, techId)}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <b style={{ fontSize: 14, color: 'var(--cf1f5f9)', minWidth: 0, flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{w.customerName || 'Walk-in'}</b>
          <PartyChip group={w.group} />
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-good)', whiteSpace: 'nowrap' }}>{formatPrice(total, currency)}</span>
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--c94a3b8)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {part ? <b style={{ color: 'var(--ccbd5e1)' }}>{part} · </b> : null}{names}
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--c64748b)' }}>▶ {mins(w.assignedAt ?? w.createdAt)}′{w.station ? ` · ${L('Ghế', 'Chair')} ${w.station}` : ''}</div>
        <div style={{ display: 'flex', gap: 6 }}>
          <a href={href} style={{ ...ui.primaryBtn, flex: 1, textAlign: 'center', textDecoration: 'none', padding: '8px 10px', fontSize: 13 }}>{L('Thu tiền', 'Checkout')}</a>
          <button type="button" onClick={() => onOpen(w.id)} style={ghostBtn}>{L('Chi tiết', 'Details')} ›</button>
        </div>
      </div>
    );
  };

  return (
    <div style={{ overflowX: 'auto', margin: isMobile ? '0 -14px' : 0, padding: isMobile ? '0 14px 6px' : '0 0 6px', scrollSnapType: isMobile ? 'x mandatory' : undefined, WebkitOverflowScrolling: 'touch' }}>
      <div style={{ display: 'grid', gridAutoFlow: 'column', gridAutoColumns: colW, gridTemplateColumns: isMobile ? undefined : `minmax(270px, 1.2fr)`, gap: 12, alignItems: 'start', minWidth: isMobile ? undefined : Math.min(270 + staff.length * 232, 99999) }}>
        {/* The queue */}
        <section style={{ ...col, background: 'var(--wash-amber-2)', scrollSnapAlign: 'start' }} aria-label={L('Chờ thợ', 'Waiting')}>
          <div style={colHead}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <b style={{ fontSize: 14, color: 'var(--cf1f5f9)' }}>{L('Chờ thợ', 'Waiting')}</b>
              <div style={{ fontSize: 11.5, color: 'var(--c94a3b8)' }}>{isMobile ? L('Bấm Giao để giao thợ', 'Tap Assign to seat') : L('Kéo thẻ sang cột thợ, hoặc bấm Giao', 'Drag onto a tech, or press Assign')}</div>
            </div>
            <span style={countDot(queue.length)}>{queue.length}</span>
          </div>
          {queue.length === 0 && <div style={emptyBox}>{L('Không có khách chờ', 'No one waiting')}</div>}
          {queue.map(waitCard)}
        </section>

        {/* One column per technician */}
        {staff.map((s) => {
          const jobs = byTech.get(s.id) ?? [];
          const color = techColor(staff, s.id);
          const over = overId === s.id && !!dragId;
          return (
            <section key={s.id} aria-label={s.name}
              onDragOver={(e) => { if (dragId) { e.preventDefault(); setOverId(s.id); } }}
              onDragLeave={() => setOverId((v) => (v === s.id ? null : v))}
              onDrop={(e) => { e.preventDefault(); const id = e.dataTransfer.getData('text/plain') || dragId; setOverId(null); setDragId(null); if (id) onAssign(id, s.id); }}
              style={{ ...col, scrollSnapAlign: 'start', outline: over ? `2px dashed ${color}` : 'none', outlineOffset: -2 }}>
              <div style={colHead}>
                <span style={{ width: 32, height: 32, borderRadius: '50%', background: color, color: '#ffffff', fontWeight: 800, fontSize: 13, display: 'grid', placeItems: 'center', flexShrink: 0 }}>{s.name.slice(0, 1).toUpperCase()}</span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                    <b style={{ fontSize: 14, color: 'var(--cf1f5f9)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.name}</b>
                    {s.nextUp && <span style={{ fontSize: 10, fontWeight: 800, color: 'var(--ink-good)', background: 'var(--c052e16)', borderRadius: 6, padding: '1px 6px', whiteSpace: 'nowrap' }}>{L('TỚI LƯỢT', 'UP NEXT')}</span>}
                  </div>
                  <div style={{ fontSize: 11.5, color: s.busy ? 'var(--ink-warn)' : 'var(--c94a3b8)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {s.busy ? (s.busyFor != null ? L(`Đang làm · còn ~${s.busyFor}′`, `Busy · free in ~${s.busyFor}′`) : L('Đang làm', 'Busy')) : L('Rảnh', 'Free')}
                  </div>
                </div>
                <span title={L('Lượt hôm nay', 'Turns today')} style={{ fontSize: 12, fontWeight: 800, padding: '3px 9px', borderRadius: 999, background: color, color: '#ffffff', whiteSpace: 'nowrap', flexShrink: 0 }}>{fmtTurns(s.turns)}</span>
              </div>
              {jobs.length === 0 && <div style={emptyBox}>{over ? L('Thả để giao', 'Drop to assign') : s.busy ? L('Đang làm khách khác', 'With another client') : L('Rảnh · nhận khách tiếp theo', 'Free · ready for the next client')}</div>}
              {jobs.map((w) => chairCard(w, s.id))}
            </section>
          );
        })}
      </div>
    </div>
  );
}

const col: CSSProperties = { background: 'var(--c0f172a)', border: '1px solid var(--line)', borderRadius: 16, padding: 10, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 8, alignContent: 'start', minWidth: 0 };
const colHead: CSSProperties = { display: 'flex', alignItems: 'center', gap: 9, padding: '2px 2px 4px', minWidth: 0 };
const card: CSSProperties = { background: 'var(--c111827)', border: '1px solid var(--line)', borderRadius: 12, padding: '10px 11px', display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 6, minWidth: 0 };
const emptyBox: CSSProperties = { border: '1.5px dashed var(--c334155)', borderRadius: 12, padding: '14px 10px', textAlign: 'center', fontSize: 12.5, color: 'var(--c94a3b8)' };
const ghostBtn: CSSProperties = { padding: '7px 10px', background: 'transparent', border: '1px solid var(--c334155)', borderRadius: 8, color: 'var(--ccbd5e1)', cursor: 'pointer', fontSize: 12.5, whiteSpace: 'nowrap' };
const countDot = (n: number): CSSProperties => ({
  minWidth: 24, height: 24, padding: '0 7px', borderRadius: 999, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  fontSize: 12, fontWeight: 700, background: n > 0 ? '#4f46e5' : 'var(--c1e293b)', color: n > 0 ? '#ffffff' : 'var(--c64748b)', flexShrink: 0,
});
