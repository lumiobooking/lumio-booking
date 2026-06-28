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
  const [moveFor, setMoveFor] = useState<{ id: string; dir: 'IN' | 'OUT' } | null>(null);
  const [histFor, setHistFor] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true); setError(null);
    try { setItems(await apiFetch<Supply[]>('/supplies', { token })); }
    catch (err) { setError(err instanceof Error ? err.message : 'Failed to load'); }
    finally { setLoading(false); }
  }, [token]);
  useEffect(() => { load(); }, [load]);

  async function adjust(id: string, delta: number) {
    try { await apiFetch(`/supplies/${id}/move`, { method: 'POST', token, body: { delta, reason: 'ADJUST' } }); await load(); }
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
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        <button onClick={() => { setMoveFor({ id: i.id, dir: 'IN' }); setHistFor(null); setEditId(null); }} style={{ ...ui.primaryBtn, padding: '6px 11px', fontSize: 12, background: '#16a34a' }}>{t('iv.stockIn')}</button>
                        <button onClick={() => { setMoveFor({ id: i.id, dir: 'OUT' }); setHistFor(null); setEditId(null); }} style={{ ...ui.primaryBtn, padding: '6px 11px', fontSize: 12, background: '#d97706' }}>{t('iv.stockOut')}</button>
                        <button onClick={() => { setHistFor(histFor === i.id ? null : i.id); setMoveFor(null); }} style={{ ...ui.primaryBtn, padding: '6px 11px', fontSize: 12, background: histFor === i.id ? '#475569' : '#334155' }}>{t('iv.history')}</button>
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
                  {moveFor?.id === i.id && (
                    <tr><td colSpan={6} style={{ padding: 16, background: '#0f172a' }}>
                      <MovePanel token={token!} item={i} dir={moveFor.dir} onDone={async () => { setMoveFor(null); await load(); }} onCancel={() => setMoveFor(null)} />
                    </td></tr>
                  )}
                  {histFor === i.id && (
                    <tr><td colSpan={6} style={{ padding: 16, background: '#0f172a' }}>
                      <HistoryPanel token={token!} item={i} />
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

interface Movement { id: string; delta: number; reason: string; note: string | null; unitCostCents: number | null; createdAt: string }
const REASON_KEY: Record<string, string> = { PURCHASE: 'iv.rPurchase', USE: 'iv.rUse', DAMAGE: 'iv.rDamage', RETURN: 'iv.rReturn', ADJUST: 'iv.rAdjust' };

/** Record a documented stock-in (purchase) or stock-out (use/damage/return). */
function MovePanel({ token, item, dir, onDone, onCancel }: { token: string; item: Supply; dir: 'IN' | 'OUT'; onDone: () => void; onCancel: () => void }) {
  const { lang } = useLang();
  const t = (k: string) => tr(k, lang);
  const reasons = dir === 'IN'
    ? [{ v: 'PURCHASE', k: 'iv.rPurchase' }, { v: 'ADJUST', k: 'iv.rAdjust' }]
    : [{ v: 'USE', k: 'iv.rUse' }, { v: 'DAMAGE', k: 'iv.rDamage' }, { v: 'RETURN', k: 'iv.rReturn' }, { v: 'ADJUST', k: 'iv.rAdjust' }];
  const [qty, setQty] = useState('1');
  const [reason, setReason] = useState(reasons[0].v);
  const [note, setNote] = useState('');
  const [cost, setCost] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const n = Math.abs(parseInt(qty, 10) || 0);
    if (!n) { setErr(t('iv.qtyErr')); return; }
    setBusy(true); setErr(null);
    try {
      await apiFetch(`/supplies/${item.id}/move`, {
        method: 'POST', token,
        body: { delta: dir === 'IN' ? n : -n, reason, note: note.trim() || undefined, unitCostCents: dir === 'IN' && cost ? Math.round(parseFloat(cost) * 100) : undefined },
      });
      onDone();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed'); } finally { setBusy(false); }
  }

  return (
    <form onSubmit={submit}>
      <div style={{ fontSize: 13, fontWeight: 700, color: dir === 'IN' ? '#22c55e' : '#f59e0b', marginBottom: 10 }}>
        {dir === 'IN' ? t('iv.stockIn') : t('iv.stockOut')} — {item.name} <span style={{ color: '#64748b', fontWeight: 400 }}>({t('iv.mNow')}: {item.stockQty} {item.unit})</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, alignItems: 'end' }}>
        <label style={{ display: 'flex', flexDirection: 'column' }}><span style={ui.label}>{t('iv.mQty')} ({item.unit})</span>
          <input style={ui.input} type="number" min={1} value={qty} onChange={(e) => setQty(e.target.value)} autoFocus /></label>
        <label style={{ display: 'flex', flexDirection: 'column' }}><span style={ui.label}>{t('iv.mReason')}</span>
          <select style={ui.input} value={reason} onChange={(e) => setReason(e.target.value)}>
            {reasons.map((r) => <option key={r.v} value={r.v}>{t(r.k)}</option>)}
          </select></label>
        {dir === 'IN' && (
          <label style={{ display: 'flex', flexDirection: 'column' }}><span style={ui.label}>{t('iv.mUnitCost')}</span>
            <input style={ui.input} type="number" min={0} step="0.01" value={cost} onChange={(e) => setCost(e.target.value)} /></label>
        )}
        <label style={{ display: 'flex', flexDirection: 'column' }}><span style={ui.label}>{t('iv.mNote')}</span>
          <input style={ui.input} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('iv.mNotePh')} /></label>
      </div>
      {err && <div style={{ ...ui.banner, marginTop: 10 }}>{err}</div>}
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button type="submit" disabled={busy} style={{ ...ui.primaryBtn, background: dir === 'IN' ? '#16a34a' : '#d97706' }}>{busy ? t('iv.saving') : t('iv.mConfirm')}</button>
        <button type="button" onClick={onCancel} style={{ padding: '9px 14px', borderRadius: 8, border: '1px solid #475569', background: 'transparent', color: '#e2e8f0', fontSize: 14, cursor: 'pointer' }}>{t('iv.close')}</button>
      </div>
    </form>
  );
}

