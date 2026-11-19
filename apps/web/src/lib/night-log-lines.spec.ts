import { describe as describeEvent, type LogEvent } from './night-log-lines';

const base: LogEvent = {
  id: '1', at: '2026-11-18T15:47:00Z', action: '', kind: 'void', by: 'Lan', approvedBy: null, witness: null, table: 'Bàn 7', checkNumber: 148,
  orderNumber: null, amountCents: null, discountCents: null, discountPct: null, method: null, reason: null, name: null, quantity: null, guests: null,
  expectedCents: null, countedCents: null, takeaway: false,
};
const vnd = (c: number) => `${c.toLocaleString('vi-VN')} đ`;

describe('night log lines', () => {
  it('a voided paid bill is an alarm with who approved and why', () => {
    const d = describeEvent({ ...base, action: 'order.voided', orderNumber: 148, amountCents: 1_850_000, approvedBy: 'Minh', reason: 'Khách đổi món' }, true, vnd);
    expect(d.alarm).toBe(true);
    expect(d.title).toBe('Huỷ bill đã thu #148');
    expect(d.amount).toBe('1.850.000 đ');
    expect(d.sub).toBe('Lan · Minh duyệt · Lý do: Khách đổi món');
  });
  it('a short drawer at close is red and says by how much', () => {
    const d = describeEvent({ ...base, action: 'pos.shift_closed', kind: 'shift', amountCents: -1_200_000, countedCents: 12_000_000, expectedCents: 13_200_000, witness: 'Minh' }, true, vnd);
    expect(d.amount).toBe('Thiếu 1.200.000 đ');
    expect(d.amountTone).toBe('bad');
    expect(d.sub).toContain('Minh kiểm két');
  });
  it('a paid bill with a discount shows the percentage', () => {
    const d = describeEvent({ ...base, action: 'restaurant.check_paid', kind: 'money', orderNumber: 146, amountCents: 980_000, discountCents: 420_000, discountPct: 30, method: 'Tiền mặt' }, true, vnd);
    expect(d.icon).toBe('🏷️');
    expect(d.sub).toBe('Tiền mặt · Lan · giảm 30% (420.000 đ)');
  });
});
