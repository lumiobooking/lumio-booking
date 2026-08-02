'use client';

import { useCallback, useEffect, useRef, useState, FormEvent, CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { SalonShell } from '../../../components/SalonShell';
import { useAuth } from '../../../lib/auth';
import { apiFetch } from '../../../lib/api';
import { ui, formatPrice } from '../../../lib/ui';
import { useLang, tr } from '../../../lib/i18n';
import { useLiveRefresh } from '../../../lib/useLiveRefresh';

interface WalkInItem { lineId: string; serviceId: string; name: string; priceCents: number; durationMinutes?: number; staffId: string | null }
interface WalkIn {
  id: string; customerId: string | null; customerName: string | null; phone: string | null; note: string | null;
  partySize: number; status: string; createdAt: string; assignedAt: string | null;
  station: string | null;
  // Minutes the front desk tacked on after the customer was already seated.
  extraMinutes?: number | null;
  items: WalkInItem[];
  service: { id: string; name: string } | null;
  assignedStaff: { id: string; firstName: string; lastName: string | null } | null;
}
interface StaffTurn { id: string; name: string; avatarUrl: string | null; turns: number; busy: boolean; nextUp: boolean }
interface Board { waiting: WalkIn[]; serving: WalkIn[]; done?: WalkIn[]; staff: StaffTurn[]; nextUpStaffId: string | null }
interface Service {
  id: string; name: string;
  // Needed by the customer screen so it can show price and length per service.
  priceCents?: number; durationMinutes?: number;
  category?: { id: string; name: string } | null;
}

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
  const BLANK_FORM = { customerName: '', lastName: '', phone: '', email: '', birthDate: '', partySize: '1', staffChoice: 'auto', station: '', extraMinutes: '' };
  const [form, setForm] = useState(BLANK_FORM);
  // A walk-in rarely wants exactly one thing; the picker adds to this list.
  const [pickedIds, setPickedIds] = useState<string[]>([]);
  // The form is a drawer, not a permanent header: reception looks at the board
  // all day and only needs the form when someone walks in.
  const [formOpen, setFormOpen] = useState(false);
  // Second monitor facing the customer. Same browser, so BroadcastChannel keeps
  // both screens in step with no pairing, no login and no network.
  const [screenOn, setScreenOn] = useState(false);
  const chRef = useRef<BroadcastChannel | null>(null);
  const winRef = useRef<Window | null>(null);
  const [pick, setPick] = useState<Record<string, string>>({});
  const [currency, setCurrency] = useState('USD');
  const [salonName, setSalonName] = useState('');
  const [salonLogo, setSalonLogo] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const [b, svc, settings] = await Promise.all([
        apiFetch<Board>('/walkins/board', { token }),
        apiFetch<Service[]>('/services', { token }).catch(() => []),
        apiFetch<{ booking?: { currency?: string }; company?: { name?: string }; branding?: { logoUrl?: string } }>('/settings', { token })
          .catch(() => ({} as { booking?: { currency?: string }; company?: { name?: string }; branding?: { logoUrl?: string } })),
      ]);
      setBoard(b); setServices(svc);
      if (settings?.booking?.currency) setCurrency(settings.booking.currency);
      if (settings?.company?.name) setSalonName(settings.company.name);
      if (settings?.branding?.logoUrl) setSalonLogo(settings.branding.logoUrl);
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to load'); }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { load(); }, [load]);
  useLiveRefresh(load, 15000);

  // Keep the newest form state in a ref so the channel handler (registered once)
  // always reads current values instead of the ones captured at mount.
  const liveRef = useRef({ form, pickedIds, formOpen });
  useEffect(() => { liveRef.current = { form, pickedIds, formOpen }; }, [form, pickedIds, formOpen]);
  const addRef = useRef<() => void>(() => undefined);

  const pushToScreen = useCallback((mode: 'idle' | 'form' | 'thanks') => {
    const { form: f, pickedIds: p } = liveRef.current;
    chRef.current?.postMessage({
      type: 'state',
      // Same envelope the register uses, so the customer display it is already
      // showing simply switches mode — no second window to open.
      state: {
        status: mode === 'idle' ? 'idle' : 'checkin',
        checkinExit: mode === 'idle' ? true : undefined,
        currency: 'USD',
        salonName: salonName || '',
        salonLogo: salonLogo || undefined,
        lines: [],
        subtotalCents: 0, savingsCents: 0, tipCents: 0, taxCents: 0, giftCents: 0, dueCents: 0,
        checkin: {
          done: mode === 'thanks',
          services: services.map((x) => ({ id: x.id, name: x.name, priceCents: x.priceCents ?? 0, durationMinutes: x.durationMinutes ?? 0, category: x.category ?? null })),
          form: {
            firstName: f.customerName, lastName: f.lastName, phone: f.phone,
            email: f.email, birthDate: f.birthDate, partySize: parseInt(f.partySize, 10) || 1,
          },
          picked: p,
        },
      },
    });
  }, [salonName, salonLogo, services]);

  useEffect(() => {
    if (typeof window === 'undefined' || !('BroadcastChannel' in window)) return;
    const ch = new BroadcastChannel('lumio-pos-display');
    chRef.current = ch;
    ch.onmessage = (e: MessageEvent) => {
      const msg = e.data as { type: string; payload?: unknown };
      // The display asks for state when it loads (and the register answers the
      // same message) — only reply while our form is actually open.
      if (msg?.type === 'request') { setScreenOn(true); if (liveRef.current.formOpen) pushToScreen('form'); return; }
      if (msg?.type === 'form') {
        // The customer is typing on the other monitor.
        const p = (msg.payload ?? {}) as Partial<{ firstName: string; lastName: string; phone: string; email: string; birthDate: string; partySize: number }>;
        setForm((f) => ({
          ...f,
          ...(p.firstName !== undefined ? { customerName: p.firstName } : {}),
          ...(p.lastName !== undefined ? { lastName: p.lastName } : {}),
          ...(p.phone !== undefined ? { phone: p.phone } : {}),
          ...(p.email !== undefined ? { email: p.email } : {}),
          ...(p.birthDate !== undefined ? { birthDate: p.birthDate } : {}),
          ...(p.partySize !== undefined ? { partySize: String(p.partySize) } : {}),
        }));
        setFormOpen(true);
      }
      if (msg?.type === 'toggleService') {
        const id = String(msg.payload ?? '');
        setPickedIds((v) => (v.includes(id) ? v.filter((x) => x !== id) : [...v, id]));
      }
      // The customer pressed "I'm done" — the desk owns the token, so the desk saves.
      if (msg?.type === 'submit') void addRef.current();
    };
    return () => { ch.close(); chRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pushToScreen]);

  // Mirror every desk keystroke onto the customer screen while the form is open.
  useEffect(() => { if (screenOn) pushToScreen(formOpen ? 'form' : 'idle'); }, [form, pickedIds, formOpen, screenOn, pushToScreen]);

  // Same window name the register uses, so this focuses the display that is
  // already open on the second monitor instead of spawning another one.
  function openCustomerScreen() {
    if (typeof window === 'undefined') return;
    winRef.current = window.open('/pos-display', 'lumioCustomerDisplay', 'width=1100,height=760');
    setScreenOn(true);
  }
  function startNew() {
    setForm(BLANK_FORM); setPickedIds([]); setFormOpen(true);
    // Push immediately: the customer should see the form the moment it opens.
    setTimeout(() => pushToScreen('form'), 0);
  }

  async function add(e?: FormEvent) {
    e?.preventDefault(); setError(null);
    try {
      const body: Record<string, unknown> = {
        customerName: form.customerName.trim() || undefined,
        lastName: form.lastName.trim() || undefined,
        phone: form.phone.trim() || undefined,
        email: form.email.trim() || undefined,
        birthDate: form.birthDate || undefined,
        // First pick leads (it decides which kind of chair to look for).
        serviceId: pickedIds[0] || undefined,
        serviceIds: pickedIds.length > 1 ? pickedIds.slice(1) : undefined,
        extraMinutes: parseInt(form.extraMinutes, 10) || undefined,
        partySize: parseInt(form.partySize, 10) || 1,
        station: form.station.trim() || undefined,
      };
      // 'auto' = give it to the up-next free tech; a staff id = a requested tech;
      // 'wait' = just add to the waiting list (assign later).
      if (form.staffChoice === 'auto') body.autoAssign = true;
      else if (form.staffChoice !== 'wait') body.assignedStaffId = form.staffChoice;
      await apiFetch('/walkins', { method: 'POST', token, body });
      pushToScreen('thanks');
      setForm(BLANK_FORM); setPickedIds([]); setFormOpen(false);
      // Leave the thank-you up for a moment, then reset the customer screen.
      setTimeout(() => pushToScreen('idle'), 6000);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not add'); }
  }
  addRef.current = () => { void add(); };

  async function act(path: string, body?: unknown) {
    setError(null);
    try { await apiFetch(`/walkins/${path}`, { method: 'PATCH', token, body }); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Action failed'); }
  }

  async function addServiceLine(id: string, serviceId: string, staffId: string, extraMinutes?: number) {
    setError(null);
    try {
      await apiFetch(`/walkins/${id}/services`, {
        method: 'POST', token,
        body: { serviceId: serviceId || undefined, staffId: staffId || undefined, extraMinutes },
      });
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Action failed'); }
  }
  async function updateServiceLine(id: string, lineId: string, patch: Record<string, unknown>) {
    setError(null);
    try { await apiFetch(`/walkins/${id}/services/${lineId}`, { method: 'PATCH', token, body: patch }); await load(); }
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

      {/* Reception looks at the board all day; the form only appears when
          someone actually walks in. The customer monitor stays connected. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
        <button
          onClick={() => { if (formOpen) { setFormOpen(false); pushToScreen('idle'); } else startNew(); }}
          style={{ ...ui.primaryBtn, padding: '11px 20px', fontSize: 14.5 }}
        >{formOpen ? t('wi.closeForm') : t('wi.newWalkin')}</button>
        <button
          onClick={openCustomerScreen}
          title={t('wi.custScreenHint')}
          style={{
            border: `1px solid ${screenOn ? '#4f46e5' : '#334155'}`, background: 'transparent',
            color: screenOn ? '#c7d2fe' : '#cbd5e1', borderRadius: 8, padding: '10px 14px',
            fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 7,
          }}
        >
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: screenOn ? '#22c55e' : '#475569' }} />
          🖥️ {screenOn ? t('wi.custScreenOn') : t('wi.custScreen')}
        </button>
        <span style={{ flex: 1 }} />
        <KioskInline t={t} />
      </div>

      {/* Three labelled blocks instead of one long strip of inputs: who the
          customer is (kept for marketing), what they want (several services at
          once), and where they sit. */}
      {formOpen && (
      <form onSubmit={add} style={{ ...ui.card, padding: 0, overflow: 'hidden', marginBottom: 16 }}>
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <SecHead label={t('wi.secWho')} />
            <div style={wiGrid}>
              <label><WiLabel text={t('wi.customer')} opt={t('wi.optional')} /><input style={ui.input} value={form.customerName} placeholder={t('wi.namePh')} onChange={(e) => setForm({ ...form, customerName: e.target.value })} /></label>
              <label><WiLabel text={t('wi.lastName')} opt={t('wi.optional')} /><input style={ui.input} value={form.lastName} placeholder="Nguyen" onChange={(e) => setForm({ ...form, lastName: e.target.value })} /></label>
              <label><WiLabel text={t('wi.phone')} opt={t('wi.optional')} /><input style={ui.input} value={form.phone} inputMode="tel" placeholder="+1 512 886 8189" onChange={(e) => setForm({ ...form, phone: e.target.value })} /></label>
              <label><WiLabel text={t('wi.email')} opt={t('wi.optional')} /><input style={ui.input} type="email" value={form.email} placeholder="anna@email.com" onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
              <label><WiLabel text={t('wi.birth')} opt={t('wi.optional')} /><input style={ui.input} type="date" max={new Date().toISOString().slice(0, 10)} value={form.birthDate} onChange={(e) => setForm({ ...form, birthDate: e.target.value })} /></label>
            </div>
          </div>

          <div>
            <SecHead label={t('wi.secWhat')} extra={pickedIds.length ? `${pickedIds.length} ${t('wi.picked')}` : undefined} />
            {pickedIds.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                {pickedIds.map((id) => {
                  const sv = services.find((x) => x.id === id);
                  return (
                    <span key={id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: '#1e3a8a', color: '#dbeafe', borderRadius: 999, padding: '4px 10px', fontSize: 12.5, fontWeight: 600 }}>
                      {sv?.name ?? id}
                      <button type="button" onClick={() => setPickedIds((v) => v.filter((x) => x !== id))} style={{ background: 'none', border: 'none', color: '#93c5fd', cursor: 'pointer', fontSize: 13, padding: 0, lineHeight: 1 }}>✕</button>
                    </span>
                  );
                })}
              </div>
            )}
            <div style={wiGrid}>
              <label style={{ gridColumn: 'span 2', minWidth: 0 }}>
                <WiLabel text={t('wi.service')} opt={t('wi.optional')} />
                <ServiceSearchSelect
                  services={services} value=""
                  onChange={(id) => { if (id) setPickedIds((v) => (v.includes(id) ? v : [...v, id])); }}
                  placeholder={t('wi.serviceSearch')}
                />
              </label>
              <label>
                <WiLabel text={t('wi.extraTime')} opt={t('wi.optional')} hint={t('wi.extraTimeHint')} />
                <input style={ui.input} type="number" min={0} max={600} step={5} value={form.extraMinutes} placeholder="0" onChange={(e) => setForm({ ...form, extraMinutes: e.target.value })} />
              </label>
            </div>
          </div>

          <div>
            <SecHead label={t('wi.secSeat')} />
            <div style={wiGrid}>
              <label><WiLabel text={t('wi.partySize')} /><input style={ui.input} type="number" min={1} max={20} value={form.partySize} onChange={(e) => setForm({ ...form, partySize: e.target.value })} /></label>
              <label><WiLabel text={t('wi.station')} opt={t('wi.optional')} /><input style={ui.input} value={form.station} placeholder={t('wi.stationPh')} onChange={(e) => setForm({ ...form, station: e.target.value })} /></label>
              <label style={{ gridColumn: 'span 2', minWidth: 0 }}><WiLabel text={lang === 'vi' ? 'Thợ' : 'Technician'} />
                <select style={ui.input} value={form.staffChoice} onChange={(e) => setForm({ ...form, staffChoice: e.target.value })}>
                  <option value="auto">{lang === 'vi' ? 'Tự động — thợ tới lượt' : 'Auto — up next'}</option>
                  {(board?.staff ?? []).map((sm) => <option key={sm.id} value={sm.id}>{sm.name}{sm.busy ? (lang === 'vi' ? ' · đang bận' : ' · busy') : ''}</option>)}
                  <option value="wait">{lang === 'vi' ? 'Chỉ thêm vào hàng chờ' : 'Add to waiting'}</option>
                </select>
              </label>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderTop: '1px solid #334155', background: '#0f172a' }}>
          <span style={{ flex: 1, fontSize: 12.5, color: '#64748b' }}>{t('wi.subtitle')}</span>
          <button type="submit" style={{ ...ui.primaryBtn, padding: '10px 20px', fontSize: 14 }}>{t('wi.addQueue')}</button>
        </div>
      </form>
      )}

      {(board?.done ?? []).length > 0 && (
        <div style={{ marginBottom: 16 }}>
          {/* Marked Done too early, or done before the customer paid — the ticket
              has to stay reachable, not vanish off the board. */}
          <div style={{ fontSize: 13, fontWeight: 700, color: '#cbd5e1', margin: '4px 0 8px' }}>{t('wi.doneToday')}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {(board?.done ?? []).map((d) => {
              const total = (d.items ?? []).reduce((sum, it) => sum + (it.priceCents || 0), 0);
              const href = `/salon/pos?walkInId=${d.id}&serviceId=${d.service?.id ?? ''}&staffId=${d.assignedStaff?.id ?? ''}&customerId=${d.customerId ?? ''}&customer=${encodeURIComponent(d.customerName || '')}`;
              return (
                <div key={d.id} style={{ ...ui.card, padding: '9px 11px', display: 'flex', alignItems: 'center', gap: 10, opacity: 0.9 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#e2e8f0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 150 }}>{d.customerName || 'Walk-in'}</div>
                    <div style={{ fontSize: 11, color: '#94a3b8' }}>{fullName(d.assignedStaff) || '—'} · {formatPrice(total, currency)}</div>
                  </div>
                  <button onClick={() => act(`${d.id}/reactivate`)} style={{ border: '1px solid #334155', background: 'transparent', color: '#cbd5e1', borderRadius: 8, padding: '6px 10px', fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap' }}>{t('wi.reopen')}</button>
                  <a href={href} style={{ ...ui.primaryBtn, padding: '6px 12px', fontSize: 12, textDecoration: 'none', whiteSpace: 'nowrap' }}>{t('wi.checkout')}</a>
                </div>
              );
            })}
          </div>
        </div>
      )}

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
            onAdd={addServiceLine} onUpdateLine={updateServiceLine} onRemove={removeServiceLine} onStation={setStationFor}
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
function WalkInTicketSheet({ w, staff, services, t, currency, onAdd, onUpdateLine, onRemove, onStation, onDone, onClose }: {
  w: WalkIn; staff: StaffTurn[]; services: Service[]; t: (k: string) => string; currency: string;
  onAdd: (id: string, serviceId: string, staffId: string, extraMinutes?: number) => Promise<void> | void;
  onUpdateLine: (id: string, lineId: string, patch: Record<string, unknown>) => Promise<void> | void;
  onRemove: (id: string, lineId: string) => Promise<void> | void;
  onStation: (id: string, station: string) => void;
  onDone: () => void;
  onClose: () => void;
}) {
  const [svcId, setSvcId] = useState('');
  const [techId, setTechId] = useState('');
  const [extra, setExtra] = useState(String(w.extraMinutes ?? ''));
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
  const extraChanged = (extra.trim() === '' ? null : Math.max(0, parseInt(extra, 10) || 0)) !== (w.extraMinutes ?? null);
  async function add() {
    // Either half can be empty: add a service, change the time, or both.
    if ((!svcId && !extraChanged) || busy) return;
    setBusy(true);
    try {
      await onAdd(w.id, svcId, techId, extraChanged ? Math.max(0, parseInt(extra, 10) || 0) : undefined);
      setSvcId('');
    } finally { setBusy(false); }
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
              <LineRow
                key={it.lineId} it={it} w={w} staff={staff} services={services} t={t} currency={currency}
                techLabel={techLabel} onUpdateLine={onUpdateLine} onRemove={onRemove}
              />
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
            <label style={{ display: 'flex', alignItems: 'center', gap: 6 }} title={t('wi.extraTimeHint')}>
              <span style={{ fontSize: 11.5, color: '#94a3b8', whiteSpace: 'nowrap' }}>{t('wi.extraTime')}</span>
              <input
                type="number" min={0} max={600} step={5} value={extra} placeholder="0"
                onChange={(e) => setExtra(e.target.value)}
                style={{ width: 64, background: '#0f172a', border: '1px solid #334155', borderRadius: 8, color: '#e2e8f0', fontSize: 12.5, padding: '7px 8px', textAlign: 'right' }}
              />
              <span style={{ fontSize: 11.5, color: '#64748b' }}>m</span>
            </label>
            <button onClick={add} disabled={(!svcId && !extraChanged) || busy} style={{ ...ui.primaryBtn, padding: '9px 14px', opacity: ((svcId || extraChanged) && !busy) ? 1 : 0.5 }}>{busy ? '…' : t('wi.addLine')}</button>
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

const wiGrid: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 };

function SecHead({ label, extra }: { label: string; extra?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 9 }}>
      <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', color: '#94a3b8', textTransform: 'uppercase' }}>{label}</span>
      {extra && <span style={{ fontSize: 11.5, color: '#818cf8', fontWeight: 600 }}>{extra}</span>}
      <span style={{ flex: 1, height: 1, background: '#334155' }} />
    </div>
  );
}

function WiLabel({ text, opt, hint }: { text: string; opt?: string; hint?: string }) {
  // Some i18n strings already carry "(optional)"; strip it so the tag isn't said twice.
  const clean = text.replace(/\s*\((tuỳ chọn|tùy chọn|optional)\)\s*/i, '').trim();
  return (
    <span style={{ ...ui.label, display: 'flex', alignItems: 'center', gap: 6 }} title={hint}>
      {clean}
      {opt && <span style={{ fontSize: 10.5, color: '#64748b', border: '1px solid #334155', borderRadius: 5, padding: '1px 5px', fontWeight: 600 }}>{opt}</span>}
    </span>
  );
}

/**
 * One ticket line. Read-only by default; the pencil turns it into four small
 * fields — service, tech, price, minutes — because a nail ticket is negotiated
 * at the chair, not fixed by the menu.
 */
function LineRow({ it, w, staff, services, t, currency, techLabel, onUpdateLine, onRemove }: {
  it: WalkInItem; w: WalkIn; staff: StaffTurn[]; services: Service[]; t: (k: string) => string; currency: string;
  techLabel: (id: string | null) => string;
  onUpdateLine: (id: string, lineId: string, patch: Record<string, unknown>) => Promise<void> | void;
  onRemove: (id: string, lineId: string) => Promise<void> | void;
}) {
  const [editing, setEditing] = useState(false);
  const [svc, setSvc] = useState(it.serviceId);
  const [tech, setTech] = useState(it.staffId ?? '');
  const [price, setPrice] = useState((it.priceCents / 100).toFixed(2));
  const [mins, setMins] = useState(String(it.durationMinutes ?? ''));
  const [busy, setBusy] = useState(false);

  function reset() {
    setSvc(it.serviceId); setTech(it.staffId ?? '');
    setPrice((it.priceCents / 100).toFixed(2)); setMins(String(it.durationMinutes ?? ''));
    setEditing(false);
  }
  async function save() {
    setBusy(true);
    try {
      const patch: Record<string, unknown> = {};
      if (svc && svc !== it.serviceId) patch.serviceId = svc;
      const cents = Math.max(0, Math.round((parseFloat(price) || 0) * 100));
      if (cents !== it.priceCents) patch.priceCents = cents;
      const m = mins.trim() === '' ? undefined : Math.max(0, parseInt(mins, 10) || 0);
      if (m !== undefined && m !== (it.durationMinutes ?? undefined)) patch.durationMinutes = m;
      if ((tech || null) !== (it.staffId ?? null)) patch.staffId = tech;
      if (Object.keys(patch).length) await onUpdateLine(w.id, it.lineId, patch);
      setEditing(false);
    } finally { setBusy(false); }
  }

  if (!editing) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderBottom: '1px solid #1e293b' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ color: '#e2e8f0', fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.name}</div>
          <div style={{ color: '#94a3b8', fontSize: 11 }}>
            {techLabel(it.staffId)}
            {it.durationMinutes ? <span style={{ color: '#64748b' }}> · {it.durationMinutes} {t('wi.mins')}</span> : null}
          </div>
        </div>
        <div style={{ color: '#e2e8f0', fontSize: 14, fontWeight: 600 }}>{formatPrice(it.priceCents, currency)}</div>
        <button onClick={() => setEditing(true)} title={t('wi.editLine')} aria-label={t('wi.editLine')}
          style={{ background: 'none', border: 'none', color: '#818cf8', cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: '0 2px' }}>✎</button>
        <button onClick={() => onRemove(w.id, it.lineId)} title={t('wi.removeLine')} aria-label={t('wi.removeLine')}
          style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 18, lineHeight: 1, padding: '0 2px' }}>×</button>
      </div>
    );
  }
  return (
    <div style={{ padding: '10px 12px', borderBottom: '1px solid #1e293b', background: '#0f172a', display: 'flex', flexDirection: 'column', gap: 7 }}>
      <select value={svc} onChange={(e) => setSvc(e.target.value)} style={{ ...ui.input, padding: '7px 8px', fontSize: 13 }}>
        {services.every((x) => x.id !== svc) && <option value={svc}>{it.name}</option>}
        {services.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
      </select>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <select value={tech} onChange={(e) => setTech(e.target.value)} style={{ ...ui.input, padding: '7px 8px', fontSize: 12.5, flex: 1, minWidth: 110 }}>
          <option value="">{t('wi.unassignedTech')}</option>
          {staff.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
        <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ fontSize: 11.5, color: '#94a3b8' }}>$</span>
          <input type="number" min={0} step="0.01" value={price} onChange={(e) => setPrice(e.target.value)}
            style={{ ...ui.input, width: 78, padding: '7px 8px', fontSize: 12.5, textAlign: 'right' }} />
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <input type="number" min={0} max={600} step={5} value={mins} placeholder="0" onChange={(e) => setMins(e.target.value)}
            style={{ ...ui.input, width: 64, padding: '7px 8px', fontSize: 12.5, textAlign: 'right' }} />
          <span style={{ fontSize: 11.5, color: '#64748b' }}>{t('wi.mins')}</span>
        </label>
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <button onClick={save} disabled={busy} style={{ ...ui.primaryBtn, padding: '7px 14px', fontSize: 12.5, opacity: busy ? 0.5 : 1 }}>{busy ? '…' : t('wi.lineSave')}</button>
        <button onClick={reset} style={{ border: '1px solid #334155', background: 'transparent', color: '#cbd5e1', borderRadius: 8, padding: '7px 14px', fontSize: 12.5, cursor: 'pointer' }}>{t('wi.lineCancel')}</button>
      </div>
    </div>
  );
}

