import { floorSummary, fmtTurns, LONG_WAIT_MIN, techColor, techsOn, type BoardData, type BoardWalkIn } from './walkin-floor';

/** The numbers on top of the walk-in board, and who sits in which tech's column. */
const ago = (m: number) => new Date(Date.now() - m * 60000).toISOString();
const walk = (id: string, o: Partial<BoardWalkIn> = {}): BoardWalkIn => ({
  id, customerName: id, partySize: 1, status: 'WAITING', createdAt: ago(1), assignedAt: null, station: null, customerId: null,
  items: [], service: null, assignedStaff: null, ...o,
});
const staff = [
  { id: 'kim', name: 'Kim', turns: 2, busy: false, nextUp: true },
  { id: 'tina', name: 'Tina', turns: 3, busy: true, nextUp: false, busyFor: 10 },
  { id: 'jen', name: 'Jenny', turns: 2.5, busy: true, nextUp: false },
];

describe('the floor strip', () => {
  const board: BoardData = {
    staff, nextUpStaffId: 'kim',
    waiting: [walk('anna', { createdAt: ago(LONG_WAIT_MIN + 2) }), walk('grace', { createdAt: ago(3) })],
    serving: [
      walk('jess', { status: 'SERVING', assignedStaff: { id: 'tina', firstName: 'Tina', lastName: null } }),
      walk('mai', { status: 'SERVING', phase: 'BETWEEN', assignedAt: ago(4) }),
    ],
  };
  it('counts waiting, in a chair, between parts and free techs', () => {
    const s = floorSummary(board);
    expect(s).toMatchObject({ waiting: 2, inChair: 1, between: 1, free: 1 });
    expect(s.next?.name).toBe('Kim');
  });
  it('flags the longest wait only once it is too long', () => {
    expect(floorSummary(board).longest?.w.id).toBe('anna');
    expect(floorSummary({ ...board, waiting: [walk('x', { createdAt: ago(2) })] }).longest).toBeNull();
  });
});

describe('who is on a ticket', () => {
  it('hands and feet with two techs appear in both columns', () => {
    const w = walk('n', { status: 'SERVING', legs: [
      { legId: 'h', status: 'SERVING', staffId: 'kim', names: [], zone: 'HAND', lineIds: ['1'] },
      { legId: 'f', status: 'SERVING', staffId: 'tina', names: [], zone: 'FOOT', lineIds: ['2'] },
    ] });
    expect(techsOn(w).sort()).toEqual(['kim', 'tina']);
  });
  it('a ticket between parts belongs to nobody yet', () => {
    expect(techsOn(walk('b', { phase: 'BETWEEN', assignedStaff: { id: 'kim', firstName: 'Kim', lastName: null } }))).toEqual([]);
  });
  it('a plain ticket belongs to its assigned tech', () => {
    expect(techsOn(walk('p', { status: 'SERVING', assignedStaff: { id: 'jen', firstName: 'Jenny', lastName: null } }))).toEqual(['jen']);
  });
});

describe('small things', () => {
  it('half turns read as ½', () => { expect(fmtTurns(2.5)).toBe('2½'); expect(fmtTurns(0.5)).toBe('½'); expect(fmtTurns(3)).toBe('3'); });
  it('each tech keeps one colour', () => { expect(techColor(staff, 'tina')).toBe(techColor(staff, 'tina')); expect(techColor(staff, 'kim')).not.toBe(techColor(staff, 'tina')); });
});

