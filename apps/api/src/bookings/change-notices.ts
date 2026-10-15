/**
 * Who hears about a cancelled or moved appointment, and on which channel.
 *
 * The salon's notification catalog has had three templates for this since the
 * start — customer_booking_cancelled, customer_booking_rescheduled and
 * staff_booking_cancelled — shown in Settings, editable, and never sent: no
 * code path called them. A customer who cancelled through the reminder link
 * got no written confirmation, the technician found out when nobody sat down,
 * and the owner's phone stayed quiet. This file decides the recipients from
 * plain inputs so the decision can be tested without a mailbox.
 *
 * Rules carried over from the confirmation:
 * - a template that is OFF sends nothing on any channel;
 * - email needs an address, SMS needs a number;
 * - a VN salon's SMS must match the carrier-registered text, and these
 *   messages are not registered, so VN gets email only (Zalo/SMS stays quiet).
 */

export interface TemplateSwitch { enabled: boolean; email: boolean; sms: boolean }

export interface ChangeNoticeInput {
  kind: 'cancelled' | 'rescheduled';
  market: string;
  customer: { email: string | null; phone: string | null };
  customerTpl: TemplateSwitch | null | undefined;
  staff: { email: string | null; phone: string | null } | null;
  staffTpl: TemplateSwitch | null | undefined;
}

export interface ChangeNoticeTarget { to: 'customer' | 'staff'; channel: 'email' | 'sms'; recipient: string }

export function changeNoticeTargets(i: ChangeNoticeInput): ChangeNoticeTarget[] {
  const out: ChangeNoticeTarget[] = [];
  const vn = (i.market || 'US').toUpperCase() === 'VN';
  const c = i.customerTpl;
  if (c?.enabled) {
    if (c.email && i.customer.email) out.push({ to: 'customer', channel: 'email', recipient: i.customer.email });
    if (c.sms && i.customer.phone && !vn) out.push({ to: 'customer', channel: 'sms', recipient: i.customer.phone });
  }
  // The technician's own note exists for a cancellation only; a move rides
  // the push (the calendar is the technician's record of the new time).
  const s = i.staffTpl;
  if (i.kind === 'cancelled' && s?.enabled && i.staff) {
    if (s.email && i.staff.email) out.push({ to: 'staff', channel: 'email', recipient: i.staff.email });
    if (s.sms && i.staff.phone && !vn) out.push({ to: 'staff', channel: 'sms', recipient: i.staff.phone });
  }
  return out;
}

/** The owner's push: who did it, which visit, when. */
export function changePushText(i: {
  kind: 'cancelled' | 'rescheduled';
  vi: boolean;
  customer: string;
  service: string;
  when: string;
  /** For a move: where it was. */
  from?: string;
  by?: 'staff' | 'customer' | 'ai' | null;
  byName?: string | null;
}): { title: string; body: string } {
  const who = i.by === 'customer' ? (i.vi ? 'Khách tự huỷ' : 'Customer cancelled')
    : i.by === 'ai' ? (i.vi ? `Huỷ qua ${i.byName || 'trợ lý AI'}` : `Cancelled via ${i.byName || 'AI assistant'}`)
    : i.by === 'staff' ? (i.vi ? `${i.byName || 'Nhân viên'} huỷ` : `Cancelled by ${i.byName || 'staff'}`)
    : (i.vi ? 'Đã huỷ' : 'Cancelled');
  if (i.kind === 'cancelled') {
    return { title: i.vi ? 'Lịch bị huỷ ✕' : 'Booking cancelled ✕', body: `${i.customer} • ${i.service} • ${i.when} • ${who}` };
  }
  return { title: i.vi ? 'Đổi lịch ↔' : 'Booking moved ↔', body: `${i.customer} • ${i.service} • ${i.from ? `${i.from} → ` : ''}${i.when}` };
}
