import { buildLedger } from './sales-ledger';

const dayOf = (d: Date) => d.toISOString().slice(0, 10);
const bucket = (m: string) => (m === 'CARD' ? 'card' : m === 'CASH' ? 'cash' : 'other');

describe('part refunds in the ledger', () => {
  const orders = [{
    id: 'o1', paidAt: new Date('2026-10-20T15:00:00Z'), discountCents: 0, changeCents: 0, giftCardAppliedCents: 0,
    items: [
      { kind: 'SERVICE', quantity: 1, lineTotalCents: 4500, tipCents: 600, staffMemberId: 'kim' },
      { kind: 'SERVICE', quantity: 1, lineTotalCents: 1500, tipCents: 300, staffMemberId: 'hoa' },
    ],
    tenders: [{ method: 'CARD', amountCents: 6900 }],
  }];
  it("come off that technician's sales and tips on the day the money went back; the visit stands", () => {
    const l = buildLedger({
      orders, appointments: [], paidByTicket: new Set(), dayOf, bucket,
      refunds: [{ at: new Date('2026-10-22T15:00:00Z'), card: true, lines: [{ staffMemberId: 'hoa', kind: 'SERVICE', netCents: 1500, tipCents: 300 }] }],
    });
    const hoa = l.get('hoa')!;
    expect(hoa.serviceCents).toBe(0);
    expect(hoa.tipsCents).toBe(0);
    expect(hoa.cardTipsCents).toBe(0);
    expect(hoa.visits).toBe(1);
    expect(hoa.days['2026-10-20'].serviceCents).toBe(1500);
    expect(hoa.days['2026-10-22'].serviceCents).toBe(-1500);
    expect(l.get('kim')!.serviceCents).toBe(4500);
  });
  it('nothing changes without refunds', () => {
    const l = buildLedger({ orders, appointments: [], paidByTicket: new Set(), dayOf, bucket });
    expect(l.get('hoa')!.serviceCents).toBe(1500);
  });
});
