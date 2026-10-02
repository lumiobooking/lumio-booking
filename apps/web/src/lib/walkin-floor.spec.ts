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
