'use client';

/**
 * "Sắp xếp thợ" — board 3B of the approved calendar canvas. The list to drag
 * the technicians into the order of the calendar's columns, and to switch a
 * technician off the calendar. Works with a finger (iPad, phone), where
 * dragging a column header sideways does not. Saved for the whole salon
 * (api calendar-layout); only the owner and managers see the button.
 */
import { useEffect, useRef, useState } from 'react';
import { moveTo } from '../../../lib/staff-order';

export interface SheetStaff { id: string; name: string; avatar: string | null; hue: string; count: number }

const ROW = 56;
const GAP = 8;

export function StaffOrderSheet({ staff, hidden: hidden0, vi, mobile, onClose, onSave }: {
  /** Everyone bookable, in the calendar's current order (hidden ones included). */
  staff: SheetStaff[];
  hidden: string[];
  vi: boolean;
  mobile: boolean;
  onClose: () => void;
  onSave: (order: string[], hidden: string[]) => Promise<void>;
}) {
  const L = (v: string, e: string) => (vi ? v : e);
  const [ids, setIds] = useState(() => staff.map((s) => s.id));
  const [hidden, setHidden] = useState<string[]>(hidden0);
  const [drag, setDrag] = useState<{ id: string; startY: number; base: number; dy: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const byId = new Map(staff.map((s) => [s.id, s]));
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const down = (e: React.PointerEvent, id: string) => {
    e.preventDefault();
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* old Safari */ }
    setDrag({ id, startY: e.clientY, base: ids.indexOf(id), dy: 0 });
  };
  const move = (e: React.PointerEvent) => {
    if (!drag) return;
    const dy = e.clientY - drag.startY;
    const target = Math.max(0, Math.min(ids.length - 1, drag.base + Math.round(dy / (ROW + GAP))));
    if (ids.indexOf(drag.id) !== target) setIds((list) => moveTo(list, drag.id, target));
    setDrag({ ...drag, dy });
  };
  const up = () => setDrag(null);

  const toggle = (id: string) => setHidden((h) => (h.includes(id) ? h.filter((x) => x !== id) : [...h, id]));
  const sortAZ = () => setIds((list) => list.slice().sort((a, b) => (byId.get(a)?.name ?? '').localeCompare(byId.get(b)?.name ?? '')));
  const sortBusy = () => setIds((list) => list.slice().sort((a, b) => (byId.get(b)?.count ?? 0) - (byId.get(a)?.count ?? 0) || (byId.get(a)?.name ?? '').localeCompare(byId.get(b)?.name ?? '')));

  const save = async () => {
    setBusy(true); setErr(null);
    try { await onSave(ids, hidden); onClose(); }
    catch (e) { setErr(e instanceof Error ? e.message : L('Không lưu được, thử lại', 'Could not save, try again')); }
    finally { setBusy(false); }
  };

  return (
    <div role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: 'fixed', inset: 0, zIndex: 90, background: 'rgba(2,6,23,0.45)', display: 'flex', alignItems: mobile ? 'flex-end' : 'center', justifyContent: 'center' }}>
      <div role="dialog" aria-modal="true" aria-label={L('Sắp xếp thợ', 'Arrange technicians')}
        style={{ width: mobile ? '100%' : 440, maxHeight: mobile ? '88vh' : '86vh', boxSizing: 'border-box', background: 'var(--c111827)', color: 'var(--ce2e8f0)', borderRadius: mobile ? '18px 18px 0 0' : 16, boxShadow: '0 24px 60px rgba(15,23,42,0.3)', display: 'flex', flexDirection: 'column', overflow: 'hidden', paddingBottom: mobile ? 'env(safe-area-inset-bottom, 0px)' : 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '16px 18px 6px' }}>
          <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <b style={{ fontSize: 17, color: 'var(--cf1f5f9)' }}>{L('Sắp xếp thợ', 'Arrange technicians')}</b>
            <span style={{ fontSize: 12.5, color: 'var(--c94a3b8)' }}>{L('Kéo để đổi thứ tự cột trên lịch. Tắt để ẩn khỏi lịch.', 'Drag to change the order of the columns. Switch off to hide from the calendar.')}</span>
          </span>
          <button type="button" onClick={onClose} aria-label={L('Đóng', 'Close')} style={{ background: 'transparent', border: 0, color: 'var(--c94a3b8)', fontSize: 24, lineHeight: 1, cursor: 'pointer' }}>×</button>
        </div>

        <div ref={listRef} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
          style={{ padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: GAP, overflowY: drag ? 'hidden' : 'auto', touchAction: drag ? 'none' : 'pan-y' }}>
          {ids.map((id) => {
            const s = byId.get(id); if (!s) return null;
            const off = hidden.includes(id);
            const dragging = drag?.id === id;
            const offsetY = dragging ? drag.dy - (ids.indexOf(id) - drag.base) * (ROW + GAP) : 0;
            return (
              <div key={id} data-row={id}
                style={{ height: ROW, flexShrink: 0, boxSizing: 'border-box', borderRadius: 12, padding: '0 12px', display: 'flex', alignItems: 'center', gap: 10, position: 'relative', zIndex: dragging ? 2 : 1,
                  border: dragging ? '2px solid #7c3aed' : off ? '1px dashed var(--c475569)' : '1px solid var(--line)',
                  background: dragging ? 'color-mix(in srgb, #7c3aed 12%, var(--c111827))' : 'var(--c111827)',
                  boxShadow: dragging ? '0 10px 24px rgba(76,29,149,0.2)' : 'none',
                  transform: dragging ? `translate(6px, ${offsetY}px)` : 'none', transition: dragging ? 'none' : 'transform .15s',
                  opacity: off && !dragging ? 0.6 : 1 }}>
                <span onPointerDown={(e) => down(e, id)} aria-label={L(`Kéo để đổi chỗ ${s.name}`, `Drag to move ${s.name}`)} role="button"
                  style={{ color: dragging ? '#7c3aed' : 'var(--c94a3b8)', fontSize: 16, letterSpacing: -2, cursor: 'grab', touchAction: 'none', padding: '14px 6px 14px 0', userSelect: 'none' }}>⋮⋮</span>
                {s.avatar
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={s.avatar} alt="" style={{ width: 32, height: 32, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
                  : <span style={{ width: 32, height: 32, borderRadius: '50%', background: off ? 'var(--c475569)' : s.hue, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, flexShrink: 0 }}>{s.name.charAt(0).toUpperCase()}</span>}
                <span onPointerDown={(e) => down(e, id)} style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', cursor: 'grab', touchAction: 'none', userSelect: 'none' }}>
                  <b style={{ fontSize: 14.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.name}{dragging ? <span style={{ fontSize: 12, color: '#7c3aed', fontWeight: 600 }}> · {L('đang kéo', 'moving')}</span> : null}</b>
                  {off && <span style={{ fontSize: 11.5, color: 'var(--c94a3b8)' }}>{L('Ẩn trên lịch — vẫn nhận khách', 'Hidden on the calendar — still takes bookings')}</span>}
                </span>
                <button type="button" role="switch" aria-checked={!off} onClick={() => toggle(id)} aria-label={off ? L(`Hiện ${s.name} trên lịch`, `Show ${s.name}`) : L(`Ẩn ${s.name} khỏi lịch`, `Hide ${s.name}`)}
                  style={{ width: 44, height: 26, flexShrink: 0, borderRadius: 999, border: 0, padding: 0, background: off ? 'var(--c475569)' : '#4f46e5', position: 'relative', cursor: 'pointer' }}>
                  <span style={{ position: 'absolute', top: 3, left: off ? 3 : 21, width: 20, height: 20, borderRadius: '50%', background: '#ffffff', transition: 'left .15s' }} />
                </button>
              </div>
            );
          })}
        </div>

        <div style={{ padding: '6px 18px 4px', display: 'flex', gap: 8, fontSize: 12.5, flexWrap: 'wrap' }}>
          <span style={{ color: 'var(--c94a3b8)' }}>{L('Sắp nhanh:', 'Quick sort:')}</span>
          <button type="button" onClick={sortAZ} style={{ background: 'transparent', border: 0, padding: 0, color: 'var(--ink-link)', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', fontSize: 12.5 }}>A → Z</button>
          <span style={{ color: 'var(--c64748b)' }}>·</span>
          <button type="button" onClick={sortBusy} style={{ background: 'transparent', border: 0, padding: 0, color: 'var(--ink-link)', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', fontSize: 12.5 }}>{L('Ai nhiều hẹn trước', 'Busiest first')}</button>
        </div>
        {err && <div role="alert" style={{ margin: '6px 18px 0', fontSize: 13, color: 'var(--ink-bad)' }}>{err}</div>}
        <div style={{ padding: '12px 18px 16px', display: 'flex', gap: 10, borderTop: '1px solid var(--line)', marginTop: 10 }}>
          <button type="button" onClick={onClose} style={{ flex: 1, height: 46, borderRadius: 10, border: '1px solid var(--line-strong)', background: 'transparent', color: 'var(--ce2e8f0)', fontFamily: 'inherit', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>{L('Huỷ', 'Cancel')}</button>
          <button type="button" disabled={busy} onClick={() => void save()} style={{ flex: 2, height: 46, borderRadius: 10, border: 0, background: '#4f46e5', color: '#fff', fontFamily: 'inherit', fontSize: 14, fontWeight: 700, cursor: busy ? 'wait' : 'pointer', opacity: busy ? 0.7 : 1 }}>
            {busy ? L('Đang lưu…', 'Saving…') : L('Lưu cho cả tiệm', 'Save for the whole salon')}
          </button>
        </div>
      </div>
    </div>
  );
}
