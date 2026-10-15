'use client';

// ---------------------------------------------------------------------------
// The "new booking" form — one booker, optionally a party, each person with
// their own services and technician. Used on the bookings page (inline) and
// as a pop-up from the calendar ("Đặt lịch"), so a booking is made without
// leaving the day being looked at.
// ---------------------------------------------------------------------------

import { useEffect, useState, FormEvent } from 'react';
import { apiFetch } from '../lib/api';
import { wallToInstantISO } from '../lib/datetime';
import { ui } from '../lib/ui';
import { useLang, tr } from '../lib/i18n';
import { NoShowWarning } from './NoShowWarning';
import { RecordAlertByPhone } from './RecordAlert';
import { deskHoursCheck, hoursMessage, wallLabel, type HoursRules } from '../lib/desk-hours';
import { ind, uiIndustry } from '../lib/ui-industry';
import { SlotPicker } from './SlotPicker';
import { hasHours } from '../lib/slot-picker';

export interface BookingFormService { id: string; name: string; durationMinutes: number }
export interface BookingFormStaff { id: string; firstName: string; lastName: string | null; isActive: boolean }
/** What the form reads of existing bookings: who is busy when. */
export interface BookingFormBooking { status: string; startTime: string; endTime: string; assignedStaff: { id: string } | null }
type Service = BookingFormService;
type Staff = BookingFormStaff;
type Booking = BookingFormBooking;