describe('Walk-in 2.0 — one ticket, one place', () => {
  const ago2 = (m: number) => new Date(Date.now() - m * 60000).toISOString();
  const w2 = (id: string, o: Partial<BoardWalkIn> = {}): BoardWalkIn => ({
    id, customerName: id, partySize: 1, status: 'SERVING', createdAt: ago2(30), assignedAt: ago2(20), station: null, customerId: null,
    items: [], service: null, assignedStaff: { id: 'kim', firstName: 'Kim', lastName: null }, ...o,
  });
  it('waiting to pay is not "in a chair"; a tech on a break is not free; missing services are counted', () => {
    const b: BoardData = {
      waiting: [], nextUpStaffId: 'kim', today: { count: 18, serviceCents: 124800 },
      serving: [
        w2('chair', { items: [{ lineId: '1', name: 'Gel', priceCents: 3500 }] }),
        w2('pay1', { awaitingPayment: true }),
        w2('pay2', { awaitingPayment: true, items: [{ lineId: '2', name: 'Pedi', priceCents: 4500 }] }),
      ],
      staff: [
        { id: 'kim', name: 'Kim', turns: 2, busy: true, nextUp: false },
        { id: 'tina', name: 'Tina', turns: 3, busy: false, nextUp: true },
        { id: 'jen', name: 'Jen', turns: 3, busy: false, nextUp: false, onBreak: true },
      ],
    };
    expect(floorSummary(b)).toMatchObject({ inChair: 1, toPay: 2, missing: 1, free: 1, onBreak: 1, doneCount: 18, doneCents: 124800 });
  });
  it('the turn line follows the rules\' order; state reads busy, break, request, a booking soon', async () => {
    const { turnLine, techState, ticketTech } = await import('./walkin-floor');
    const now = Date.parse('2026-10-17T20:00:00Z');
    const line = turnLine([
      { id: 'a', name: 'A', turns: 3, busy: false, nextUp: false, rank: 2 },
      { id: 'b', name: 'B', turns: 1, busy: false, nextUp: true, rank: 1 },
      { id: 'c', name: 'C', turns: 3, busy: false, nextUp: false, onBreak: true, rank: null },
    ]);
    expect(line.map((s) => s.id)).toEqual(['b', 'a', 'c']);
    expect(techState({ id: 'x', name: 'X', turns: 0, busy: true, nextUp: false, busyFor: 12, nextBookingAt: '2026-10-17T20:45:00Z' }, now)).toEqual({ kind: 'busy', busyFor: 12, bookingSoon: '2026-10-17T20:45:00Z' });
    expect(techState({ id: 'x', name: 'X', turns: 0, busy: false, nextUp: false, nextBookingAt: '2026-10-17T23:45:00Z' }, now).bookingSoon).toBeNull();
    expect(techState({ id: 'x', name: 'X', turns: 0, busy: false, nextUp: false, manualOnly: true }, now).kind).toBe('request');
    expect(ticketTech(w2('t', { legs: [
      { legId: 'h', status: 'DONE', staffId: 'kim', names: [], zone: 'HAND', lineIds: ['1'] },
      { legId: 'f', status: 'DONE', staffId: 'tina', names: [], zone: 'FOOT', lineIds: ['2'] },
    ] }))).toBe('tina');
  });
});

describe('a ticket\'s story', () => {
  it('came in, parts started and finished in order, then waiting to pay', async () => {
    const { ticketTimeline } = await import('./walkin-floor');
    const ev = ticketTimeline({
      createdAt: '2026-10-17T19:00:00Z', arrivedAt: '2026-10-17T18:58:00Z', assignedAt: '2026-10-17T19:05:00Z', status: 'SERVING', awaitingPayment: true,
      legs: [
        { legId: 'f', status: 'DONE', staffId: 'tina', names: ['Pedi'], startedAt: '2026-10-17T19:20:00Z', doneAt: '2026-10-17T20:00:00Z' },
        { legId: 'h', status: 'DONE', staffId: 'kim', names: ['Gel'], startedAt: '2026-10-17T19:05:00Z', doneAt: '2026-10-17T19:40:00Z' },
      ],
    });
    expect(ev.map((e) => `${e.kind}:${e.staffId ?? '-'}`)).toEqual(['in:-', 'start:kim', 'start:tina', 'done:kim', 'done:tina', 'pay:-']);
  });
});
