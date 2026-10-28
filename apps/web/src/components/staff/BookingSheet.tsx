'use client';

/**
 * One booking, close up, for the technician — and the two decisions she
 * makes about it from her phone:
 *   - a new booking the salon gave her: "Nhận" (yes) or "Không nhận" (no,
 *     with a one-tap reason so the desk knows whom to give it to instead);
 *   - her customer is here: "Khách đã đến — bắt đầu làm", which checks the
 *     customer in and starts her part on the floor, exactly like the desk would.
 * Calling or texting the customer is one tap too: a late customer is the
 * most common reason to open a booking at all.
 */

import { useEffect, useState } from 'react';
import { fmtInTz } from '../../lib/datetime';
import { formatPrice } from '../../lib/ui';
import { IC, Icon, L, Pill, Sheet, st } from './kit';
import { ClientCard } from './ClientCard';
import { apiFetch } from '../../lib/api';
import { isMaskedContact } from '../../lib/contact-mask';
import { useAuth } from '../../lib/auth';
import { ClientFormsPanel } from '../forms/ClientFormsPanel';

export interface StaffBooking {
  id: string;
  status: string;
  startTime: string;
  endTime?: string | null;
  notes: string | null;
  priceCents?: number | null;
  customer: { firstName?: string; lastName?: string | null; phone?: string | null } | null;
  service: { name: string; durationMinutes?: number } | null;
  addons?: unknown;
}

export function bookingName(b: StaffBooking): string {
  const c = b.customer;
  return c ? `${c.firstName ?? ''} ${c.lastName ?? ''}`.trim() || '—' : '—';
}

/** Every service of the booking, the main one first. */
export function bookingServices(b: StaffBooking): string {
  const extra = (Array.isArray(b.addons) ? (b.addons as { name?: string; kind?: string }[]) : [])
    .filter((a) => a && a.name && (a.kind === 'service' || a.kind === 'addon' || !a.kind))
    .map((a) => a.name as string);
  return [b.service?.name, ...extra].filter(Boolean).join(' + ') || 'Service';
}

export function bookingMinutes(b: StaffBooking): number {
  if (b.endTime) return Math.max(0, Math.round((new Date(b.endTime).getTime() - new Date(b.startTime).getTime()) / 60000));
  return b.service?.durationMinutes ?? 0;
}

export type Tone = 'good' | 'warn' | 'info' | 'mute' | 'bad' | 'sky';
export function bookingStatus(status: string, vi: boolean): { text: string; tone: Tone } {
  switch (status) {
    case 'ASSIGNED': return { text: L(vi, 'Chờ bạn nhận', 'Needs your OK'), tone: 'warn' };
    case 'ACCEPTED':
    case 'CONFIRMED': return { text: L(vi, 'Đã nhận', 'Confirmed'), tone: 'info' };
    case 'ARRIVED': return { text: L(vi, 'Khách đã đến', 'Arrived'), tone: 'sky' };
    case 'COMPLETED': return { text: L(vi, 'Đã xong', 'Done'), tone: 'mute' };
    case 'CANCELLED': return { text: L(vi, 'Đã huỷ', 'Cancelled'), tone: 'mute' };
    case 'NO_SHOW': return { text: L(vi, 'Không đến', 'No-show'), tone: 'bad' };
    case 'REJECTED': return { text: L(vi, 'Đã từ chối', 'Declined'), tone: 'mute' };
    default: return { text: L(vi, 'Chờ xếp thợ', 'Unassigned'), tone: 'mute' };
  }
}

/** A booking she can start now: hers, confirmed, and today within a sensible window. */
export function canStart(b: StaffBooking): boolean {
  if (!['ASSIGNED', 'ACCEPTED', 'CONFIRMED', 'ARRIVED'].includes(b.status)) return false;
  const diff = new Date(b.startTime).getTime() - Date.now();
  return diff < 90 * 60000 && diff > -4 * 3600000;
}

export const REJECT_REASONS: { vi: string; en: string }[] = [
  { vi: 'Kín lịch giờ đó', en: 'Booked at that time' },
  { vi: 'Không làm dịch vụ này', en: "I don't do this service" },
  { vi: 'Nghỉ ngày này', en: 'Off that day' },
  { vi: 'Lý do khác', en: 'Other reason' },
];

/** No forms on a booking that will not happen. */
const FORMLESS = new Set(['CANCELLED', 'REJECTED', 'NO_SHOW']);

