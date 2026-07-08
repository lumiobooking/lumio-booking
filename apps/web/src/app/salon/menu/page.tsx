'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { SalonShell } from '../../../components/SalonShell';
import { useAuth } from '../../../lib/auth';
import { apiFetch } from '../../../lib/api';
import { ui, formatPrice } from '../../../lib/ui';
import { useLang, tr } from '../../../lib/i18n';

interface Item { id: string; name: string; category: string | null; priceCents: number; currency: string; description: string | null; isActive: boolean; sortOrder: number }

export default function MenuPage() {
  return <SalonShell><Inner /></SalonShell>;
}

function Inner() {
  const { token } = useAuth();
  const { lang } = useLang();
  const t = (k: string) => tr(k, lang);
  const [items, setItems] = useState<Item[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', category: '', price: '', description: '' });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    try { setItems(await apiFetch<Item[]>('/menu-items', { token })); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Failed to load'); }
  }, [token]);
  useEffect(() => { load(); }, [load]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return;
    setBusy(true); setErr(null);
    try {
      await apiFetch('/menu-items', {
        method: 'POST', token,
        body: {
          name: form.name.trim(),
          category: form.category.trim() || undefined,
          priceCents: Math.round((parseFloat(form.price) || 0) * 100),
          description: form.description.trim() || undefined,
        },
      });
      setForm({ name: '', category: '', price: '', description: '' });
      await load();
    } catch (e2) { setErr(e2 instanceof Error ? e2.message : 'Failed'); }
    finally { setBusy(false); }
  }
  async function patch(id: string, data: Record<string, unknown>) {
    try { await apiFetch(`/menu-items/${id}`, { method: 'PATCH', token, body: data }); await load(); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Failed'); }
  }
  async function remove(id: string) {
    try { await apiFetch(`/menu-items/${id}`, { method: 'DELETE', token }); await load(); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Failed'); }
  }

  const grouped = useMemo(() => {
    const m = new Map<string, Item[]>();
    for (const it of items) { const k = it.category || '—'; const a = m.get(k) ?? []; a.push(it); m.set(k, a); }
    return Array.from(m.entries());
  }, [items]);

  return (
    <section style={{ maxWidth: 820 }}>
      <h1 style={{ fontSize: 22, margin: '0 0 4px' }}>{t('mn.title')}</h1>
      <p style={{ color: '#94a3b8', fontSize: 14, marginTop: 0 }}>{t('mn.subtitle')}</p>
      {err && <div style={ui.banner}>{err}</div>}

      <form onSubmit={add} style={{ ...ui.card, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label style={{ flex: '2 1 160px' }}><span style={ui.label}>{t('mn.name')}</span>
          <input style={ui.input} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Phở tái" /></label>
        <label style={{ flex: '1 1 120px' }}><span style={ui.label}>{t('mn.category')}</span>
          <input style={ui.input} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="Phở" list="mn-cats" />
          <datalist id="mn-cats">{Array.from(new Set(items.map((i) => i.category).filter(Boolean))).map((c) => <option key={c} value={c as string} />)}</datalist></label>
        <label style={{ flex: '0 1 90px' }}><span style={ui.label}>{t('mn.price')} ($)</span>
          <input style={ui.input} type="number" min={0} step="0.5" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} placeholder="14" /></label>
        <label style={{ flex: '3 1 200px' }}><span style={ui.label}>{t('mn.desc')}</span>
          <input style={ui.input} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Rare beef pho" /></label>
        <button type="submit" disabled={busy} style={ui.primaryBtn}>{t('mn.add')}</button>
      </form>

      {items.length === 0 && <p style={{ color: '#64748b', fontSize: 14, marginTop: 16 }}>{t('mn.empty')}</p>}

      {grouped.map(([cat, list]) => (
        <div key={cat} style={{ marginTop: 18 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#818cf8', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 6 }}>{cat} <span style={{ color: '#475569' }}>· {list.length}</span></div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {list.map((it) => (
              <div key={it.id} style={{ ...ui.card, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', padding: 10, opacity: it.isActive ? 1 : 0.5 }}>
                <input style={{ ...ui.input, flex: '2 1 150px', minWidth: 120 }} value={it.name}
                  onChange={(e) => setItems((xs) => xs.map((x) => (x.id === it.id ? { ...x, name: e.target.value } : x)))}
                  onBlur={(e) => patch(it.id, { name: e.target.value })} />
                <input style={{ ...ui.input, width: 120 }} value={it.category ?? ''} placeholder={t('mn.category')}
                  onChange={(e) => setItems((xs) => xs.map((x) => (x.id === it.id ? { ...x, category: e.target.value } : x)))}
                  onBlur={(e) => patch(it.id, { category: e.target.value })} />
                <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                  <span style={{ color: '#94a3b8' }}>$</span>
                  <input style={{ ...ui.input, width: 78 }} type="number" min={0} step="0.5" value={(it.priceCents / 100).toString()}
                    onChange={(e) => setItems((xs) => xs.map((x) => (x.id === it.id ? { ...x, priceCents: Math.round((parseFloat(e.target.value) || 0) * 100) } : x)))}
                    onBlur={(e) => patch(it.id, { priceCents: Math.round((parseFloat(e.target.value) || 0) * 100) })} />
                </div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 13, color: '#cbd5e1' }}>
                  <input type="checkbox" checked={it.isActive} onChange={(e) => patch(it.id, { isActive: e.target.checked })} />{t('mn.active')}
                </label>
                <button onClick={() => remove(it.id)} style={{ marginLeft: 'auto', background: 'none', border: '1px solid #ef4444', color: '#ef4444', borderRadius: 6, padding: '5px 10px', cursor: 'pointer', fontSize: 13 }}>{t('mn.delete')}</button>
              </div>
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}