/** Movement history (newest first) for one supply item. */
function HistoryPanel({ token, item }: { token: string; item: Supply }) {
  const { lang } = useLang();
  const t = (k: string) => tr(k, lang);
  const [rows, setRows] = useState<Movement[] | null>(null);
  useEffect(() => {
    apiFetch<Movement[]>(`/supplies/${item.id}/movements`, { token }).then(setRows).catch(() => setRows([]));
  }, [item.id, token]);
  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 700, color: '#cbd5e1', marginBottom: 8 }}>{t('iv.history')} — {item.name}</div>
      {rows === null ? <p style={{ color: '#94a3b8', fontSize: 13 }}>{t('iv.loading')}</p>
        : rows.length === 0 ? <p style={{ color: '#64748b', fontSize: 13 }}>{t('iv.noHistory')}</p>
        : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 280, overflowY: 'auto' }}>
            {rows.map((m) => (
              <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, padding: '5px 8px', background: '#1e293b', borderRadius: 6 }}>
                <span style={{ width: 56, fontWeight: 700, textAlign: 'right', color: m.delta >= 0 ? '#22c55e' : '#f59e0b' }}>{m.delta >= 0 ? '+' : ''}{m.delta}</span>
                <span style={{ color: '#cbd5e1', minWidth: 120 }}>{t(REASON_KEY[m.reason] ?? 'iv.rAdjust')}</span>
                <span style={{ color: '#94a3b8', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.note || ''}</span>
                <span style={{ color: '#64748b', whiteSpace: 'nowrap' }}>{new Date(m.createdAt).toLocaleString('en-US')}</span>
              </div>
            ))}
          </div>
        )}
    </div>
  );
}
