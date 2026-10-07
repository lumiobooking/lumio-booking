/** Chia tua — the rules as one sentence the desk can read. */

export interface TurnRules {
  mode: 'COUNT' | 'MONEY' | 'HYBRID'; halfBelowCents: number; tieBreak: 'PRIORITY_LIST' | 'LAST_FINISHED' | 'CLOCK_IN'; requestWeight: 1 | 0.5 | 0; appointmentWeight: 'ONE' | 'BY_SERVICE' | 'NONE';
  /** Phase 2 — optional so an older API answer still renders; the defaults below are the engine's. */
  breakPolicy?: 'HOLD' | 'BOTTOM'; skipPolicy?: 'FREE' | 'COUNT_AS_TURN' | 'BOTTOM'; latePolicy?: 'NONE' | 'PLUS_HALF' | 'PLUS_ONE'; lateGraceMin?: number;
  /** Phase 3 */
  reverseServiceIds?: string[]; newTechDays?: number; newTechBoost?: 0.5 | 1; ownerInRotation?: boolean;
}

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
  const parts = [mode, tie, req, appt];
  if (r.breakPolicy === 'BOTTOM') parts.push(vi ? 'nghỉ giải lao xong xuống cuối' : 'after a break: back of the line');
  if (r.skipPolicy === 'COUNT_AS_TURN') parts.push(vi ? 'bỏ khách vẫn tính tua' : 'a skip still counts a turn');
  else if (r.skipPolicy === 'BOTTOM') parts.push(vi ? 'bỏ khách thì xuống cuối' : 'a skip: back of the line');
  if (r.latePolicy === 'PLUS_HALF' || r.latePolicy === 'PLUS_ONE') parts.push((vi ? `vào ca trễ quá ${r.lateGraceMin ?? 15} phút tính thêm ` : `over ${r.lateGraceMin ?? 15} min late: +`) + (r.latePolicy === 'PLUS_ONE' ? (vi ? '1 tua' : '1 turn') : (vi ? '½ tua' : '½ turn')));
  if (r.reverseServiceIds?.length) parts.push(vi ? `${r.reverseServiceIds.length} dịch vụ chia tua ngược` : `${r.reverseServiceIds.length} services in reverse`);
  if (r.newTechDays) parts.push(vi ? `thợ mới ${r.newTechDays} ngày đầu được ưu tiên ${r.newTechBoost === 1 ? '1' : '½'} tua` : `new techs (${r.newTechDays} days) start ${r.newTechBoost === 1 ? '1' : '½'} turn ahead`);
  if (r.ownerInRotation === false) parts.push(vi ? 'chủ tiệm chỉ nhận khách request' : 'owner takes requests only');
  return parts.join(' · ');
}

