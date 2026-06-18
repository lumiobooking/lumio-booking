'use client';

import { useCallback, useEffect, useState, FormEvent } from 'react';
import { SalonShell } from '../../../components/SalonShell';
import { useAuth } from '../../../lib/auth';
import { apiFetch } from '../../../lib/api';
import { ui, formatPrice } from '../../../lib/ui';
import { SearchBox, matchesQuery, sortNewest, usePaged, Pager } from '../../../components/ListFilter';

interface Service {
  id: string;
  name: string;
  description: string | null;
  durationMinutes: number;
  priceCents: number;
  discountPercent?: number;
  currency: string;
  isActive: boolean;
  createdAt?: string;
  categoryId?: string | null;
  isFeatured?: boolean;
  priceFrom?: boolean;
  sortOrder?: number;
}

interface Category { id: string; name: string; icon: string | null; sortOrder: number; isActive: boolean }

export default function ServicesPage() {
  return (
    <SalonShell>
      <ServicesInner />
    </SalonShell>
  );
}

function ServicesInner() {
  const { token } = useAuth();
  const [q, setQ] = useState('');
  const [services, setServices] = useState<Service[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [catFilter, setCatFilter] = useState<string>('all');

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const [svc, cats] = await Promise.all([
        apiFetch<Service[]>('/services', { token }),
        apiFetch<Category[]>('/services/categories', { token }),
      ]);
      setServices(svc);
      setCategories(cats);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load services');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  async function toggleActive(s: Service) {
    try {
      await apiFetch(`/services/${s.id}`, {
        method: 'PATCH',
        token,
        body: { isActive: !s.isActive },
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed');
    }
  }

  async function remove(id: string) {
    if (!confirm('Delete this service?')) return;
    try {
      await apiFetch(`/services/${id}`, { method: 'DELETE', token });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    }
  }

  const catName = (id?: string | null) => categories.find((c) => c.id === id)?.name ?? '—';

  // Search + category filter, then newest first. (No date filter — a service
  // menu shouldn't be hidden by when it was created.)
  const visible = sortNewest(
    services.filter((s) =>
      matchesQuery(`${s.name} ${s.description ?? ''}`, q) &&
      (catFilter === 'all' || (catFilter === 'none' ? !s.categoryId : s.categoryId === catFilter))),
    (s) => s.createdAt,
  );
  const pg = usePaged(visible, 25);

  return (
    <section>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <h2 style={{ fontSize: 18, margin: 0 }}>Services</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => { setShowImport((s) => !s); setShowForm(false); }} style={{ ...ui.primaryBtn, background: 'transparent', border: '1px solid #475569' }}>
            {showImport ? 'Close' : '⇪ Import menu'}
          </button>
          <button onClick={() => { setShowForm((s) => !s); setShowImport(false); }} style={ui.primaryBtn}>
            {showForm ? 'Close' : '+ New service'}
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 16 }}>
        <SearchBox value={q} onChange={setQ} placeholder="Search service name…" />
        <span style={{ color: '#94a3b8', fontSize: 13 }}>{visible.length} service{visible.length === 1 ? '' : 's'}</span>
      </div>

      {error && <div style={ui.banner}>{error}</div>}

      {showImport && <ImportPanel token={token!} onDone={async () => { setShowImport(false); await load(); }} />}

      <CategoryManager token={token!} categories={categories} onChanged={load} />

      {categories.length > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '4px 0 16px' }}>
          <FilterChip active={catFilter === 'all'} onClick={() => setCatFilter('all')}>All</FilterChip>
          {categories.map((c) => (
            <FilterChip key={c.id} active={catFilter === c.id} onClick={() => setCatFilter(c.id)}>{c.name}</FilterChip>
          ))}
          <FilterChip active={catFilter === 'none'} onClick={() => setCatFilter('none')}>Uncategorised</FilterChip>
        </div>
      )}

      {showForm && (
        <CreateServiceForm
          token={token!}
          categories={categories}
          onCreated={async () => {
            setShowForm(false);
            await load();
          }}
        />
      )}

      {loading ? (
        <p style={{ color: '#94a3b8' }}>Loading...</p>
      ) : (
        <div style={{ border: '1px solid #334155', borderRadius: 12, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ background: '#1e293b' }}>
                <th style={ui.th}>Name</th>
                <th style={{ ...ui.th, whiteSpace: 'nowrap' }}>Category</th>
                <th style={{ ...ui.th, whiteSpace: 'nowrap' }}>Duration</th>
                <th style={{ ...ui.th, whiteSpace: 'nowrap' }}>Price</th>
                <th style={{ ...ui.th, whiteSpace: 'nowrap' }}>Status</th>
                <th style={{ ...ui.th, whiteSpace: 'nowrap' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 && (
                <tr>
                  <td style={ui.td} colSpan={6}>
                    No services in this range.
                  </td>
                </tr>
              )}
              {pg.paged.map((s) => (
                <FragmentRow key={s.id} service={s} token={token!} categories={categories} catName={catName} onToggle={() => toggleActive(s)} onDelete={() => remove(s.id)} onSaved={load} />
              ))}
            </tbody>
          </table>
          <div style={{ padding: '0 14px 12px' }}><Pager paged={pg} /></div>
        </div>
      )}
    </section>
  );
}

