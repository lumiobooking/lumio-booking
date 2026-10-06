'use client';

import { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../lib/api';
import { ui } from '../lib/ui';
import { dayKeyInTz, fmtInTz } from '../lib/datetime';
import { ind } from '../lib/ui-industry';

/**
 * "Same again in two weeks?" — the next visit, booked at the till.
 *
 * Opens on the "Paid" screen with everything the register already knows filled
 * in: the customer it just charged, the services on the bill, the technician
 * who did them. What is left for the receptionist is the two things nobody can
 * guess — the day and the hour — and both are a single tap: quick-pick days,
 * then the technician's real open times for that day from the server.
 *
 * The booking is created CONFIRMED (the customer is standing here, the tech is
 * here) and the normal confirmation SMS/email goes out through the booking
 * service, so nothing on this screen sends anything itself.
 */
export interface RebookLine { serviceId: string; staffId: string | null }
export interface RebookService { id: string; name: string; durationMinutes: number; isActive?: boolean }
export interface RebookStaff { id: string; firstName: string; lastName: string | null; isActive?: boolean }
export interface RebookResult { id: string; startTime: string; staffName: string | null; serviceNames: string[]; customerName: string }

const DAY_MS = 86_400_000;

export function RebookSheet({ token, lang, customerId, customerLabel, lines, services, staff, onClose, onBooked }: {
  token: string;
  lang: string;
  /** The CRM customer on the bill, when there was one. */
  customerId: string | null;
  /** "Name · phone" as the till shows it. */
  customerLabel: string | null;
  lines: RebookLine[];
  services: RebookService[];
  staff: RebookStaff[];
  onClose: () => void;
  onBooked: (r: RebookResult) => void;
}) {
  const vi = lang === 'vi';
  const L = (v: string, e: string) => ind(vi ? v : e);
  const staffName = (s: RebookStaff | undefined) => (s ? `${s.firstName} ${s.lastName ?? ''}`.trim() : '');

  // ---- what the bill already told us ------------------------------------
  const [labelName, labelPhone] = useMemo(() => {
    const parts = (customerLabel || '').split(' · ');
    return [parts[0]?.trim() || '', parts.slice(1).join(' · ').trim()];
  }, [customerLabel]);
  const [name, setName] = useState(labelName);
  const [phone, setPhone] = useState(labelPhone);
  const [serviceIds, setServiceIds] = useState<string[]>(() => {
    const seen: string[] = [];
    for (const l of lines) if (l.serviceId && !seen.includes(l.serviceId) && services.some((s) => s.id === l.serviceId)) seen.push(l.serviceId);
    return seen;
  });
  const [staffId, setStaffId] = useState<string>(() => {
    const counts = new Map<string, number>();
    for (const l of lines) if (l.staffId) counts.set(l.staffId, (counts.get(l.staffId) ?? 0) + 1);
    let best = ''; let n = 0;
    for (const [id, c] of counts) if (c > n && staff.some((s) => s.id === id)) { best = id; n = c; }
    return best;
  });
  const [svcQ, setSvcQ] = useState('');

  // ---- the day --------------------------------------------------------
  const quick = useMemo(() => [
    { label: L('Ngày mai', 'Tomorrow'), days: 1 },
    { label: L('1 tuần', '1 week'), days: 7 },
    { label: L('2 tuần', '2 weeks'), days: 14 },
    { label: L('3 tuần', '3 weeks'), days: 21 },
    { label: L('4 tuần', '4 weeks'), days: 28 },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [vi]);
  const dayAfter = (days: number) => dayKeyInTz(Date.now() + days * DAY_MS);
  const [date, setDate] = useState<string>(() => dayAfter(14));
  const [times, setTimes] = useState<string[] | null>(null);
  const [timesErr, setTimesErr] = useState<string | null>(null);
  const [at, setAt] = useState<string | null>(null);

  const minutes = useMemo(
    () => Math.max(15, serviceIds.reduce((sum, id) => sum + (services.find((s) => s.id === id)?.durationMinutes ?? 0), 0)),
    [serviceIds, services],
  );

  useEffect(() => {
    let alive = true;
    setTimes(null); setTimesErr(null); setAt(null);
    const q = new URLSearchParams({ date, minutes: String(minutes) });
    if (staffId) q.set('staffId', staffId);
    apiFetch<{ times: string[] }>(`/bookings/open-times?${q.toString()}`, { token })
      .then((r) => { if (alive) setTimes(r.times); })
      .catch((e) => { if (alive) { setTimes([]); setTimesErr(e instanceof Error ? e.message : 'error'); } });
    return () => { alive = false; };
  }, [date, staffId, minutes, token]);

  // ---- booking ----------------------------------------------------------
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const canBook = !!at && serviceIds.length > 0 && (customerId || name.trim().length > 0) && !busy;

  async function book() {
    if (!canBook || !at) return;
    setBusy(true); setErr(null);
    const [first, ...rest] = name.trim().split(/\s+/);
    try {
      const r = await apiFetch<{ id: string; startTime: string }>('/bookings/counter', {
        method: 'POST', token,
        body: {
          serviceId: serviceIds[0],
          serviceIds,
          startTime: at,
          staffId: staffId || undefined,
          customerId: customerId || undefined,
          customerFirstName: first || L('Khách', 'Guest'),
          customerLastName: rest.join(' ') || undefined,
          customerPhone: phone.trim() || undefined,
          confirmNow: !!staffId,
          notes: L('Đặt tại quầy sau khi thanh toán', 'Booked at the counter after paying'),
        },
      });
      onBooked({
        id: r.id, startTime: r.startTime || at,
        staffName: staffId ? staffName(staff.find((s) => s.id === staffId)) : null,
        serviceNames: serviceIds.map((id) => services.find((s) => s.id === id)?.name ?? ''),
        customerName: name.trim() || labelName,
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'error');
    } finally { setBusy(false); }
  }

  const svcShown = services.filter((s) => s.isActive !== false && (!svcQ.trim() || s.name.toLowerCase().includes(svcQ.trim().toLowerCase())));
  const chip = (on: boolean): React.CSSProperties => ({
    padding: '9px 14px', borderRadius: 999, fontSize: 14, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
    border: `1.5px solid ${on ? '#6366f1' : 'var(--line)'}`, background: on ? '#6366f1' : 'var(--c0f172a)', color: on ? '#fff' : 'var(--ccbd5e1)',
  });
  const label: React.CSSProperties = { fontSize: 11.5, letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 700, color: 'var(--c94a3b8)', marginBottom: 8 };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(2,6,23,0.72)', zIndex: 400, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 12 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ ...ui.card, width: 'min(680px, 100%)', maxHeight: '94vh', overflowY: 'auto', padding: 0, display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 18px', borderBottom: '1px solid var(--line)' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--ce2e8f0)' }}>{L('Đặt lịch lần sau', 'Book the next visit')}</div>
            <div style={{ fontSize: 13, color: 'var(--c94a3b8)' }}>{L('Khách, dịch vụ và thợ đã điền sẵn từ hoá đơn — chỉ còn chọn ngày và giờ.', 'Customer, services and technician come from the bill — pick a day and a time.')}</div>
          </div>
          <button type="button" onClick={onClose} aria-label={L('Đóng', 'Close')} style={{ background: 'none', border: 'none', color: 'var(--c94a3b8)', fontSize: 24, cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>

        <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 18 }}>
          {/* Who */}
          <div>
            <div style={label}>{L('Khách', 'Customer')}</div>
            {customerId ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 12, background: 'var(--c1e293b)', border: '1px solid var(--line)' }}>
                <span style={{ width: 34, height: 34, borderRadius: '50%', background: '#6366f1', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}>{(labelName || '?').slice(0, 1).toUpperCase()}</span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ce2e8f0)' }}>{labelName || L('Khách', 'Customer')}</div>
                  <div style={{ fontSize: 13, color: 'var(--c94a3b8)' }}>{labelPhone || L('Chưa có số điện thoại — sẽ không nhắn SMS được', 'No mobile on file — no SMS will go out')}</div>
                </div>
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder={L('Tên khách', 'Customer name')} style={ui.input} autoCapitalize="words" />
                <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder={L('Số điện thoại (để nhắn xác nhận)', 'Mobile (for the confirmation text)')} inputMode="tel" style={ui.input} />
              </div>
            )}
          </div>

          {/* What + who does it */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
            <div>
              <div style={label}>{L('Dịch vụ', 'Services')} · {minutes} {L('phút', 'min')}</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                {serviceIds.map((id) => {
                  const s = services.find((x) => x.id === id);
                  return (
                    <button key={id} type="button" onClick={() => setServiceIds((v) => v.filter((x) => x !== id))} style={{ ...chip(true), display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                      {s?.name ?? id} <span aria-hidden>✕</span>
                    </button>
                  );
                })}
                {serviceIds.length === 0 && <span style={{ fontSize: 13, color: 'var(--ink-warn)' }}>{L('Chọn ít nhất một dịch vụ.', 'Pick at least one service.')}</span>}
              </div>
              <input value={svcQ} onChange={(e) => setSvcQ(e.target.value)} placeholder={L('Thêm dịch vụ…', 'Add a service…')} style={{ ...ui.input, marginBottom: 6 }} />
              {svcQ.trim() && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxHeight: 120, overflowY: 'auto' }}>
                  {svcShown.filter((s) => !serviceIds.includes(s.id)).slice(0, 12).map((s) => (
                    <button key={s.id} type="button" onClick={() => { setServiceIds((v) => [...v, s.id]); setSvcQ(''); }} style={chip(false)}>+ {s.name}</button>
                  ))}
                </div>
              )}
            </div>
            <div>
              <div style={label}>{L('Thợ', 'Technician')}</div>
              <select value={staffId} onChange={(e) => setStaffId(e.target.value)} style={{ ...ui.input, width: '100%' }}>
                <option value="">{L('— Tiệm sắp xếp sau —', '— Salon assigns later —')}</option>
                {staff.filter((s) => s.isActive !== false).map((s) => <option key={s.id} value={s.id}>{staffName(s)}</option>)}
              </select>
              <div style={{ fontSize: 12.5, color: 'var(--c94a3b8)', marginTop: 6 }}>
                {staffId
                  ? L('Giờ bên dưới là giờ còn trống của thợ này. Lịch được xác nhận ngay.', 'Times below are this technician\'s open times. The booking is confirmed on the spot.')
                  : L('Không chọn thợ: lịch chờ tiệm phân thợ, giờ bên dưới theo giờ mở cửa.', 'No technician: the booking waits for assignment; times follow opening hours.')}
              </div>
            </div>
          </div>

          {/* When */}
          <div>
            <div style={label}>{L('Ngày', 'Day')}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
              {quick.map((q) => { const d = dayAfter(q.days); return <button key={q.days} type="button" onClick={() => setDate(d)} style={chip(date === d)}>{q.label}</button>; })}
              <input type="date" value={date} min={dayAfter(0)} onChange={(e) => { if (e.target.value) setDate(e.target.value); }} style={{ ...ui.input, width: 'auto', padding: '7px 10px' }} />
            </div>
            <div style={{ fontSize: 13.5, color: 'var(--ccbd5e1)', marginTop: 8, fontWeight: 600 }}>{fmtInTz(`${date}T12:00:00`, { weekday: 'long', day: 'numeric', month: 'long' })}</div>
          </div>

          <div>
            <div style={label}>{L('Giờ', 'Time')}</div>
            {times === null ? <div style={{ fontSize: 13.5, color: 'var(--c94a3b8)' }}>{L('Đang tìm giờ trống…', 'Finding open times…')}</div>
              : times.length === 0 ? <div style={{ fontSize: 13.5, color: 'var(--ink-warn)' }}>{timesErr || L('Không còn giờ trống ngày này — thử ngày khác hoặc thợ khác.', 'No open times that day — try another day or technician.')}</div>
                : (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(88px, 1fr))', gap: 6 }}>
                    {times.map((iso) => (
                      <button key={iso} type="button" onClick={() => setAt(iso)} style={{ ...chip(at === iso), padding: '10px 6px', textAlign: 'center', borderRadius: 10 }}>
                        {fmtInTz(iso, { hour: 'numeric', minute: '2-digit' })}
                      </button>
                    ))}
                  </div>
                )}
          </div>

          {err && <div style={ui.banner}>{err}</div>}
        </div>

        <div style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '14px 18px', borderTop: '1px solid var(--line)', position: 'sticky', bottom: 0, background: 'var(--c0f172a)' }}>
          <div style={{ flex: 1, minWidth: 0, fontSize: 14, color: 'var(--ccbd5e1)' }}>
            {at ? <><b style={{ color: 'var(--ce2e8f0)' }}>{fmtInTz(at, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</b>{staffId ? ` · ${staffName(staff.find((s) => s.id === staffId))}` : ''}</> : L('Chọn giờ để đặt.', 'Pick a time to book.')}
          </div>
          <button type="button" onClick={onClose} style={{ height: 48, padding: '0 18px', borderRadius: 12, border: '1px solid var(--line)', background: 'var(--c0f172a)', color: 'var(--ccbd5e1)', fontSize: 15, fontWeight: 600, cursor: 'pointer' }}>{L('Để sau', 'Not now')}</button>
          <button type="button" onClick={book} disabled={!canBook} style={{ height: 48, padding: '0 22px', borderRadius: 12, border: 'none', background: '#4f46e5', color: '#fff', fontSize: 15.5, fontWeight: 700, cursor: canBook ? 'pointer' : 'default', opacity: canBook ? 1 : 0.5 }}>
            {busy ? L('Đang đặt…', 'Booking…') : L('Đặt lịch', 'Book it')}
          </button>
        </div>
      </div>
    </div>
  );
}
