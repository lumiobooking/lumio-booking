'use client';

import { useCallback, useEffect, useState } from 'react';
import { StaffShell } from '../../../components/StaffShell';
import { useAuth } from '../../../lib/auth';
import { apiFetch } from '../../../lib/api';
import { ui, formatPrice } from '../../../lib/ui';
import { useLang, tr } from '../../../lib/i18n';
import { useLiveRefresh } from '../../../lib/useLiveRefresh';

interface Svc { id: string; name: string; priceCents: number }
interface Item { lineId: string; serviceId: string; name: string; priceCents: number; staffId: string | null }
interface Chair {
  id: string; customerName: string | null; phone: string | null; assignedAt: string | null;
  items: Item[]; service: { id: string; name: string } | null;
}
interface MyChair { staffId: string | null; currency: string; serving: Chair[] }

export default function StaffChairPage() {
  const { lang } = useLang();
  return (
    <StaffShell title={tr('sc.title', lang)}>
      <Inner />
    </StaffShell>
  );
}

function minsSince(iso: string | null): number {
  if (!iso) return 0;
  return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
}

function Inner() {
  const { token } = useAuth();
  const { lang } = useLang();
  const t = (k: string) => tr(k, lang);
  const [data, setData] = useState<MyChair | null>(null);
  const [services, setServices] = useState<Svc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const [mine, svc] = await Promise.all([
        apiFetch<MyChair>('/walkins/my', { token }),
        apiFetch<Svc[]>('/services', { token }).catch(() => [] as Svc[]),
      ]);
      setData(mine); setServices(svc); setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to load'); }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { load(); }, [load]);
  useLiveRefresh(load, 15000);

  const currency = data?.currency ?? 'USD';
  const myStaffId = data?.staffId ?? '';

  async function addService(id: string, serviceId: string) {
    setError(null); setBusyId(id);
    try { await apiFetch(`/walkins/${id}/services`, { method: 'POST', token, body: { serviceId, staffId: myStaffId || undefined } }); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not add'); }
    finally { setBusyId(null); }
  }
  async function removeService(id: string, lineId: string) {
    setError(null);
    try { await apiFetch(`/walkins/${id}/services/${lineId}`, { method: 'DELETE', token }); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not remove'); }
  }

  if (loading && !data) return <p style={{ color: '#94a3b8' }}>Loading...</p>;

  const serving = data?.serving ?? [];

  return (
    <div>
      <p style={{ color: '#94a3b8', margin: '0 0 16px', fontSize: 14 }}>{t('sc.subtitle')}</p>
      {error && <div style={ui.banner}>{error}</div>}
      {serving.length === 0 ? (
        <div style={{ ...ui.card, color: '#94a3b8', textAlign: 'center', padding: '36px 16px' }}>
          <div style={{ fontSize: 34, marginBottom: 8 }}>💺</div>
          {t('sc.none')}
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 14 }}>
          {serving.map((w) => (
            <ChairCard key={w.id} w={w} services={services} currency={currency} t={t}
              busy={busyId === w.id} onAdd={addService} onRemove={removeService} />
          ))}
        </div>
      )}
      {serving.length > 0 && (
        <p style={{ color: '#64748b', fontSize: 12, marginTop: 16, lineHeight: 1.5 }}>{t('sc.hint')}</p>
      )}
    </div>
  );
}

function ChairCard({ w, services, currency, t, busy, onAdd, onRemove }: {
  w: Chair; services: Svc[]; currency: string; t: (k: string) => string; busy: boolean;
  onAdd: (id: string, serviceId: string) => void; onRemove: (id: string, lineId: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState('');
  const items = w.items ?? [];
  const subtotal = items.reduce((sum, it) => sum + (it.priceCents || 0), 0);
  const q = query.trim().toLowerCase();
  const filtered = q ? services.filter((s) => s.name.toLowerCase().includes(q)) : services;
  const mins = minsSince(w.assignedAt);
  return (
    <div style={{ ...ui.card, padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, marginBottom: 12 }}>
        <div>
          <div style={{ fontWeight: 800, fontSize: 17, color: '#e2e8f0' }}>{w.customerName || t('sc.walkin')}</div>
          {mins > 0 && <div style={{ color: '#64748b', fontSize: 12, marginTop: 2 }}>{mins}m {t('sc.inChair')}</div>}
        </div>
        {w.phone && <a href={`tel:${w.phone}`} style={{ color: '#818cf8', fontSize: 13, textDecoration: 'none', whiteSpace: 'nowrap' }}>{w.phone}</a>}
      </div>

      <div style={{ border: '1px solid #263041', borderRadius: 12, overflow: 'hidden', marginBottom: 12 }}>
        {items.length === 0 ? (
          <div style={{ padding: '12px 14px', color: '#64748b', fontSize: 13 }}>{t('wi.noLines')}</div>
        ) : items.map((it) => (
          <div key={it.lineId} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderBottom: '1px solid #1e293b' }}>
            <div style={{ flex: 1, minWidth: 0, color: '#e2e8f0', fontSize: 15, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.name}</div>
            <div style={{ color: '#e2e8f0', fontSize: 15, fontWeight: 700 }}>{formatPrice(it.priceCents, currency)}</div>
            <button onClick={() => onRemove(w.id, it.lineId)} aria-label={t('wi.removeLine')}
              style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 22, lineHeight: 1, padding: '0 4px' }}>&times;</button>
          </div>
        ))}
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 14px', background: '#0f172a' }}>
          <span style={{ color: '#94a3b8', fontSize: 13, fontWeight: 700 }}>{t('wi.subtotal')}</span>
          <span style={{ color: '#fff', fontSize: 18, fontWeight: 800 }}>{formatPrice(subtotal, currency)}</span>
        </div>
      </div>

      {!adding ? (
        <button onClick={() => { setAdding(true); setQuery(''); }} style={{ ...ui.primaryBtn, width: '100%', padding: '13px', fontSize: 15 }}>{t('sc.add')}</button>
      ) : (
        <div style={{ border: '1px solid #334155', borderRadius: 12, padding: 10 }}>
          <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('wi.addServicePh')}
            style={{ ...ui.input, width: '100%', boxSizing: 'border-box', marginBottom: 8 }} />
          <div style={{ maxHeight: 260, overflowY: 'auto', display: 'grid', gap: 6 }}>
            {filtered.map((s) => (
              <button key={s.id} disabled={busy} onClick={() => { onAdd(w.id, s.id); setAdding(false); }}
                style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '12px', borderRadius: 8, border: '1px solid #334155', background: '#0f172a', color: '#e2e8f0', cursor: 'pointer', fontSize: 15, textAlign: 'left' }}>
                <span style={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.name}</span>
                <span style={{ color: '#94a3b8' }}>{formatPrice(s.priceCents, currency)}</span>
              </button>
            ))}
            {filtered.length === 0 && <div style={{ color: '#64748b', fontSize: 13, padding: '8px 4px' }}>{t('wi.noMatch')}</div>}
          </div>
          <button onClick={() => setAdding(false)} style={{ ...ghost, width: '100%', marginTop: 8 }}>{t('wi.cancel')}</button>
        </div>
      )}
    </div>
  );
}

const ghost: React.CSSProperties = {
  padding: '10px 14px', borderRadius: 8, border: '1px solid #475569',
  background: 'transparent', color: '#e2e8f0', fontSize: 14, cursor: 'pointer',
};
