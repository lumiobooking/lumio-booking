'use client';

import { useCallback, useEffect, useState } from 'react';
import { SalonShell } from '../../../components/SalonShell';
import { useAuth } from '../../../lib/auth';
import { apiFetch } from '../../../lib/api';
import { ui } from '../../../lib/ui';
import { useLang, tr } from '../../../lib/i18n';

interface Table { id: string; name: string; seats: number; area: string | null; isActive: boolean; sortOrder: number }

export default function TablesPage() {
  return <SalonShell><Inner /></SalonShell>;
}

function Inner() {
  const { token } = useAuth();
  const { lang } = useLang();
  const t = (k: string) => tr(k, lang);
  const [tables, setTables] = useState<Table[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', seats: '2', area: '' });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    try { setTables(await apiFetch<Table[]>('/tables', { token })); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Failed to load'); }
  }, [token]);
  useEffect(() => { load(); }, [load]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return;
    setBusy(true); setErr(null);
    try {
      await apiFetch('/tables', { method: 'POST', token, body: { name: form.name.trim(), seats: parseInt(form.seats, 10) || 2, area: form.area.trim() || undefined } });
      setForm({ name: '', seats: '2', area: '' });
      await load();
    } catch (e2) { setErr(e2 instanceof Error ? e2.message : 'Failed'); }
    finally { setBusy(false); }
  }

  async function patch(id: string, data: Partial<Table>) {
    try { await apiFetch(`/tables/${id}`, { method: 'PATCH', token, body: data }); await load(); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Failed'); }
  }
  async function remove(id: string) {
    try { await apiFetch(`/tables/${id}`, { method: 'DELETE', token }); await load(); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Failed'); }
  }

  return (
    <section style={{ maxWidth: 720 }}>
      <h1 style={{ fontSize: 22, margin: '0 0 4px' }}>{t('tb.title')}</h1>
      <p style={{ color: '#94a3b8', fontSize: 14, marginTop: 0 }}>{t('tb.subtitle')}</p>
      {err && <div style={ui.banner}>{err}</div>}

      <form onSubmit={add} style={{ ...ui.card, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label style={{ flex: '2 1 150px' }}><span style={ui.label}>{t('tb.name')}</span>
          <input style={ui.input} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="T1" /></label>
        <label style={{ flex: '1 1 80px' }}><span style={ui.label}>{t('tb.seats')}</span>
          <input style={ui.input} type="number" min={1} max={50} value={form.seats} onChange={(e) => setForm({ ...form, seats: e.target.value })} /></label>
        <label style={{ flex: '2 1 130px' }}><span style={ui.label}>{t('tb.area')}</span>
          <input style={ui.input} value={form.area} onChange={(e) => setForm({ ...form, area: e.target.value })} placeholder="Indoor / Patio" /></label>
        <button type="submit" disabled={busy} style={ui.primaryBtn}>{t('tb.add')}</button>
      </form>

      <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {tables.length === 0 && <p style={{ color: '#64748b', fontSize: 14 }}>{t('tb.empty')}</p>}
        {tables.map((tb) => (
          <div key={tb.id} style={{ ...ui.card, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', padding: 12, opacity: tb.isActive ? 1 : 0.55 }}>
            <input style={{ ...ui.input, width: 110 }} value={tb.name}
              onChange={(e) => setTables((xs) => xs.map((x) => (x.id === tb.id ? { ...x, name: e.target.value } : x)))}
              onBlur={(e) => patch(tb.id, { name: e.target.value })} />
            <span style={{ color: '#94a3b8', fontSize: 13 }}>{t('tb.seats')}</span>
            <input style={{ ...ui.input, width: 68 }} type="number" min={1} max={50} value={tb.seats}
              onChange={(e) => setTables((xs) => xs.map((x) => (x.id === tb.id ? { ...x, seats: parseInt(e.target.value, 10) || 1 } : x)))}
              onBlur={(e) => patch(tb.id, { seats: parseInt(e.target.value, 10) || 1 })} />
            <input style={{ ...ui.input, width: 130 }} value={tb.area ?? ''} placeholder={t('tb.area')}
              onChange={(e) => setTables((xs) => xs.map((x) => (x.id === tb.id ? { ...x, area: e.target.value } : x)))}
              onBlur={(e) => patch(tb.id, { area: e.target.value })} />
            <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 13, color: '#cbd5e1' }}>
              <input type="checkbox" checked={tb.isActive} onChange={(e) => patch(tb.id, { isActive: e.target.checked })} />{t('tb.active')}
            </label>
            <button onClick={() => remove(tb.id)} style={{ marginLeft: 'auto', background: 'none', border: '1px solid #ef4444', color: '#ef4444', borderRadius: 6, padding: '5px 10px', cursor: 'pointer', fontSize: 13 }}>{t('tb.delete')}</button>
          </div>
        ))}
      </div>
    </section>
  );
}
