'use client';

import { useCallback, useEffect, useState, FormEvent } from 'react';
import { SalonShell } from '../../../components/SalonShell';
import { useAuth } from '../../../lib/auth';
import { apiFetch } from '../../../lib/api';
import { ui, formatPrice } from '../../../lib/ui';

interface Service {
  id: string;
  name: string;
  description: string | null;
  durationMinutes: number;
  priceCents: number;
  discountPercent?: number;
  currency: string;
  isActive: boolean;
}

export default function ServicesPage() {
  return (
    <SalonShell>
      <ServicesInner />
    </SalonShell>
  );
}

function ServicesInner() {
  const { token } = useAuth();
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      setServices(await apiFetch<Service[]>('/services', { token }));
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

  return (
    <section>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <h2 style={{ fontSize: 18, margin: 0 }}>Services</h2>
        <button onClick={() => setShowForm((s) => !s)} style={ui.primaryBtn}>
          {showForm ? 'Close' : '+ New service'}
        </button>
      </div>

      {error && <div style={ui.banner}>{error}</div>}

      {showForm && (
        <CreateServiceForm
          token={token!}
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
                <th style={ui.th}>Duration</th>
                <th style={ui.th}>Price</th>
                <th style={ui.th}>Status</th>
                <th style={ui.th}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {services.length === 0 && (
                <tr>
                  <td style={ui.td} colSpan={5}>
                    No services yet.
                  </td>
                </tr>
              )}
              {services.map((s) => (
                <FragmentRow key={s.id} service={s} token={token!} onToggle={() => toggleActive(s)} onDelete={() => remove(s.id)} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

interface Addon { id: string; name: string; durationMinutes: number; priceCents: number; currency: string }

function FragmentRow({ service: s, token, onToggle, onDelete }: {
  service: Service; token: string; onToggle: () => void; onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <tr style={{ borderTop: '1px solid #334155' }}>
        <td style={ui.td}>
          <div>{s.name}</div>
          {s.description && <div style={{ color: '#94a3b8', fontSize: 12 }}>{s.description}</div>}
        </td>
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
        <td style={ui.td}>
          <button onClick={onToggle} style={{ cursor: 'pointer', background: 'transparent', border: `1px solid ${s.isActive ? '#22c55e' : '#64748b'}`, color: s.isActive ? '#22c55e' : '#94a3b8', borderRadius: 999, padding: '2px 10px', fontSize: 12 }}>
            {s.isActive ? 'Active' : 'Inactive'}
          </button>
        </td>
        <td style={ui.td}>
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={() => setOpen((o) => !o)} style={{ ...ui.primaryBtn, padding: '6px 12px', fontSize: 12, background: open ? '#475569' : '#6366f1' }}>
              {open ? 'Hide add-ons' : 'Add-ons'}
            </button>
            <button onClick={onDelete} style={ui.dangerBtn}>Delete</button>
          </div>
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={5} style={{ padding: 0, background: '#0f172a' }}>
            <AddonsPanel serviceId={s.id} token={token} />
          </td>
        </tr>
      )}
    </>
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

function CreateServiceForm({ token, onCreated }: { token: string; onCreated: () => void }) {
  const [form, setForm] = useState({ name: '', description: '', durationMinutes: '30', price: '25', discount: '0' });
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
