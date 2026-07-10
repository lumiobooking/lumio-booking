'use client';

import { useCallback, useEffect, useState, FormEvent } from 'react';
import { SalonShell } from '../../../components/SalonShell';
import { useAuth } from '../../../lib/auth';
import { apiFetch } from '../../../lib/api';
import { ui } from '../../../lib/ui';
import { useLang } from '../../../lib/i18n';

interface SType { id: string; name: string; keywords: string | null; sortOrder: number; isActive: boolean }
interface Station { id: string; name: string; stationTypeId: string | null; stationType: { id: string; name: string } | null; isActive: boolean; sortOrder: number }

export default function StationsPage() {
  return <SalonShell><Inner /></SalonShell>;
}

function Inner() {
  const { token } = useAuth();
  const { lang } = useLang();
  const vi = lang === 'vi';

  const [types, setTypes] = useState<SType[]>([]);
  const [rows, setRows] = useState<Station[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [bulk, setBulk] = useState({ count: '4', typeId: '', prefix: '' });
  const [newType, setNewType] = useState('');

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const [ty, st] = await Promise.all([
        apiFetch<SType[]>('/stations/types', { token }),
        apiFetch<Station[]>('/stations', { token }),
      ]);
      setTypes(ty); setRows(st);
      setBulk((b) => ({ ...b, typeId: b.typeId || ty[0]?.id || '' }));
      setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to load'); }
    finally { setLoading(false); }
  }, [token]);
  useEffect(() => { load(); }, [load]);

  // ---- chair types (add / rename / delete) ----
  async function addType(e: FormEvent) {
    e.preventDefault(); const name = newType.trim(); if (!name) return;
    setError(null);
    try { await apiFetch('/stations/types', { method: 'POST', token, body: { name } }); setNewType(''); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not add type'); }
  }
  async function patchType(id: string, data: { name?: string; keywords?: string }) {
    try { await apiFetch(`/stations/types/${id}`, { method: 'PATCH', token, body: data }); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not save'); }
  }
  async function delType(id: string) {
    if (!window.confirm(vi ? 'Xoá loại này? Các ghế thuộc loại này sẽ thành "chưa phân loại".' : 'Delete this type? Its chairs become untyped.')) return;
    try { await apiFetch(`/stations/types/${id}`, { method: 'DELETE', token }); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not delete'); }
  }

  // ---- chairs ----
  async function addBulk(e: FormEvent) {
    e.preventDefault(); setError(null);
    try {
      await apiFetch('/stations/bulk', { method: 'POST', token, body: {
        count: Math.max(1, Math.min(40, parseInt(bulk.count, 10) || 1)),
        stationTypeId: bulk.typeId || undefined,
        prefix: bulk.prefix.trim() || undefined,
      } });
      setBulk({ ...bulk, prefix: '' });
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not add'); }
  }
  async function patch(id: string, data: Partial<Station>) {
    try { await apiFetch(`/stations/${id}`, { method: 'PATCH', token, body: data }); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not save'); }
  }
  async function del(id: string) {
    if (!window.confirm(vi ? 'Xoá ghế này?' : 'Delete this chair?')) return;
    try { await apiFetch(`/stations/${id}`, { method: 'DELETE', token }); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not delete'); }
  }

  if (loading) return <section><h2 style={{ fontSize: 18 }}>{vi ? 'Ghế / Bàn' : 'Chairs'}</h2><p style={{ color: '#94a3b8' }}>Loading…</p></section>;

  const groups = [
    ...types.map((t) => ({ id: t.id, name: t.name, list: rows.filter((r) => r.stationTypeId === t.id) })),
    { id: '', name: vi ? 'Chưa phân loại' : 'Untyped', list: rows.filter((r) => !r.stationTypeId) },
  ].filter((g) => g.list.length > 0);

  return (
    <section>
      <h2 style={{ fontSize: 18, margin: '0 0 2px' }}>{vi ? 'Ghế / Bàn của tiệm' : 'Chairs & stations'}</h2>
      <p style={{ color: '#94a3b8', margin: '0 0 16px', fontSize: 14 }}>
        {vi ? 'Khai báo các loại ghế và ghế của tiệm. Sơ đồ ghế trong Calendar dùng danh sách này để tự xếp khách vào ghế trống đúng loại.'
            : 'Set up your chair types and chairs. The floor view in Calendar uses this to auto-seat walk-ins in a free chair of the right type.'}
      </p>

      {error && <div style={ui.banner}>{error}</div>}

      {/* Chair types + auto-seat keywords: automatic, but you control the words */}
      <div style={{ ...ui.card, marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#cbd5e1', marginBottom: 4 }}>{vi ? 'Loại ghế & từ khóa tự xếp' : 'Chair types & auto-seat keywords'}</div>
        <p style={{ fontSize: 12, color: '#64748b', margin: '0 0 12px', lineHeight: 1.5 }}>{vi
          ? 'Dịch vụ có tên hoặc nhóm chứa một trong các "từ khóa" này sẽ TỰ ĐỘNG được xếp vào loại ghế đó — không cần gán tay từng dịch vụ. Chỉ sửa từ khóa khi có ngoại lệ (vd thêm "combo" vào Pedi).'
          : 'A service whose name or category contains any of these keywords is auto-seated at that chair type — no per-service setup. Edit the words only to fix exceptions.'}</p>
        <div style={{ display: 'grid', gap: 8, marginBottom: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '150px 1fr auto', gap: 8, fontSize: 11, color: '#64748b' }}>
            <span>{vi ? 'Tên loại' : 'Type name'}</span><span>{vi ? 'Từ khóa (cách nhau bằng dấu phẩy)' : 'Keywords (comma-separated)'}</span><span></span>
          </div>
          {types.map((t) => (
            <div key={t.id} style={{ display: 'grid', gridTemplateColumns: '150px 1fr auto', gap: 8, alignItems: 'center' }}>
              <input defaultValue={t.name} onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== t.name) patchType(t.id, { name: v }); }} style={{ ...ui.input, padding: '7px 10px' }} />
              <input defaultValue={t.keywords ?? ''} onBlur={(e) => { const v = e.target.value; if (v !== (t.keywords ?? '')) patchType(t.id, { keywords: v }); }} placeholder={vi ? 'vd: pedi, chân, foot, spa' : 'e.g. pedi, foot, spa'} style={{ ...ui.input, padding: '7px 10px' }} />
              <button onClick={() => delType(t.id)} aria-label="delete type" style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 16, padding: '0 6px' }}>×</button>
            </div>
          ))}
        </div>
        <form onSubmit={addType} style={{ display: 'flex', gap: 8 }}>
          <input value={newType} onChange={(e) => setNewType(e.target.value)} placeholder={vi ? 'Thêm loại mới (vd: Ghế trẻ em)' : 'Add a type (e.g. Kids chair)'}
            style={{ ...ui.input, flex: 1, maxWidth: 320 }} />
          <button type="submit" style={{ ...ui.input, width: 'auto', padding: '9px 16px', cursor: 'pointer' }}>{vi ? '+ Thêm loại' : '+ Add type'}</button>
        </form>
      </div>

      {/* Quick add chairs */}
      <form onSubmit={addBulk} style={{ ...ui.card, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10, alignItems: 'end', marginBottom: 18 }}>
        <label><span style={ui.label}>{vi ? 'Số lượng' : 'How many'}</span>
          <input style={ui.input} type="number" min={1} max={40} value={bulk.count} onChange={(e) => setBulk({ ...bulk, count: e.target.value })} /></label>
        <label><span style={ui.label}>{vi ? 'Loại' : 'Type'}</span>
          <select style={ui.input} value={bulk.typeId} onChange={(e) => setBulk({ ...bulk, typeId: e.target.value })}>
            {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select></label>
        <label><span style={ui.label}>{vi ? 'Tên đầu (tuỳ chọn)' : 'Name prefix (optional)'}</span>
          <input style={ui.input} value={bulk.prefix} placeholder={vi ? 'vd: Spa' : 'e.g. Spa'} onChange={(e) => setBulk({ ...bulk, prefix: e.target.value })} /></label>
        <button type="submit" style={ui.primaryBtn}>{vi ? '+ Thêm nhanh' : '+ Quick add'}</button>
      </form>

      {rows.length === 0 ? (
        <div style={{ ...ui.card, color: '#64748b' }}>{vi ? 'Chưa có ghế nào. Dùng "Thêm nhanh" ở trên để tạo.' : 'No chairs yet. Use "Quick add" above.'}</div>
      ) : groups.map((g) => (
        <div key={g.id || 'none'} style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#cbd5e1', margin: '0 0 8px' }}>{g.name} ({g.list.length})</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: 10 }}>
            {g.list.map((s) => (
              <div key={s.id} style={{ ...ui.card, padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 8, opacity: s.isActive ? 1 : 0.5 }}>
                <input defaultValue={s.name} onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== s.name) patch(s.id, { name: v }); }}
                  style={{ ...ui.input, flex: 1, minWidth: 0, padding: '7px 10px' }} />
                <select value={s.stationTypeId ?? ''} onChange={(e) => patch(s.id, { stationTypeId: e.target.value })} style={{ ...ui.input, width: 'auto', padding: '7px 8px' }}>
                  <option value="">{vi ? '—' : '—'}</option>
                  {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
                <button onClick={() => patch(s.id, { isActive: !s.isActive })} title={s.isActive ? (vi ? 'Đang dùng' : 'Active') : (vi ? 'Tạm ẩn' : 'Hidden')}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: s.isActive ? '#22c55e' : '#64748b', fontSize: 16 }}>{s.isActive ? '●' : '○'}</button>
                <button onClick={() => del(s.id)} aria-label="delete" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', fontSize: 16 }}>×</button>
              </div>
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}
