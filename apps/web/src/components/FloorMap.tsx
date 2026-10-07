'use client';

/**
 * Restaurant floor map (API: GET /tables/floor, PATCH /tables/layout).
 * Every table on a 100×100 grid, painted by its state at a moment:
 * seated (a reservation running), soon (next one within the hour), free.
 * The owner can switch to "Arrange" and drag tables where they stand in the
 * room; the layout is stored per restaurant on the server.
 * Reservations with no table yet are listed beside the map: pick one, then
 * tap a table to seat it (POST /bookings/:id/table — the server refuses a
 * table already taken for that time).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '../lib/api';
import { clockIn } from '../lib/desk-time';
import { instantToWall, salonTz, wallToInstantISO } from '../lib/datetime';

type Shape = 'round' | 'square' | 'long';
interface Spot { x: number; y: number; shape: Shape }
interface Table { id: string; name: string; seats: number; area: string | null; isActive: boolean }
interface State {
  id: string; state: 'seated' | 'soon' | 'free';
  current: { name: string | null; party: number; until: string; preOrder?: string | null } | null;
  next: { name: string | null; party: number; at: string; preOrder?: string | null } | null;
}
interface Waiting { id: string; name: string | null; party: number; at: string; until: string; preOrder?: string | null }
interface Floor { at: string; tables: Table[]; layout: Record<string, Spot>; states: State[]; waiting?: Waiting[] }

const INK: Record<State['state'], string> = { seated: 'var(--ink-bad)', soon: 'var(--ink-warn)', free: 'var(--ink-good)' };
const SIZE: Record<Shape, { w: number; h: number; r: string }> = {
  round: { w: 62, h: 62, r: '50%' },
  square: { w: 66, h: 66, r: '10px' },
  long: { w: 112, h: 60, r: '10px' },
};

export function FloorMap({ token, vi, canArrange }: { token: string | null; vi: boolean; canArrange: boolean }) {
  const [floor, setFloor] = useState<Floor | null>(null);
  const [at, setAt] = useState<string | null>(null); // null = now (live)
  const [arrange, setArrange] = useState(false);
  const [draft, setDraft] = useState<Record<string, Spot>>({});
  const [dirty, setDirty] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [seat, setSeat] = useState<string | null>(null);
  const box = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{ id: string; dx: number; dy: number; moved: boolean } | null>(null);
  const dirtyRef = useRef(false);
  useEffect(() => { dirtyRef.current = dirty; }, [dirty]);
  const tz = salonTz();

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const q = at ? `?at=${encodeURIComponent(at)}` : '';
      const f = await apiFetch<Floor>(`/tables/floor${q}`, { token });
      setFloor(f);
      setDraft((d) => (dirtyRef.current ? d : f.layout));
      setErr(null);
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed to load'); }
  }, [token, at]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (at || arrange) return undefined;
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [at, arrange, load]);

  function onDown(e: React.PointerEvent<HTMLDivElement>, id: string) {
    if (!arrange || !box.current) return;
    const r = box.current.getBoundingClientRect();
    const s = draft[id]; if (!s) return;
    drag.current = { id, dx: e.clientX - (r.left + (s.x / 100) * r.width), dy: e.clientY - (r.top + (s.y / 100) * r.height), moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function onMove(e: React.PointerEvent<HTMLDivElement>) {
    const d = drag.current; if (!d || !box.current) return;
    const r = box.current.getBoundingClientRect();
    const x = Math.min(96, Math.max(0, ((e.clientX - d.dx - r.left) / r.width) * 100));
    const y = Math.min(92, Math.max(0, ((e.clientY - d.dy - r.top) / r.height) * 100));
    d.moved = true;
    setDraft((m) => ({ ...m, [d.id]: { ...m[d.id], x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 } }));
    setDirty(true);
  }
  function onUp(id: string) {
    if (!arrange) return;
    const d = drag.current; drag.current = null;
    if (!d || !d.moved) setPicked((p) => (p === id ? null : id));
  }

  async function save() {
    setSaving(true); setErr(null);
    try {
      const out = await apiFetch<{ layout: Record<string, Spot> }>('/tables/layout', { method: 'PATCH', token, body: { layout: draft } });
      setDraft(out.layout); setDirty(false); setArrange(false);
      await load();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed'); }
    finally { setSaving(false); }
  }
  async function seatAt(tableId: string) {
    if (!seat) return;
    setSaving(true); setErr(null);
    try {
      await apiFetch(`/bookings/${seat}/table`, { method: 'POST', token, body: { tableId } });
      setSeat(null);
      await load();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed'); }
    finally { setSaving(false); }
  }
  function cancel() { setDirty(false); setArrange(false); if (floor) setDraft(floor.layout); }
  function setShape(id: string, shape: Shape) { setDraft((m) => ({ ...m, [id]: { ...m[id], shape } })); setDirty(true); }

  const states = new Map((floor?.states ?? []).map((s) => [s.id, s]));
  const tables = (floor?.tables ?? []).filter((t) => t.isActive);
  const count = { seated: 0, soon: 0, free: 0 };
  for (const s of floor?.states ?? []) count[s.state]++;
  const label = { seated: vi ? 'Đang có khách' : 'Seated', soon: vi ? 'Sắp có khách (≤1 giờ)' : 'Soon (≤1h)', free: vi ? 'Trống' : 'Free' };
  const pickedT = tables.find((t) => t.id === picked) ?? null;
  const waiting = floor?.waiting ?? [];
  const seating = seat ? waiting.find((w) => w.id === seat) ?? null : null;
  const fits = (t: Table) => !seating || (t.seats >= seating.party && states.get(t.id)?.state !== 'seated');
  const pickedS = picked ? states.get(picked) : undefined;
  const btn = (on = false): React.CSSProperties => ({ padding: '6px 11px', borderRadius: 8, border: '1px solid var(--c334155)', background: on ? 'var(--c1e293b)' : 'transparent', color: 'var(--ccbd5e1)', fontSize: 13, cursor: 'pointer' });

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
        <button type="button" style={btn(!at)} onClick={() => setAt(null)}>{vi ? 'Bây giờ' : 'Now'}</button>
        {[60, 120, 180].map((m) => (
          <button key={m} type="button" style={btn()} onClick={() => setAt(new Date(Date.now() + m * 60_000).toISOString())}>+{m / 60}h</button>
        ))}
        <input type="datetime-local" aria-label={vi ? 'Xem sơ đồ lúc' : 'Show the floor at'}
          value={floor ? instantToWall(floor.at, tz) : ''}
          onChange={(e) => e.target.value && setAt(wallToInstantISO(e.target.value, tz))}
          style={{ padding: '5px 8px', borderRadius: 8, border: '1px solid var(--c334155)', background: 'transparent', color: 'var(--ccbd5e1)', fontSize: 13 }} />
        <span style={{ flex: 1 }} />
        {canArrange && !arrange && <button type="button" style={btn()} onClick={() => { setArrange(true); setPicked(null); setSeat(null); }}>{vi ? 'Sắp xếp bàn' : 'Arrange tables'}</button>}
        {arrange && <>
          <button type="button" style={btn()} onClick={cancel} disabled={saving}>{vi ? 'Huỷ' : 'Cancel'}</button>
          <button type="button" style={{ ...btn(true), borderColor: 'var(--ink-good)', color: 'var(--ink-good)' }} onClick={save} disabled={saving || !dirty}>{saving ? '…' : vi ? 'Lưu sơ đồ' : 'Save layout'}</button>
        </>}
      </div>

      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 12, color: 'var(--c94a3b8)', marginBottom: 8 }}>
        {(['free', 'soon', 'seated'] as const).map((k) => (
          <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: INK[k] }} />{label[k]} · {count[k]}
          </span>
        ))}
        {arrange && <span>{vi ? 'Kéo bàn tới đúng vị trí trong quán, bấm vào bàn để đổi hình.' : 'Drag tables to where they stand; tap one to change its shape.'}</span>}
      </div>

      {err && <div style={{ color: 'var(--ink-bad)', fontSize: 13, marginBottom: 8 }}>{err}</div>}

      {!arrange && waiting.length > 0 && (
        <div style={{ marginBottom: 10, padding: 10, borderRadius: 10, border: '1px solid var(--c334155)' }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ccbd5e1)', marginBottom: 6 }}>
            {vi ? `Chờ xếp bàn (${waiting.length})` : `To seat (${waiting.length})`}
            <span style={{ fontWeight: 400, color: 'var(--c94a3b8)', marginLeft: 8 }}>
              {seating ? (vi ? `Bấm vào bàn trống đủ ${seating.party} chỗ để xếp.` : `Tap a free table with ${seating.party}+ seats.`) : (vi ? 'Chọn một lịch đặt, rồi bấm vào bàn.' : 'Pick a reservation, then tap a table.')}
            </span>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {waiting.map((w) => (
              <button key={w.id} type="button" title={w.preOrder ? `${vi ? 'Gọi trước' : 'Pre-order'}: ${w.preOrder}` : undefined} onClick={() => { setSeat((x) => (x === w.id ? null : w.id)); setPicked(null); }}
                style={{ ...btn(seat === w.id), borderColor: seat === w.id ? 'var(--ink-warn)' : 'var(--c334155)' }}>
                {clockIn(w.at, tz, vi)} · {w.name || (vi ? 'Khách' : 'Guest')} · {w.party} {vi ? 'người' : 'ppl'}{w.preOrder ? ' · 🍽' : ''}
              </button>
            ))}
          </div>
        </div>
      )}

      <div ref={box} style={{ position: 'relative', width: '100%', height: 520, borderRadius: 12, border: '1px solid var(--c334155)', overflow: 'hidden', touchAction: arrange ? 'none' : 'auto',
        backgroundImage: arrange ? 'linear-gradient(var(--c1e293b) 1px, transparent 1px), linear-gradient(90deg, var(--c1e293b) 1px, transparent 1px)' : undefined, backgroundSize: '5% 5%' }}>
        {floor && tables.length === 0 && <p style={{ padding: 16, color: 'var(--c64748b)', fontSize: 14 }}>{vi ? 'Chưa có bàn — thêm bàn ở tab Danh sách.' : 'No tables yet — add them in the List tab.'}</p>}
        {tables.map((t) => {
          const spot = draft[t.id]; if (!spot) return null;
          const st = states.get(t.id); const ink = INK[st?.state ?? 'free'];
          const z = SIZE[spot.shape] ?? SIZE.round;
          const sub = st?.current ? `${vi ? 'đến' : 'til'} ${clockIn(st.current.until, tz, vi)}` : st?.next ? clockIn(st.next.at, tz, vi) : '';
          return (
            <div key={t.id} role="button" tabIndex={0} title={t.area ?? undefined}
              onPointerDown={(e) => onDown(e, t.id)} onPointerMove={onMove} onPointerUp={() => onUp(t.id)}
              onClick={() => { if (arrange) return; if (seat) { if (fits(t)) void seatAt(t.id); return; } setPicked((p) => (p === t.id ? null : t.id)); }}
              onKeyDown={(e) => { if (e.key === 'Enter') setPicked(t.id); }}
              style={{ position: 'absolute', left: `${spot.x}%`, top: `${spot.y}%`, width: z.w, height: z.h, borderRadius: z.r,
                border: `2px solid ${ink}`, background: `color-mix(in srgb, ${ink} 16%, transparent)`, color: 'var(--ccbd5e1)',
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', lineHeight: 1.15,
                cursor: arrange ? 'grab' : seating && !fits(t) ? 'not-allowed' : 'pointer', userSelect: 'none', opacity: fits(t) ? 1 : 0.35, outline: picked === t.id ? '2px solid var(--ccbd5e1)' : 'none', outlineOffset: 2 }}>
              <strong style={{ fontSize: 13 }}>{t.name}</strong>
              <span style={{ fontSize: 10, color: 'var(--c94a3b8)' }}>{t.seats} {vi ? 'chỗ' : 'seats'}</span>
              {sub && <span style={{ fontSize: 10, color: ink }}>{sub}</span>}
            </div>
          );
        })}
      </div>

      {pickedT && (
        <div style={{ marginTop: 10, padding: 12, borderRadius: 10, border: '1px solid var(--c334155)', fontSize: 13, color: 'var(--ccbd5e1)' }}>
          <strong>{pickedT.name}</strong> · {pickedT.seats} {vi ? 'chỗ' : 'seats'}{pickedT.area ? ` · ${pickedT.area}` : ''}
          {arrange ? (
            <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
              {(['round', 'square', 'long'] as const).map((s) => (
                <button key={s} type="button" style={btn(draft[pickedT.id]?.shape === s)} onClick={() => setShape(pickedT.id, s)}>
                  {s === 'round' ? (vi ? 'Tròn' : 'Round') : s === 'square' ? (vi ? 'Vuông' : 'Square') : (vi ? 'Dài' : 'Long')}
                </button>
              ))}
            </div>
          ) : (
            <div style={{ marginTop: 6, color: 'var(--c94a3b8)' }}>
              {pickedS?.current
                ? <div style={{ color: INK.seated }}>{vi ? 'Đang ngồi' : 'Seated'}: {pickedS.current.name || (vi ? 'Khách' : 'Guest')} · {pickedS.current.party} {vi ? 'người' : 'ppl'} · {vi ? 'đến' : 'until'} {clockIn(pickedS.current.until, tz, vi)}</div>
                : <div style={{ color: INK.free }}>{vi ? 'Bàn đang trống' : 'Table is free'}</div>}
              {pickedS?.current?.preOrder && <div>🍽 {vi ? 'Gọi trước' : 'Pre-order'}: {pickedS.current.preOrder}</div>}
              {pickedS?.next && <div>{vi ? 'Kế tiếp' : 'Next'}: {pickedS.next.name || (vi ? 'Khách' : 'Guest')} · {pickedS.next.party} {vi ? 'người' : 'ppl'} · {clockIn(pickedS.next.at, tz, vi)}</div>}
              {pickedS?.next?.preOrder && <div>🍽 {vi ? 'Gọi trước' : 'Pre-order'}: {pickedS.next.preOrder}</div>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
