'use client';

// The technician's own chair. Everything a tech is allowed to do with the client
// in front of them, and nothing else: see who they have, seat them in a chair,
// add the services they actually performed (credited to THEM), send the client to
// the front desk to pay, and close the ticket (which credits their turn).
//
// Calls /my-chair/* — a route with no `walkins` capability gate, because a
// TECHNICIAN must never see the front-desk board or the salon's totals.

import { useCallback, useEffect, useState } from 'react';
import { StaffShell } from '../../../components/StaffShell';
import { useAuth } from '../../../lib/auth';
import { apiFetch } from '../../../lib/api';
import { ui, formatPrice } from '../../../lib/ui';
import { useLang, tr } from '../../../lib/i18n';
import { useLiveRefresh } from '../../../lib/useLiveRefresh';

interface Svc { id: string; name: string; priceCents: number; durationMinutes: number }
interface ChairOpt { id: string; name: string; type: string; takenBy: string | null }
interface Item { lineId: string; serviceId: string; name: string; priceCents: number; staffId: string | null }
interface Chair {
  id: string; customerName: string | null; phone: string | null; assignedAt: string | null;
  station: string | null; stationId: string | null; awaitingPayment?: boolean;
  items: Item[]; service: { id: string; name: string } | null;
}
interface SalonClient { id: string; customerName: string | null; station: string | null }
interface MyChair { staffId: string | null; currency: string; serving: Chair[]; salon: SalonClient[] }

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
  const vi = lang === 'vi';
  const [data, setData] = useState<MyChair | null>(null);
  const [services, setServices] = useState<Svc[]>([]);
  const [chairs, setChairs] = useState<ChairOpt[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [undo, setUndo] = useState<{ id: string; name: string } | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const [mine, svc, ch] = await Promise.all([
        apiFetch<MyChair>('/my-chair', { token }),
        apiFetch<Svc[]>('/my-chair/services', { token }).catch(() => [] as Svc[]),
        apiFetch<ChairOpt[]>('/my-chair/chairs', { token }).catch(() => [] as ChairOpt[]),
      ]);
      setData(mine); setServices(svc); setChairs(ch); setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to load'); }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { load(); }, [load]);
  useLiveRefresh(load, 15000);

  // The undo bar for an accidental "Done" only lives for 20 seconds.
  useEffect(() => {
    if (!undo) return;
    const id = window.setTimeout(() => setUndo(null), 20000);
    return () => window.clearTimeout(id);
  }, [undo]);

  const currency = data?.currency ?? 'USD';

  const act = useCallback(async (id: string, path: string, method: 'POST' | 'PATCH' | 'DELETE', body?: Record<string, unknown>) => {
    setError(null); setBusyId(id);
    try { await apiFetch(path, { method, token, body }); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Action failed'); }
    finally { setBusyId(null); }
  }, [token, load]);

  const addService = (id: string, serviceId: string) => act(id, `/my-chair/${id}/services`, 'POST', { serviceId });
  const removeService = (id: string, lineId: string) => act(id, `/my-chair/${id}/services/${lineId}`, 'DELETE');
  const setChair = (id: string, stationId: string) => act(id, `/my-chair/${id}/chair`, 'PATCH', { stationId });
  const toPay = (id: string) => act(id, `/my-chair/${id}/wait-payment`, 'PATCH');
  const finish = async (id: string, name: string) => { await act(id, `/my-chair/${id}/done`, 'PATCH'); setUndo({ id, name }); };
  const undoDone = (id: string) => { setUndo(null); act(id, `/my-chair/${id}/reactivate`, 'PATCH'); };

  if (loading && !data) return <p style={{ color: '#94a3b8' }}>Loading…</p>;

  const serving = data?.serving ?? [];
  const others = data?.salon ?? [];

  return (
    <div style={{ paddingBottom: undo ? 76 : 0 }}>
      <p style={{ color: '#94a3b8', margin: '0 0 16px', fontSize: 14 }}>{t('sc.subtitle')}</p>
      {error && <div style={ui.banner}>{error}</div>}

      {serving.length === 0 && others.length === 0 ? (
        <div style={{ ...ui.card, color: '#94a3b8', textAlign: 'center', padding: '36px 16px' }}>
          <div style={{ fontSize: 34, marginBottom: 8 }}>💺</div>
          {t('sc.none')}
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 14 }}>
          {serving.map((w) => (
            <ChairCard key={w.id} w={w} services={services} chairs={chairs} currency={currency} t={t} vi={vi}
              busy={busyId === w.id}
              onAdd={addService} onRemove={removeService} onChair={setChair} onPay={toPay} onDone={finish} />
          ))}
        </div>
      )}

      {others.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#cbd5e1', margin: '0 0 4px' }}>{t('sc.others')}</div>
          <p style={{ color: '#64748b', fontSize: 12, margin: '0 0 10px' }}>{t('sc.moved')}</p>
          <div style={{ display: 'grid', gap: 10 }}>
            {others.map((o) => (
              <OtherClientRow key={o.id} c={o} services={services} currency={currency} t={t}
                busy={busyId === o.id} onAdd={addService} />
            ))}
          </div>
        </div>
      )}

      {serving.length > 0 && (
        <p style={{ color: '#64748b', fontSize: 12, marginTop: 16, lineHeight: 1.5 }}>{t('sc.hint')}</p>
      )}

      {undo && (
        <div style={{ position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 60, display: 'flex', alignItems: 'center', gap: 12,
          padding: '12px 16px calc(12px + env(safe-area-inset-bottom, 0px))', background: '#1e293b', borderTop: '1px solid #334155' }}>
          <span style={{ flex: 1, minWidth: 0, color: '#e2e8f0', fontSize: 14 }}>
            {vi ? 'Đã xong' : 'Finished'}: <b>{undo.name}</b>
          </span>
          <button onClick={() => undoDone(undo.id)}
            style={{ flexShrink: 0, padding: '10px 18px', borderRadius: 999, border: '1px solid #6366f1', background: 'transparent', color: '#a5b4fc', fontWeight: 700, cursor: 'pointer' }}>
            {vi ? '↩ Hoàn tác' : '↩ Undo'}
          </button>
        </div>
      )}
    </div>
  );
}