export function CreateBookingForm({
  token,
  services,
  staff,
  bookings,
  initial,
  salonTz,
  hours,
  isOwner,
  onCreated,
  bare,
  onCancel,
}: {
  token: string;
  services: Service[];
  staff: Staff[];
  bookings: Booking[];
  initial?: { staffId?: string; startLocal?: string; firstName?: string; lastName?: string; phone?: string };
  /** The salon's timezone: the picker is the SALON's wall clock, whoever is typing. */
  salonTz?: string;
  hours?: HoursRules | null;
  isOwner?: boolean;
  onCreated: () => void;
  /** Inside a pop-up: no card frame, header and footer stay in view while the form scrolls. */
  bare?: boolean;
  /** Shows a close button in the header. */
  onCancel?: () => void;
}) {
  const { lang } = useLang();
  const t = (k: string) => tr(k, lang);
  const vi = lang === 'vi';
  // The owner pressed "book outside hours anyway" for THIS time.
  const [overrideAt, setOverrideAt] = useState<string | null>(null);
  // One row per person in the party; index 0 is the booker. Friends coming
  // together rarely want the same thing — one takes gel, one takes a pedicure —
  // so each person carries their own service list and their own name.
  // Each person also carries their own technician: two friends booked for
  // the same hour are two chairs, and the salon often knows who takes whom
  // ("Lan does the gel, Mai's pedicure goes to Tú"). '' = pick by turn and
  // skill, '__none' = leave for later, else a staff id. The booker's lives in
  // form.staffId (the field above), the guests' here.
  const [people, setPeople] = useState<{ name: string; serviceIds: string[]; staffId: string }[]>([{ name: '', serviceIds: [], staffId: '' }]);
  const [who, setWho] = useState(0); // whose services the picker below is editing
  const [svcQ, setSvcQ] = useState(''); // type-to-filter: many salons have 50+ services
  const serviceIds = people[who]?.serviceIds ?? [];
  const setServiceIds = (fn: (ids: string[]) => string[]) =>
    setPeople((ps) => ps.map((p, i) => (i === who ? { ...p, serviceIds: fn(p.serviceIds) } : p)));
  const [form, setForm] = useState({
    startLocal: initial?.startLocal ?? '',
    staffId: initial?.staffId ?? '',
    partySize: '1',
    customerFirstName: initial?.firstName ?? '',
    customerLastName: initial?.lastName ?? '',
    customerBirthDate: '',
    customerEmail: '',
    customerPhone: initial?.phone ?? '',
    // Real estate: the property to view; home services: the client's address.
    location: '',
  });
  const askLocation = uiIndustry() === 'REAL_ESTATE' || uiIndustry() === 'SERVICE';
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function up(key: keyof typeof form, v: string) {
    setForm((f) => ({ ...f, [key]: v }));
  }
  const toggleSvc = (id: string) =>
    setServiceIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  const totalMinutes = serviceIds.reduce((sum, id) => sum + (services.find((s) => s.id === id)?.durationMinutes ?? 0), 0);
  // Expected finish time, so staff can see the slot the booking will occupy.
  const endsAt = (() => {
    if (!form.startLocal || totalMinutes <= 0) return '';
    const d = new Date(form.startLocal);
    if (Number.isNaN(d.getTime())) return '';
    d.setMinutes(d.getMinutes() + totalMinutes);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  })();
  const svcShown = svcQ.trim()
    ? services.filter((s) => s.name.toLowerCase().includes(svcQ.trim().toLowerCase()))
    : services;

  const partyN = Math.max(1, Math.min(10, parseInt(form.partySize, 10) || 1));
  // The party holds its chairs until the slowest member is done.
  const longestMin = Math.max(0, ...people.map((p) => p.serviceIds.reduce((sum, id) => sum + (services.find((s) => s.id === id)?.durationMinutes ?? 0), 0)));

  // Grow or shrink the party to match the People box. A new guest starts with
  // the booker's services because that is the common case on a phone call;
  // staff then change only the one who wants something else.
  useEffect(() => {
    setPeople((ps) => {
      if (ps.length === partyN) return ps;
      if (ps.length > partyN) return ps.slice(0, partyN);
      const seed = ps[0]?.serviceIds ?? [];
      return [...ps, ...Array.from({ length: partyN - ps.length }, () => ({ name: '', serviceIds: [...seed], staffId: '' }))];
    });
    setWho((i) => Math.min(i, partyN - 1));
  }, [partyN]);

  // How many technicians are actually free for this slot. A group of four
  // arriving to a shop with two free chairs is the failure that costs a salon
  // the whole table, so the number is put in front of staff BEFORE they
  // promise the time — as a warning, never as a block: the owner is allowed to
  // squeeze a group in and rearrange.
  const freeStaff = (() => {
    // The party holds its chairs until the SLOWEST member is done, so the
    // window to test is the longest service list in the group, not the one
    // whose tab happens to be open.
    const longest = Math.max(
      0,
      ...people.map((p) => p.serviceIds.reduce((sum, id) => sum + (services.find((s) => s.id === id)?.durationMinutes ?? 0), 0)),
    );
    if (!form.startLocal || longest <= 0) return null;
    const start = new Date(wallToInstantISO(form.startLocal, salonTz || undefined));
    if (Number.isNaN(start.getTime())) return null;
    const end = new Date(start.getTime() + longest * 60_000);
    const DEAD = new Set(['CANCELLED', 'COMPLETED', 'NO_SHOW']);
    const busy = new Set(
      bookings
        .filter((b) => !DEAD.has(b.status) && b.assignedStaff?.id)
        .filter((b) => new Date(b.startTime) < end && new Date(b.endTime) > start)
        .map((b) => b.assignedStaff!.id),
    );
    const active = staff.filter((s) => s.isActive);
    return { free: active.filter((s) => !busy.has(s.id)).length, total: active.length, busy };
  })();
  // The technician each person is down for, in one list (index 0 = booker).
  const staffOf = (i: number) => (i === 0 ? form.staffId : people[i]?.staffId ?? '');
  const setStaffOf = (i: number, v: string) => {
    if (i === 0) up('staffId', v);
    else setPeople((ps) => ps.map((p, j) => (j === i ? { ...p, staffId: v } : p)));
  };
  const nameOf = (i: number) => (i === 0
    ? (form.customerFirstName.trim() || t('bk.you'))
    : (people[i]?.name?.trim() || `${t('bk.guestLabel')} ${i + 1}`));
  const staffName = (id: string) => { const s = staff.find((x) => x.id === id); return s ? `${s.firstName}${s.lastName ? ` ${s.lastName}` : ''}` : ''; };
  // One technician named for two people at the same hour: they cannot do both
  // at once. A warning, not a block — some salons run one tech on two
  // pedicure chairs, and the owner knows.
  const doubleBooked = (() => {
    const seen = new Map<string, number[]>();
    for (let i = 0; i < partyN; i++) {
      const id = staffOf(i);
      if (!id || id === '__none') continue;
      seen.set(id, [...(seen.get(id) ?? []), i]);
    }
    return [...seen.entries()].filter(([, idx]) => idx.length > 1).map(([id, idx]) => ({ name: staffName(id), who: idx.map(nameOf) }));
  })();
  const staffSelect = (i: number) => (
    <select style={ui.input} value={staffOf(i)} onChange={(e) => setStaffOf(i, e.target.value)}>
      <option value="">{ind(vi ? '⚡ Tự chọn thợ (theo lượt, đúng tay nghề)' : '⚡ Pick automatically (turns + skills)')}</option>
      <option value="__none">{t('bk.leaveUnassigned')}</option>
      {staff.filter((s) => s.isActive || s.id === staffOf(i)).map((s) => {
        const busyThen = freeStaff?.busy.has(s.id);
        const takenBy = Array.from({ length: partyN }, (_, j) => j).filter((j) => j !== i && staffOf(j) === s.id).map(nameOf);
        return (
          <option key={s.id} value={s.id}>
            {s.firstName} {s.lastName ?? ''}{busyThen ? (vi ? ' · đang có lịch giờ này' : ' · booked then') : ''}{takenBy.length ? (vi ? ` · đã giao cho ${takenBy.join(', ')}` : ` · given to ${takenBy.join(', ')}`) : ''}
          </option>
        );
      })}
    </select>
  );
  const staffShort = freeStaff !== null && partyN > freeStaff.free;
  // Opening hours, checked the moment a time is picked (the server checks too).
  const hoursCheck = form.startLocal ? deskHoursCheck(form.startLocal, hours, vi) : ({ ok: true } as const);
  const outside = !hoursCheck.ok && overrideAt !== form.startLocal;
  // Minutes since the chosen time, on the salon's clock. The desk may record a
  // customer already in the chair (up to 12 hours back — the server agrees);
  // older than that is a wrong day or an AM/PM slip.
  const pastMin = (() => {
    if (!form.startLocal) return 0;
    const at = Date.parse(wallToInstantISO(form.startLocal, salonTz || undefined));
    return Number.isFinite(at) ? Math.floor((Date.now() - at) / 60_000) : 0;
  })();
  const tooOld = pastMin > 12 * 60;
  const pastText = tooOld
    ? (vi ? 'Giờ này đã qua hơn 12 tiếng — kiểm tra lại ngày và sáng/chiều (AM/PM).' : 'That time is more than 12 hours ago — check the date and AM/PM.')
    : (vi ? `Giờ này đã qua ${pastMin < 60 ? `${pastMin} phút` : `${Math.floor(pastMin / 60)} giờ ${pastMin % 60} phút`} — vẫn ghi được (khách đã đến / ghi bù).`
      : `That time was ${pastMin < 60 ? `${pastMin} min` : `${Math.floor(pastMin / 60)} h ${pastMin % 60} min`} ago — it can still be recorded (customer already here).`);
  // '' = let the system pick by turn; '__none' = leave it for later on purpose.
  const autoPick = form.staffId !== '__none';
  const chosenStaff = form.staffId && form.staffId !== '__none' ? form.staffId : '';

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (serviceIds.length === 0) { setError(t('bk.pickAtLeastOne')); return; }
    if (!form.startLocal) { setError(vi ? 'Chọn giờ hẹn.' : 'Pick a time.'); return; }
    // A guest with no service would silently be booked on the booker's, which
    // is how a pedicure turns into a gel set at the till.
    const empty = people
      .map((p, i) => ({ i, p }))
      .filter(({ p }) => p.serviceIds.length === 0)
      .map(({ p, i }) => (i === 0 ? (form.customerFirstName.trim() || t('bk.you')) : (p.name.trim() || `${t('bk.guestLabel')} ${i + 1}`)));
    if (empty.length > 0) { setError(t('bk.missingSvc').replace('{who}', empty.join(', '))); return; }
    if (outside) { setError(hoursMessage(form.startLocal, hoursCheck, vi)); return; }
    if (tooOld) { setError(pastText); return; }
    setSubmitting(true);
    // form.startLocal is the SALON's wall clock — the receptionist typed the
    // customer's hour, not their own browser's. The salon's zone is passed in
    // explicitly: the stored one in the browser can be missing or another salon's.
    const startTime = wallToInstantISO(form.startLocal, salonTz || undefined);
    const outsideOk = !hoursCheck.ok && overrideAt === form.startLocal;
    const groupNote = partyN > 1 ? `${t('bk.groupNote')} (${partyN})` : undefined;
    // One id shared by the whole party. The note is for humans; this is what
    // the calendar and the till read.
    const groupId = partyN > 1
      ? (globalThis.crypto?.randomUUID?.() ?? `grp-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`)
      : undefined;
    try {
      await apiFetch('/bookings', {
        method: 'POST',
        token,
        body: {
          // First pick = primary service; the rest ride along as service lines
          // (same visit, durations added up server-side).
          serviceId: people[0].serviceIds[0],
          serviceIds: people[0].serviceIds,
          // datetime-local is local time; convert to a UTC ISO string.
          startTime,
          staffId: chosenStaff || undefined,
          // No technician picked: the system chooses one by turn and skill.
          autoAssign: chosenStaff ? undefined : autoPick,
          ...(outsideOk ? { outsideHours: true } : {}),
          customerFirstName: form.customerFirstName,
          customerLastName: form.customerLastName || undefined,
          // Birthday is opt-in and only used for birthday campaigns.
          customerBirthDate: form.customerBirthDate || undefined,
          customerEmail: form.customerEmail || undefined,
          customerPhone: form.customerPhone || undefined,
          partySize: partyN,
          groupId,
          notes: groupNote,
          location: askLocation ? form.location.trim() || undefined : undefined,
        },
      });

      // Everyone else in the party: same time, same services, no contact
      // details. Their names are unknown on a phone call and their numbers are
      // not the booker's, so sending the booker's phone again would merge four
      // strangers into one customer record. Staff rename them on arrival.
      // Each guest goes to the technician picked for them; a guest left on
      // "automatic" is placed by turn rotation and skill, like before.
      const failed: string[] = [];
      for (let i = 2; i <= partyN; i++) {
        const g = people[i - 1];
        try {
          await apiFetch('/bookings', {
            method: 'POST',
            token,
            body: {
              serviceId: g.serviceIds[0],
              serviceIds: g.serviceIds,
              startTime,
              customerFirstName: g.name.trim() || `${t('bk.guestLabel')} ${i}`,
              // This guest's own technician; '' = by turn and skill.
              ...(g.staffId && g.staffId !== '__none' ? { staffId: g.staffId } : { autoAssign: g.staffId !== '__none' }),
              ...(outsideOk ? { outsideHours: true } : {}),
              partySize: partyN,
              groupId,
              notes: `${groupNote} — ${form.customerFirstName || ''}`.trim(),
            },
          });
        } catch {
          failed.push(g.name.trim() || `${t('bk.guestLabel')} ${i}`);
        }
      }
      if (failed.length) {
        // The booker IS booked; say so plainly rather than showing a bare
        // failure that makes staff redo the whole form.
        setError(
          t('bk.groupPartial')
            .replace('{ok}', String(partyN - failed.length))
            .replace('{n}', String(partyN))
            .replace('{who}', failed.join(', ')),
        );
      }
      onCreated();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Create failed';
      // The server's own hours check, in the reader's language.
      if (/in the past/i.test(msg)) { setError(vi ? 'Giờ này đã qua quá xa — kiểm tra lại ngày và sáng/chiều (AM/PM), hoặc chọn giờ muộn hơn.' : 'That time is too far in the past — check the date and AM/PM, or pick a later time.'); return; }
      setError(/^OUTSIDE_HOURS/.test(msg) ? (hoursMessage(form.startLocal, deskHoursCheck(form.startLocal, hours, vi), vi) || msg.replace(/^OUTSIDE_HOURS:\s*/, '')) : msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="bkf" style={bare ? { ...ui.card, margin: 0, padding: 0, border: 0, borderRadius: 0, boxShadow: 'none', minHeight: '100%', display: 'flex', flexDirection: 'column' } : { ...ui.card, marginBottom: 16, padding: 0, overflow: 'hidden' }}>
      <style>{`
        .bkf input, .bkf select { transition: border-color .12s ease, box-shadow .12s ease; }
        .bkf input:focus, .bkf select:focus { outline: none; border-color: #6366f1; box-shadow: 0 0 0 3px rgba(99,102,241,0.18); }
        .bkf input::placeholder { color: var(--c475569); }
      `}</style>

      <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '14px 20px', borderBottom: '1px solid var(--c334155)', ...(bare ? { position: 'sticky', top: 0, zIndex: 2, background: ui.card.background } : {}) }}>
        <span style={{ width: 34, height: 34, borderRadius: 10, background: 'var(--c1e3a8a)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0 }}>📅</span>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--ce2e8f0)' }}>{t('bk.createBooking')}</div>
          <div style={{ fontSize: 12, color: 'var(--c94a3b8)' }}>
            {serviceIds.length === 0
              ? t('bk.pickSvcFirst')
              : `${serviceIds.length} ${t('bk.servicesPicked')} · ${t('bk.totalDuration')} ${totalMinutes} min${endsAt ? ` · ${t('bk.endsAt')} ${endsAt}` : ''}`}
          </div>
        </div>
        {onCancel && (
          <button type="button" onClick={onCancel} aria-label={vi ? 'Đóng' : 'Close'}
            style={{ marginLeft: 'auto', width: 36, height: 36, borderRadius: 10, border: '1px solid var(--c334155)', background: 'transparent', color: 'var(--c94a3b8)', fontSize: 16, cursor: 'pointer', flexShrink: 0 }}>✕</button>
        )}
      </div>

      <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 18, ...(bare ? { flex: 1 } : {}) }}>
        <FormSection title={t('bk.secWhen')}>
          <div style={fieldGrid}>
            <div style={{ gridColumn: '1 / -1' }}>
              <FieldLabel raw={t('bk.dateTime')} required optionalWord={t('bk.optional')} />
              {/* Only open days and opening hours, never a time already gone —
                  with how many technicians are free at each. See SlotPicker. */}
              <SlotPicker
                value={form.startLocal}
                onChange={(v) => up('startLocal', v)}
                rules={hours}
                salonTz={salonTz}
                vi={vi}
                isOwner={isOwner}
                minutes={longestMin}
                bookings={bookings}
                staff={staff}
                staffId={form.staffId}
              />
              {/* The picker reads the choice back; only a problem is repeated here
                  (an owner's out-of-hours time, or a salon with no hours set). */}
              {form.startLocal && (outside || !hasHours(hours)) && (
                <span style={{ display: 'block', marginTop: 5, fontSize: 12, fontWeight: 600, color: outside ? 'var(--ink-bad)' : 'var(--c94a3b8)' }}>
                  {outside ? `⚠ ${hoursMessage(form.startLocal, hoursCheck, vi)}` : `🕒 ${wallLabel(form.startLocal, vi)}${ind(vi ? ' — giờ của tiệm' : ' — salon time')}`}
                </span>
              )}
              {form.startLocal && pastMin > 2 && (
                <span style={{ display: 'block', marginTop: 4, fontSize: 12, fontWeight: 600, color: tooOld ? 'var(--ink-bad)' : 'var(--ink-warn)' }}>
                  {tooOld ? '⚠ ' : '⏱ '}{pastText}
                </span>
              )}
              {outside && isOwner && (
                <button type="button" onClick={() => { setOverrideAt(form.startLocal); setError(null); }}
                  style={{ marginTop: 6, padding: '5px 10px', fontSize: 12, borderRadius: 8, border: '1px solid var(--c475569)', background: 'transparent', color: 'var(--ccbd5e1)', cursor: 'pointer' }}>
                  {ind(vi ? 'Vẫn đặt ngoài giờ (chủ tiệm)' : 'Book outside hours anyway (owner)')}
                </button>
              )}
            </div>
            <label>
              <FieldLabel raw={t('bk.partySize')} optionalWord={t('bk.optional')} hint={`👥 ${t('bk.partyHint')}`} />
              <input
                style={ui.input}
                type="number"
                min={1}
                max={10}
                value={form.partySize}
                onChange={(e) => up('partySize', e.target.value)}
              />
            </label>
            <label>
              <FieldLabel raw={partyN > 1 ? (vi ? `Thợ cho ${nameOf(0)} (người đặt)` : `Tech for ${nameOf(0)} (booker)`) : t('bk.assignStaff')} optionalWord={t('bk.optional')} />
              {staffSelect(0)}
              {partyN > 1 && <span style={{ display: 'block', fontSize: 11.5, color: 'var(--c94a3b8)', marginTop: 4 }}>{vi ? 'Thợ cho từng khách đi cùng: chọn ở mục Dịch vụ bên dưới.' : 'Each guest’s tech: pick it under Services below.'}</span>}
            </label>
          </div>
          {/* Capacity, shown the moment a time is picked. Amber when the party
              outgrows the free chairs — a warning, never a block. */}
          {freeStaff !== null && (staffShort || !hasHours(hours)) && (
            <div
              style={{
                marginTop: 10, fontSize: 12.5, lineHeight: 1.5, display: 'inline-flex', alignItems: 'center', gap: 6,
                color: staffShort ? 'var(--ink-warn)' : 'var(--c94a3b8)',
                background: staffShort ? '#2a1c06' : 'var(--c0f172a)',
                border: `1px solid ${staffShort ? 'var(--c78350f)' : 'var(--c334155)'}`,
                borderRadius: 999, padding: '6px 12px',
              }}
            >
              {staffShort
                ? `⚠️ ${t('bk.staffShort').replace('{free}', String(freeStaff.free)).replace('{n}', String(partyN))}`
                : `${freeStaff.free}/${freeStaff.total} ${t('bk.staffFree')}`}
            </div>
          )}
        </FormSection>

        <FormSection title={t('bk.secWho')}>
          {/* Short labels: the section heading already says these are the
              customer's, so "Customer first name" only repeats itself. Five
              fields fit one line on a laptop; birthday feeds the birthday
              campaign and is never required. */}
          <div style={custGrid}>
            <label>
              <FieldLabel raw={t('bk.fFirst')} required optionalWord={t('bk.optional')} />
              <input style={ui.input} value={form.customerFirstName} onChange={(e) => up('customerFirstName', e.target.value)} placeholder="Anna" required />
            </label>
            <label>
              <FieldLabel raw={t('bk.fLast')} optionalWord={t('bk.optional')} />
              <input style={ui.input} value={form.customerLastName} onChange={(e) => up('customerLastName', e.target.value)} placeholder="Nguyen" />
            </label>
            <label>
              <FieldLabel raw={t('bk.fPhone')} optionalWord={t('bk.optional')} />
              <input style={ui.input} value={form.customerPhone} onChange={(e) => up('customerPhone', e.target.value)} placeholder="+1 512 886 8189" />
              <NoShowWarning token={token} phone={form.customerPhone} vi={lang === 'vi'} />
              <RecordAlertByPhone token={token} phone={form.customerPhone} vi={lang === 'vi'} />
            </label>
            {askLocation && (
              <label style={{ gridColumn: '1 / -1' }}>
                <FieldLabel raw={uiIndustry() === 'REAL_ESTATE' ? (vi ? 'Địa chỉ bất động sản cần xem (tuỳ chọn)' : 'Property to view (optional)') : (vi ? 'Địa chỉ làm dịch vụ (tuỳ chọn)' : 'Service address (optional)')} optionalWord={t('bk.optional')} />
                <input style={ui.input} value={form.location} maxLength={300} onChange={(e) => up('location', e.target.value)} placeholder={vi ? 'Số nhà, đường, quận…' : '123 Main St, City'} />
              </label>
            )}
            <label>
              <FieldLabel raw={t('bk.fEmail')} optionalWord={t('bk.optional')} />
              <input style={ui.input} type="email" value={form.customerEmail} onChange={(e) => up('customerEmail', e.target.value)} placeholder="anna@email.com" />
            </label>
            <label>
              <FieldLabel raw={t('bk.fBirth')} optionalWord={t('bk.optional')} hint={`🎂 ${t('bk.birthWhy')}`} />
              <input
                style={ui.input} type="date" max={new Date().toISOString().slice(0, 10)}
                value={form.customerBirthDate} onChange={(e) => up('customerBirthDate', e.target.value)}
              />
            </label>
          </div>
        </FormSection>
        <FormSection title={partyN > 1 ? t('bk.secWhatGroup') : t('bk.secWhat')}>
        {partyN > 1 && (
          <div style={{ border: '1px solid var(--c334155)', borderRadius: 10, background: 'var(--c0f172a)', padding: 12, marginBottom: 14 }}>
            <span style={{ ...ui.label, display: 'block', marginBottom: 8 }}>{t('bk.perPersonHint')}</span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {people.map((p, i) => {
                const label = i === 0
                  ? (form.customerFirstName.trim() || t('bk.you'))
                  : (p.name.trim() || `${t('bk.guestLabel')} ${i + 1}`);
                const n = p.serviceIds.length;
                const on = i === who;
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setWho(i)}
                    style={{
                      border: `1px solid ${on ? '#6366f1' : n === 0 ? 'var(--c78350f)' : 'var(--c334155)'}`,
                      background: on ? 'var(--c312e81)' : 'var(--c0f172a)',
                      color: on ? 'var(--ce0e7ff)' : n === 0 ? 'var(--ink-warn)' : 'var(--ccbd5e1)',
                      borderRadius: 999, padding: '6px 12px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
                    }}
                  >
                    {label} · {n === 0 ? t('bk.noSvcYet') : t('bk.svcCount').replace('{n}', String(n))}
                    {' · '}{staffOf(i) === '' ? (vi ? '⚡ tự chọn thợ' : '⚡ auto tech') : staffOf(i) === '__none' ? (vi ? 'chưa giao' : 'unassigned') : `💅 ${staffName(staffOf(i))}`}
                  </button>
                );
              })}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10, marginTop: 10, maxWidth: 680 }}>
              {who > 0 && (
                <label style={{ display: 'block' }}>
                  <FieldLabel raw={t('bk.guestName')} optionalWord={t('bk.optional')} />
                  <input
                    style={ui.input}
                    value={people[who]?.name ?? ''}
                    onChange={(e) => setPeople((ps) => ps.map((p, i) => (i === who ? { ...p, name: e.target.value } : p)))}
                    placeholder="Mai"
                  />
                </label>
              )}
              <label style={{ display: 'block' }}>
                <FieldLabel raw={vi ? `Thợ cho ${nameOf(who)}` : `Tech for ${nameOf(who)}`} optionalWord={t('bk.optional')} />
                {staffSelect(who)}
              </label>
            </div>
            {doubleBooked.length > 0 && (
              <div style={{ marginTop: 10, fontSize: 12.5, color: 'var(--ink-warn)' }}>
                ⚠️ {doubleBooked.map((d) => (vi ? `${d.name} đang được giao cho ${d.who.join(' và ')} cùng một giờ` : `${d.name} is given to ${d.who.join(' and ')} at the same time`)).join(' · ')}
                {vi ? ' — thợ không làm song song được thì chọn thợ khác hoặc để "Tự chọn".' : ' — pick another tech or "automatic" unless they can work both chairs.'}
              </div>
            )}
          </div>
        )}
        <div>
          <span style={ui.label}>
            {partyN > 1
              ? (who === 0 ? (form.customerFirstName.trim() || t('bk.you')) : (people[who]?.name?.trim() || `${t('bk.guestLabel')} ${who + 1}`))
              : t('bk.fService')}
            {serviceIds.length > 0 && (
              <span style={{ color: 'var(--c94a3b8)', fontWeight: 400 }}> · {totalMinutes} min{endsAt ? ` · ${t('bk.endsAt')} ${endsAt}` : ''}</span>
            )}
          </span>
          {/* Picked services stay visible as chips while staff searches for the next one. */}
          {serviceIds.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
              {serviceIds.map((id) => {
                const s = services.find((x) => x.id === id);
                if (!s) return null;
                return (
                  <span key={id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'var(--c1e3a8a)', color: 'var(--cdbeafe)', borderRadius: 999, padding: '4px 10px', fontSize: 12.5, fontWeight: 600 }}>
                    {s.name}
                    <button type="button" onClick={() => toggleSvc(id)} style={{ background: 'none', border: 'none', color: 'var(--c93c5fd)', cursor: 'pointer', fontSize: 13, padding: 0, lineHeight: 1 }}>✕</button>
                  </span>
                );
              })}
            </div>
          )}
          <input
            value={svcQ}
            onChange={(e) => setSvcQ(e.target.value)}
            placeholder={t('bk.searchService')}
            style={{ ...ui.input, marginBottom: 8 }}
          />
          <div style={{ border: '1px solid var(--c334155)', borderRadius: 8, background: 'var(--c0f172a)', maxHeight: 210, overflowY: 'auto', padding: 6, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 2 }}>
            {svcShown.length === 0 && <span style={{ color: 'var(--c94a3b8)', fontSize: 13, padding: '6px 8px' }}>{t('bk.noSvcMatch')}</span>}
            {svcShown.map((s) => (
              <label key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 8px', borderRadius: 6, cursor: 'pointer', background: serviceIds.includes(s.id) ? 'var(--c1e293b)' : 'transparent', fontSize: 13, color: serviceIds.includes(s.id) ? 'var(--ce2e8f0)' : 'var(--ccbd5e1)' }}>
                <input type="checkbox" checked={serviceIds.includes(s.id)} onChange={() => toggleSvc(s.id)} style={{ flexShrink: 0 }} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name} ({s.durationMinutes} min)</span>
              </label>
            ))}
          </div>
        </div>
        </FormSection>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '13px 20px', borderTop: '1px solid var(--c334155)', background: 'var(--c0f172a)', ...(bare ? { position: 'sticky', bottom: 0, zIndex: 2, paddingBottom: 'calc(13px + env(safe-area-inset-bottom, 0px))' } : {}) }}>
        {error
          ? <span style={{ color: 'var(--cf87171)', fontSize: 13, flex: 1, minWidth: 160 }}>{error}</span>
          : <span style={{ color: 'var(--c64748b)', fontSize: 12.5, flex: 1, minWidth: 160 }}>{t('bk.custFirstName')} + {t('bk.dateTime').toLowerCase()} {lang === 'vi' ? 'là bắt buộc' : 'are required'}</span>}
        <button
          type="submit"
          disabled={submitting || people.some((p) => p.serviceIds.length === 0)}
          style={{ ...ui.primaryBtn, padding: '10px 22px', fontSize: 14, opacity: (submitting || people.some((p) => p.serviceIds.length === 0)) ? 0.5 : 1, cursor: (submitting || people.some((p) => p.serviceIds.length === 0)) ? 'not-allowed' : 'pointer' }}
        >
          {submitting ? t('bk.creating') : `+ ${t('bk.createBooking')}${partyN > 1 ? ` (${partyN})` : ''}`}
        </button>
      </div>
    </form>
  );
}