interface Addon { id: string; name: string; durationMinutes: number; priceCents: number; currency: string }

function FragmentRow({ service: s, token, categories, catName, onToggle, onDelete, onSaved }: {
  service: Service; token: string; categories: Category[]; catName: (id?: string | null) => string; onToggle: () => void; onDelete: () => void; onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  return (
    <>
      <tr style={{ borderTop: '1px solid #334155' }}>
        <td style={ui.td}>
          <div>
            {s.name}
            {s.isFeatured && <span style={{ marginLeft: 6, background: '#eab308', color: '#1f2937', borderRadius: 6, padding: '1px 6px', fontSize: 10, fontWeight: 700 }}>POPULAR</span>}
          </div>
          {s.description && <div style={{ color: '#94a3b8', fontSize: 12 }}>{s.description}</div>}
        </td>
        <td style={{ ...ui.td, color: '#94a3b8' }}>{catName(s.categoryId)}</td>
        <td style={ui.td}>{s.durationMinutes} min</td>
        <td style={ui.td}>
          {s.discountPercent && s.discountPercent > 0 ? (
            <span>
              <span style={{ textDecoration: 'line-through', color: '#94a3b8', marginRight: 6 }}>{formatPrice(s.priceCents, s.currency)}</span>
              <span style={{ color: '#22c55e', fontWeight: 600 }}>{formatPrice(Math.round((s.priceCents * (100 - s.discountPercent)) / 100), s.currency)}</span>
              <span style={{ marginLeft: 6, background: '#ef4444', color: '#fff', borderRadius: 6, padding: '1px 6px', fontSize: 11, fontWeight: 700 }}>-{s.discountPercent}%</span>
            </span>
          ) : (
            formatPrice(s.priceCents, s.currency)
          )}
        </td>
        <td style={{ ...ui.td, whiteSpace: 'nowrap' }}>
          <button onClick={onToggle} style={{ cursor: 'pointer', whiteSpace: 'nowrap', background: 'transparent', border: `1px solid ${s.isActive ? '#22c55e' : '#64748b'}`, color: s.isActive ? '#22c55e' : '#94a3b8', borderRadius: 999, padding: '3px 12px', fontSize: 12 }}>
            {s.isActive ? 'Active' : 'Inactive'}
          </button>
        </td>
        <td style={{ ...ui.td, whiteSpace: 'nowrap' }}>
          <div style={{ display: 'inline-flex', gap: 6 }}>
            <button onClick={() => setEditing((e) => !e)} style={actBtn(editing ? '#475569' : '#0ea5e9')}>
              {editing ? 'Close' : 'Edit'}
            </button>
            <button onClick={() => setOpen((o) => !o)} style={actBtn(open ? '#475569' : '#6366f1')}>
              {open ? 'Hide' : 'Add-ons'}
            </button>
            <button onClick={onDelete} style={actBtn('#b91c1c')}>Delete</button>
          </div>
        </td>
      </tr>
      {editing && (
        <tr>
          <td colSpan={6} style={{ padding: 0, background: '#0f172a' }}>
            <EditServicePanel service={s} token={token} categories={categories} onSaved={onSaved} />
          </td>
        </tr>
      )}
      {open && (
        <tr>
          <td colSpan={6} style={{ padding: 0, background: '#0f172a' }}>
            <AddonsPanel serviceId={s.id} token={token} />
          </td>
        </tr>
      )}
    </>
  );
}

function EditServicePanel({ service, token, categories, onSaved }: { service: Service; token: string; categories: Category[]; onSaved: () => void }) {
  const [form, setForm] = useState({
    name: service.name,
    description: service.description ?? '',
    duration: String(service.durationMinutes),
    price: (service.priceCents / 100).toString(),
    discount: String(service.discountPercent ?? 0),
    categoryId: service.categoryId ?? '',
    isFeatured: service.isFeatured ?? false,
    priceFrom: service.priceFrom ?? false,
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const updated = await apiFetch<Service>(`/services/${service.id}`, {
        method: 'PATCH',
        token,
        body: {
          name: form.name,
          description: form.description || undefined,
          durationMinutes: parseInt(form.duration, 10),
          priceCents: Math.round(parseFloat(form.price) * 100),
          discountPercent: Math.min(90, Math.max(0, parseInt(form.discount, 10) || 0)),
          categoryId: form.categoryId || null,
          isFeatured: form.isFeatured,
          priceFrom: form.priceFrom,
        },
      });
      if (updated && typeof updated === 'object') {
        setForm({
          name: updated.name,
          description: updated.description ?? '',
          duration: String(updated.durationMinutes),
          price: (updated.priceCents / 100).toString(),
          discount: String(updated.discountPercent ?? 0),
          categoryId: updated.categoryId ?? '',
          isFeatured: updated.isFeatured ?? false,
          priceFrom: updated.priceFrom ?? false,
        });
      }
      setSaved(true);
      onSaved(); // refresh the list/prices in the background; panel stays open
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save} style={{ padding: 16 }}>
      <div style={{ fontSize: 13, color: '#cbd5e1', marginBottom: 8, fontWeight: 600 }}>Edit service</div>
      {error && <div style={ui.banner}>{error}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: 10 }}>
        <label><span style={ui.label}>Name</span><input style={ui.input} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></label>
        <label><span style={ui.label}>Duration (min)</span><input style={ui.input} type="number" min={1} value={form.duration} onChange={(e) => setForm({ ...form, duration: e.target.value })} required /></label>
        <label><span style={ui.label}>Price (USD)</span><input style={ui.input} type="number" min={0} step="0.01" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} required /></label>
        <label><span style={ui.label}>Discount %</span><input style={ui.input} type="number" min={0} max={90} value={form.discount} onChange={(e) => setForm({ ...form, discount: e.target.value })} /></label>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 10, marginTop: 10, alignItems: 'end' }}>
        <label><span style={ui.label}>Category</span>
          <select style={ui.input} value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>
            <option value="">— Uncategorised —</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#e2e8f0', paddingBottom: 8 }}>
          <input type="checkbox" checked={form.isFeatured} onChange={(e) => setForm({ ...form, isFeatured: e.target.checked })} /> Popular
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#e2e8f0', paddingBottom: 8 }}>
          <input type="checkbox" checked={form.priceFrom} onChange={(e) => setForm({ ...form, priceFrom: e.target.checked })} /> "From" price
        </label>
      </div>
      <label style={{ display: 'block', marginTop: 10 }}>
        <span style={ui.label}>Description (optional)</span>
        <input style={ui.input} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
      </label>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12 }}>
        <button type="submit" disabled={saving} style={ui.primaryBtn}>{saving ? 'Saving…' : 'Save changes'}</button>
        {saved && <span style={{ color: '#22c55e', fontSize: 13 }}>✓ Saved — discount is now live on the booking page.</span>}
      </div>
    </form>
  );
}

