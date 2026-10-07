'use client';

// CHẤM CÔNG — the owner's view of the time clock.
//
// Totals per technician for the range, then every shift: fix a forgotten
// "Ra ca", add a shift someone didn't clock, delete a mistake. Times are typed
// in SALON time (the API reads them in the salon's timezone, never the
// browser's), and every change is written to the audit log by the server.

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../../lib/auth';
import { apiFetch } from '../../../lib/api';
import { ui } from '../../../lib/ui';
import { ind } from '../../../lib/ui-industry';
import { instantToWall } from '../../../lib/datetime';

interface Entry { id: string; staffId: string; name: string; clockIn: string; clockOut: string | null; minutes: number | null; source: string; note: string | null }
interface Total { staffId: string; name: string; minutes: number; days: number; stale: number }
interface Data { from: string; to: string; timezone: string; staff: Total[]; entries: Entry[] }
interface StaffLite { id: string; firstName: string; lastName: string | null; isActive?: boolean }

const hm = (min: number) => { const m = Math.max(0, Math.round(min)); return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`; };

export function TimeClockTab({ vi }: { vi: boolean }) {
  const { token } = useAuth();
  const L = (v: string, e: string) => ind(vi ? v : e);
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);
  const [data, setData] = useState<Data | null>(null);
  const [staff, setStaff] = useState<StaffLite[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [edit, setEdit] = useState<{ id: string | null; staffId: string; clockIn: string; clockOut: string; note: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [who, setWho] = useState<string>('');

  const load = useCallback(async () => {
    if (!token) return;
    const q = range ? `?from=${range.from}&to=${range.to}` : '';
    try {
      const d = await apiFetch<Data>(`/time-clock${q}`, { token });
      setData(d); setErr(null);
      if (!range) setRange({ from: d.from, to: d.to });
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed'); }
  }, [token, range]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!token) return;
    apiFetch<StaffLite[]>('/staff', { token }).then((s) => setStaff(Array.isArray(s) ? s.filter((x) => x.isActive !== false) : [])).catch(() => undefined);
  }, [token]);

  const tz = data?.timezone;
  const wall = (iso: string | null) => (iso ? instantToWall(iso, tz) : '');
  const dayLabel = (iso: string) => new Date(iso).toLocaleDateString(vi ? 'vi-VN' : 'en-US', { weekday: 'short', day: 'numeric', month: 'numeric', timeZone: tz });
  const timeLabel = (iso: string) => new Date(iso).toLocaleTimeString(vi ? 'vi-VN' : 'en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz });

  async function save() {
    if (!edit) return;
    setBusy(true); setErr(null);
    try {
      const body = { clockIn: edit.clockIn, clockOut: edit.clockOut || null, note: edit.note.trim() };
      if (edit.id) await apiFetch(`/time-clock/${edit.id}`, { method: 'PATCH', token, body });
      else await apiFetch('/time-clock', { method: 'POST', token, body: { ...body, staffId: edit.staffId } });
      setEdit(null); await load();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed'); } finally { setBusy(false); }
  }
  async function remove(id: string) {
    setBusy(true); setErr(null);
    try { await apiFetch(`/time-clock/${id}`, { method: 'DELETE', token }); setEdit(null); await load(); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Failed'); } finally { setBusy(false); }
  }

  const entries = (data?.entries ?? []).filter((e) => !who || e.staffId === who);
  const newShift = () => {
    const today = instantToWall(new Date(), tz).slice(0, 10);
    setEdit({ id: null, staffId: who || staff[0]?.id || '', clockIn: `${today}T09:00`, clockOut: `${today}T17:00`, note: '' });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={ui.label}>{L('Từ ngày', 'From')}</span>
          <input type="date" lang="en-US" value={range?.from ?? ''} onChange={(e) => e.target.value && setRange((r) => ({ from: e.target.value, to: r?.to ?? e.target.value }))} style={{ ...ui.input, width: 'auto' }} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={ui.label}>{L('Đến ngày', 'To')}</span>
          <input type="date" lang="en-US" value={range?.to ?? ''} onChange={(e) => e.target.value && setRange((r) => ({ from: r?.from ?? e.target.value, to: e.target.value }))} style={{ ...ui.input, width: 'auto' }} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={ui.label}>{L('Thợ', 'Tech')}</span>
          <select value={who} onChange={(e) => setWho(e.target.value)} style={{ ...ui.input, width: 'auto' }}>
            <option value="">{L('Tất cả', 'Everyone')}</option>
            {staff.map((s) => <option key={s.id} value={s.id}>{s.firstName}{s.lastName ? ` ${s.lastName}` : ''}</option>)}
          </select>
        </label>
        <button type="button" onClick={newShift} disabled={staff.length === 0} style={{ ...ui.primaryBtn, marginLeft: 'auto' }}>{L('+ Thêm ca', '+ Add a shift')}</button>
      </div>

      {err && <div style={ui.banner}>{err}</div>}

      {/* Totals per technician */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10 }}>
        {(data?.staff ?? []).filter((t) => !who || t.staffId === who).map((t) => (
          <button type="button" key={t.staffId} onClick={() => setWho(who === t.staffId ? '' : t.staffId)}
            style={{ textAlign: 'left', cursor: 'pointer', borderRadius: 14, border: `1px solid ${who === t.staffId ? 'var(--ink-link)' : 'var(--line)'}`, background: 'var(--c111827)', padding: '12px 14px', color: 'var(--cf1f5f9)' }}>
            <div style={{ fontSize: 14, fontWeight: 700 }}>{t.name || '—'}</div>
            <div style={{ fontSize: 22, fontWeight: 800, marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>{hm(t.minutes)}</div>
            <div style={{ fontSize: 12, color: 'var(--c94a3b8)' }}>
              {L(`${t.days} ngày`, `${t.days} day${t.days === 1 ? '' : 's'}`)}
              {t.stale > 0 && <span style={{ color: 'var(--ink-warn)', fontWeight: 700 }}>{L(` · ${t.stale} ca quên ra`, ` · ${t.stale} not clocked out`)}</span>}
            </div>
          </button>
        ))}
        {data && data.staff.length === 0 && (
          <div style={{ color: 'var(--c94a3b8)', fontSize: 14, gridColumn: '1 / -1' }}>
            {L('Chưa có ca nào trong khoảng này. Khi tiệm chọn "Chấm công" trong Cài đặt lương, thợ sẽ thấy nút Vào ca / Ra ca trong app.', 'No shifts in this range. Once payroll settings use the time clock, techs get a Clock in / out button in their app.')}
          </div>
        )}
      </div>

      {/* Every shift */}
      <div style={{ borderRadius: 14, border: '1px solid var(--line)', overflow: 'hidden' }}>
        {entries.map((e) => {
          const open = !e.clockOut;
          const stale = open && e.minutes == null;
          return (
            <div key={e.id} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, padding: '12px 14px', borderBottom: '1px solid var(--line)', background: stale ? 'var(--wash-amber)' : undefined }}>
              <div style={{ minWidth: 140, fontWeight: 700, color: 'var(--cf1f5f9)' }}>{e.name}</div>
              <div style={{ minWidth: 110, color: 'var(--ccbd5e1)', textTransform: 'capitalize' }}>{dayLabel(e.clockIn)}</div>
              <div style={{ flex: 1, minWidth: 150, color: 'var(--ccbd5e1)', fontVariantNumeric: 'tabular-nums' }}>
                {timeLabel(e.clockIn)} → {e.clockOut ? timeLabel(e.clockOut) : stale ? <span style={{ color: 'var(--ink-warn)', fontWeight: 700 }}>{L('quên ra ca', 'never clocked out')}</span> : <span style={{ color: 'var(--ink-good)', fontWeight: 700 }}>{L('đang trong ca', 'on the clock')}</span>}
                {e.source !== 'app' && <span style={{ marginLeft: 8, fontSize: 12, color: 'var(--c94a3b8)' }}>{L('· chủ tiệm nhập', '· entered by owner')}</span>}
                {e.note && <span style={{ marginLeft: 8, fontSize: 12, color: 'var(--c94a3b8)' }}>· {e.note}</span>}
              </div>
              <div style={{ minWidth: 70, textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: 'var(--cf1f5f9)' }}>{e.minutes == null ? '—' : hm(e.minutes)}</div>
              <button type="button" onClick={() => setEdit({ id: e.id, staffId: e.staffId, clockIn: wall(e.clockIn), clockOut: wall(e.clockOut), note: e.note ?? '' })}
                style={{ ...ui.input, width: 'auto', cursor: 'pointer', padding: '6px 12px' }}>{L('Sửa', 'Edit')}</button>
            </div>
          );
        })}
        {data && entries.length === 0 && <div style={{ padding: 14, color: 'var(--c94a3b8)', fontSize: 14 }}>{L('Không có ca nào.', 'No shifts.')}</div>}
      </div>

      {edit && (
        <div role="dialog" aria-modal="true" onClick={() => setEdit(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 300, display: 'grid', placeItems: 'center', padding: 16 }}>
          <div onClick={(ev) => ev.stopPropagation()} style={{ ...ui.card, width: '100%', maxWidth: 440, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--cf1f5f9)' }}>{edit.id ? L('Sửa ca làm', 'Edit shift') : L('Thêm ca làm', 'Add a shift')}</div>
            {!edit.id && (
              <label><span style={ui.label}>{L('Thợ', 'Tech')}</span>
                <select value={edit.staffId} onChange={(e) => setEdit({ ...edit, staffId: e.target.value })} style={ui.input}>
                  {staff.map((s) => <option key={s.id} value={s.id}>{s.firstName}{s.lastName ? ` ${s.lastName}` : ''}</option>)}
                </select>
              </label>
            )}
            <label><span style={ui.label}>{L('Vào ca', 'Clock in')}</span>
              <input type="datetime-local" lang="en-US" value={edit.clockIn} onChange={(e) => setEdit({ ...edit, clockIn: e.target.value })} style={ui.input} />
            </label>
            <label><span style={ui.label}>{L('Ra ca (để trống nếu vẫn đang làm)', 'Clock out (empty if still on the clock)')}</span>
              <input type="datetime-local" lang="en-US" value={edit.clockOut} onChange={(e) => setEdit({ ...edit, clockOut: e.target.value })} style={ui.input} />
            </label>
            <label><span style={ui.label}>{L('Ghi chú', 'Note')}</span>
              <input value={edit.note} maxLength={200} onChange={(e) => setEdit({ ...edit, note: e.target.value })} style={ui.input} placeholder={L('VD: quên bấm ra ca', 'e.g. forgot to clock out')} />
            </label>
            <div style={{ fontSize: 12, color: 'var(--c94a3b8)' }}>{L(`Giờ theo múi giờ của tiệm (${tz ?? ''}). Một ca tối đa 16 giờ.`, `Salon time (${tz ?? ''}). A shift is at most 16 hours.`)}</div>
            {err && <div style={ui.banner}>{err}</div>}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button type="button" onClick={save} disabled={busy || !edit.clockIn || (!edit.id && !edit.staffId)} style={ui.primaryBtn}>{busy ? L('Đang lưu…', 'Saving…') : L('Lưu', 'Save')}</button>
              <button type="button" onClick={() => setEdit(null)} style={{ ...ui.input, width: 'auto', cursor: 'pointer' }}>{L('Huỷ', 'Cancel')}</button>
              {edit.id && <button type="button" onClick={() => remove(edit.id!)} disabled={busy} style={{ ...ui.dangerBtn, marginLeft: 'auto' }}>{L('Xoá ca', 'Delete')}</button>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
