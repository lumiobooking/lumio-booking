'use client';

import { useCallback, useEffect, useState } from 'react';
import { SalonShell } from '../../../components/SalonShell';
import { useAuth, useCan } from '../../../lib/auth';
import { apiFetch } from '../../../lib/api';
import { wallToInstantISO, instantToWall } from '../../../lib/datetime';
import { ui } from '../../../lib/ui';
import { useLang, tr } from '../../../lib/i18n';
import { missedMinutes } from '../../../lib/missed';
import { useLiveRefresh } from '../../../lib/useLiveRefresh';
import { useLiveTopics } from '../../../lib/useLiveEvents';
import { useIsMobile, CARD_LIST_MAX } from '../../../lib/responsive';
import { MList, MCard, MHead, MRow, MActions } from '../../../components/MobileCard';
import { CreateBookingForm } from '../../../components/CreateBookingForm';
import { DateRangeBar, SearchBox, matchesQuery, useDateRange, sortNewest, usePaged, Pager } from '../../../components/ListFilter';
import { useBulkSelect, BulkBar, BulkAllBox, BulkRowBox, runBulkDelete } from '../../../components/BulkDelete';
import { uiLocale } from '../../../lib/datetime';
import { DateTimeField } from '../../../components/DateTimeField';
import { withHoursOverride, type HoursRules } from '../../../lib/desk-hours';


interface NamedRef {
  id: string;
  firstName?: string;
  lastName?: string | null;
  name?: string;
}
interface Service {
  id: string;
  name: string;
  durationMinutes: number;
}
interface Staff {
  id: string;
  firstName: string;
  lastName: string | null;
  isActive: boolean;
}
interface Booking {
  id: string;
  status: string;
  startTime: string;
  endTime: string;
  notes: string | null;
  customer: (NamedRef & { phone?: string | null }) | null;
  service: { id: string; name: string } | null;
  // Extra services booked in the same visit are stored as line items on the
  // appointment (kind: 'service'); add-ons live in the same array without a kind.
  addons?: { id?: string; name?: string; kind?: string; staffMemberId?: string }[] | null;
  assignedStaff: NamedRef | null;
  preferredStaff?: NamedRef | null;
  // Shared by everyone booked together; null for a solo visit.
  groupId?: string | null;
}
interface Payment {
  id: string;
  appointmentId: string | null;
  status: string;
  type: string;
}

/** "Chưa đến": an hour past its start and nobody came. The desk calls, or marks the no-show. */
function MissedTag({ t }: { t: (k: string) => string }) {
  return <span style={{ color: '#f97316', background: 'rgba(249,115,22,0.14)', borderRadius: 999, padding: '2px 8px', fontSize: 10.5, fontWeight: 700, whiteSpace: 'nowrap' }}>{t('bk.missed')}</span>;
}

const STATUS_COLORS: Record<string, string> = {
  PENDING: '#eab308',
  ASSIGNED: '#3b82f6',
  ACCEPTED: '#22c55e',
  CONFIRMED: '#22c55e',
  REJECTED: '#ef4444',
  CANCELLED: 'var(--c94a3b8)',
  COMPLETED: '#a855f7',
  NO_SHOW: '#ef4444',
};

const ACTIVE_STATUSES = ['PENDING', 'ASSIGNED', 'ACCEPTED', 'CONFIRMED'];

export default function BookingsPage() {
  return (
    <SalonShell>
      <BookingsInner />
    </SalonShell>
  );
}

