/** Chia tua, the week in numbers: the report counts what the floor counted, per day, per technician. */
import { DEFAULT_TURN_RULES } from './turn-rules';
import { turnReport, weekOf } from './turn-report';
import { TicketLike } from './walkin-legs';

const dayOf = (d: Date) => d.toISOString().slice(0, 10);
const item = (staffId: string, legId: string, price: number, extra: Record<string, unknown> = {}) => ({ lineId: `l-${legId}`, serviceId: 'svc', name: 'Gel', priceCents: price, staffId, legId, zone: 'HAND', legStatus: 'DONE', doneAt: '2026-10-06T18:00:00Z', turnValue: 1, ...extra });
const done = (id: string, items: Record<string, unknown>[], doneAt = '2026-10-06T18:00:00Z'): TicketLike => ({ id, status: 'DONE', assignedStaffId: null, createdAt: doneAt, doneAt, items } as unknown as TicketLike);

describe('turnReport', () => {
  it('adds up legs, bookings, corrections and skips inside the range, per technician', () => {
    const tickets = [
      done('w1', [item('kim', 'a', 3000), item('lisa', 'b', 4500, { zone: 'FOOT' })]),
      done('w2', [item('kim', 'c', 2000, { pinned: true, doneAt: '2026-10-07T18:00:00Z' })], '2026-10-07T18:00:00Z'),
      done('w3', [item('kim', 'd', 9000, { doneAt: '2026-10-12T18:00:00Z' })], '2026-10-12T18:00:00Z'), // next week
      { id: 'w4', status: 'SERVING', assignedStaffId: null, createdAt: '2026-10-07T18:00:00Z', doneAt: null, items: [item('lisa', 'e', 5000, { legStatus: 'SERVING', doneAt: null })] } as unknown as TicketLike,
    ];
    const appts = [
      { assignedStaffId: 'lisa', completedAt: '2026-10-08T15:00:00Z', priceCents: 6000, turnValue: 0.5 },
      { assignedStaffId: 'lisa', completedAt: '2026-10-08T16:00:00Z', priceCents: 6000, seated: true }, // on the floor already: not twice
      { assignedStaffId: null, completedAt: '2026-10-08T16:00:00Z', priceCents: 100 },
    ];
    const adjustments = [{ staffId: 'kim', delta: -0.5, day: '2026-10-07' }, { staffId: 'kim', delta: 1, createdAt: '2026-10-13T19:00:00Z' }];
    const skips = [{ staffId: 'lisa', at: '2026-10-09T10:00:00Z' }];
    const r = turnReport(tickets, appts, adjustments, skips, weekOf('2026-10-07'), { ...DEFAULT_TURN_RULES, appointmentWeight: 'BY_SERVICE' }, dayOf);
    expect(r.from).toBe('2026-10-05'); expect(r.to).toBe('2026-10-11');
    expect(r.techs).toEqual([
      expect.objectContaining({ staffId: 'lisa', turns: 1.5, legs: 1, bookings: 1, requested: 0, skips: 1, moneyCents: 10500, days: ['2026-10-06', '2026-10-08'], perTurnCents: 7000 }),
      expect.objectContaining({ staffId: 'kim', turns: 1.5, legs: 2, bookings: 0, requested: 1, adjustments: -0.5, moneyCents: 5000, days: ['2026-10-06', '2026-10-07'], perTurnCents: 3333 }),
    ]);
    expect(r.totals).toEqual({ turns: 3, moneyCents: 15500, requested: 1, skips: 1 });
    expect(r.spread).toBe(0);
  });
  it('an empty range is an empty report; the week runs Monday to Sunday', () => {
    const r = turnReport([], [], [], [], weekOf('2026-10-11'), DEFAULT_TURN_RULES, dayOf);
    expect(r).toEqual({ from: '2026-10-05', to: '2026-10-11', techs: [], totals: { turns: 0, moneyCents: 0, requested: 0, skips: 0 }, spread: 0 });
    expect(weekOf('2026-10-05')).toEqual({ from: '2026-10-05', to: '2026-10-11' });
    expect(weekOf('2026-10-12')).toEqual({ from: '2026-10-12', to: '2026-10-18' });
  });
});