function AddonsPanel({ serviceId, token }: { serviceId: string; token: string }) {
  const [addons, setAddons] = useState<Addon[]>([]);
  const [form, setForm] = useState({ name: '', duration: '15', price: '15' });
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setAddons(await apiFetch<Addon[]>(`/services/${serviceId}/addons`, { token }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load add-ons');
    }
  }, [serviceId, token]);

  useEffect(() => { load(); }, [load]);

  async function add(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await apiFetch(`/services/${serviceId}/addons`, {
        method: 'POST', token,
        body: { name: form.name, durationMinutes: parseInt(form.duration, 10), priceCents: Math.round(parseFloat(form.price) * 100) },
      });
      setForm({ name: '', duration: '15', price: '15' });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create failed');
    }
  }

  async function remove(id: string) {
    try {
      await apiFetch(`/services/${serviceId}/addons/${id}`, { method: 'DELETE', token });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    }
  }

  return (
    <div style={{ padding: 16 }}>
      <div style={{ fontSize: 13, color: '#cbd5e1', marginBottom: 8, fontWeight: 600 }}>Add-ons (extras customers can add)</div>
      {error && <div style={ui.banner}>{error}</div>}
      {addons.length === 0 ? (
        <div style={{ color: '#64748b', fontSize: 13, marginBottom: 10 }}>No add-ons yet.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
          {addons.map((a) => (
            <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
              <span style={{ flex: 1 }}>{a.name}</span>
              <span style={{ color: '#94a3b8' }}>{a.durationMinutes} min</span>
              <span style={{ color: '#22c55e' }}>{formatPrice(a.priceCents, a.currency)}</span>
              <button onClick={() => remove(a.id)} style={{ ...ui.dangerBtn, padding: '3px 8px', fontSize: 12 }}>Remove</button>
            </div>
          ))}
        </div>
      )}
      <form onSubmit={add} style={{ display: 'flex', gap: 8, alignItems: 'end', flexWrap: 'wrap' }}>
        <div style={{ flex: 2, minWidth: 160 }}>
          <span style={ui.label}>Add-on name</span>
          <input style={ui.input} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required placeholder="e.g. Nail art" />
        </div>
        <div style={{ width: 90 }}>
          <span style={ui.label}>Min</span>
          <input style={ui.input} type="number" min={0} value={form.duration} onChange={(e) => setForm({ ...form, duration: e.target.value })} />
        </div>
        <div style={{ width: 100 }}>
          <span style={ui.label}>Price $</span>
          <input style={ui.input} type="number" min={0} step="0.01" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} />
        </div>
        <button type="submit" style={{ ...ui.primaryBtn, padding: '9px 14px' }}>+ Add</button>
      </form>
    </div>
  );
}

