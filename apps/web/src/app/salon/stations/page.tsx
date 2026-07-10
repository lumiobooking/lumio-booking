'use client';

import { useCallback, useEffect, useState, FormEvent } from 'react';
import { SalonShell } from '../../../components/SalonShell';
import { useAuth } from '../../../lib/auth';
import { apiFetch } from '../../../lib/api';
import { ui } from '../../../lib/ui';
import { useLang } from '../../../lib/i18n';

type Kind = 'PEDI' | 'MANI' | 'NAIL' | 'OTHER';
interface Station { id: string; name: string; kind: Kind; isActive: boolean; sortOrder: number }
const KINDS: Kind[] = ['PEDI', 'MANI', 'NAIL', 'OTHER'];

export default function StationsPage() {
  return <SalonShell><Inner /></SalonShell>;
}

function Inner() {
  const { token } = useAuth();
  const { lang } = useLang();
  const vi = lang === 'vi';
  const kindLabel = (k: Kind) => (vi
    ? { PEDI: 'Ghế Pedi (chân)', MANI: 'Bàn Mani (tay)', NAIL: 'Bàn Nail', OTHER: 'Khác' }[k]
    : { PEDI: 'Pedi chair', MANI: 'Mani table', NAIL: 'Nail station', OTHER: 'Other' }[k]);

  const [rows, setRows] = useState<Station[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [bulk, setBulk] = useState({ count: '4', kind: 'PEDI' as Kind, prefix: '' });

  const load = useCallback(async () => {
    if (!token) return;
    try { setRows(await apiFetch<Station[]>('/stations', { token })); setError(null); }
    catch (e) { setError(e instanceof Error ? e.message : 'Failed to load'); }
    finally { setLoading(false); }
  }, [token]);
  useEffect(() => { load(); }, [load]);

  async function addBulk(e: FormEvent) {
    e.preventDefault(); setError(null);
    try {
      await apiFetch('/stations/bulk', { method: 'POST', token, body: {
        count: Math.max(1, Math.min(40, parseInt(bulk.count, 10) || 1)),
        kind: bulk.kind,
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

  const byKind = KINDS.map((k) => ({ k, list: rows.filter((r) => r.kind === k) })).filter((g) => g.list.length > 0);

  return (
    <section>
      <h2 style={{ fontSize: 18, margin: '0 0 2px' }}>{vi ? 'Ghế / Bàn của tiệm' : 'Chairs & stations'}</h2>
      <p style={{ color: '#94a3b8', margin: '0 0 16px', fontSize: 14 }}>
        {vi ? 'Khai báo các ghế/bàn của tiệm. Hệ thống dùng danh sách này cho Sơ đồ ghế trong Calendar — tự xếp khách vào ghế trống đúng loại.'
            : 'Set up your chairs. The floor view in Calendar uses this list to auto-seat walk-ins in a free chair of the right type.'}
      </p>

      {error && <div style={ui.banner}>{error}</div>}

      <form onSubmit={addBulk} style={{ ...ui.card, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10, alignItems: 'end', marginBottom: 18 }}>
        <label><span style={ui.label}>{vi ? 'Số lượng' : 'How many'}</span>
          <input style={ui.input} type="number" min={1} max={40} value={bulk.count} onChange={(e) => setBulk({ ...bulk, count: e.target.value })} /></label>
        <label><span style={ui.label}>{vi ? 'Loại' : 'Type'}</span>
          <select style={ui.input} value={bulk.kind} onChange={(e) => setBulk({ ...bulk, kind: e.target.value as Kind })}>
            {KINDS.map((k) => <option key={k} value={k}>{kindLabel(k)}</option>)}
          </select></label>
        <label><span style={ui.label}>{vi ? 'Tên đầu (tuỳ chọn)' : 'Name prefix (optional)'}</span>
          <input style={ui.input} value={bulk.prefix} placeholder={vi ? 'vd: Spa' : 'e.g. Spa'} onChange={(e) => setBulk({ ...bulk, prefix: e.target.value })} /></label>
        <button type="submit" style={ui.primaryBtn}>{vi ? '+ Thêm nhanh' : '+ Quick add'}</button>
      </form>

      {rows.length === 0 ? (
        <div style={{ ...ui.card, color: '#64748b' }}>{vi ? 'Chưa có ghế nào. Dùng "Thêm nhanh" ở trên để tạo, ví dụ 6 ghế Pedi.' : 'No chairs yet. Use "Quick add" above, e.g. 6 Pedi chairs.'}</div>
      ) : byKind.map((g) => (
        <div key={g.k} style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#cbd5e1', margin: '0 0 8px' }}>{kindLabel(g.k)} ({g.list.length})</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 10 }}>
            {g.list.map((s) => (
              <div key={s.id} style={{ ...ui.card, padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 8, opacity: s.isActive ? 1 : 0.5 }}>
                <input defaultValue={s.name} onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== s.name) patch(s.id, { name: v }); }}
                  style={{ ...ui.input, flex: 1, minWidth: 0, padding: '7px 10px' }} />
                <select value={s.kind} onChange={(e) => patch(s.id, { kind: e.target.value as Kind })} style={{ ...ui.input, width: 'auto', padding: '7px 8px' }}>
                  {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
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
