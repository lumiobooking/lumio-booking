'use client';

import { Fragment, useCallback, useEffect, useState, FormEvent } from 'react';
import { SalonShell } from '../../../components/SalonShell';
import { useAuth } from '../../../lib/auth';
import { apiFetch } from '../../../lib/api';
import { ui, formatPrice } from '../../../lib/ui';
import { useLang, tr } from '../../../lib/i18n';
import { SearchBox, matchesQuery, sortNewest, usePaged, Pager } from '../../../components/ListFilter';

interface Product {
  id: string; name: string; sku: string | null; priceCents: number; discountPercent?: number; currency: string;
  taxable: boolean; trackStock: boolean; stockQty: number; isActive: boolean; createdAt?: string;
}

function netCents(p: { priceCents: number; discountPercent?: number }) {
  return p.discountPercent && p.discountPercent > 0
    ? Math.round((p.priceCents * (100 - p.discountPercent)) / 100)
    : p.priceCents;
}

export default function ProductsPage() {
  return (
    <SalonShell>
      <Inner />
    </SalonShell>
  );
}

function Inner() {
  const { token } = useAuth();
  const { lang } = useLang();
  const t = (k: string) => tr(k, lang);
  const [q, setQ] = useState('');
  const [products, setProducts] = useState<Product[]>([]);
  const [taxRate, setTaxRate] = useState('');
  const [footer, setFooter] = useState('');
  const [savedTax, setSavedTax] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const [p, settings] = await Promise.all([
        apiFetch<Product[]>('/pos/products', { token }),
        apiFetch<{ pos?: { taxRatePercent?: number; receiptFooter?: string } }>('/settings', { token }),
      ]);
      setProducts(p);
      setTaxRate(String(settings.pos?.taxRatePercent ?? 0));
      setFooter(settings.pos?.receiptFooter ?? '');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load products');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  async function saveTax() {
    setError(null);
    try {
      await apiFetch('/settings/pos', { method: 'PATCH', token, body: { taxRatePercent: parseFloat(taxRate) || 0, receiptFooter: footer } });
      setSavedTax(true);
      setTimeout(() => setSavedTax(false), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    }
  }

  async function remove(id: string) {
    if (!confirm(t('pd.confirmDelete'))) return;
    try { await apiFetch(`/pos/products/${id}`, { method: 'DELETE', token }); await load(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Delete failed'); }
  }

  const visible = sortNewest(
    products.filter((p) => matchesQuery(`${p.name} ${p.sku ?? ''}`, q)),
    (p) => p.createdAt,
  );
  const pg = usePaged(visible, 25);

  return (
    <section>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <h1 style={{ fontSize: 22, margin: 0 }}>{t('pd.title')}</h1>
        <button onClick={() => { setShowForm((s) => !s); setEditId(null); }} style={ui.primaryBtn}>{showForm ? t('pd.close') : t('pd.newProduct')}</button>
      </div>

      {error && <div style={ui.banner}>{error}</div>}

      {/* Tax + receipt config */}
      <div style={{ ...ui.card, marginBottom: 16, display: 'flex', gap: 14, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <label>
          <span style={ui.label}>{t('pd.salesTax')}</span>
          <input type="number" min={0} step="0.01" value={taxRate} onChange={(e) => setTaxRate(e.target.value)} style={{ ...ui.input, width: 140 }} />
        </label>
        <label style={{ flex: 1, minWidth: 200 }}>
          <span style={ui.label}>{t('pd.receiptFooter')}</span>
          <input value={footer} onChange={(e) => setFooter(e.target.value)} style={ui.input} placeholder={t('pd.receiptFooterPh')} />
        </label>
        <button onClick={saveTax} style={ui.primaryBtn}>{t('pd.save')}</button>
        {savedTax && <span style={{ color: '#22c55e', fontSize: 13 }}>{t('pd.saved')}</span>}
      </div>

      {showForm && <ProductForm token={token!} onDone={async () => { setShowForm(false); await load(); }} />}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 16 }}>
        <SearchBox value={q} onChange={setQ} placeholder={t('pd.searchPh')} />
        <span style={{ color: '#94a3b8', fontSize: 13 }}>{visible.length} {t('pd.productsWord')}</span>
      </div>

      {loading ? <p style={{ color: '#94a3b8' }}>{t('pd.loading')}</p> : (
        <div style={{ border: '1px solid #334155', borderRadius: 12, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead><tr style={{ background: '#1e293b' }}>
              <th style={ui.th}>{t('pd.colName')}</th><th style={ui.th}>{t('pd.colPrice')}</th><th style={ui.th}>{t('pd.colTaxable')}</th><th style={ui.th}>{t('pd.colStock')}</th><th style={ui.th}>{t('pd.colStatus')}</th><th style={ui.th}>{t('pd.colActions')}</th>
            </tr></thead>
            <tbody>
              {visible.length === 0 && <tr><td style={ui.td} colSpan={6}>{t('pd.empty')}</td></tr>}
              {pg.paged.map((p) => (
                <Fragment key={p.id}>
                  <tr style={{ borderTop: '1px solid #334155' }}>
                    <td style={ui.td}>{p.name}{p.sku ? <span style={{ color: '#64748b', fontSize: 12 }}> · {p.sku}</span> : null}</td>
                    <td style={ui.td}>
                      {p.discountPercent && p.discountPercent > 0 ? (
                        <span>
                          <span style={{ textDecoration: 'line-through', color: '#94a3b8', marginRight: 6 }}>{formatPrice(p.priceCents, p.currency)}</span>
                          <span style={{ color: '#22c55e', fontWeight: 600 }}>{formatPrice(netCents(p), p.currency)}</span>
                          <span style={{ marginLeft: 6, background: '#ef4444', color: '#fff', borderRadius: 6, padding: '1px 6px', fontSize: 11, fontWeight: 700 }}>-{p.discountPercent}%</span>
                        </span>
                      ) : formatPrice(p.priceCents, p.currency)}
                    </td>
                    <td style={ui.td}>{p.taxable ? t('pd.yes') : t('pd.no')}</td>
                    <td style={ui.td}>{p.trackStock ? p.stockQty : '—'}</td>
                    <td style={ui.td}><span style={{ color: p.isActive ? '#22c55e' : '#94a3b8' }}>{p.isActive ? t('pd.active') : t('pd.inactive')}</span></td>
                    <td style={ui.td}>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button onClick={() => setEditId(editId === p.id ? null : p.id)} style={{ ...ui.primaryBtn, padding: '6px 12px', fontSize: 12, background: editId === p.id ? '#475569' : '#6366f1' }}>{editId === p.id ? t('pd.close') : t('pd.edit')}</button>
                        <button onClick={() => remove(p.id)} style={ui.dangerBtn}>{t('pd.delete')}</button>
                      </div>
                    </td>
                  </tr>
                  {editId === p.id && (
                    <tr><td colSpan={6} style={{ padding: 16, background: '#0f172a' }}>
                      <ProductForm token={token!} product={p} onDone={async () => { setEditId(null); await load(); }} />
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

function ProductForm({ token, product, onDone }: { token: string; product?: Product; onDone: () => void }) {
  const { lang } = useLang();
  const t = (k: string) => tr(k, lang);
  const [form, setForm] = useState({
    name: product?.name ?? '',
    sku: product?.sku ?? '',
    price: product ? (product.priceCents / 100).toString() : '',
    discountPercent: product ? String(product.discountPercent ?? 0) : '0',
    taxable: product?.taxable ?? true,
    trackStock: product?.trackStock ?? false,
    stockQty: product ? String(product.stockQty) : '0',
    isActive: product?.isActive ?? true,
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true); setError(null);
    try {
      const body = {
        name: form.name,
        sku: form.sku || undefined,
        priceCents: Math.round((parseFloat(form.price) || 0) * 100),
        discountPercent: Math.max(0, Math.min(90, parseInt(form.discountPercent, 10) || 0)),
        taxable: form.taxable,
        trackStock: form.trackStock,
        stockQty: parseInt(form.stockQty, 10) || 0,
        isActive: form.isActive,
      };
      if (product) await apiFetch(`/pos/products/${product.id}`, { method: 'PATCH', token, body });
      else await apiFetch('/pos/products', { method: 'POST', token, body });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally { setSaving(false); }
  }

  return (
    <form onSubmit={submit} style={product ? {} : { ...ui.card, marginBottom: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
        <label><span style={ui.label}>{t('pd.fName')}</span><input style={ui.input} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></label>
        <label><span style={ui.label}>{t('pd.sku')}</span><input style={ui.input} value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} /></label>
        <label><span style={ui.label}>{t('pd.price')}</span><input style={ui.input} type="number" min={0} step="0.01" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} required /></label>
        <label><span style={ui.label}>{t('pd.discount')}</span><input style={ui.input} type="number" min={0} max={90} value={form.discountPercent} onChange={(e) => setForm({ ...form, discountPercent: e.target.value })} /></label>
        <label><span style={ui.label}>{t('pd.stockQty')}</span><input style={ui.input} type="number" min={0} value={form.stockQty} onChange={(e) => setForm({ ...form, stockQty: e.target.value })} disabled={!form.trackStock} /></label>
      </div>
      <div style={{ display: 'flex', gap: 18, marginTop: 12, flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}><input type="checkbox" checked={form.taxable} onChange={(e) => setForm({ ...form, taxable: e.target.checked })} /> {t('pd.taxable')}</label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}><input type="checkbox" checked={form.trackStock} onChange={(e) => setForm({ ...form, trackStock: e.target.checked })} /> {t('pd.trackStock')}</label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}><input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} /> {t('pd.activeLabel')}</label>
      </div>
      {error && <div style={ui.banner}>{error}</div>}
      <button type="submit" disabled={saving} style={{ ...ui.primaryBtn, marginTop: 14 }}>{saving ? t('pd.saving') : product ? t('pd.saveChanges') : t('pd.createProduct')}</button>
    </form>
  );
}