function CreateServiceForm({ token, categories, onCreated }: { token: string; categories: Category[]; onCreated: () => void }) {
  const [form, setForm] = useState({ name: '', description: '', durationMinutes: '30', price: '25', discount: '0', categoryId: '', isFeatured: false, priceFrom: false });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiFetch('/services', {
        method: 'POST',
        token,
        body: {
          name: form.name,
          description: form.description || undefined,
          durationMinutes: parseInt(form.durationMinutes, 10),
          priceCents: Math.round(parseFloat(form.price) * 100),
          discountPercent: Math.min(90, Math.max(0, parseInt(form.discount, 10) || 0)),
          categoryId: form.categoryId || null,
          isFeatured: form.isFeatured,
          priceFrom: form.priceFrom,
        },
      });
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} style={{ ...ui.card, marginBottom: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: 12 }}>
        <label>
          <span style={ui.label}>Service name</span>
          <input
            style={ui.input}
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            required
          />
        </label>
        <label>
          <span style={ui.label}>Duration (min)</span>
          <input
            style={ui.input}
            type="number"
            min={1}
            value={form.durationMinutes}
            onChange={(e) => setForm({ ...form, durationMinutes: e.target.value })}
            required
          />
        </label>
        <label>
          <span style={ui.label}>Price (USD)</span>
          <input
            style={ui.input}
            type="number"
            min={0}
            step="0.01"
            value={form.price}
            onChange={(e) => setForm({ ...form, price: e.target.value })}
            required
          />
        </label>
        <label>
          <span style={ui.label}>Discount %</span>
          <input
            style={ui.input}
            type="number"
            min={0}
            max={90}
            value={form.discount}
            onChange={(e) => setForm({ ...form, discount: e.target.value })}
          />
        </label>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 12, marginTop: 12, alignItems: 'end' }}>
        <label><span style={ui.label}>Category</span>
          <select style={ui.input} value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>
            <option value="">— Uncategorised —</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#e2e8f0', paddingBottom: 8 }}>
          <input type="checkbox" checked={form.isFeatured} onChange={(e) => setForm({ ...form, isFeatured: e.target.checked })} /> Popular
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#e2e8f0', paddingBottom: 8 }}>
          <input type="checkbox" checked={form.priceFrom} onChange={(e) => setForm({ ...form, priceFrom: e.target.checked })} /> "From" price
        </label>
      </div>
      <label style={{ display: 'block', marginTop: 12 }}>
        <span style={ui.label}>Description (optional)</span>
        <input
          style={ui.input}
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
        />
      </label>
      {error && <div style={ui.banner}>{error}</div>}
      <button type="submit" disabled={submitting} style={{ ...ui.primaryBtn, marginTop: 14 }}>
        {submitting ? 'Creating...' : 'Create service'}
      </button>
    </form>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} style={{ padding: '6px 12px', borderRadius: 999, fontSize: 13, cursor: 'pointer', border: `1px solid ${active ? '#6366f1' : '#334155'}`, background: active ? '#312e81' : 'transparent', color: active ? '#c7d2fe' : '#94a3b8' }}>
      {children}
    </button>
  );
}

