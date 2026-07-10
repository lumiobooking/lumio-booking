'use client';

import { useCallback, useEffect, useRef, useState, CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { apiFetch } from '../lib/api';
import { ui, formatPrice } from '../lib/ui';
import { useLiveRefresh } from '../lib/useLiveRefresh';

interface WItem { lineId: string; serviceId: string; name: string; priceCents: number; staffId: string | null }
interface Serving {
  id: string; customerName: string | null; phone: string | null; assignedAt: string | null; stationId: string | null;
  items: WItem[]; service: { id: string; name: string } | null; assignedStaff: { id: string; firstName: string; lastName: string | null } | null;
}
interface Waiting { id: string; customerName: string | null; phone: string | null; createdAt: string; partySize: number; service: { id: string; name: string } | null }
interface StaffTurn { id: string; name: string; avatarUrl: string | null; turns: number; busy: boolean; nextUp: boolean }
interface Board { waiting: Waiting[]; serving: Serving[]; staff: StaffTurn[]; nextUpStaffId: string | null }
interface Station { id: string; name: string; stationType: { id: string; name: string; sortOrder: number } | null; isActive: boolean; sortOrder: number }
interface Svc { id: string; name: string; priceCents: number; durationMinutes: number }

function fullName(s: { firstName: string; lastName: string | null } | null) { return s ? `${s.firstName}${s.lastName ? ' ' + s.lastName : ''}` : ''; }
function minsSince(iso: string | null) { return iso ? Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000)) : 0; }
function initials(name: string) { return (name || '?').split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase(); }

