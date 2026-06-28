'use client';

import { Fragment, useCallback, useEffect, useState, FormEvent } from 'react';
import { SalonShell } from '../../../components/SalonShell';
import { useAuth } from '../../../lib/auth';
import { apiFetch } from '../../../lib/api';
import { ui, formatPrice } from '../../../lib/ui';
import { useLang, tr } from '../../../lib/i18n';
import { SearchBox, matchesQuery, usePaged, Pager } from '../../../components/ListFilter';

interface Supply {
  id: string; name: string; unit: string; stockQty: number; lowStockThreshold: number;
  costCents: number | null; supplier: string | null; isActive: boolean; lowStock: boolean;
}

export default function InventoryPage() {
  return <SalonShell><Inner /></SalonShell>;
}

function Inner() {
  const { token } = useAuth();
  const { lang } = useLang();
  const t = (k: string) => tr(k, lang);
  const [q, setQ] = useState('');
  const [lowOnly, setLowOnly] = useState(false);
  const [items, setItems] = useState<Supply[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true); setError(null);
    try { setItems(await apiFetch<Supply[]>('/supplies', { token })); }
    catch (err) { setError(err instanceof Error ? err.message : 'Failed to load'); }
    finally { setLoading(false); }
  }, [token]);
  useEffect(() => { load(); }, [load]);

  async function adjust(id: string, delta: number) {
    try { await apiFetch(`/supplies/${id}/adjust`, { method: 'PATCH', token, body: { delta } }); await load(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Failed'); }
  }
  async function remove(id: string) {
    if (!confirm(t('iv.confirmDelete'))) return;
    try { await apiFetch(`/supplies/${id}`, { method: 'DELETE', token }); await load(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Delete failed'); }
  }

  const lowCount = items.filter((i) => i.lowStock).length;
  const visible = items.filter((i) => matchesQuery(`${i.name} ${i.supplier ?? ''}`, q) && (!lowOnly || i.lowStock));
  const pg = usePaged(visible, 25);

  return (
    <section>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h1 style={{ fontSize: 22, margin: 0 }}>{t('iv.title')}</h1>
          <p style={{ color: '#94a3b8', margin: '4px 0 0', fontSize: 14 }}>{t('iv.subtitle')}</p>
        </div>
        <button onClick={() => { setShowForm((s) => !s); setEditId(null); }} style={ui.primaryBtn}>{showForm ? t('iv.close') : t('iv.newItem')}</button>
      </div>

      {error && <div style={ui.banner}>{error}</div>}
      {lowCount > 0 && (
        <div style={{ background: '#3f2d0e', color: '#fde68a', padding: '9px 14px', borderRadius: 8, fontSize: 13, margin: '12px 0' }}>
          {t('iv.lowBanner').replace('{n}', String(lowCount))}
        </div>
      )}

      {showForm && <SupplyForm token={token!} onDone={async () => { setShowForm(false); await load(); }} />}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, margin: '14px 0 16px' }}>
        <SearchBox value={q} onChange={setQ} placeholder={t('iv.searchPh')} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={() => setLowOnly((v) => !v)} style={{ padding: '7px 12px', borderRadius: 8, border: `1px solid ${lowOnly ? '#f59e0b' : '#475569'}`, background: lowOnly ? '#78350f' : 'transparent', color: lowOnly ? '#fde68a' : '#cbd5e1', fontSize: 13, cursor: 'pointer', fontWeight: 600 }}>{t('iv.lowOnly')}</button>
          <span style={{ color: '#94a3b8', fontSize: 13 }}>{visible.length} {t('iv.itemsWord')}</span>
        </div>
      </div>

      {loading ? <p style={{ color: '#94a3b8' }}>{t('iv.loading')}</p> : (
        <div style={{ border: '1px solid #334155', borderRadius: 12, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead><tr style={{ background: '#1e293b' }}>
              <th style={ui.th}>{t('iv.colName')}</th>
              <th style={{ ...ui.th, whiteSpace: 'nowrap' }}>{t('iv.colStock')}</th>
              <th style={{ ...ui.th, whiteSpace: 'nowrap' }}>{t('iv.colThreshold')}</th>
              <th style={{ ...ui.th, whiteSpace: 'nowrap' }}>{t('iv.colCost')}</th>
              <th style={ui.th}>{t('iv.colSupplier')}</th>
              <th style={ui.th}>{t('iv.colActions')}</th>
            </tr></thead>
            <tbody>
              {visible.length === 0 && <tr><td style={ui.td} colSpan={6}>{t('iv.empty')}</td></tr>}
              {pg.paged.map((i) => (
                <Fragment key={i.id}>
                  <tr style={{ borderTop: '1px solid #334155', opacity: i.isActive ? 1 : 0.5 }}>
                    <td style={ui.td}>
                      {i.name}{' '}
                      {i.lowStock && <span style={{ marginLeft: 4, background: '#7f1d1d', color: '#fecaca', borderRadius: 6, padding: '1px 7px', fontSize: 10, fontWeight: 700 }}>{t('iv.low')}</span>}
                    </td>
                    <td style={ui.td}>
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <button onClick={() => adjust(i.id, -1)} style={qtyBtn}>−</button>
                        <span style={{ minWidth: 44, textAlign: 'center', fontWeight: 700, color: i.lowStock ? '#f59e0b' : '#e2e8f0' }}>{i.stockQty} <span style={{ color: '#64748b', fontWeight: 400, fontSize: 12 }}>{i.unit}</span></span>
                        <button onClick={() => adjust(i.id, 1)} style={qtyBtn}>+</button>
                      </div>
                    </td>
                    <td style={{ ...ui.td, color: '#94a3b8' }}>{i.lowStockThreshold}</td>
                    <td style={{ ...ui.td, color: '#94a3b8' }}>{i.costCents != null ? formatPrice(i.costCents) : '—'}</td>
                    <td style={{ ...ui.td, color: '#94a3b8' }}>{i.supplier || '—'}</td>
                    <td style={ui.td}>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button onClick={() => setEditId(editId === i.id ? null : i.id)} style={{ ...ui.primaryBtn, padding: '6px 12px', fontSize: 12, background: editId === i.id ? '#475569' : '#6366f1' }}>{editId === i.id ? t('iv.close') : t('iv.edit')}</button>
                        <button onClick={() => remove(i.id)} style={ui.dangerBtn}>{t('iv.delete')}</button>
                      </div>
                    </td>
                  </tr>
                  {editId === i.id && (
                    <tr><td colSpan={6} style={{ padding: 16, background: '#0f172a' }}>
                      <SupplyForm token={token!} item={i} onDone={async () => { setEditId(null); await load(); }} />
                    </td></tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
          <div style={{ padding: '0 14px 12px' }}><Pager paged={pg} /></div>
        </div>
      )}
    </section>
  );
}

function SupplyForm({ token, item, onDone }: { token: string; item?: Supply; onDone: () => void }) {
  const { lang } = useLang();
  const t = (k: string) => tr(k, lang);
  const [form, setForm] = useState({
    name: item?.name ?? '',
    unit: item?.unit ?? 'unit',
    stockQty: item ? String(item.stockQty) : '0',
    lowStockThreshold: item ? String(item.lowStockThreshold) : '0',
    cost: item?.costCents != null ? (item.costCents / 100).toString() : '',
    supplier: item?.supplier ?? '',
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true); setError(null);
    try {
      const body = {
        name: form.name,
        unit: form.unit || 'unit',
        stockQty: parseInt(form.stockQty, 10) || 0,
        lowStockThreshold: parseInt(form.lowStockThreshold, 10) || 0,
        costCents: form.cost.trim() ? Math.round((parseFloat(form.cost) || 0) * 100) : undefined,
        supplier: form.supplier.trim() || undefined,
      };
      if (item) await apiFetch(`/supplies/${item.id}`, { method: 'PATCH', token, body });
      else await apiFetch('/supplies', { method: 'POST', token, body });
      onDone();
    } catch (err) { setError(err instanceof Error ? err.message : 'Save failed'); }
    finally { setSaving(false); }
  }

  return (
    <form onSubmit={submit} style={item ? {} : { ...ui.card, marginBottom: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
        <label><span style={ui.label}>{t('iv.fName')}</span><input style={ui.input} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></label>
        <label><span style={ui.label}>{t('iv.fUnit')}</span><input style={ui.input} value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} placeholder={t('iv.fUnitPh')} /></label>
        <label><span style={ui.label}>{t('iv.fStock')}</span><input style={ui.input} type="number" min={0} value={form.stockQty} onChange={(e) => setForm({ ...form, stockQty: e.target.value })} /></label>
        <label><span style={ui.label}>{t('iv.fThreshold')}</span><input style={ui.input} type="number" min={0} value={form.lowStockThreshold} onChange={(e) => setForm({ ...form, lowStockThreshold: e.target.value })} /></label>
        <label><span style={ui.label}>{t('iv.fCost')}</span><input style={ui.input} type="number" min={0} step="0.01" value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })} /></label>
        <label><span style={ui.label}>{t('iv.fSupplier')}</span><input style={ui.input} value={form.supplier} onChange={(e) => setForm({ ...form, supplier: e.target.value })} /></label>
      </div>
      {error && <div style={ui.banner}>{error}</div>}
      <button type="submit" disabled={saving} style={{ ...ui.primaryBtn, marginTop: 14 }}>{saving ? t('iv.saving') : item ? t('iv.saveChanges') : t('iv.create')}</button>
    </form>
  );
}

const qtyBtn: React.CSSProperties = {
  width: 28, height: 28, borderRadius: 6, border: '1px solid #475569', background: 'transparent', color: '#e2e8f0', cursor: 'pointer', fontSize: 16, lineHeight: 1,
};