function CategoryManager({ token, categories, onChanged }: { token: string; categories: Category[]; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function add(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setError(null);
    try {
      await apiFetch('/services/categories', { method: 'POST', token, body: { name: name.trim(), sortOrder: categories.length } });
      setName('');
      onChanged();
    } catch (err) { setError(err instanceof Error ? err.message : 'Create failed'); }
  }
  async function rename(c: Category) {
    const next = prompt('Rename category', c.name);
    if (!next || next.trim() === c.name) return;
    try { await apiFetch(`/services/categories/${c.id}`, { method: 'PATCH', token, body: { name: next.trim() } }); onChanged(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Rename failed'); }
  }
  async function move(c: Category, dir: -1 | 1) {
    try { await apiFetch(`/services/categories/${c.id}`, { method: 'PATCH', token, body: { sortOrder: Math.max(0, c.sortOrder + dir) } }); onChanged(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Reorder failed'); }
  }
  async function remove(c: Category) {
    if (!confirm(`Delete category "${c.name}"? Services keep existing but become uncategorised.`)) return;
    try { await apiFetch(`/services/categories/${c.id}`, { method: 'DELETE', token }); onChanged(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Delete failed'); }
  }

  return (
    <div style={{ ...ui.card, marginBottom: 16 }}>
      <button onClick={() => setOpen((o) => !o)} style={{ background: 'none', border: 'none', color: '#cbd5e1', cursor: 'pointer', fontSize: 14, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8, padding: 0 }}>
        <span style={{ fontSize: 11, transform: open ? 'rotate(90deg)' : 'none' }}>▶</span>
        Menu categories ({categories.length})
      </button>
      {open && (
        <div style={{ marginTop: 12 }}>
          {error && <div style={ui.banner}>{error}</div>}
          {categories.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
              {categories.map((c) => (
                <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
                  <span style={{ flex: 1 }}>{c.name}</span>
                  <button onClick={() => move(c, -1)} style={miniBtn} aria-label="Move up">↑</button>
                  <button onClick={() => move(c, 1)} style={miniBtn} aria-label="Move down">↓</button>
                  <button onClick={() => rename(c)} style={miniBtn}>Rename</button>
                  <button onClick={() => remove(c)} style={{ ...miniBtn, color: '#ef4444', borderColor: '#ef4444' }}>Delete</button>
                </div>
              ))}
            </div>
          )}
          <form onSubmit={add} style={{ display: 'flex', gap: 8 }}>
            <input style={{ ...ui.input, flex: 1 }} value={name} onChange={(e) => setName(e.target.value)} placeholder="New category (e.g. Hand & Feet Care)" />
            <button type="submit" style={ui.primaryBtn}>+ Add</button>
          </form>
        </div>
      )}
    </div>
  );
}

const miniBtn: React.CSSProperties = { padding: '4px 10px', borderRadius: 6, border: '1px solid #475569', background: 'transparent', color: '#cbd5e1', fontSize: 12, cursor: 'pointer' };
function actBtn(bg: string): React.CSSProperties {
  return { padding: '6px 12px', borderRadius: 8, border: 'none', background: bg, color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap', minWidth: 64 };
}

// ---- Bulk menu import ------------------------------------------------------
const IMPORT_EXAMPLE = `# Acrylic
New Set | 62+ | 60
Refill | 50 | 45

# Waxing
Eyebrows | 10+
Full Legs | 45+ | 40`;

interface ParsedItem { category: string; name: string; priceCents: number; durationMinutes: number; priceFrom: boolean }

/** Parse a pasted menu: "# Category" lines + "Name | price | minutes" rows. */
function parseMenu(text: string): ParsedItem[] {
  const items: ParsedItem[] = [];
  let category = '';
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith('#')) { category = line.replace(/^#+/, '').trim(); continue; }
    const parts = line.split('|').map((p) => p.trim());
    const name = parts[0];
    if (!name) continue;
    const priceStr = parts[1] || '';
    const priceFrom = priceStr.includes('+');
    const dollars = parseFloat((priceStr.match(/[\d.]+/) || ['0'])[0]) || 0;
    const dur = parseInt((((parts[2] || '').match(/\d+/)) || ['30'])[0], 10) || 30;
    items.push({ category, name, priceCents: Math.round(dollars * 100), durationMinutes: dur, priceFrom });
  }
  return items;
}

function ImportPanel({ token, onDone }: { token: string; onDone: () => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const items = parseMenu(text);
  const ok = msg?.startsWith('✓');

  async function run() {
    if (items.length === 0) { setMsg('Paste your menu first.'); return; }
    setBusy(true); setMsg(null);
    try {
      const r = await apiFetch<{ createdCategories: number; createdServices: number; skipped: number }>(
        '/services/import', { method: 'POST', token, body: { items } },
      );
      setMsg(`✓ Imported ${r.createdServices} services in ${r.createdCategories} new categor${r.createdCategories === 1 ? 'y' : 'ies'} (${r.skipped} skipped).`);
      setTimeout(onDone, 1000);
    } catch (e) { setMsg(e instanceof Error ? e.message : 'Import failed'); setBusy(false); }
  }

  return (
    <div style={{ ...ui.card, marginBottom: 16 }}>
      <div style={{ fontWeight: 700, marginBottom: 6 }}>⇪ Import menu</div>
      <p style={{ color: '#94a3b8', fontSize: 13, margin: '0 0 10px' }}>
        Paste your price list below. Start a group with <code style={{ color: '#cbd5e1' }}># Category</code>, then one service per line:
        {' '}<code style={{ color: '#cbd5e1' }}>Name | price | minutes</code>. A <code style={{ color: '#cbd5e1' }}>+</code> after the price = &ldquo;from&rdquo; pricing; minutes is optional (defaults to 30).
      </p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={12}
        placeholder={IMPORT_EXAMPLE}
        style={{ width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: 10, border: '1px solid #475569', background: '#0f172a', color: '#e2e8f0', fontSize: 14, fontFamily: 'ui-monospace, Menlo, monospace', resize: 'vertical' }}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 10, flexWrap: 'wrap' }}>
        <button onClick={run} disabled={busy || items.length === 0} style={ui.primaryBtn}>
          {busy ? 'Importing…' : `Import ${items.length || ''} service${items.length === 1 ? '' : 's'}`}
        </button>
        {items.length > 0 && !msg && <span style={{ color: '#94a3b8', fontSize: 13 }}>{items.length} rows detected — review then import.</span>}
        {msg && <span style={{ color: ok ? '#22c55e' : '#f87171', fontSize: 13 }}>{msg}</span>}
      </div>
    </div>
  );
}
