'use client';

import { useCallback, useEffect, useState, FormEvent, CSSProperties } from 'react';
import { SalonShell } from '../../../components/SalonShell';
import { useAuth } from '../../../lib/auth';
import { apiFetch } from '../../../lib/api';
import { ui } from '../../../lib/ui';
import { useLang, tr } from '../../../lib/i18n';
import { useLiveRefresh } from '../../../lib/useLiveRefresh';

interface WalkIn {
  id: string; customerId: string | null; customerName: string | null; phone: string | null; note: string | null;
  partySize: number; status: string; createdAt: string; assignedAt: string | null;
  service: { id: string; name: string } | null;
  assignedStaff: { id: string; firstName: string; lastName: string | null } | null;
}
interface StaffTurn { id: string; name: string; avatarUrl: string | null; turns: number; busy: boolean; nextUp: boolean }
interface Board { waiting: WalkIn[]; serving: WalkIn[]; staff: StaffTurn[]; nextUpStaffId: string | null }
interface Service { id: string; name: string }

export default function WalkinsPage() {
  return <SalonShell><Inner /></SalonShell>;
}

function fullName(s: { firstName: string; lastName: string | null } | null) {
  return s ? `${s.firstName}${s.lastName ? ' ' + s.lastName : ''}` : '';
}
function waitedMins(iso: string) {
  return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
}

