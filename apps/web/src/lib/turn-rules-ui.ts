/** Chia tua — the rules as one sentence the desk can read. */

export interface TurnRules { mode: 'COUNT' | 'MONEY' | 'HYBRID'; halfBelowCents: number; tieBreak: 'PRIORITY_LIST' | 'LAST_FINISHED' | 'CLOCK_IN'; requestWeight: 1 | 0.5 | 0; appointmentWeight: 'ONE' | 'BY_SERVICE' | 'NONE' }

/** One line that says how this salon chooses the next technician. */
export function rulesLine(r: TurnRules, vi: boolean): string {
  const mode = r.mode === 'MONEY' ? (vi ? 'ai làm ít tiền nhất đi trước' : 'lowest service $ goes first')
    : r.mode === 'HYBRID' ? (vi ? `ít tua nhất đi trước, dịch vụ nhỏ tính ½ tua` : 'fewest turns first, small services are ½ a turn')
    : (vi ? 'ít tua nhất đi trước' : 'fewest turns first');
  const tie = r.tieBreak === 'LAST_FINISHED' ? (vi ? 'bằng nhau thì ai rảnh lâu hơn' : 'ties: free longest')
    : r.tieBreak === 'CLOCK_IN' ? (vi ? 'bằng nhau thì ai vào ca sớm hơn' : 'ties: clocked in first')
    : (vi ? 'bằng nhau thì theo ưu tiên & thứ tự danh sách' : 'ties: priority, then list order');
  const req = r.requestWeight === 1 ? (vi ? 'khách request tính 1 tua' : 'a request counts 1') : r.requestWeight === 0.5 ? (vi ? 'khách request tính ½ tua' : 'a request counts ½') : (vi ? 'khách request không tính tua' : 'a request counts 0');
  const appt = r.appointmentWeight === 'ONE' ? (vi ? 'lịch hẹn xong tính 1 tua' : 'a booking counts 1') : r.appointmentWeight === 'BY_SERVICE' ? (vi ? 'lịch hẹn tính theo dịch vụ' : 'a booking counts by service') : (vi ? 'lịch hẹn không tính tua' : 'bookings do not count');
  return `${mode} · ${tie} · ${req} · ${appt}`;
}

