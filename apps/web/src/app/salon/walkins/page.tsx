'use client';

import { useCallback, useEffect, useState, FormEvent, CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { SalonShell } from '../../../components/SalonShell';
import { useAuth } from '../../../lib/auth';
import { apiFetch } from '../../../lib/api';
import { ui, formatPrice } from '../../../lib/ui';
import { useLang, tr } from '../../../lib/i18n';
import { useLiveRefresh } from '../../../lib/useLiveRefresh';

interface WalkInItem { lineId: string; serviceId: string; name: string; priceCents: number; staffId: string | null }
interface WalkIn {
  id: string; customerId: string | null; customerName: string | null; phone: string | null; note: string | null;
  partySize: number; status: string; createdAt: string; assignedAt: string | null;
  station: string | null;
  items: WalkInItem[];
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
  const [form, setForm] = useState({ customerName: '', phone: '', serviceId: '', partySize: '1', staffChoice: 'auto', station: '' });
  const [pick, setPick] = useState<Record<string, string>>({});
  const [currency, setCurrency] = useState('USD');
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const [b, svc, settings] = await Promise.all([
        apiFetch<Board>('/walkins/board', { token }),
        apiFetch<Service[]>('/services', { token }).catch(() => []),
        apiFetch<{ booking?: { currency?: string } }>('/settings', { token }).catch(() => ({} as { booking?: { currency?: string } })),
      ]);
      setBoard(b); setServices(svc);
      if (settings?.booking?.currency) setCurrency(settings.booking.currency);
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to load'); }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { load(); }, [load]);
  useLiveRefresh(load, 15000);

  async function add(e: FormEvent) {
    e.preventDefault(); setError(null);
    try {
      const body: Record<string, unknown> = {
        customerName: form.customerName.trim() || undefined,
        phone: form.phone.trim() || undefined,
        serviceId: form.serviceId || undefined,
        partySize: parseInt(form.partySize, 10) || 1,
        station: form.station.trim() || undefined,
      };
      // 'auto' = give it to the up-next free tech; a staff id = a requested tech;
      // 'wait' = just add to the waiting list (assign later).
      if (form.staffChoice === 'auto') body.autoAssign = true;
      else if (form.staffChoice !== 'wait') body.assignedStaffId = form.staffChoice;
      await apiFetch('/walkins', { method: 'POST', token, body });
      setForm({ customerName: '', phone: '', serviceId: '', partySize: '1', staffChoice: 'auto', station: '' });
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not add'); }
  }
  async function act(path: string, body?: unknown) {
    setError(null);
    try { await apiFetch(`/walkins/${path}`, { method: 'PATCH', token, body }); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Action failed'); }
  }

  async function addServiceLine(id: string, serviceId: string, staffId: string) {
    setError(null);
    try { await apiFetch(`/walkins/${id}/services`, { method: 'POST', token, body: { serviceId, staffId: staffId || undefined } }); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Action failed'); }
  }
  async function removeServiceLine(id: string, lineId: string) {
    setError(null);
    try { await apiFetch(`/walkins/${id}/services/${lineId}`, { method: 'DELETE', token }); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Action failed'); }
  }
  async function setStationFor(id: string, station: string) {
    setError(null);
    try { await apiFetch(`/walkins/${id}/station`, { method: 'PATCH', token, body: { station } }); await load(); }
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

      <form onSubmit={add} style={{ ...ui.card, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, alignItems: 'end', marginBottom: 16 }}>
        <label><span style={ui.label}>{t('wi.customer')}</span><input style={ui.input} value={form.customerName} placeholder={t('wi.namePh')} onChange={(e) => setForm({ ...form, customerName: e.target.value })} /></label>
        <label><span style={ui.label}>{t('wi.phone')}</span><input style={ui.input} value={form.phone} inputMode="tel" onChange={(e) => setForm({ ...form, phone: e.target.value })} /></label>
        <label><span style={ui.label}>{t('wi.service')}</span>
          <ServiceSearchSelect services={services} value={form.serviceId} onChange={(id) => setForm({ ...form, serviceId: id })} placeholder={t('wi.serviceSearch')} />
        </label>
        <label><span style={ui.label}>{t('wi.partySize')}</span><input style={ui.input} type="number" min={1} max={20} value={form.partySize} onChange={(e) => setForm({ ...form, partySize: e.target.value })} /></label>
        <label><span style={ui.label}>{t('wi.station')}</span><input style={ui.input} value={form.station} placeholder={t('wi.stationPh')} onChange={(e) => setForm({ ...form, station: e.target.value })} /></label>
        <label><span style={ui.label}>{lang === 'vi' ? 'Thợ' : 'Technician'}</span>
          <select style={ui.input} value={form.staffChoice} onChange={(e) => setForm({ ...form, staffChoice: e.target.value })}>
            <option value="auto">{lang === 'vi' ? 'Tự động — thợ tới lượt' : 'Auto — up next'}</option>
            {(board?.staff ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}{s.busy ? (lang === 'vi' ? ' · đang bận' : ' · busy') : ''}</option>)}
            <option value="wait">{lang === 'vi' ? 'Chỉ thêm vào hàng chờ' : 'Add to waiting'}</option>
          </select>
        </label>
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

      <style>{`.wi-serving{transition:border-color .12s ease, transform .06s ease}.wi-serving:hover{border-color:#6366f1}.wi-serving:active{transform:scale(.99)}`}</style>

      {/* Waiting queue — full width, compact grid (usually short). */}
      <div style={{ fontSize: 13, fontWeight: 700, color: '#cbd5e1', margin: '0 0 8px' }}>{t('wi.waiting')} ({board?.waiting.length ?? 0})</div>
      {(!board || board.waiting.length === 0) ? (
        <div style={{ ...ui.card, color: '#64748b', marginBottom: 20 }}>{t('wi.noWaiting')}</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(258px, 1fr))', gap: 10, marginBottom: 20 }}>
          {board.waiting.map((w) => {
            const sel = pick[w.id] ?? nextUp ?? '';
            return (
              <div key={w.id} style={{ ...ui.card, padding: '12px 14px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                  <div style={{ fontWeight: 600, color: '#e2e8f0', minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{w.customerName || 'Walk-in'}{w.station ? ` · ${t('wi.stationShort')} ${w.station}` : ''}{w.partySize > 1 ? ` · ${w.partySize} ${t('wi.people')}` : ''}</div>
                  <div style={{ color: '#94a3b8', fontSize: 12, flexShrink: 0 }}>{waitedMins(w.createdAt)}′</div>
                </div>
                <div style={{ color: '#94a3b8', fontSize: 12, margin: '2px 0 10px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{w.service?.name ?? t('wi.noService')}{w.phone ? ` · ${w.phone}` : ''}</div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <select style={{ ...ui.input, padding: '7px 10px', flex: 1, minWidth: 120 }} value={sel} onChange={(e) => setPick({ ...pick, [w.id]: e.target.value })}>
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
      )}

      {/* In service — full-width responsive grid of COMPACT cards. Tap a card to open
          the detail sheet (edit ticket / add services / checkout). Keeps the whole
          floor on one screen even when busy. */}
      <div style={{ fontSize: 13, fontWeight: 700, color: '#cbd5e1', margin: '0 0 8px' }}>{t('wi.inService')} ({board?.serving.length ?? 0})</div>
      {(!board || board.serving.length === 0) ? (
        <div style={{ ...ui.card, color: '#64748b' }}>{t('wi.noInService')}</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(268px, 1fr))', gap: 12 }}>
          {board.serving.map((w) => (
            <CompactServingCard key={w.id} w={w} currency={currency} t={t} onOpen={() => setOpenId(w.id)} />
          ))}
        </div>
      )}

      {openId && board && (() => {
        const w = board.serving.find((x) => x.id === openId);
        if (!w) return null;
        return (
          <WalkInTicketSheet
            w={w} staff={staff} services={services} t={t} currency={currency}
            onAdd={addServiceLine} onRemove={removeServiceLine} onStation={setStationFor}
            onDone={async () => { await act(`${w.id}/done`); setOpenId(null); }}
            onClose={() => setOpenId(null)}
          />
        );
      })()}
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
  const { lang } = useLang();
  const t = (k: string) => tr(k, lang);
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
          {filtered.length === 0 && <div style={{ padding: '10px 12px', color: '#64748b', fontSize: 13 }}>{t('wi.noMatch')}</div>}
        </div>
      )}
    </div>
  );
}
const svcOpt = (active: boolean): CSSProperties => ({
  display: 'block', width: '100%', textAlign: 'left', padding: '9px 12px', border: 'none',
  background: active ? '#312e81' : 'transparent', color: active ? '#c7d2fe' : '#e2e8f0', cursor: 'pointer', fontSize: 14,
});

/** Compact "in service" card: name, station, tech, service count + running total,
 *  a quick Checkout, and a Details button that opens the full ticket sheet. Kept
 *  small on purpose so the whole floor fits on one screen when it's busy. */
function CompactServingCard({ w, currency, t, onOpen }: {
  w: WalkIn; currency: string; t: (k: string) => string; onOpen: () => void;
}) {
  const items = w.items ?? [];
  const subtotal = items.reduce((sum, it) => sum + (it.priceCents || 0), 0);
  const summary = items.length === 0
    ? t('wi.noService')
    : items.length === 1 ? items[0].name : `${items.length} ${t('wi.svcMany')}`;
  const checkoutHref = `/salon/pos?walkInId=${w.id}&serviceId=${w.service?.id ?? ''}&staffId=${w.assignedStaff?.id ?? ''}&customerId=${w.customerId ?? ''}&customer=${encodeURIComponent(w.customerName || '')}`;
  return (
    <div className="wi-serving" onClick={onOpen}
      style={{ ...ui.card, padding: 0, cursor: 'pointer', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '12px 14px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#22c55e', flexShrink: 0 }} />
            <span style={{ fontWeight: 700, color: '#e2e8f0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{w.customerName || 'Walk-in'}</span>
            {w.station && <span style={stationChip}>{t('wi.stationShort')} {w.station}</span>}
          </div>
          <span style={{ color: '#94a3b8', fontSize: 11, whiteSpace: 'nowrap', flexShrink: 0 }}>{fullName(w.assignedStaff)}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 8, marginTop: 10 }}>
          <span style={{ color: '#94a3b8', fontSize: 12, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{summary}</span>
          <span style={{ color: '#fff', fontSize: 18, fontWeight: 800, flexShrink: 0 }}>{formatPrice(subtotal, currency)}</span>
        </div>
      </div>
      <div style={{ display: 'flex', borderTop: '1px solid #1e293b', marginTop: 'auto' }}>
        <a href={checkoutHref} onClick={(e) => e.stopPropagation()}
          style={{ flex: 1, textAlign: 'center', padding: '10px', color: '#c7d2fe', fontWeight: 700, fontSize: 13, textDecoration: 'none', background: 'rgba(99,102,241,0.12)' }}>{t('wi.checkout')}</a>
        <button onClick={(e) => { e.stopPropagation(); onOpen(); }}
          style={{ padding: '10px 16px', background: 'none', border: 'none', borderLeft: '1px solid #1e293b', color: '#94a3b8', cursor: 'pointer', fontSize: 13, whiteSpace: 'nowrap' }}>{t('wi.manage')} ›</button>
      </div>
    </div>
  );
}
const stationChip: CSSProperties = { fontSize: 11, fontWeight: 700, color: '#c7d2fe', background: '#312e81', borderRadius: 6, padding: '2px 8px', flexShrink: 0, whiteSpace: 'nowrap' };

/** Full ticket editor for one in-service walk-in, in a focused overlay: service
 *  lines (each with its tech), add a service, edit station, checkout, done. Opened
 *  from a compact card so the board itself stays a clean overview. Portaled to body. */
function WalkInTicketSheet({ w, staff, services, t, currency, onAdd, onRemove, onStation, onDone, onClose }: {
  w: WalkIn; staff: StaffTurn[]; services: Service[]; t: (k: string) => string; currency: string;
  onAdd: (id: string, serviceId: string, staffId: string) => Promise<void> | void;
  onRemove: (id: string, lineId: string) => Promise<void> | void;
  onStation: (id: string, station: string) => void;
  onDone: () => void;
  onClose: () => void;
}) {
  const [svcId, setSvcId] = useState('');
  const [techId, setTechId] = useState('');
  const [station, setStation] = useState(w.station ?? '');
  const [busy, setBusy] = useState(false);
  const items = w.items ?? [];
  const subtotal = items.reduce((sum, it) => sum + (it.priceCents || 0), 0);
  const techLabel = (id: string | null) => {
    if (!id) return t('wi.unassignedTech');
    const s = staff.find((x) => x.id === id);
    if (s) return s.name;
    return w.assignedStaff && w.assignedStaff.id === id ? fullName(w.assignedStaff) : t('wi.unassignedTech');
  };
  async function add() {
    if (!svcId || busy) return;
    setBusy(true);
    try { await onAdd(w.id, svcId, techId); setSvcId(''); }
    finally { setBusy(false); }
  }
  const checkoutHref = `/salon/pos?walkInId=${w.id}&serviceId=${w.service?.id ?? ''}&staffId=${w.assignedStaff?.id ?? ''}&customerId=${w.customerId ?? ''}&customer=${encodeURIComponent(w.customerName || '')}`;
  const content = (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(2,6,23,0.7)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ ...ui.card, width: 'min(560px, 96vw)', maxHeight: '88vh', overflowY: 'auto', padding: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '14px 16px', borderBottom: '1px solid #1e293b', position: 'sticky', top: 0, background: '#111827', zIndex: 1 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 800, fontSize: 17, color: '#e2e8f0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{w.customerName || 'Walk-in'}</div>
            <div style={{ color: '#94a3b8', fontSize: 12, marginTop: 2 }}>{t('wi.tech')} <strong style={{ color: '#cbd5e1' }}>{fullName(w.assignedStaff) || '—'}</strong></div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4 }} title={t('wi.station')}>
              <span style={{ fontSize: 11, color: '#64748b' }}>{t('wi.stationShort')}</span>
              <input value={station} onChange={(e) => setStation(e.target.value)}
                onBlur={() => { const v = station.trim(); if (v !== (w.station ?? '')) onStation(w.id, v); }}
                onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                placeholder={t('wi.stationPh')}
                style={{ width: 52, background: '#0f172a', border: '1px solid #334155', borderRadius: 8, color: '#e2e8f0', fontSize: 12, padding: '5px 8px', textAlign: 'center' }} />
            </label>
            <button onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: 24, lineHeight: 1, cursor: 'pointer' }}>×</button>
          </div>
        </div>

        <div style={{ padding: 16 }}>
          <div style={{ border: '1px solid #263041', borderRadius: 10, overflow: 'hidden' }}>
            {items.length === 0 ? (
              <div style={{ padding: '12px', color: '#64748b', fontSize: 13 }}>{t('wi.noLines')}</div>
            ) : items.map((it) => (
              <div key={it.lineId} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderBottom: '1px solid #1e293b' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: '#e2e8f0', fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.name}</div>
                  <div style={{ color: '#94a3b8', fontSize: 11 }}>{techLabel(it.staffId)}</div>
                </div>
                <div style={{ color: '#e2e8f0', fontSize: 14, fontWeight: 600 }}>{formatPrice(it.priceCents, currency)}</div>
                <button onClick={() => onRemove(w.id, it.lineId)} title={t('wi.removeLine')} aria-label={t('wi.removeLine')}
                  style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 18, lineHeight: 1, padding: '0 2px' }}>×</button>
              </div>
            ))}
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 12px', background: '#0f172a' }}>
              <span style={{ color: '#94a3b8', fontSize: 13, fontWeight: 700 }}>{t('wi.subtotal')}</span>
              <span style={{ color: '#fff', fontSize: 16, fontWeight: 800 }}>{formatPrice(subtotal, currency)}</span>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 10, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 150 }}>
              <ServiceSearchSelect services={services} value={svcId} onChange={setSvcId} placeholder={t('wi.addServicePh')} />
            </div>
            <select style={{ ...ui.input, padding: '9px 10px', width: 'auto', maxWidth: 150 }} value={techId} onChange={(e) => setTechId(e.target.value)}>
              <option value="">{t('wi.sameTech')}</option>
              {staff.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
            <button onClick={add} disabled={!svcId || busy} style={{ ...ui.primaryBtn, padding: '9px 14px', opacity: svcId && !busy ? 1 : 0.5 }}>{busy ? '…' : t('wi.addLine')}</button>
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <a href={checkoutHref}
              style={{ ...ui.primaryBtn, flex: 1, textAlign: 'center', padding: '12px 16px', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>{t('wi.checkout')} · {formatPrice(subtotal, currency)}</a>
            <button onClick={onDone} style={{ ...ui.primaryBtn, background: '#334155', padding: '12px 14px' }}>{t('wi.done')}</button>
          </div>
        </div>
      </div>
    </div>
  );
  return typeof document === 'undefined' ? null : createPortal(content, document.body);
}