export function BookingSheet({ booking, vi, currency, onClose, onAccept, onReject, onStart, startReject = false }: {
  booking: StaffBooking | null; vi: boolean; currency?: string;
  onClose: () => void;
  onAccept: (b: StaffBooking) => Promise<void> | void;
  onReject: (b: StaffBooking, reason: string) => Promise<void> | void;
  onStart: (b: StaffBooking) => Promise<void> | void;
  /** Open straight on the "why not?" step (the inline "Không nhận" button). */
  startReject?: boolean;
}) {
  const { token } = useAuth();
  const [step, setStep] = useState<'view' | 'reject'>('view');
  const [reason, setReason] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // "Nhờ quầy liên hệ khách": the ask box and what happened to it.
  const [askOpen, setAskOpen] = useState(false);
  const [askText, setAskText] = useState('');
  const [asked, setAsked] = useState<string | null>(null);
  useEffect(() => { setStep(startReject ? 'reject' : 'view'); setReason(null); setBusy(false); }, [booking?.id, startReject]);

  const run = async (fn: () => Promise<void> | void) => {
    if (busy) return;
    setBusy(true);
    try { await fn(); } finally { setBusy(false); }
  };

  if (!booking) return <Sheet open={false} onClose={onClose} label="">{null}</Sheet>;
  const b = booking;
  const s = bookingStatus(b.status, vi);
  const mins = bookingMinutes(b);
  const phone = b.customer?.phone?.trim();
  const when = `${fmtInTz(b.startTime, { weekday: 'short', day: 'numeric', month: 'numeric' })} · ${fmtInTz(b.startTime, { hour: 'numeric', minute: '2-digit' })}${mins ? ` · ${mins} ${L(vi, 'phút', 'min')}` : ''}`;

  return (
    <Sheet open onClose={onClose} label={bookingName(b)}>
      {step === 'view' ? (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 20, fontWeight: 800, color: 'var(--ce2e8f0)', flex: 1, minWidth: 0 }}>{bookingName(b)}</span>
            <Pill text={s.text} tone={s.tone} />
          </div>
          <div style={{ fontSize: 15, color: 'var(--ccbd5e1)', marginTop: 8, textTransform: 'capitalize' }}>{when}</div>
          <div style={{ fontSize: 15, color: 'var(--ce2e8f0)', marginTop: 4, fontWeight: 600 }}>
            {bookingServices(b)}{b.priceCents ? <span style={{ color: 'var(--c94a3b8)', fontWeight: 500 }}> · {formatPrice(b.priceCents, currency)}</span> : null}
          </div>
          {b.notes && (
            <div style={{ fontSize: 14, color: 'var(--ccbd5e1)', marginTop: 12, padding: '10px 12px', borderRadius: 12, background: 'var(--c0f172a)', lineHeight: 1.5 }}>
              {b.notes}
            </div>
          )}
          {/* the client, close up — hers only (bookings/client-card) */}
          {b.customer && <ClientCard bookingId={b.id} token={token} vi={vi} />}
          {/* Her client's forms before she arrives: what is signed, what is missing,
              sign on this phone or text the link (massage / spa salons; draws
              nothing when the salon has no forms). The API only answers for
              bookings that are hers. */}
          {b.customer && !FORMLESS.has(b.status) && <div style={{ marginTop: 12 }}><ClientFormsPanel appointmentId={b.id} /></div>}
          {/* Full number (the salon allows it): call / text. Otherwise the desk does it for her. */}
          {phone && !isMaskedContact(phone) ? (
            <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
              <a href={`tel:${phone}`} style={{ ...st.ghost, flex: 1 }}><Icon d={IC.phone} size={18} />{L(vi, 'Gọi khách', 'Call')}</a>
              <a href={`sms:${phone}`} style={{ ...st.ghost, flex: 1 }}><Icon d={IC.message} size={18} />{L(vi, 'Nhắn tin', 'Text')}</a>
            </div>
          ) : (
            <div style={{ marginTop: 14 }}>
              {phone && <div style={{ fontSize: 13, color: 'var(--c94a3b8)', marginBottom: 8 }}>{L(vi, 'SĐT khách', 'Client phone')}: {phone}</div>}
              {asked ? (
                <div style={{ fontSize: 14, color: 'var(--ink-good)', fontWeight: 600, padding: '10px 0' }}>{asked}</div>
              ) : askOpen ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <label style={{ fontSize: 13, color: 'var(--c94a3b8)' }} htmlFor="ask-desk">{L(vi, 'Nhắn quầy (không bắt buộc)', 'Note for the desk (optional)')}</label>
                  <input id="ask-desk" value={askText} maxLength={200} onChange={(e) => setAskText(e.target.value)}
                    placeholder={L(vi, 'VD: báo khách tôi trễ 10 phút', 'e.g. tell her I am running 10 min late')}
                    style={{ height: 46, borderRadius: 12, border: '1px solid var(--line-strong)', background: 'var(--c0f172a)', color: 'var(--ce2e8f0)', padding: '0 12px', fontSize: 16 }} />
                  <div style={{ display: 'flex', gap: 10 }}>
                    <button type="button" onClick={() => setAskOpen(false)} style={{ ...st.ghost, flex: 1 }}>{L(vi, 'Huỷ', 'Cancel')}</button>
                    <button type="button" disabled={busy} style={{ ...st.primary, flex: 2 }} onClick={() => run(async () => {
                      try {
                        await apiFetch(`/bookings/${b.id}/ask-desk`, { method: 'POST', token, body: { message: askText.trim() || undefined } });
                        setAsked(L(vi, '✓ Đã báo quầy — quầy sẽ liên hệ khách.', '✓ The desk has been asked to contact the client.'));
                      } catch (e) { setAsked(e instanceof Error ? e.message : 'Error'); }
                    })}>{L(vi, 'Gửi cho quầy', 'Send to desk')}</button>
                  </div>
                </div>
              ) : (
                <button type="button" onClick={() => setAskOpen(true)} style={{ ...st.ghost, width: '100%' }}>
                  <Icon d={IC.message} size={18} />{L(vi, 'Nhờ quầy liên hệ khách', 'Ask the desk to contact client')}
                </button>
              )}
            </div>
          )}
          {b.status === 'ASSIGNED' && (
            <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
              <button type="button" disabled={busy} onClick={() => setStep('reject')} style={{ ...st.ghost, flex: 1, height: 56 }}>{L(vi, 'Không nhận', 'Decline')}</button>
              <button type="button" disabled={busy} onClick={() => run(() => onAccept(b))} style={{ ...st.primary, flex: 2, height: 56 }}>{L(vi, 'Nhận lịch này', 'Accept')}</button>
            </div>
          )}
          {canStart(b) && b.status !== 'ASSIGNED' && (
            <button type="button" disabled={busy} onClick={() => run(() => onStart(b))} style={{ ...st.primary, width: '100%', height: 56, marginTop: 12 }}>
              {busy ? '…' : L(vi, 'Khách đã đến — bắt đầu làm', 'Client is here — start')}
            </button>
          )}
        </div>
      ) : (
        <div>
          <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--ce2e8f0)' }}>{L(vi, 'Vì sao bạn không nhận?', 'Why not?')}</div>
          <div style={{ fontSize: 14, color: 'var(--c94a3b8)', marginTop: 4 }}>
            {L(vi, 'Quầy sẽ được báo và giao lịch này cho thợ khác.', 'The desk is told and gives it to someone else.')}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10, marginTop: 14 }}>
            {REJECT_REASONS.map((r) => {
              const label = vi ? r.vi : r.en;
              const on = reason === label;
              return (
                <button key={r.en} type="button" onClick={() => setReason(label)} aria-pressed={on}
                  style={{ minHeight: 52, padding: '8px 10px', borderRadius: 12, border: `1.5px solid ${on ? '#6366f1' : 'var(--line-strong)'}`, background: on ? 'var(--c1e1b4b)' : 'var(--c0f172a)', color: on ? 'var(--cc7d2fe)' : 'var(--ce2e8f0)', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
                  {label}
                </button>
              );
            })}
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
            <button type="button" onClick={() => (startReject ? onClose() : setStep('view'))} style={{ ...st.ghost, flex: 1, height: 56 }}>{L(vi, 'Quay lại', 'Back')}</button>
            <button type="button" disabled={!reason || busy} onClick={() => reason && run(() => onReject(b, reason))}
              style={{ ...st.primary, flex: 2, height: 56, opacity: reason ? 1 : 0.45 }}>{L(vi, 'Gửi cho quầy', 'Send to desk')}</button>
          </div>
        </div>
      )}
    </Sheet>
  );
}
