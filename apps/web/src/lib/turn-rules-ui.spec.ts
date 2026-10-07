/** Chia tua: the rules sentence says exactly what the salon chose. */
import { rulesLine } from './turn-rules-ui';

describe('rulesLine', () => {
  it('defaults read like the old floor; each rule changes one clause', () => {
    const d = { mode: 'COUNT' as const, halfBelowCents: 0, tieBreak: 'PRIORITY_LIST' as const, requestWeight: 1 as const, appointmentWeight: 'ONE' as const };
    expect(rulesLine(d, true)).toBe('ít tua nhất đi trước · bằng nhau thì theo ưu tiên & thứ tự danh sách · khách request tính 1 tua · lịch hẹn xong tính 1 tua');
    expect(rulesLine({ ...d, mode: 'MONEY', tieBreak: 'LAST_FINISHED', requestWeight: 0, appointmentWeight: 'NONE' }, false))
      .toBe('lowest service $ goes first · ties: free longest · a request counts 0 · bookings do not count');
  });
});