// Section heading: a small caps label with a hairline running to the edge, so
// a long form reads as two short ones instead of a wall of inputs.
function FormSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 11 }}>
        <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', color: 'var(--c94a3b8)', textTransform: 'uppercase' }}>{title}</span>
        <span style={{ flex: 1, height: 1, background: 'var(--c334155)' }} />
      </div>
      {children}
    </div>
  );
}

// Labels come from i18n with "(optional)" baked in. Pull it out and show it as
// a quiet tag instead, so every label is the same short shape.
function FieldLabel({ raw, required, optionalWord, hint }: { raw: string; required?: boolean; optionalWord: string; hint?: string }) {
  const isOpt = /\((tuỳ chọn|tùy chọn|optional)\)/i.test(raw);
  const text = raw.replace(/\s*\((tuỳ chọn|tùy chọn|optional)\)\s*/i, '').trim();
  return (
    <span style={{ ...ui.label, display: 'flex', alignItems: 'center', gap: 6 }} title={hint}>
      {text}
      {required && <span style={{ color: 'var(--cf87171)', fontWeight: 600 }}>*</span>}
      {isOpt && !required && (
        <span style={{ fontSize: 10.5, color: 'var(--c64748b)', border: '1px solid var(--c334155)', borderRadius: 5, padding: '1px 5px', fontWeight: 600 }}>{optionalWord}</span>
      )}
    </span>
  );
}

const fieldGrid: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12 };
// Five customer fields; birthday is the narrowest so it gets a smaller floor.
const custGrid: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 };