/** Shared search + tap-to-add service list. */
function ServicePicker({ services, currency, busy, onPick, onCancel, t }: {
  services: Svc[]; currency: string; busy: boolean; onPick: (serviceId: string) => void; onCancel: () => void; t: (k: string) => string;
}) {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const filtered = q ? services.filter((s) => s.name.toLowerCase().includes(q)) : services;
  return (
    <div style={{ border: '1px solid #334155', borderRadius: 12, padding: 10 }}>
      <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('wi.addServicePh')}
        style={{ ...ui.input, width: '100%', boxSizing: 'border-box', marginBottom: 8 }} />
      <div style={{ maxHeight: 260, overflowY: 'auto', display: 'grid', gap: 6 }}>
        {filtered.map((s) => (
          <button key={s.id} disabled={busy} onClick={() => onPick(s.id)}
            style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '12px', borderRadius: 8, border: '1px solid #334155', background: '#0f172a', color: '#e2e8f0', cursor: 'pointer', fontSize: 15, textAlign: 'left' }}>
            <span style={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.name}</span>
            <span style={{ color: '#94a3b8' }}>{formatPrice(s.priceCents, currency)}</span>
          </button>
        ))}
        {filtered.length === 0 && <div style={{ color: '#64748b', fontSize: 13, padding: '8px 4px' }}>{t('wi.noMatch')}</div>}
      </div>
      <button onClick={onCancel} style={{ ...ghost, width: '100%', marginTop: 8 }}>{t('wi.cancel')}</button>
    </div>
  );
}