function BookingsInner() {
  const { token, user } = useAuth();
  const can = useCan();
  const canDelete = can('bookings.delete');
  // Only the owner may book outside opening hours on purpose (the server agrees).
  const isOwner = user?.role === 'SALON_ADMIN' || user?.role === 'SUPER_ADMIN';
  const [hours, setHours] = useState<HoursRules | null>(null);
  const { lang } = useLang();
  const t = (k: string) => tr(k, lang);
  // Cards up to tablet width — an iPad gets every field, not a squeezed table.
  const cardList = useIsMobile(CARD_LIST_MAX);
  const range = useDateRange('all', true); // bookings are future-oriented
  const [q, setQ] = useState('');
  // Arrived from the header search (?q=…): start with that search filled in.
  useEffect(() => { const v = new URLSearchParams(window.location.search).get('q'); if (v) setQ(v); }, []);
  const [needsConfirm, setNeedsConfirm] = useState(false);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  // Dates must read in the SALON's timezone, not the viewer's. Without this a
  // 4:00 PM appointment showed as 3:00 AM the NEXT DAY to anyone whose computer
  // sits in another timezone — the calendar and this table disagreed.
  const [salonTz, setSalonTz] = useState<string>('');
  const [staff, setStaff] = useState<Staff[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  // "/salon/bookings?new=1&staff=<id>&at=YYYY-MM-DDTHH:mm" — the phone
  // calendar's "+ Đặt cho <thợ>" lands here with the form open and the
  // technician / slot already chosen. Read once, on the client only.
  // Also "&first=&last=&phone=" — the recall list's "Đặt lịch" books that patient.
  const [prefill, setPrefill] = useState<{ staffId?: string; startLocal?: string; firstName?: string; lastName?: string; phone?: string } | null>(null);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const q = new URLSearchParams(window.location.search);
    if (q.get('new') !== '1') return;
    const at = q.get('at') ?? '';
    const txt = (k: string) => (q.get(k) ?? '').slice(0, 80) || undefined;
    setPrefill({ staffId: q.get('staff') ?? undefined, startLocal: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(at) ? at : undefined, firstName: txt('first'), lastName: txt('last'), phone: txt('phone') });
    setShowForm(true);
  }, []);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      // Payments are the owner's (GET /payments is owner-only). A receptionist
      // used to get "Insufficient role for this action" for the WHOLE page —
      // no services, no booking form — because one of these five failed. The
      // paid column simply stays empty for her now.
      const [b, s, st, p, settings] = await Promise.all([
        apiFetch<Booking[]>('/bookings', { token }),
        apiFetch<Service[]>('/services', { token }),
        apiFetch<Staff[]>('/staff', { token }),
        apiFetch<Payment[]>('/payments', { token }).catch(() => [] as Payment[]),
        apiFetch<{ company?: { timezone?: string }; booking?: HoursRules }>('/settings', { token }).catch(() => ({} as { company?: { timezone?: string }; booking?: HoursRules })),
      ]);
      setBookings(b);
      setServices(s);
      setStaff(st);
      setPayments(p);
      if (settings?.company?.timezone) setSalonTz(settings.company.timezone);
      setHours(settings?.booking ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load bookings');
    } finally {
      setLoading(false);
    }
  }, [token]);

  // Latest payment per booking (payments are returned newest-first).
  const paymentByBooking = new Map<string, Payment>();
  for (const p of payments) {
    if (p.appointmentId && !paymentByBooking.has(p.appointmentId)) {
      paymentByBooking.set(p.appointmentId, p);
    }
  }

  useEffect(() => {
    load();
  }, [load]);
  useLiveRefresh(load);
  useLiveTopics(['bookings', 'payments'], token, load);

  async function action(id: string, path: string, body?: unknown) {
    try {
      // A move outside opening hours: the owner is asked once and may go ahead.
      const timed = path === 'reschedule' || path === 'move';
      await withHoursOverride(
        (o) => apiFetch(`/bookings/${id}/${path}`, { method: 'POST', token, body: o && timed ? { ...(body as object), outsideHours: true } : body }),
        { owner: isOwner && timed, vi: lang === 'vi' },
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
    }
  }

  async function removeBooking(id: string) {
    if (!confirm('Delete this booking permanently? This cannot be undone. (To keep history, use Cancel instead.)')) return;
    try {
      await apiFetch(`/bookings/${id}`, { method: 'DELETE', token });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    }
  }

  async function processTimeouts() {
    try {
      const res = await apiFetch<{ processed: number; reassigned: number }>(
        '/bookings/process-timeouts',
        { method: 'POST', token },
      );
      await load();
      setError(
        res.processed === 0
          ? 'No timed-out bookings to process.'
          : `Processed ${res.processed} timed-out booking(s); reassigned ${res.reassigned}.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
    }
  }

  const staffName = (s: NamedRef | null) =>
    s ? `${s.firstName ?? ''} ${s.lastName ?? ''}`.trim() : '—';

  // "Needs confirmation" = upcoming booking the customer hasn't confirmed yet
  // (still PENDING/ASSIGNED/ACCEPTED, not CONFIRMED) → salon can call to remind.
  const now = Date.now();
  const isUnconfirmed = (b: Booking) =>
    new Date(b.startTime).getTime() > now && ['PENDING', 'ASSIGNED', 'ACCEPTED'].includes(b.status);

  // Filter by appointment date + search text, then show newest first.
  const visible = sortNewest(
    bookings.filter(
      (b) =>
        range.inRange(b.startTime) &&
        (!needsConfirm || isUnconfirmed(b)) &&
        matchesQuery(`${staffName(b.customer)} ${b.customer?.phone ?? ''} ${(b.customer?.phone ?? '').replace(/\D/g, '')} ${serviceNames(b).join(' ')} ${staffName(b.assignedStaff)} ${b.status}`, q),
    ),
    (b) => b.startTime,
  );
  const unconfirmedCount = bookings.filter(isUnconfirmed).length;

  // One MAIN row per party (the booker), the rest folded underneath. Four
  // sibling rows at the same minute read as four bills; folding them restores
  // the truth: one order, expandable into each person's line.
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  const toggleGroup = (gid: string) =>
    setOpenGroups((prev) => { const n = new Set(prev); if (n.has(gid)) n.delete(gid); else n.add(gid); return n; });
  const displayRows: Booking[] = [];
  {
    const seen = new Set<string>();
    for (const b of visible) {
      if (!b.groupId) { displayRows.push(b); continue; }
      if (seen.has(b.groupId)) continue;
      seen.add(b.groupId);
      const grp = bookings.filter((x) => x.groupId === b.groupId);
      // The booker carries the contact details; guests were created without.
      displayRows.push(grp.find((x) => x.customer?.phone) ?? b);
    }
  }
  const pg = usePaged(displayRows, 20);
  const bulk = useBulkSelect(pg.paged.map((r) => r.id));

  return (
    <section>
      <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
        <h2 style={{ fontSize: 18, margin: 0 }}>{t('bk.title')}</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={processTimeouts} style={ghostBtn} title={t('bk.processTimeoutsHint')}>
            {t('bk.processTimeouts')}
          </button>
          <button onClick={() => setShowForm((s) => !s)} style={ui.primaryBtn}>
            {showForm ? t('bk.close') : t('bk.newBooking')}
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 16 }}>
        <SearchBox value={q} onChange={setQ} placeholder={lang === 'vi' ? 'Tìm theo tên, số điện thoại, dịch vụ…' : 'Search by name, phone, service…'} />
        <button
          onClick={() => setNeedsConfirm((v) => !v)}
          title={t('bk.needsConfirmHint')}
          style={{ padding: '7px 12px', borderRadius: 8, border: `1px solid ${needsConfirm ? '#f59e0b' : 'var(--c475569)'}`, background: needsConfirm ? 'var(--c78350f)' : 'transparent', color: needsConfirm ? 'var(--cfde68a)' : 'var(--ccbd5e1)', fontSize: 13, cursor: 'pointer', fontWeight: 600 }}
        >
          {t('bk.needsConfirm')}{unconfirmedCount > 0 ? ` (${unconfirmedCount})` : ''}
        </button>
        <span style={{ color: 'var(--c94a3b8)', fontSize: 13 }}>{visible.length} {t('bk.bookingWord')}</span>
        <DateRangeBar range={range} />
      </div>

      {error && <div style={ui.banner}>{error}</div>}

      {showForm && (
        <CreateBookingForm
          token={token!}
          services={services}
          staff={staff.filter((s) => s.isActive)}
          bookings={bookings}
          initial={prefill ?? undefined}
          salonTz={salonTz}
          hours={hours}
          isOwner={isOwner}
          onCreated={async () => {
            setShowForm(false);
            await load();
          }}
        />
      )}

      {loading && bookings.length === 0 ? (
        <p style={{ color: 'var(--c94a3b8)' }}>{t('bk.loading')}</p>
      ) : cardList ? (
        <>
          <MList>
            {visible.length === 0 && <p style={{ color: 'var(--c64748b)', fontSize: 13 }}>{t('bk.noBookings')}</p>}
            {pg.paged.flatMap((b) => {
              const gid = b.groupId ?? '';
              const grp = gid ? bookings.filter((x) => x.groupId === gid) : [];
              const open = !!gid && openGroups.has(gid);
              const members = grp.filter((x) => x.id !== b.id);
              const pill = (st: string, startTime?: string) => (
                <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                  {startTime && missedMinutes({ status: st, startTime }, now) !== null && <MissedTag t={t} />}
                  <span style={{ color: STATUS_COLORS[st] ?? 'var(--c94a3b8)', border: `1px solid ${STATUS_COLORS[st] ?? 'var(--c94a3b8)'}`, borderRadius: 999, padding: '2px 10px', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' }}>{st}</span>
                </span>
              );
              const cards = [
                <MCard key={b.id}>
                  <MHead right={pill(b.status, b.startTime)}>
                    {b.customer?.id
                      ? <a href={`/salon/customers/${b.customer.id}`} style={{ color: 'var(--c818cf8)', textDecoration: 'none' }}>{staffName(b.customer)}</a>
                      : staffName(b.customer)}
                    {gid && grp.length > 1 ? <GroupChip n={grp.length} open={open} onToggle={() => toggleGroup(gid)} label={t('bk.groupChip')} /> : null}
                  </MHead>
                  <MRow label={t('bk.colWhen')}>{fmtWhen(b.startTime, salonTz)}</MRow>
                  <MRow label={t('bk.colService')}><ServiceCell b={b} /></MRow>
                  <MRow label={t('bk.colStaff')}><StaffCell b={b} staff={staff} /></MRow>
                  <MRow label={t('bk.colPayment')}><PaymentCell payment={paymentByBooking.get(b.id)} /></MRow>
                  <MActions>
                    <BookingActions
                      b={b} staff={staff} t={t}
                      checkoutHref={`/salon/pos?appointmentId=${b.id}&serviceId=${b.service?.id ?? ''}&staffId=${b.assignedStaff?.id ?? ''}&customerId=${b.customer?.id ?? ''}&customer=${encodeURIComponent(staffName(b.customer))}`}
                      groupSize={grp.length || 1}
                      onAction={(path, body) => action(b.id, path, body)}
                      onDelete={canDelete ? () => removeBooking(b.id) : undefined}
                    />
                  </MActions>
                </MCard>,
              ];
              if (open) {
                for (const m of members) {
                  cards.push(
                    <div key={m.id} style={{ marginLeft: 14, borderLeft: '2px solid var(--c312e81)', paddingLeft: 8 }}>
                      <MCard>
                        <MHead right={pill(m.status, m.startTime)}>
                          <span style={{ color: 'var(--c64748b)' }}>↳ </span>
                          {m.customer?.id
                            ? <a href={`/salon/customers/${m.customer.id}`} style={{ color: 'var(--c818cf8)', textDecoration: 'none' }}>{staffName(m.customer)}</a>
                            : staffName(m.customer)}
                        </MHead>
                        <MRow label={t('bk.colService')}><ServiceCell b={m} /></MRow>
                        <MRow label={t('bk.colStaff')}><StaffCell b={m} staff={staff} /></MRow>
                        <MRow label={t('bk.colPayment')}><PaymentCell payment={paymentByBooking.get(m.id)} /></MRow>
                        <MActions>
                          <BookingActions
                            b={m} staff={staff} t={t}
                            checkoutHref={`/salon/pos?appointmentId=${m.id}&serviceId=${m.service?.id ?? ''}&staffId=${m.assignedStaff?.id ?? ''}&customerId=${m.customer?.id ?? ''}&customer=${encodeURIComponent(staffName(m.customer))}`}
                            groupSize={1}
                            onAction={(path, body) => action(m.id, path, body)}
                            onDelete={canDelete ? () => removeBooking(m.id) : undefined}
                          />
                        </MActions>
                      </MCard>
                    </div>,
                  );
                }
              }
              return cards;
            })}
          </MList>
          <Pager paged={pg} />
        </>
      ) : (
        <div>
          {canDelete && <BulkBar count={bulk.count} ids={bulk.sel} onClear={bulk.clear} onDelete={(ids) => runBulkDelete(ids, (id) => apiFetch(`/bookings/${id}`, { method: 'DELETE', token }), load)} />}
          <div style={{ border: '1px solid var(--c334155)', borderRadius: 12, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ background: 'var(--c1e293b)' }}>
                <th style={{ ...ui.th, width: 34 }}><BulkAllBox on={bulk.allOn} onChange={bulk.toggleAll} /></th>
                <th style={{ ...ui.th, whiteSpace: 'nowrap' }}>{t('bk.colWhen')}</th>
                <th style={{ ...ui.th, whiteSpace: 'nowrap' }}>{t('bk.colCustomer')}</th>
                <th style={{ ...ui.th, whiteSpace: 'nowrap' }}>{t('bk.colService')}</th>
                <th style={{ ...ui.th, whiteSpace: 'nowrap' }}>{t('bk.colStaff')}</th>
                <th style={{ ...ui.th, whiteSpace: 'nowrap' }}>{t('bk.colStatus')}</th>
                <th style={{ ...ui.th, whiteSpace: 'nowrap' }}>{t('bk.colPayment')}</th>
                <th style={{ ...ui.th, whiteSpace: 'nowrap' }}>{t('bk.colActions')}</th>
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 && (
                <tr>
                  <td style={ui.td} colSpan={8}>
                    {t('bk.noBookings')}
                  </td>
                </tr>
              )}
              {pg.paged.flatMap((b) => {
                const gid = b.groupId ?? '';
                const grp = gid ? bookings.filter((x) => x.groupId === gid) : [];
                const open = !!gid && openGroups.has(gid);
                const members = grp.filter((x) => x.id !== b.id);
                const pill = (st: string, startTime?: string) => (
                  <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                    {startTime && missedMinutes({ status: st, startTime }, now) !== null && <MissedTag t={t} />}
                    <span style={{ display: 'inline-block', whiteSpace: 'nowrap', color: STATUS_COLORS[st] ?? 'var(--c94a3b8)', border: `1px solid ${STATUS_COLORS[st] ?? 'var(--c94a3b8)'}`, borderRadius: 999, padding: '3px 10px', fontSize: 11, fontWeight: 600 }}>{st}</span>
                  </span>
                );
                const rows = [
                  <tr key={b.id} style={{ borderTop: '1px solid var(--c334155)', background: bulk.has(b.id) ? 'var(--c1e1b4b)' : undefined }}>
                    <td style={{ ...ui.td, width: 34 }}><BulkRowBox on={bulk.has(b.id)} onChange={() => bulk.toggle(b.id)} /></td>
                    <td style={ui.td}>{fmtWhen(b.startTime, salonTz)}</td>
                    <td style={ui.td}>
                      {b.customer?.id
                        ? <a href={`/salon/customers/${b.customer.id}`} style={{ color: 'var(--c818cf8)', textDecoration: 'none', fontWeight: 600 }}>{staffName(b.customer)}</a>
                        : staffName(b.customer)}
                      {gid && grp.length > 1 ? <GroupChip n={grp.length} open={open} onToggle={() => toggleGroup(gid)} label={t('bk.groupChip')} /> : null}
                    </td>
                    <td style={ui.td}><ServiceCell b={b} /></td>
                    <td style={ui.td}><StaffCell b={b} staff={staff} /></td>
                    <td style={{ ...ui.td, whiteSpace: 'nowrap' }}>{pill(b.status, b.startTime)}</td>
                    <td style={ui.td}>
                      <PaymentCell payment={paymentByBooking.get(b.id)} />
                    </td>
                    <td style={{ ...ui.td, whiteSpace: 'nowrap' }}>
                      <BookingActions
                        b={b} staff={staff} t={t}
                        checkoutHref={`/salon/pos?appointmentId=${b.id}&serviceId=${b.service?.id ?? ''}&staffId=${b.assignedStaff?.id ?? ''}&customerId=${b.customer?.id ?? ''}&customer=${encodeURIComponent(staffName(b.customer))}`}
                        groupSize={grp.length || 1}
                        onAction={(path, body) => action(b.id, path, body)}
                        onDelete={canDelete ? () => removeBooking(b.id) : undefined}
                      />
                    </td>
                  </tr>,
                ];
                if (open) {
                  for (const m of members) {
                    rows.push(
                      <tr key={m.id} style={{ borderTop: '1px dashed #26324a', background: bulk.has(m.id) ? 'var(--c1e1b4b)' : 'var(--c0d1526)' }}>
                        <td style={{ ...ui.td, width: 34, boxShadow: 'inset 3px 0 0 #4338ca' }}><BulkRowBox on={bulk.has(m.id)} onChange={() => bulk.toggle(m.id)} /></td>
                        <td style={ui.td}></td>
                        <td style={ui.td}>
                          <span style={{ color: 'var(--ink-link)', marginRight: 6 }}>↳</span>
                          {m.customer?.id
                            ? <a href={`/salon/customers/${m.customer.id}`} style={{ color: 'var(--c818cf8)', textDecoration: 'none' }}>{staffName(m.customer)}</a>
                            : staffName(m.customer)}
                        </td>
                        <td style={ui.td}><ServiceCell b={m} /></td>
                        <td style={ui.td}><StaffCell b={m} staff={staff} /></td>
                        <td style={{ ...ui.td, whiteSpace: 'nowrap' }}>{pill(m.status, m.startTime)}</td>
                        <td style={ui.td}>
                          <PaymentCell payment={paymentByBooking.get(m.id)} />
                        </td>
                        <td style={{ ...ui.td, whiteSpace: 'nowrap' }}>
                          <BookingActions
                            b={m} staff={staff} t={t}
                            checkoutHref={`/salon/pos?appointmentId=${m.id}&serviceId=${m.service?.id ?? ''}&staffId=${m.assignedStaff?.id ?? ''}&customerId=${m.customer?.id ?? ''}&customer=${encodeURIComponent(staffName(m.customer))}`}
                            groupSize={1}
                            onAction={(path, body) => action(m.id, path, body)}
                            onDelete={canDelete ? () => removeBooking(m.id) : undefined}
                          />
                        </td>
                      </tr>,
                    );
                  }
                }
                return rows;
              })}
            </tbody>
          </table>
          <div style={{ padding: '0 14px 12px' }}><Pager paged={pg} /></div>
          </div>
        </div>
      )}
    </section>
  );
}

/**
 * One booking's actions, arranged by how often they are used instead of all at
 * once: the next step in the visit is a filled button, the two "change the plan"
 * controls sit next to it as quiet icons, and everything destructive hides in a
 * ⋯ menu so nobody cancels a booking by mis-tapping.
 */
function BookingActions({ b, staff, t, checkoutHref, groupSize, onAction, onDelete }: {
  b: Booking;
  staff: Staff[];
  t: (k: string) => string;
  checkoutHref: string;
  groupSize: number;
  onAction: (path: string, body?: Record<string, unknown>) => void;
  onDelete?: () => void;
}) {
  const [menu, setMenu] = useState(false);
  const [panel, setPanel] = useState<'none' | 'move' | 'staff'>('none');
  const active = ACTIVE_STATUSES.includes(b.status);
  const pending = b.status === 'PENDING';
  const live = staff.filter((s) => s.isActive);

  const iconBtn: React.CSSProperties = {
    width: 30, height: 30, display: 'grid', placeItems: 'center', borderRadius: 8,
    border: '1px solid var(--c334155)', background: 'transparent', color: 'var(--ccbd5e1)', cursor: 'pointer', fontSize: 14,
  };

  return (
    <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-start' }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'nowrap' }}>
        {/* Next step in the visit */}
        {pending ? (
          <button onClick={() => onAction('auto-assign')} title={t('bk.autoAssignHint')} style={{ ...actBtnFilled('#22c55e') }}>
            {t('bk.autoAssign')}
          </button>
        ) : null}
        {/* A party can be settled at any point in its life. While the rows are
            still pending the primary button is Auto-assign, so the group bill
            would have been invisible exactly when a walk-in group is standing
            at the desk — it sits beside it instead. */}
        {active && groupSize > 1 && b.groupId && (
          <a
            href={`/salon/pos?appointmentId=${b.id}&groupId=${encodeURIComponent(b.groupId)}&customerId=${b.customer?.id ?? ''}`}
            title={t('bk.payGroup')}
            style={{ ...actBtnFilled('#6366f1'), textDecoration: 'none' }}
          >
            {t('bk.checkoutGroup').replace('{n}', String(groupSize))}
          </a>
        )}
        {!pending && active && groupSize <= 1 ? (
          // A party that booked together almost always walks to the desk
          // together, so the main button settles all of them. Paying one
          // person on their own is still there, one menu down.
          <a href={checkoutHref} title={t('bk.checkoutHint')} style={{ ...actBtnFilled('#6366f1'), textDecoration: 'none' }}>
            {t('bk.checkout')}
          </a>
        ) : null}

        {/* Change the plan — icons, because they are used far less than the step above */}
        {active && (
          <>
            <button onClick={() => setPanel(panel === 'move' ? 'none' : 'move')} title={t('bk.reschedule')} style={{ ...iconBtn, ...(panel === 'move' ? { borderColor: '#6366f1', color: 'var(--ca5b4fc)' } : {}) }}>🗓</button>
            <button onClick={() => setPanel(panel === 'staff' ? 'none' : 'staff')} title={pending ? t('bk.assign') : t('bk.changeStaff')} style={{ ...iconBtn, ...(panel === 'staff' ? { borderColor: '#6366f1', color: 'var(--ca5b4fc)' } : {}) }}>👤</button>
          </>
        )}

        {/* Everything that ends or undoes the booking */}
        <button onClick={() => setMenu((v) => !v)} title={t('bk.colActions')} style={{ ...iconBtn, ...(menu ? { borderColor: '#6366f1', color: 'var(--ca5b4fc)' } : {}) }}>⋯</button>
      </div>

      {panel === 'move' && (
        <InlineMove current={b.startTime} t={t} onMove={(iso) => { onAction('reschedule', { startTime: iso }); setPanel('none'); }} onClose={() => setPanel('none')} />
      )}
      {panel === 'staff' && (
        (b.addons ?? []).some((a) => a?.kind === 'service') ? (
          <AssignLines b={b} live={live} t={t} onAction={onAction} onClose={() => setPanel('none')} />
        ) : (
          <select
            autoFocus
            defaultValue=""
            onChange={(e) => { if (e.target.value) { onAction('assign', { staffId: e.target.value }); setPanel('none'); } }}
            style={{ ...ui.input, padding: '6px 8px', fontSize: 13, minWidth: 170 }}
          >
            <option value="">{pending ? t('bk.assign') : t('bk.changeStaff')}</option>
            {live.map((s) => <option key={s.id} value={s.id}>{s.firstName} {s.lastName ?? ''}</option>)}
          </select>
        )
      )}

      {menu && (
        <>
          <div onClick={() => setMenu(false)} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
          <div style={{ position: 'absolute', top: 36, left: 0, zIndex: 41, minWidth: 190, background: 'var(--c0f172a)', border: '1px solid var(--c223047)', borderRadius: 10, boxShadow: '0 14px 40px rgba(0,0,0,.5)', padding: 5 }}>
            {active && groupSize > 1 && (
              <>
                <MenuItem
                  label={`🧾 ${t('bk.checkoutSolo')}`}
                  color="var(--ca5b4fc)"
                  onClick={() => { setMenu(false); window.location.href = checkoutHref; }}
                />
                <div style={{ height: 1, background: 'var(--line)', margin: '4px 6px' }} />
              </>
            )}
            {active && (
              <>
                <MenuItem label={`✅ ${t('bk.complete')}`} color="#22c55e" onClick={() => { setMenu(false); onAction('complete'); }} />
                <MenuItem label={`⚠ ${t('bk.noShow')}`} color="#f97316" onClick={() => { setMenu(false); if (confirm(t('bk.confirmNoShow'))) onAction('no-show'); }} />
                <MenuItem label={`✖ ${t('bk.cancel')}`} color="#ef4444" onClick={() => { setMenu(false); if (confirm(t('bk.confirmCancel'))) onAction('cancel'); }} />
                <div style={{ height: 1, background: 'var(--line)', margin: '4px 6px' }} />
              </>
            )}
            {onDelete && <MenuItem label={`🗑 ${t('bk.delete')}`} color="var(--cf87171)" onClick={() => { setMenu(false); onDelete(); }} />}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Per-service staffing, opened from the 👤 icon on multi-service visits.
 * Primary row re-assigns the visit's main tech (overlap-checked server-side);
 * every other service line gets its own tech. Changes save on pick and the
 * panel stays open so both rows can be set in one go.
 */
function AssignLines({ b, live, t, onAction, onClose }: {
  b: Booking;
  live: Staff[];
  t: (k: string) => string;
  onAction: (path: string, body?: Record<string, unknown>) => void;
  onClose: () => void;
}) {
  // Older rows can miss ids on their snapshot lines; those can't be targeted.
  const lines = (b.addons ?? []).filter((a) => a?.kind === 'service' && a.id);
  const selStyle: React.CSSProperties = { ...ui.input, padding: '5px 7px', fontSize: 12.5, width: 140, flexShrink: 0 };
  return (
    <div style={{ background: 'var(--c0f172a)', border: '1px solid var(--c223047)', borderRadius: 10, padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 6, minWidth: 250 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {b.service?.name ?? '—'}
          <span style={{ marginLeft: 5, fontSize: 10, fontWeight: 600, color: 'var(--c818cf8)', border: '1px solid var(--c3730a3)', borderRadius: 6, padding: '0 4px' }}>{t('cal.lineMain')}</span>
        </span>
        <select
          value={b.assignedStaff?.id ?? ''}
          onChange={(e) => { if (e.target.value) onAction('assign', { staffId: e.target.value }); }}
          style={{ ...selStyle, ...(b.assignedStaff ? {} : { color: 'var(--ink-warn)', borderColor: 'var(--c7c5c22)' }) }}
        >
          <option value="" disabled>{t('cal.linePick')}</option>
          {live.map((s) => <option key={s.id} value={s.id}>{s.firstName} {s.lastName ?? ''}</option>)}
        </select>
      </div>
      {lines.map((line) => (
        <div key={line.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, borderTop: '1px solid var(--line)', paddingTop: 6 }}>
          <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{line.name}</span>
          <select
            value={line.staffMemberId ?? ''}
            onChange={(e) => onAction('line-staff', { serviceId: line.id, staffId: e.target.value || null })}
            style={selStyle}
          >
            <option value="">{t('cal.lineWithMain')}</option>
            {live.map((s) => <option key={s.id} value={s.id}>{s.firstName} {s.lastName ?? ''}</option>)}
          </select>
        </div>
      ))}
      <button onClick={onClose} style={{ alignSelf: 'flex-end', background: 'none', border: 'none', color: 'var(--c818cf8)', fontSize: 12.5, cursor: 'pointer', padding: '2px 4px', fontWeight: 600 }}>
        ✓ {t('bk.done')}
      </button>
    </div>
  );
}

function MenuItem({ label, color, onClick }: { label: string; color: string; onClick: () => void }) {
  const [hov, setHov] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 10px', borderRadius: 7, border: 'none', background: hov ? '#1a2436' : 'transparent', color, fontSize: 13, cursor: 'pointer' }}
    >
      {label}
    </button>
  );
}

/** Date+time picker that opens under the 🗓 icon. */
function InlineMove({ current, t, onMove, onClose }: { current: string; t: (k: string) => string; onMove: (iso: string) => void; onClose: () => void }) {
  // The picker shows and reads SALON wall time. Browser-local here means an
  // owner rescheduling from another timezone silently moves the appointment.
  const [val, setVal] = useState(() => instantToWall(current));
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
      <DateTimeField value={val} onChange={setVal} style={{ padding: '5px 8px', fontSize: 13 }} wrapStyle={{ flex: '1 1 260px' }} />
      <button disabled={!val} onClick={() => val && onMove(wallToInstantISO(val))} style={smallOk}>{t('bk.move')}</button>
      <button onClick={onClose} style={actBtnOutline('var(--c94a3b8)')}>✕</button>
    </div>
  );
}


/** The party's toggle: one main row stands for the group, this chip fans the
 *  members out underneath it (and folds them away again). */
function GroupChip({ n, open, onToggle, label }: { n: number; open: boolean; onToggle: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); onToggle(); }}
      title={label.replace('{n}', String(n))}
      style={{ marginLeft: 6, display: 'inline-flex', alignItems: 'center', gap: 4, background: open ? 'var(--c3730a3)' : 'var(--c312e81)', color: 'var(--cc7d2fe)', border: '1px solid #4338ca', borderRadius: 999, padding: '1px 9px', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap', cursor: 'pointer' }}
    >
      👥 {n} <span style={{ fontSize: 9 }}>{open ? '▼' : '▶'}</span>
    </button>
  );
}

/** A booking time as the salon reads it on its own wall clock. */
function fmtWhen(iso: string, tz: string): string {
  const d = new Date(iso);
  try {
    return d.toLocaleString(uiLocale(), tz ? { timeZone: tz } : undefined);
  } catch {
    return d.toLocaleString(uiLocale()); // unknown zone → viewer's clock
  }
}

/** Every service on the visit: the primary plus any extra service lines. */
function serviceNames(b: Booking): string[] {
  // Extra services, then add-ons ("Vẽ móng") — both are part of what she booked.
  const extra = (b.addons ?? []).filter((a) => a?.kind === 'service').map((a) => a?.name ?? '').filter(Boolean);
  const adds = (b.addons ?? []).filter((a) => a && a.kind !== 'service').map((a) => a?.name ?? '').filter(Boolean);
  return [b.service?.name ?? '', ...extra, ...adds].filter(Boolean);
}

/**
 * A visit can hold several services. Showing only the first one made staff
 * think the extras had been lost, so the rest are listed underneath.
 */
/**
 * Staff column: the visit's main tech plus every different tech assigned to a
 * service line. One name used to hide the fact that three techs work this
 * visit — the desk plans turns from this column.
 */
function StaffCell({ b, staff }: { b: Booking; staff: Staff[] }) {
  const primary = b.assignedStaff ? `${b.assignedStaff.firstName} ${b.assignedStaff.lastName ?? ''}`.trim() : '—';
  // The one the customer ASKED for, when nobody (or somebody else) is assigned yet.
  const asked = b.preferredStaff && b.preferredStaff.id !== b.assignedStaff?.id ? `${b.preferredStaff.firstName} ${b.preferredStaff.lastName ?? ''}`.trim() : '';
  const others = [...new Set(
    (b.addons ?? [])
      .filter((a) => a?.kind === 'service' && a.staffMemberId && a.staffMemberId !== b.assignedStaff?.id)
      .map((a) => {
        const st = staff.find((x) => x.id === a.staffMemberId);
        return st ? `${st.firstName} ${st.lastName ?? ''}`.trim() : '';
      })
      .filter(Boolean),
  )];
  const askedLine = asked ? <span style={{ display: 'block', fontSize: 12, color: 'var(--cfcd34d)', marginTop: 2 }} title="Requested by the customer">★ {asked}</span> : null;
  if (others.length === 0) return <>{primary}{askedLine}</>;
  return (
    <span title={[primary, ...others].join(', ')}>
      {primary}
      <span style={{ display: 'block', fontSize: 12, color: 'var(--c94a3b8)', marginTop: 2 }}>+ {others.join(' · ')}</span>
      {askedLine}
    </span>
  );
}

function ServiceCell({ b }: { b: Booking }) {
  const names = serviceNames(b);
  if (names.length === 0) return <>—</>;
  return (
    <span>
      {names[0]}
      {names.length > 1 && (
        <span style={{ display: 'block', fontSize: 12, color: 'var(--c94a3b8)', marginTop: 2 }}>
          + {names.slice(1).join(' · ')}
        </span>
      )}
    </span>
  );
}

// Read-only payment status. Money is collected only through POS / Checkout
// (single source of truth) so a booking can never be paid twice — once here
// and once in the register. If unpaid, we point staff to the Checkout button.
function PaymentCell({ payment }: { payment?: Payment }) {
  const { lang } = useLang();
  const t = (k: string) => tr(k, lang);
  if (!payment) {
    return <span style={{ color: 'var(--c64748b)', fontSize: 12 }}>{t('bk.collectAtCheckout')}</span>;
  }
  const color = payment.status === 'PAID' ? '#22c55e' : payment.status === 'FAILED' ? '#ef4444' : '#eab308';
  return <span style={{ color, fontSize: 12, fontWeight: 600 }}>{payment.status}</span>;
}

// Uniform compact action-button styles so the Actions cell stays tidy.
function actBtnOutline(color: string): React.CSSProperties {
  return { padding: '6px 11px', borderRadius: 8, border: `1px solid ${color}`, background: 'transparent', color, fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap', lineHeight: 1.2 };
}
function actBtnFilled(bg: string): React.CSSProperties {
  return { padding: '6px 11px', borderRadius: 8, border: 'none', background: bg, color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap', lineHeight: 1.2, display: 'inline-block' };
}

const smallOk: React.CSSProperties = actBtnOutline('#22c55e');
const smallWarn: React.CSSProperties = actBtnOutline('#f97316');

const ghostBtn: React.CSSProperties = {
  padding: '9px 14px',
  borderRadius: 8,
  border: '1px solid var(--c475569)',
  background: 'transparent',
  color: 'var(--ce2e8f0)',
  fontSize: 13,
  cursor: 'pointer',
};
