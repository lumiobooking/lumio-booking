/** Chia tua: the rules sentence says exactly what the salon chose. */
import { rulesLine } from './turn-rules-ui';

describe('rulesLine', () => {
  it('defaults read like the old floor; each rule changes one clause', () => {
    const d = { mode: 'COUNT' as const, halfBelowCents: 0, tieBreak: 'PRIORITY_LIST' as const, requestWeight: 1 as const, appointmentWeight: 'ONE' as const };
    expect(rulesLine(d, true)).toBe('ít tua nhất đi trước · bằng nhau thì theo ưu tiên & thứ tự danh sách · khách request tính 1 tua · lịch hẹn xong tính 1 tua');
    expect(rulesLine({ ...d, mode: 'MONEY', tieBreak: 'LAST_FINISHED', requestWeight: 0, appointmentWeight: 'NONE' }, false))
      .toBe('lowest service $ goes first · ties: free longest · a request counts 0 · bookings do not count');
  });
  it('break, skip and late rules only appear when they bite', () => {
    const d = { mode: 'COUNT' as const, halfBelowCents: 0, tieBreak: 'PRIORITY_LIST' as const, requestWeight: 1 as const, appointmentWeight: 'ONE' as const };
    expect(rulesLine({ ...d, breakPolicy: 'HOLD', skipPolicy: 'FREE', latePolicy: 'NONE', lateGraceMin: 15 }, true)).toBe(rulesLine(d, true));
    expect(rulesLine({ ...d, breakPolicy: 'BOTTOM', skipPolicy: 'COUNT_AS_TURN', latePolicy: 'PLUS_HALF', lateGraceMin: 10 }, true))
      .toBe('ít tua nhất đi trước · bằng nhau thì theo ưu tiên & thứ tự danh sách · khách request tính 1 tua · lịch hẹn xong tính 1 tua · nghỉ giải lao xong xuống cuối · bỏ khách vẫn tính tua · vào ca trễ quá 10 phút tính thêm ½ tua');
    expect(rulesLine({ ...d, skipPolicy: 'BOTTOM', latePolicy: 'PLUS_ONE' }, false)).toContain('a skip: back of the line · over 15 min late: +1 turn');
    expect(rulesLine({ ...d, reverseServiceIds: ['a', 'b'], newTechDays: 14, newTechBoost: 1, ownerInRotation: false }, true))
      .toContain('2 dịch vụ chia tua ngược · thợ mới 14 ngày đầu được ưu tiên 1 tua · chủ tiệm chỉ nhận khách request');
    expect(rulesLine({ ...d, reverseServiceIds: [], newTechDays: 0, ownerInRotation: true }, true)).toBe(rulesLine(d, true));
  });
});