function ChairCard({ w, services, chairs, currency, t, vi, busy, onAdd, onRemove, onChair, onPay, onDone }: {
  w: Chair; services: Svc[]; chairs: ChairOpt[]; currency: string; t: (k: string) => string; vi: boolean; busy: boolean;
  onAdd: (id: string, serviceId: string) => void; onRemove: (id: string, lineId: string) => void;
  onChair: (id: string, stationId: string) => void; onPay: (id: string) => void; onDone: (id: string, name: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const items = w.items ?? [];
  const subtotal = items.reduce((sum, it) => sum + (it.priceCents || 0), 0);
  const mins = minsSince(w.assignedAt);
  const name = w.customerName || t('sc.walkin');
  const chair = chairs.find((c) => c.id === w.stationId);

  return (
    <div style={{ ...ui.card, padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, marginBottom: 12 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 800, fontSize: 17, color: '#e2e8f0' }}>{name}</div>
          {mins > 0 && <div style={{ color: '#64748b', fontSize: 12, marginTop: 2 }}>{mins}m {t('sc.inChair')}</div>}
        </div>
        {w.phone && <a href={`tel:${w.phone}`} style={{ color: '#818cf8', fontSize: 13, textDecoration: 'none', whiteSpace: 'nowrap' }}>{w.phone}</a>}
      </div>

      <div style={{ marginBottom: 12 }}>
        <label style={{ display: 'block', fontSize: 12, color: '#94a3b8', marginBottom: 6 }}>
          {vi ? 'Ghế / bàn khách đang ngồi' : 'Chair the client is sitting in'}
        </label>
        <select value={w.stationId ?? ''} disabled={busy} onChange={(e) => onChair(w.id, e.target.value)}
          style={{ ...ui.input, width: '100%', cursor: 'pointer' }}>
          <option value="">{vi ? '— Chưa chọn ghế —' : '— No chair yet —'}</option>
          {chairs.map((c) => {
            const taken = !!c.takenBy && c.id !== w.stationId;
            return (
              <option key={c.id} value={c.id} disabled={taken}>
                {c.name}{c.type ? ' · ' + c.type : ''}{taken ? (vi ? ' — đang có khách' : ' — in use') : ''}
              </option>
            );
          })}
        </select>
        {chairs.length === 0 && (
          <p style={{ color: '#fbbf24', fontSize: 12, margin: '6px 0 0' }}>
            {vi ? 'Tiệm chưa khai báo ghế. Nhờ quản lý thêm ở mục Ghế.' : 'No chairs set up yet. Ask your manager to add them under Chairs.'}
          </p>
        )}
        {chair && (
          <p style={{ color: '#a5b4fc', fontSize: 12, margin: '6px 0 0' }}>
            {vi ? 'Đang ngồi' : 'Seated at'}: <b>{chair.name}</b>{chair.type ? ' · ' + chair.type : ''}
          </p>
        )}
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
        <button onClick={() => setAdding(true)} style={{ ...ui.primaryBtn, width: '100%', padding: '13px', fontSize: 15 }}>{t('sc.add')}</button>
      ) : (
        <ServicePicker services={services} currency={currency} busy={busy} t={t}
          onPick={(sid) => { onAdd(w.id, sid); setAdding(false); }} onCancel={() => setAdding(false)} />
      )}

      {!adding && (
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          <button onClick={() => onPay(w.id)} disabled={busy || !!w.awaitingPayment}
            style={{ ...ghost, flex: 1, padding: '12px', opacity: w.awaitingPayment ? 0.5 : 1 }}>
            {w.awaitingPayment
              ? (vi ? '⏳ Đang chờ trả tiền' : '⏳ Waiting to pay')
              : (vi ? '💵 Ra quầy trả tiền' : '💵 Send to pay')}
          </button>
          {!confirm ? (
            <button onClick={() => setConfirm(true)} disabled={busy}
              style={{ ...ghost, flex: 1, padding: '12px', borderColor: '#16a34a', color: '#4ade80' }}>
              {vi ? '✓ Xong khách' : '✓ Finish'}
            </button>
          ) : (
            <button onClick={() => { setConfirm(false); onDone(w.id, name); }} disabled={busy}
              style={{ flex: 1, padding: '12px', borderRadius: 8, border: 'none', background: '#16a34a', color: '#fff', fontWeight: 700, cursor: 'pointer' }}>
              {vi ? 'Chắc chắn xong?' : 'Confirm finish?'}
            </button>
          )}
        </div>
      )}
      {confirm && (
        <p style={{ color: '#94a3b8', fontSize: 12, margin: '8px 0 0' }}>
          {vi ? 'Xong khách sẽ nhả ghế và tính một lượt cho thợ. Bấm lại để xác nhận — lỡ tay vẫn hoàn tác được.'
              : 'Finishing frees the chair and credits your turn. Tap again to confirm — you can still undo.'}
        </p>
      )}
    </div>
  );
}

/** A client currently in the salon but not (yet) on this tech's ticket — used when a
 *  customer moves to this tech's chair. Tapping adds this tech's service to the SAME bill. */
function OtherClientRow({ c, services, currency, t, busy, onAdd }: {
  c: SalonClient; services: Svc[]; currency: string; t: (k: string) => string; busy: boolean;
  onAdd: (id: string, serviceId: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  return (
    <div style={{ ...ui.card, padding: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
        <div style={{ fontWeight: 600, color: '#e2e8f0', display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.customerName || t('sc.walkin')}</span>
          {c.station && <span style={{ fontSize: 12, fontWeight: 700, color: '#c7d2fe', background: '#312e81', borderRadius: 6, padding: '2px 8px', flexShrink: 0 }}>{t('wi.stationShort')} {c.station}</span>}
        </div>
        {!adding && <button onClick={() => setAdding(true)} style={{ ...ui.primaryBtn, padding: '8px 14px', flexShrink: 0 }}>{t('sc.addMine')}</button>}
      </div>
      {adding && (
        <div style={{ marginTop: 10 }}>
          <ServicePicker services={services} currency={currency} busy={busy} t={t}
            onPick={(sid) => { onAdd(c.id, sid); setAdding(false); }} onCancel={() => setAdding(false)} />
        </div>
      )}
    </div>
  );
}

const ghost: React.CSSProperties = {
  padding: '10px 14px', borderRadius: 8, border: '1px solid #475569',
  background: 'transparent', color: '#e2e8f0', fontSize: 14, cursor: 'pointer',
};