export function FloorView({ token, lang }: { token: string | null; lang: string }) {
  const vi = lang === 'vi';
  const [board, setBoard] = useState<Board | null>(null);
  const [stations, setStations] = useState<Station[]>([]);
  const [services, setServices] = useState<Svc[]>([]);
  const [currency, setCurrency] = useState('USD');
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [quick, setQuick] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [lastDone, setLastDone] = useState<{ id: string; name: string } | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const [b, st, svc, settings] = await Promise.all([
        apiFetch<Board>('/walkins/board', { token }),
        apiFetch<Station[]>('/stations', { token }).catch(() => [] as Station[]),
        apiFetch<Svc[]>('/services', { token }).catch(() => [] as Svc[]),
        apiFetch<{ booking?: { currency?: string } }>('/settings', { token }).catch(() => ({} as { booking?: { currency?: string } })),
      ]);
      setBoard(b); setStations(st); setServices(svc);
      if (settings?.booking?.currency) setCurrency(settings.booking.currency);
      setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to load'); }
  }, [token]);
  useEffect(() => { load(); }, [load]);
  useLiveRefresh(load, 12000);

  async function call(path: string, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', body?: unknown) {
    setError(null);
    try { await apiFetch(`/walkins/${path}`, { method, token, body }); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Action failed'); }
  }
  const move = (id: string, stationId: string) => call(`${id}/chair`, 'PATCH', { stationId });
  const addLine = (id: string, serviceId: string, staffId: string) => call(`${id}/services`, 'POST', { serviceId, staffId: staffId || undefined });
  const removeLine = (id: string, lineId: string) => call(`${id}/services/${lineId}`, 'DELETE');
  const done = async (id: string) => {
    const w = board?.serving.find((x) => x.id === id);
    await call(`${id}/done`, 'PATCH');
    setOpenId(null);
    setLastDone({ id, name: w?.customerName || 'Walk-in' });
    window.setTimeout(() => setLastDone((cur) => (cur && cur.id === id ? null : cur)), 15000);
  };
  async function reactivate(id: string) { setLastDone(null); await call(`${id}/reactivate`, 'PATCH'); }
  async function createBill(body: Record<string, unknown>) {
    setError(null);
    try { await apiFetch('/walkins', { method: 'POST', token, body: { ...body, autoAssign: true } }); setQuick(false); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not create'); }
  }

  if (!board) return <p style={{ color: '#94a3b8' }}>Loading…</p>;

  const active = stations.filter((s) => s.isActive);
  const occByStation = new Map<string, Serving>();
  for (const s of board.serving) if (s.stationId) occByStation.set(s.stationId, s);
  const noChair = board.serving.filter((s) => !s.stationId);
  const idle = board.staff.filter((s) => !s.busy);
  const freeCount = active.length - occByStation.size;
  const freeStations = active.filter((s) => !occByStation.has(s.id));
  const svcDur = new Map(services.map((s) => [s.id, s.durationMinutes || 0]));
  const expectedMins = (items: WItem[]) => items.reduce((a, it) => a + (svcDur.get(it.serviceId) || 0), 0);
  const typeGroups = new Map<string, { id: string; name: string; order: number; list: Station[] }>();
  for (const st of active) {
    const key = st.stationType?.id ?? '__none__';
    if (!typeGroups.has(key)) typeGroups.set(key, { id: key, name: st.stationType?.name ?? (vi ? 'Chưa phân loại' : 'Other'), order: st.stationType?.sortOrder ?? 999, list: [] });
    typeGroups.get(key)!.list.push(st);
  }
  const byType = [...typeGroups.values()].sort((a, b) => a.order - b.order);

  const openWalkIn = openId ? board.serving.find((x) => x.id === openId) ?? null : null;

  return (
    <div>
      <style>{`.fl-tile{transition:border-color .12s,transform .06s}.fl-tile:hover{border-color:#6366f1}.fl-drop{outline:2px dashed #22c55e;outline-offset:-4px}`}</style>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 13, color: freeCount > 0 ? '#22c55e' : '#f59e0b', background: freeCount > 0 ? 'rgba(34,197,94,0.12)' : 'rgba(245,158,11,0.12)', borderRadius: 8, padding: '5px 10px', fontWeight: 700 }}>
            {active.length === 0 ? (vi ? 'Chưa có ghế' : 'No chairs yet') : `${freeCount} ${vi ? 'ghế trống' : 'free'}`}
          </span>
          {active.length === 0 && <a href="/salon/stations" style={{ fontSize: 12, color: '#818cf8', textDecoration: 'none' }}>{vi ? 'Khai báo ghế →' : 'Set up chairs →'}</a>}
        </div>
        <button onClick={() => setQuick(true)} style={{ ...ui.primaryBtn, padding: '9px 16px' }}>+ {vi ? 'Lên bill' : 'New bill'}</button>
      </div>

      {error && <div style={ui.banner}>{error}</div>}

      {lastDone && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, background: '#1e293b', border: '1px solid #475569', borderRadius: 10, padding: '8px 12px', marginBottom: 12 }}>
          <span style={{ fontSize: 13, color: '#cbd5e1' }}>{vi ? `Đã kết thúc "${lastDone.name}" (không thu tiền).` : `Finished "${lastDone.name}" (no sale).`}</span>
          <button onClick={() => reactivate(lastDone.id)} style={{ ...ui.primaryBtn, padding: '6px 14px' }}>{vi ? '↶ Hoàn tác' : '↶ Undo'}</button>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', background: '#111827', border: '1px solid #1e293b', borderRadius: 10, padding: '8px 12px', marginBottom: 14 }}>
        <span style={{ fontSize: 13, color: '#94a3b8' }}>{vi ? 'Thợ đang rảnh' : 'Idle techs'}</span>
        {idle.length === 0 ? <span style={{ fontSize: 12, color: '#64748b' }}>{vi ? 'Tất cả đang bận' : 'all busy'}</span>
          : idle.map((s) => (
            <span key={s.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#e2e8f0', background: '#1e293b', border: '1px solid #334155', borderRadius: 20, padding: '3px 10px' }}>
              <span style={ava}>{initials(s.name)}</span>{s.name} · {s.turns}{s.nextUp ? (vi ? ' · tới lượt' : ' · next') : ''}
            </span>
          ))}
      </div>

      {noChair.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 12, color: '#f59e0b', marginBottom: 6 }}>{vi ? 'Đang làm, chưa có ghế — chọn ghế bên dưới (hoặc kéo vào ô ghế trống):' : 'In service, no chair — pick a chair below (or drag onto a free chair):'}</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {noChair.map((w) => (
              <div key={w.id} style={{ background: '#1e293b', border: '1px solid #f59e0b', borderRadius: 10, padding: '8px 12px', minWidth: 200 }}>
                <div draggable onDragStart={() => setDragId(w.id)} onDragEnd={() => setDragId(null)} onClick={() => setOpenId(w.id)} style={{ cursor: 'grab' }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0' }}>{w.customerName || 'Walk-in'}</div>
                  <div style={{ fontSize: 11, color: '#94a3b8' }}>{fullName(w.assignedStaff)} · {formatPrice(w.items.reduce((a, it) => a + it.priceCents, 0), currency)}</div>
                </div>
                <select value="" onChange={(e) => e.target.value && move(w.id, e.target.value)} style={{ ...ui.input, width: '100%', boxSizing: 'border-box', marginTop: 6, padding: '5px 8px', fontSize: 12 }}>
                  <option value="">{vi ? 'Xếp vào ghế…' : 'Seat at chair…'}</option>
                  {freeStations.map((st) => <option key={st.id} value={st.id}>{st.name}{st.stationType ? ` · ${st.stationType.name}` : ''}</option>)}
                </select>
              </div>
            ))}
          </div>
        </div>
      )}

      {byType.map((g) => (
        <div key={g.id} style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#cbd5e1', margin: '0 0 8px' }}>{g.name} ({g.list.length})</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(172px, 1fr))', gap: 10 }}>
            {g.list.map((st) => {
              const occ = occByStation.get(st.id);
              if (occ) {
                const total = occ.items.reduce((a, it) => a + it.priceCents, 0);
                const elapsed = minsSince(occ.assignedAt);
                const exp = expectedMins(occ.items);
                const over = exp > 0 && elapsed >= exp;
                const soon = exp > 0 && !over && elapsed >= exp - 5;
                const tColor = over ? '#f87171' : soon ? '#fbbf24' : '#c7d2fe';
                const tBg = over ? 'rgba(248,113,113,0.15)' : soon ? 'rgba(251,191,36,0.15)' : '#312e81';
                return (
                  <div key={st.id} className="fl-tile" draggable onDragStart={() => setDragId(occ.id)} onDragEnd={() => setDragId(null)} onClick={() => setOpenId(occ.id)}
                    style={{ ...ui.card, padding: '10px 12px', cursor: 'pointer', minHeight: 118, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: 12, color: '#64748b' }}>{st.name}</span>
                      <span style={{ fontSize: 11, color: tColor, background: tBg, borderRadius: 20, padding: '2px 8px' }}>{elapsed}′{exp > 0 ? ` / ${exp}′` : ''}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                      <span style={ava}>{initials(occ.customerName || 'W')}</span>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 14, fontWeight: 600, color: '#e2e8f0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{occ.customerName || 'Walk-in'}</div>
                        <div style={{ fontSize: 12, color: '#94a3b8', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{occ.items.length ? (occ.items.length === 1 ? occ.items[0].name : `${occ.items.length} ${vi ? 'dịch vụ' : 'services'}`) : (vi ? 'chưa có dịch vụ' : 'no service')}</div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 'auto' }}>
                      <span style={{ fontSize: 12, color: '#94a3b8', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{fullName(occ.assignedStaff) || '—'}</span>
                      <span style={{ fontSize: 15, fontWeight: 800, color: '#fff' }}>{formatPrice(total, currency)}</span>
                    </div>
                  </div>
                );
              }
              return (
                <div key={st.id}
                  onDragOver={(e) => { if (dragId) { e.preventDefault(); e.currentTarget.classList.add('fl-drop'); } }}
                  onDragLeave={(e) => e.currentTarget.classList.remove('fl-drop')}
                  onDrop={(e) => { e.currentTarget.classList.remove('fl-drop'); if (dragId) { move(dragId, st.id); setDragId(null); } }}
                  style={{ background: 'rgba(34,197,94,0.06)', border: '1.5px dashed #16a34a', borderRadius: 12, minHeight: 118, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3, color: '#22c55e' }}>
                  <span style={{ fontSize: 22, lineHeight: 1 }}>+</span>
                  <span style={{ fontSize: 14, fontWeight: 600 }}>{vi ? 'Trống' : 'Free'}</span>
                  <span style={{ fontSize: 11, color: '#22c55e' }}>{st.name}</span>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {board.waiting.length > 0 && (
        <div style={{ marginTop: 6 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#cbd5e1', margin: '0 0 8px' }}>{vi ? 'Đang chờ' : 'Waiting'} ({board.waiting.length})</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {board.waiting.map((w) => (
              <div key={w.id} style={{ ...ui.card, padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 10 }}>
                <div><div style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0' }}>{w.customerName || 'Walk-in'}</div>
                  <div style={{ fontSize: 11, color: '#94a3b8' }}>{w.service?.name ?? (vi ? 'chưa chọn' : 'no service')} · {minsSince(w.createdAt)}′</div></div>
                <button onClick={() => call(`${w.id}/assign`, 'PATCH', { staffId: board.nextUpStaffId })} disabled={!board.nextUpStaffId}
                  style={{ ...ui.primaryBtn, padding: '7px 12px', opacity: board.nextUpStaffId ? 1 : 0.5 }}>{vi ? 'Bắt đầu' : 'Start'}</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {quick && <QuickBill vi={vi} services={services} currency={currency} onClose={() => setQuick(false)} onCreate={createBill} />}
      {openWalkIn && (
        <TicketSheet vi={vi} w={openWalkIn} stations={active.filter((s) => !occByStation.has(s.id) || s.id === openWalkIn.stationId)} staff={board.staff} services={services} currency={currency}
          onClose={() => setOpenId(null)} onAdd={addLine} onRemove={removeLine} onMove={move} onDone={() => done(openWalkIn.id)} />
      )}
    </div>
  );
}

const ava: CSSProperties = { width: 26, height: 26, borderRadius: '50%', background: '#312e81', color: '#c7d2fe', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, flexShrink: 0 };

function ServicePick({ services, onPick, placeholder }: { services: Svc[]; onPick: (id: string) => void; placeholder: string }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const ql = q.trim().toLowerCase();
  const list = ql ? services.filter((s) => s.name.toLowerCase().includes(ql)) : services;
  return (
    <div style={{ position: 'relative', flex: 1, minWidth: 150 }}>
      <input style={{ ...ui.input, width: '100%', boxSizing: 'border-box' }} value={q} placeholder={placeholder}
        onFocus={() => setOpen(true)} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onBlur={() => setTimeout(() => setOpen(false), 150)} />
      {open && (
        <div style={{ position: 'absolute', zIndex: 30, top: 'calc(100% + 4px)', left: 0, right: 0, maxHeight: 220, overflowY: 'auto', background: '#0f172a', border: '1px solid #334155', borderRadius: 10 }}>
          {list.map((s) => (
            <button key={s.id} type="button" onMouseDown={(e) => { e.preventDefault(); onPick(s.id); setQ(''); setOpen(false); }}
              style={{ display: 'flex', justifyContent: 'space-between', width: '100%', textAlign: 'left', padding: '9px 12px', border: 'none', background: 'transparent', color: '#e2e8f0', cursor: 'pointer', fontSize: 14 }}>
              <span>{s.name}</span><span style={{ color: '#94a3b8' }}>{formatPrice(s.priceCents, 'USD')}</span>
            </button>
          ))}
          {list.length === 0 && <div style={{ padding: '10px 12px', color: '#64748b', fontSize: 13 }}>—</div>}
        </div>
      )}
    </div>
  );
}

function QuickBill({ vi, services, currency, onClose, onCreate }: {
  vi: boolean; services: Svc[]; currency: string; onClose: () => void; onCreate: (b: Record<string, unknown>) => void;
}) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [serviceId, setServiceId] = useState('');
  const svc = services.find((s) => s.id === serviceId);
  const content = (
    <div onClick={onClose} style={overlay}>
      <div onClick={(e) => e.stopPropagation()} style={{ ...ui.card, width: 'min(460px, 96vw)', padding: 18 }}>
        <div style={{ fontSize: 17, fontWeight: 800, color: '#e2e8f0', marginBottom: 4 }}>{vi ? 'Lên bill nhanh' : 'Quick bill'}</div>
        <p style={{ fontSize: 12, color: '#94a3b8', margin: '0 0 14px' }}>{vi ? 'Hệ thống tự chọn ghế trống + thợ tới lượt. Đổi sau bằng cách kéo trên sơ đồ.' : 'Auto-picks a free chair + the up-next tech. Drag on the floor to change.'}</p>
        <label style={{ display: 'block', marginBottom: 10 }}><span style={ui.label}>{vi ? 'Tên khách (tuỳ chọn)' : 'Customer (optional)'}</span>
          <input style={ui.input} value={name} placeholder="Walk-in" onChange={(e) => setName(e.target.value)} /></label>
        <label style={{ display: 'block', marginBottom: 10 }}><span style={ui.label}>{vi ? 'Điện thoại (tuỳ chọn)' : 'Phone (optional)'}</span>
          <input style={ui.input} value={phone} inputMode="tel" onChange={(e) => setPhone(e.target.value)} /></label>
        <div style={{ marginBottom: 4 }}><span style={ui.label}>{vi ? 'Dịch vụ (tuỳ chọn)' : 'Service (optional)'}</span></div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 16 }}>
          <ServicePick services={services} onPick={setServiceId} placeholder={vi ? 'Tìm dịch vụ…' : 'Search service…'} />
          {svc && <span style={{ fontSize: 13, color: '#cbd5e1', whiteSpace: 'nowrap' }}>{svc.name} · {formatPrice(svc.priceCents, currency)}</span>}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => onCreate({ customerName: name.trim() || undefined, phone: phone.trim() || undefined, serviceId: serviceId || undefined })}
            style={{ ...ui.primaryBtn, flex: 1, padding: '11px' }}>{vi ? 'Tạo & tự xếp' : 'Create & auto-seat'}</button>
          <button onClick={onClose} style={{ ...ui.input, width: 'auto', padding: '11px 16px', cursor: 'pointer' }}>{vi ? 'Huỷ' : 'Cancel'}</button>
        </div>
      </div>
    </div>
  );
  return typeof document === 'undefined' ? null : createPortal(content, document.body);
}

function TicketSheet({ vi, w, stations, staff, services, currency, onClose, onAdd, onRemove, onMove, onDone }: {
  vi: boolean; w: Serving; stations: Station[]; staff: StaffTurn[]; services: Svc[]; currency: string;
  onClose: () => void; onAdd: (id: string, serviceId: string, staffId: string) => void; onRemove: (id: string, lineId: string) => void;
  onMove: (id: string, stationId: string) => void; onDone: () => void;
}) {
  const [techId, setTechId] = useState('');
  const [pendingSvc, setPendingSvc] = useState<Svc | null>(null);
  const items = w.items ?? [];
  const subtotal = items.reduce((a, it) => a + it.priceCents, 0);
  const techName = (id: string | null) => (id ? (staff.find((s) => s.id === id)?.name ?? fullName(w.assignedStaff)) : (vi ? 'Chưa gán' : 'Unassigned'));
  const checkoutHref = `/salon/pos?walkInId=${w.id}&serviceId=${w.service?.id ?? ''}&staffId=${w.assignedStaff?.id ?? ''}&customer=${encodeURIComponent(w.customerName || '')}`;
  const content = (
    <div onClick={onClose} style={overlay}>
      <div onClick={(e) => e.stopPropagation()} style={{ ...ui.card, width: 'min(540px, 96vw)', maxHeight: '88vh', overflowY: 'auto', padding: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '14px 16px', borderBottom: '1px solid #1e293b' }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 17, fontWeight: 800, color: '#e2e8f0' }}>{w.customerName || 'Walk-in'}</div>
            <div style={{ fontSize: 12, color: '#94a3b8' }}>{vi ? 'Thợ' : 'Tech'} <strong style={{ color: '#cbd5e1' }}>{fullName(w.assignedStaff) || '—'}</strong></div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <select value={w.stationId ?? ''} onChange={(e) => onMove(w.id, e.target.value)} style={{ ...ui.input, width: 'auto', padding: '7px 8px' }}>
              <option value="">{vi ? 'Ghế…' : 'Chair…'}</option>
              {stations.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <button onClick={onClose} aria-label="close" style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: 24, lineHeight: 1, cursor: 'pointer' }}>×</button>
          </div>
        </div>
        <div style={{ padding: 16 }}>
          <div style={{ border: '1px solid #263041', borderRadius: 10, overflow: 'hidden' }}>
            {items.length === 0 ? <div style={{ padding: 12, color: '#64748b', fontSize: 13 }}>{vi ? 'Chưa có dịch vụ.' : 'No services yet.'}</div>
              : items.map((it) => (
                <div key={it.lineId} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderBottom: '1px solid #1e293b' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: '#e2e8f0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.name}</div>
                    <div style={{ fontSize: 11, color: '#94a3b8' }}>{techName(it.staffId)}</div>
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: '#e2e8f0' }}>{formatPrice(it.priceCents, currency)}</div>
                  <button onClick={() => onRemove(w.id, it.lineId)} aria-label="remove" style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 18 }}>×</button>
                </div>
              ))}
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 12px', background: '#0f172a' }}>
              <span style={{ fontSize: 13, color: '#94a3b8', fontWeight: 700 }}>{vi ? 'Tạm tính' : 'Subtotal'}</span>
              <span style={{ fontSize: 16, fontWeight: 800, color: '#fff' }}>{formatPrice(subtotal, currency)}</span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 10, flexWrap: 'wrap' }}>
            {pendingSvc ? (
              <div style={{ flex: 1, minWidth: 150, display: 'flex', alignItems: 'center', gap: 8, background: '#0f172a', border: '1px solid #334155', borderRadius: 8, padding: '8px 10px' }}>
                <span style={{ flex: 1, minWidth: 0, color: '#e2e8f0', fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{pendingSvc.name}</span>
                <span style={{ color: '#94a3b8', fontSize: 13 }}>{formatPrice(pendingSvc.priceCents, currency)}</span>
                <button onClick={() => setPendingSvc(null)} aria-label="clear" style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 16 }}>×</button>
              </div>
            ) : (
              <ServicePick services={services} onPick={(sid) => setPendingSvc(services.find((s) => s.id === sid) || null)} placeholder={vi ? 'Chọn dịch vụ…' : 'Pick a service…'} />
            )}
            <select value={techId} onChange={(e) => setTechId(e.target.value)} style={{ ...ui.input, width: 'auto', maxWidth: 150, padding: '9px 10px' }}>
              <option value="">{vi ? 'Cùng thợ' : 'Same tech'}</option>
              {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <button disabled={!pendingSvc} onClick={() => { if (pendingSvc) { onAdd(w.id, pendingSvc.id, techId); setPendingSvc(null); setTechId(''); } }}
              style={{ ...ui.primaryBtn, padding: '9px 16px', opacity: pendingSvc ? 1 : 0.5 }}>{vi ? 'Thêm' : 'Add'}</button>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <a href={checkoutHref} style={{ ...ui.primaryBtn, flex: 1, textAlign: 'center', padding: '12px', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{vi ? '💳 Thu ngân' : '💳 Checkout'} · {formatPrice(subtotal, currency)}</a>
            <button
              onClick={() => { if (window.confirm(vi ? 'Kết thúc khách này mà KHÔNG thu tiền? Chỉ dùng khi khách bỏ về hoặc không tính tiền.' : 'Finish this client WITHOUT taking payment? Only use this for a walk-out or a comp.')) onDone(); }}
              title={vi ? 'Kết thúc không thu tiền' : 'Finish without payment'}
              style={{ ...ui.primaryBtn, background: '#334155', padding: '12px 14px' }}>{vi ? 'Xong' : 'Done'}</button>
          </div>
          <p style={{ fontSize: 11, color: '#64748b', margin: '10px 0 0', lineHeight: 1.5 }}>{vi ? 'Thu ngân = tính tiền rồi tự kết thúc, ghế được giải phóng. Xong = kết thúc KHÔNG thu tiền (khách rời ghế, không có hoá đơn).' : 'Checkout takes payment then finishes and frees the chair. Done finishes with no sale.'}</p>
        </div>
      </div>
    </div>
  );
  return typeof document === 'undefined' ? null : createPortal(content, document.body);
}

const overlay: CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(2,6,23,0.7)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 };
