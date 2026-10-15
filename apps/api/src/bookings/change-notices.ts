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
  /**
   * The salon itself — the same mailbox and phone, and the same two switches,
   * that get the "new booking" alert (Settings → Notifications → "Email the
   * salon", "SMS the salon"). A salon that wants to hear about a booking wants
   * to hear about its cancellation; one that turned the alert off is left alone.
   */
  owner?: { email: string | null; phone: string | null; emailOn: boolean; smsOn: boolean } | null;
}

export interface ChangeNoticeTarget { to: 'customer' | 'staff' | 'owner'; channel: 'email' | 'sms'; recipient: string }

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
  const o = i.owner;
  if (o) {
    if (o.emailOn && o.email) out.push({ to: 'owner', channel: 'email', recipient: o.email });
    if (o.smsOn && o.phone && !vn) out.push({ to: 'owner', channel: 'sms', recipient: o.phone });
  }
  return out;
}

/**
 * The owner's written copy — a work note, not a courtesy: who, what, when,
 * by whom, and (for a move) from where. Built here, not from a template,
 * because the salon has no template for its own alerts and the new-booking
 * alert is built the same way.
 */
export function ownerNoticeText(i: {
  kind: 'cancelled' | 'rescheduled';
  vi: boolean;
  salon: string;
  customer: string;
  phone: string;
  service: string;
  staff: string;
  when: string;
  from?: string;
  by?: 'staff' | 'customer' | 'ai' | null;
  byName?: string | null;
}): { subject: string; body: string; sms: string } {
  const push = changePushText({ kind: i.kind, vi: i.vi, customer: i.customer, service: i.service, when: i.when, from: i.from, by: i.by, byName: i.byName });
  const lines = i.vi
    ? [
      i.kind === 'cancelled' ? 'Một lịch hẹn vừa bị huỷ:' : 'Một lịch hẹn vừa được dời:',
      '',
      `Khách: ${i.customer}${i.phone ? ` · ${i.phone}` : ''}`,
      `Dịch vụ: ${i.service}`,
      `Thợ: ${i.staff}`,
      i.kind === 'rescheduled' && i.from ? `Giờ cũ: ${i.from}` : null,
      `${i.kind === 'rescheduled' ? 'Giờ mới' : 'Giờ hẹn'}: ${i.when}`,
      `Ai thực hiện: ${push.body.split(' • ').pop() ?? ''}`,
      '',
      i.salon,
    ]
    : [
      i.kind === 'cancelled' ? 'An appointment was just cancelled:' : 'An appointment was just moved:',
      '',
      `Client: ${i.customer}${i.phone ? ` · ${i.phone}` : ''}`,
      `Service: ${i.service}`,
      `Technician: ${i.staff}`,
      i.kind === 'rescheduled' && i.from ? `Was: ${i.from}` : null,
      `${i.kind === 'rescheduled' ? 'Now' : 'Time'}: ${i.when}`,
      `By: ${push.body.split(' • ').pop() ?? ''}`,
      '',
      i.salon,
    ];
  return {
    subject: `${push.title.replace(/ [✕↔]$/, '')} — ${i.customer} · ${i.when}`,
    body: lines.filter((l) => l !== null).join('\n'),
    sms: `${i.salon}: ${push.body}`,
  };
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