/**
 * Pair the customer-facing iPad. Deliberately quiet — it is a one-time setup,
 * not something the front desk touches every day — but always reachable,
 * because a rotated code makes the kiosk stop working until it is re-entered.
 */
function KioskInline({ t }: { t: (k: string) => string }) {
  const { token } = useAuth();
  const [open, setOpen] = useState(false);
  const [s, setS] = useState<{ pairCode: string; displayUrl: string } | null>(null);
  const load = useCallback(async () => {
    if (!token) return;
    try { setS(await apiFetch<{ pairCode: string; displayUrl: string }>('/display/session', { token })); }
    catch { /* not fatal — the desk still works without a kiosk */ }
  }, [token]);
  useEffect(() => { if (open && !s) load(); }, [open, s, load]);
  const url = s ? s.displayUrl.replace(/\/display\/?$/, '/checkin') : '';

  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{ background: 'none', border: '1px solid #334155', borderRadius: 8, color: '#94a3b8', fontSize: 12.5, cursor: 'pointer', padding: '9px 12px', display: 'flex', alignItems: 'center', gap: 7 }}
      >
        📱 {t('wi.kiosk')}<span style={{ color: '#64748b' }}>{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div style={{ ...ui.card, position: 'absolute', right: 0, top: 'calc(100% + 6px)', zIndex: 20, width: 'min(520px, 86vw)', display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ background: '#0f172a', border: '1px solid #4f46e5', borderRadius: 12, padding: '12px 20px', textAlign: 'center' }}>
            <div style={{ fontSize: 10.5, color: '#94a3b8', letterSpacing: '0.1em', fontWeight: 700 }}>CODE</div>
            <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: 4, color: '#c7d2fe' }}>{s?.pairCode ?? '······'}</div>
          </div>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ fontSize: 13, color: '#cbd5e1', marginBottom: 6 }}>
              {t('wi.kioskHow').replace('%url%', '')}
            </div>
            {url && <div style={{ fontSize: 13, color: '#818cf8', wordBreak: 'break-all', fontWeight: 600 }}>{url}</div>}
          </div>
          <button
            onClick={async () => { if (!token) return; try { setS(await apiFetch('/display/rotate', { method: 'POST', token })); } catch { /* ignore */ } }}
            style={{ border: '1px solid #334155', background: 'transparent', color: '#94a3b8', borderRadius: 8, padding: '8px 12px', fontSize: 12, cursor: 'pointer' }}
          >{t('wi.kioskNew')}</button>
        </div>
      )}
    </div>
  );
}
