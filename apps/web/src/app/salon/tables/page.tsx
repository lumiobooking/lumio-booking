'use client';

import { useCallback, useEffect, useState } from 'react';
import { SalonShell } from '../../../components/SalonShell';
import { useAuth } from '../../../lib/auth';
import { apiFetch } from '../../../lib/api';
import { ui } from '../../../lib/ui';
import { useLang, tr } from '../../../lib/i18n';
import { ImportCsv } from '../../../components/ImportCsv';

interface Table { id: string; name: string; seats: number; area: string | null; isActive: boolean; sortOrder: number }

const SAMPLE_TABLES = `name,seats,area
M1,2,Main Dining
M2,2,Main Dining
M3,4,Main Dining
M4,4,Main Dining
M5,4,Main Dining
M6,4,Main Dining
M7,6,Main Dining
M8,6,Main Dining
M9,4,Main Dining
M10,2,Main Dining
W1,2,Window
W2,2,Window
W3,4,Window
W4,4,Window
P1,4,Patio
P2,4,Patio
P3,6,Patio
P4,6,Patio
P5,8,Patio
VIP1,10,Private Room
VIP2,12,Private Room
B1,2,Bar
B2,2,Bar
B3,2,Bar`;

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

  async function loadSampleRes() {
    setBusy(true); setErr(null);
    try {
      const svcs = await apiFetch<{ id: string; name: string }[]>('/services', { token });
      const svc = svcs.find((sv) => /reserv|table/i.test(sv.name)) || svcs[0];
      if (!svc) { setErr('No reservation service — set this tenant to Restaurant first.'); return; }
      const at = (h: number, m: number) => { const d = new Date(); d.setHours(h, m, 0, 0); return d.toISOString(); };
      const RES: [string, string, string, number, string][] = [
        ['Emily', 'Tran', '4155550101', 2, at(17, 0)],
        ['Michael', 'Nguyen', '4155550102', 4, at(17, 30)],
        ['The Johnson', 'Family', '4155550103', 6, at(18, 0)],
        ['David', 'Chen', '4155550104', 10, at(18, 0)],
        ['Sarah', 'Pham', '4155550105', 2, at(18, 30)],
        ['James', 'Le', '4155550106', 4, at(19, 0)],
        ['Birthday', 'Party', '4155550107', 8, at(19, 0)],
        ['Jessica', 'Do', '4155550108', 2, at(19, 30)],
        ['Kevin', 'Vo', '4155550109', 4, at(19, 30)],
        ['Company', 'Group', '4155550110', 12, at(20, 0)],
        ['Amanda', 'Hoang', '4155550111', 2, at(20, 0)],
        ['Brian', 'Dang', '4155550112', 6, at(20, 30)],
      ];
      let n = 0;
      for (const [fn, ln, ph, party, startTime] of RES) {
        try { await apiFetch('/bookings', { method: 'POST', token, body: { serviceId: svc.id, startTime, partySize: party, customerFirstName: fn, customerLastName: ln, customerPhone: ph } }); n++; } catch { /* skip */ }
      }
      alert('Added ' + n + ' reservations for today. Open Calendar and switch to the Tables view.');
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed'); }
    finally { setBusy(false); }
  }

  return (
    <section style={{ maxWidth: 720 }}>
      <h1 style={{ fontSize: 22, margin: '0 0 4px' }}>{t('tb.title')}</h1>
      <p style={{ color: '#94a3b8', fontSize: 14, marginTop: 0 }}>{t('tb.subtitle')}</p>
      {err && <div style={ui.banner}>{err}</div>}

      <ImportCsv token={token} endpoint="/tables" header="name,seats,area" sample={SAMPLE_TABLES} existing={() => new Set(tables.map((tb) => tb.name.toLowerCase()))} buildBody={(c) => ({ name: c[0], seats: parseInt(c[1], 10) || 2, area: c[2] || undefined })} onDone={load} />
      <button onClick={loadSampleRes} disabled={busy} style={{ padding: '7px 12px', borderRadius: 8, border: '1px solid #334155', background: 'transparent', color: '#cbd5e1', fontSize: 13, cursor: 'pointer', marginBottom: 14 }}>+ Sample reservations (today)</button>

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