function Inner() {
  const { token } = useAuth();
  const { lang } = useLang();
  const t = (k: string) => tr(k, lang);
  const [board, setBoard] = useState<Board | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ customerName: '', phone: '', serviceId: '', partySize: '1' });
  const [pick, setPick] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const [b, svc] = await Promise.all([
        apiFetch<Board>('/walkins/board', { token }),
        apiFetch<Service[]>('/services', { token }).catch(() => []),
      ]);
      setBoard(b); setServices(svc);
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to load'); }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { load(); }, [load]);
  useLiveRefresh(load, 15000);

  async function add(e: FormEvent) {
    e.preventDefault(); setError(null);
    try {
      await apiFetch('/walkins', {
        method: 'POST', token,
        body: {
          customerName: form.customerName.trim() || undefined,
          phone: form.phone.trim() || undefined,
          serviceId: form.serviceId || undefined,
          partySize: parseInt(form.partySize, 10) || 1,
        },
      });
      setForm({ customerName: '', phone: '', serviceId: '', partySize: '1' });
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not add'); }
  }
  async function act(path: string, body?: unknown) {
    setError(null);
    try { await apiFetch(`/walkins/${path}`, { method: 'PATCH', token, body }); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Action failed'); }
  }

  if (loading && !board) return <section><h2 style={{ fontSize: 18 }}>{t('wi.title')}</h2><p style={{ color: '#94a3b8' }}>Loading…</p></section>;

  const staff = board?.staff ?? [];
  const nextUp = board?.nextUpStaffId ?? null;

  return (
    <section>
      <h2 style={{ fontSize: 18, margin: '0 0 2px' }}>{t('wi.title')}</h2>
      <p style={{ color: '#94a3b8', margin: '0 0 16px', fontSize: 14 }}>{t('wi.subtitle')}</p>

      {error && <div style={ui.banner}>{error}</div>}

      <form onSubmit={add} style={{ ...ui.card, display: 'grid', gridTemplateColumns: '1.4fr 1fr 1.4fr 0.7fr auto', gap: 10, alignItems: 'end', marginBottom: 16 }}>
        <label><span style={ui.label}>{t('wi.customer')}</span><input style={ui.input} value={form.customerName} placeholder={t('wi.namePh')} onChange={(e) => setForm({ ...form, customerName: e.target.value })} /></label>
        <label><span style={ui.label}>{t('wi.phone')}</span><input style={ui.input} value={form.phone} inputMode="tel" onChange={(e) => setForm({ ...form, phone: e.target.value })} /></label>
        <label><span style={ui.label}>{t('wi.service')}</span>
          <ServiceSearchSelect services={services} value={form.serviceId} onChange={(id) => setForm({ ...form, serviceId: id })} placeholder={t('wi.serviceSearch')} />
        </label>
        <label><span style={ui.label}>{t('wi.partySize')}</span><input style={ui.input} type="number" min={1} max={20} value={form.partySize} onChange={(e) => setForm({ ...form, partySize: e.target.value })} /></label>
        <button type="submit" style={ui.primaryBtn}>{t('wi.addQueue')}</button>
      </form>

      <div style={{ fontSize: 13, fontWeight: 700, color: '#cbd5e1', margin: '4px 0 8px' }}>{t('wi.turnsToday')}</div>
      {staff.length === 0 ? (
        <div style={{ ...ui.card, color: '#94a3b8' }}>{t('wi.noStaff')}</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12, marginBottom: 20 }}>
          {staff.map((s) => {
            const isNext = s.nextUp;
            const border = isNext ? '#22c55e' : s.busy ? '#f59e0b' : '#334155';
            return (
              <div key={s.id} style={{ background: isNext ? 'rgba(34,197,94,0.10)' : '#1e293b', border: `1.5px solid ${border}`, borderRadius: 14, padding: 14, textAlign: 'center' }}>
                <div style={{ fontWeight: 700, color: '#e2e8f0', fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.name}</div>
                <div style={{ fontSize: 34, fontWeight: 800, color: '#fff', lineHeight: 1.1, margin: '4px 0' }}>{s.turns}</div>
                <div style={{ fontSize: 11, color: '#94a3b8' }}>{t('wi.turns')}</div>
                <div style={{ marginTop: 8, fontSize: 11, fontWeight: 700, color: isNext ? '#22c55e' : s.busy ? '#f59e0b' : '#64748b' }}>
                  {isNext ? t('wi.nextUp') : s.busy ? t('wi.serving') : t('wi.free')}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#cbd5e1', margin: '0 0 8px' }}>{t('wi.waiting')} ({board?.waiting.length ?? 0})</div>
          {(!board || board.waiting.length === 0) ? (
            <div style={{ ...ui.card, color: '#64748b' }}>{t('wi.noWaiting')}</div>
          ) : board.waiting.map((w) => {
            const sel = pick[w.id] ?? nextUp ?? '';
            return (
              <div key={w.id} style={{ ...ui.card, marginBottom: 8, padding: '12px 14px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <div style={{ fontWeight: 600, color: '#e2e8f0' }}>{w.customerName || 'Walk-in'}{w.partySize > 1 ? ` ·  ${w.partySize} ${t('wi.people')}` : ''}</div>
                  <div style={{ color: '#94a3b8', fontSize: 12 }}>{t('wi.waited')} {waitedMins(w.createdAt)}′</div>
                </div>
                <div style={{ color: '#94a3b8', fontSize: 12, margin: '2px 0 10px' }}>{w.service?.name ?? t('wi.noService')}{w.phone ? ` · ${w.phone}` : ''}</div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <select style={{ ...ui.input, padding: '7px 10px', flex: 1, minWidth: 130 }} value={sel} onChange={(e) => setPick({ ...pick, [w.id]: e.target.value })}>
                    <option value="">{t('wi.pickStaff')}</option>
                    {staff.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.turns} {t('wi.turns')}){s.busy ? ' · ' + t('wi.busy') : ''}{s.nextUp ? ' · ' + t('wi.upnext') : ''}</option>)}
                  </select>
                  <button disabled={!sel} onClick={() => sel && act(`${w.id}/assign`, { staffId: sel })} style={{ ...ui.primaryBtn, opacity: sel ? 1 : 0.5, padding: '8px 14px' }}>{t('wi.assign')}</button>
                  <button onClick={() => act(`${w.id}/cancel`)} style={{ ...ui.dangerBtn, padding: '8px 12px' }}>{t('wi.cancel')}</button>
                </div>
              </div>
            );
          })}
        </div>

        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#cbd5e1', margin: '0 0 8px' }}>{t('wi.inService')} ({board?.serving.length ?? 0})</div>
          {(!board || board.serving.length === 0) ? (
            <div style={{ ...ui.card, color: '#64748b' }}>{t('wi.noInService')}</div>
          ) : board.serving.map((w) => (
            <div key={w.id} style={{ ...ui.card, marginBottom: 8, padding: '12px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
              <div>
                <div style={{ fontWeight: 600, color: '#e2e8f0' }}>{w.customerName || 'Walk-in'}</div>
                <div style={{ color: '#94a3b8', fontSize: 12, marginTop: 2 }}>{w.service?.name ?? '—'} · {t('wi.tech')} <strong style={{ color: '#cbd5e1' }}>{fullName(w.assignedStaff)}</strong></div>
              </div>
              <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                <a
                  href={`/salon/pos?walkInId=${w.id}&serviceId=${w.service?.id ?? ''}&staffId=${w.assignedStaff?.id ?? ''}&customerId=${w.customerId ?? ''}&customer=${encodeURIComponent(w.customerName || '')}`}
                  style={{ ...ui.primaryBtn, padding: '8px 16px', textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}
                >{t('wi.checkout')}</a>
                <button onClick={() => act(`${w.id}/done`)} style={{ ...ui.primaryBtn, background: '#334155', padding: '8px 14px' }}>{t('wi.done')}</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/**
 * Type-to-search service picker for the walk-in form. A native <select> is hard
 * to scan once a salon has many services; this filters the list as you type.
 */
function ServiceSearchSelect({ services, value, onChange, placeholder }: {
  services: Service[]; value: string; onChange: (id: string) => void; placeholder: string;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const selected = services.find((s) => s.id === value) || null;
  const q = query.trim().toLowerCase();
  const filtered = q ? services.filter((s) => s.name.toLowerCase().includes(q)) : services;
  return (
    <div style={{ position: 'relative' }}>
      <style>{`.svc-opt:hover{background:#1e293b !important}`}</style>
      <input
        style={ui.input}
        value={open ? query : selected?.name ?? ''}
        placeholder={placeholder}
        onFocus={() => { setOpen(true); setQuery(''); }}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
      />
      {open && (
        <div style={{ position: 'absolute', zIndex: 30, top: 'calc(100% + 4px)', left: 0, right: 0, maxHeight: 260, overflowY: 'auto', background: '#0f172a', border: '1px solid #334155', borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,0.45)' }}>
          <button type="button" className="svc-opt" onMouseDown={(e) => { e.preventDefault(); onChange(''); setQuery(''); setOpen(false); }} style={svcOpt(!value)}>—</button>
          {filtered.map((s) => (
            <button key={s.id} type="button" className="svc-opt" onMouseDown={(e) => { e.preventDefault(); onChange(s.id); setQuery(s.name); setOpen(false); }} style={svcOpt(s.id === value)}>
              {s.name}
            </button>
          ))}
          {filtered.length === 0 && <div style={{ padding: '10px 12px', color: '#64748b', fontSize: 13 }}>No match</div>}
        </div>
      )}
    </div>
  );
}
const svcOpt = (active: boolean): CSSProperties => ({
  display: 'block', width: '100%', textAlign: 'left', padding: '9px 12px', border: 'none',
  background: active ? '#312e81' : 'transparent', color: active ? '#c7d2fe' : '#e2e8f0', cursor: 'pointer', fontSize: 14,
});
