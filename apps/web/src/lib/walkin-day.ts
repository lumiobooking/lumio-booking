/**
 * Walk-in 2.0, step 3 — the end-of-day review on the web side: its shape,
 * the reason labels, and the spreadsheet export. Pure (tested in walkin-day.spec.ts).
 */

export interface DayIssue { id: string; kind: 'open' | 'unpaid' | 'no_service'; name: string; staffId: string | null; amountCents: number; since: string }
export interface DayTech { staffId: string; name: string; turns: number; requested: number; skips: number; overrides: number; moneyCents: number }
export interface DayReview {
  day: string; timezone: string;
  closed: { at: string; by: string | null; note: string | null } | null;
  issues: DayIssue[];
  totals: { tickets: number; done: number; cancelled: number; noShows: number; serviceCents: number; avgWaitMin: number | null; longestWaitMin: number | null };
  closedUnpaid: { walkInId: string; reason: string | null; note: string | null; at: string; userId: string | null }[];
  overrides: { walkInId: string; suggested: string | null; chosen: string | null; reason: string | null; at: string; userId: string | null }[];
  staff: { id: string; name: string }[];
  users: { id: string; name: string }[];
  techs: DayTech[];
}

export const CLOSE_REASON_LABEL: Record<string, { vi: string; en: string }> = {
  paid_elsewhere: { vi: 'Đã thu ở máy khác', en: 'Paid on another machine' },
  pay_later: { vi: 'Khách trả sau', en: 'Pays later' },
  free_redo: { vi: 'Miễn phí / làm lại', en: 'Free / redo' },
  mistake: { vi: 'Tạo nhầm', en: 'Created by mistake' },
  other: { vi: 'Khác', en: 'Other' },
};
export const OVERRIDE_REASON_LABEL: Record<string, { vi: string; en: string }> = {
  customer_request: { vi: 'Khách yêu cầu', en: 'Customer asked' },
  specialist: { vi: 'Thợ chuyên dịch vụ này', en: 'Specialist for it' },
  tech_yielded: { vi: 'Thợ gợi ý nhường lượt', en: 'Suggested tech passed' },
  other: { vi: 'Khác', en: 'Other' },
};

/** One CSV cell row, quoted the way spreadsheets expect. */
export function csvLine(cells: (string | number | null | undefined)[]): string {
  return cells.map((c) => {
    const s = c == null ? '' : String(c);
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(',');
}

const money = (cents: number) => (cents / 100).toFixed(2);

/** The whole review as one spreadsheet: totals, tickets to sort out, technicians, overrides, closed without payment. */
export function dayCsv(d: DayReview, o: { staffName: (id: string | null) => string; userName: (id: string | null) => string; vi: boolean; currency: string }): string {
  const L = (a: string, b: string) => (o.vi ? a : b);
  const rows: string[] = [];
  rows.push(csvLine([L('Đối soát walk-in', 'Walk-in review'), d.day, d.closed ? L('đã chốt', 'signed off') : L('chưa chốt', 'not signed off'), d.closed?.note ?? '']));
  rows.push('');
  rows.push(csvLine([L('Phiếu', 'Tickets'), L('Xong', 'Done'), L('Huỷ/bỏ về', 'Cancelled'), L('Vắng mặt', 'No-shows'), `${L('Tiền dịch vụ', 'Service money')} (${o.currency})`, L('Chờ TB (phút)', 'Avg wait (min)'), L('Chờ lâu nhất (phút)', 'Longest wait (min)')]));
  rows.push(csvLine([d.totals.tickets, d.totals.done, d.totals.cancelled, d.totals.noShows, money(d.totals.serviceCents), d.totals.avgWaitMin ?? '', d.totals.longestWaitMin ?? '']));
  rows.push('');
  rows.push(csvLine([L('Phiếu cần xử lý', 'Tickets to sort out')]));
  rows.push(csvLine([L('Khách', 'Customer'), L('Thợ', 'Tech'), L('Từ', 'Since'), `${L('Số tiền', 'Amount')} (${o.currency})`, L('Vấn đề', 'Issue')]));
  for (const i of d.issues) rows.push(csvLine([i.name, o.staffName(i.staffId), i.since, money(i.amountCents), i.kind]));
  rows.push('');
  rows.push(csvLine([L('Thợ', 'Technician'), L('Tua', 'Turns'), 'Request', L('Bỏ lượt', 'Skips'), L('Quầy đổi', 'Overrides'), `${L('Dịch vụ', 'Services')} (${o.currency})`]));
  for (const t of d.techs) rows.push(csvLine([t.name, t.turns, t.requested, t.skips, t.overrides, money(t.moneyCents)]));
  rows.push('');
  rows.push(csvLine([L('Quầy chọn thợ khác gợi ý', 'Desk overrides'), L('Máy gợi ý', 'Suggested'), L('Quầy chọn', 'Chosen'), L('Lý do', 'Reason'), L('Người chọn', 'By')]));
  for (const x of d.overrides) rows.push(csvLine([x.at, o.staffName(x.suggested), o.staffName(x.chosen), x.reason ? (OVERRIDE_REASON_LABEL[x.reason]?.[o.vi ? 'vi' : 'en'] ?? x.reason) : '', o.userName(x.userId)]));
  rows.push('');
  rows.push(csvLine([L('Đóng không thu tiền', 'Closed without payment'), L('Lý do', 'Reason'), L('Ghi chú', 'Note'), L('Người đóng', 'By')]));
  for (const c of d.closedUnpaid) rows.push(csvLine([c.at, CLOSE_REASON_LABEL[c.reason ?? 'other']?.[o.vi ? 'vi' : 'en'] ?? c.reason, c.note ?? '', o.userName(c.userId)]));
  return rows.join('\n') + '\n';
}
