jest.mock('@prisma/client', () => {
  const actual = jest.requireActual('@prisma/client');
  return {
    ...actual,
    AppointmentStatus: actual.AppointmentStatus?.CONFIRMED ? actual.AppointmentStatus : { PENDING: 'PENDING', ASSIGNED: 'ASSIGNED', ACCEPTED: 'ACCEPTED', CONFIRMED: 'CONFIRMED', ARRIVED: 'ARRIVED', COMPLETED: 'COMPLETED', CANCELLED: 'CANCELLED', NO_SHOW: 'NO_SHOW', REJECTED: 'REJECTED' },
  };
});
import { BookingsService } from './bookings.service';
import { GROUP_NOTICE_DELAY_MS, groupLead, groupSummary } from './group-notice';

/**
 * "Khách đặt đi chung nhiều người thì hệ thống thông báo tới 5 mail và 5 sms"
 * (4 Nov 2026, MT. Hawthorn). A party is told ONCE — one confirmation to the
 * person who booked, one notice to the salon — listing everybody.
 */
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const member = (id: string, first: string, service: string, opts: Row = {}) => ({
  id, tenantId: opts.tenantId ?? 'A', groupId: opts.groupId ?? 'g1', status: opts.status ?? 'CONFIRMED', priceCents: opts.price ?? 3000, currency: 'USD',
  createdAt: new Date(opts.at ?? '2026-11-04T19:37:00Z'), addons: opts.addons ?? [],
  customer: { firstName: first, lastName: null, email: opts.email ?? null, phone: opts.phone ?? null },
  service: { name: service }, assignedStaff: opts.tech ? { firstName: opts.tech, lastName: null } : null,
});

describe('who the party\'s contact is, and what the one message says', () => {
  const party = [
    member('b2', 'Mai', 'Gel X', { tech: 'Kim', at: '2026-11-04T19:37:01Z' }),
    member('b1', 'Thi', 'Manicure & Pedicure', { phone: '+61400000000', tech: 'Lisa', addons: [{ name: 'French tip' }] }),
    member('b3', '', 'Manicure & Pedicure', { at: '2026-11-04T19:37:02Z' }),
  ];
  it('the contact is the member who left a phone or email, wherever she was written', () => {
    expect(groupLead(party)?.id).toBe('b1');
    expect(groupLead([member('x', 'A', 'S'), member('y', 'B', 'S')])?.id).toBe('x');
    expect(groupLead([])).toBeNull();
  });
  it('one summary: how many, each person with services and technician (contact first), the party total', () => {
    const s = groupSummary(party, false);
    expect(s.size).toBe(3);
    expect(s.service).toBe('Group of 3 · Manicure & Pedicure, Gel X');
    expect(s.lineup).toBe('Thi: Manicure & Pedicure + French tip — Lisa · Mai: Gel X — Kim · Guest 3: Manicure & Pedicure');
    expect(s.totalCents).toBe(9000);
    expect(groupSummary(party, true).service).toBe('Nhóm 3 người · Manicure & Pedicure, Gel X');
  });
});

function make(rows: Row[]) {
  const svc = Object.create(BookingsService.prototype) as BookingsService;
  const sent: Array<{ tenantId: string; id: string; group: Row[] | undefined }> = [];
  Object.assign(svc as unknown as Row, {
    logger: { warn: jest.fn(), log: jest.fn() },
    groupNoticeTimers: new Map(),
    prisma: {
      appointment: {
        findMany: jest.fn(async ({ where }: Row) => rows.filter((r) => r.tenantId === where.tenantId && r.groupId === where.groupId && r.status !== where.status.not)),
      },
    },
    sendBookingConfirmation: jest.fn(async (tenantId: string, a: Row, opts: Row = {}) => { sent.push({ tenantId, id: a.id, group: opts.group }); }),
  });
  const S = svc as unknown as { queueGroupConfirmation: (t: string, g: string, ms?: number) => void; sendGroupConfirmation: (t: string, g: string) => Promise<void> };
  return { S, sent };
}

describe('a party of five sends one confirmation, not five', () => {
  afterEach(() => jest.useRealTimers());

  it('five members written one after another → ONE message, after the last, naming all five', async () => {
    jest.useFakeTimers();
    const rows = ['Thi', 'Mai', 'Lan', 'Hoa', 'Vy'].map((n, i) => member(`b${i}`, n, 'Manicure & Pedicure', i === 0 ? { phone: '+61400000000' } : {}));
    const { S, sent } = make(rows);
    for (let i = 0; i < 5; i++) { S.queueGroupConfirmation('A', 'g1'); jest.advanceTimersByTime(1000); }
    expect(sent).toHaveLength(0); // still growing
    jest.advanceTimersByTime(GROUP_NOTICE_DELAY_MS);
    await Promise.resolve(); await Promise.resolve();
    expect(sent).toHaveLength(1);
    expect(sent[0].id).toBe('b0');
    expect(sent[0].group).toHaveLength(5);
  });

  it('a cancelled member is left out; a party reduced to one is an ordinary confirmation', async () => {
    const rows = [member('b1', 'Thi', 'Mani', { phone: '+1' }), member('b2', 'Mai', 'Pedi', { status: 'CANCELLED' })];
    const { S, sent } = make(rows);
    await S.sendGroupConfirmation('A', 'g1');
    expect(sent).toEqual([{ tenantId: 'A', id: 'b1', group: undefined }]);
  });

  it('cross-tenant: another salon\'s appointments under the same group id are never read or listed', async () => {
    const rows = [
      member('a1', 'Thi', 'Mani', { phone: '+1', tenantId: 'A' }), member('a2', 'Mai', 'Pedi', { tenantId: 'A' }),
      member('z1', 'Intruder', 'Gel', { phone: '+2', tenantId: 'B' }),
    ];
    const { S, sent } = make(rows);
    await S.sendGroupConfirmation('A', 'g1');
    expect(sent).toHaveLength(1);
    expect(sent[0].group!.map((r) => r.id)).toEqual(['a1', 'a2']);
    await S.sendGroupConfirmation('B', 'g1');
    expect(sent[1]).toEqual({ tenantId: 'B', id: 'z1', group: undefined });
  });

  it('two salons\' parties do not share a timer', async () => {
    jest.useFakeTimers();
    const rows = [member('a1', 'Thi', 'Mani', { phone: '+1', tenantId: 'A' }), member('z1', 'Bea', 'Gel', { phone: '+2', tenantId: 'B' })];
    const { S, sent } = make(rows);
    S.queueGroupConfirmation('A', 'g1');
    S.queueGroupConfirmation('B', 'g1');
    jest.advanceTimersByTime(GROUP_NOTICE_DELAY_MS + 1);
    await Promise.resolve(); await Promise.resolve();
    expect(sent.map((x) => x.tenantId).sort()).toEqual(['A', 'B']);
  });
});

describe('person by person for the email and the text', () => {
  it('main service with its technician, extra services with theirs, add-ons apart; contact first', async () => {
    const { visitPeople } = await import('./group-notice');
    const rows = [
      member('b2', 'Mai', 'Gel X', { tech: 'Kim' }),
      member('b1', 'Thi', 'Manicure', { phone: '+1', tech: 'Lisa', addons: [{ kind: 'service', name: 'Nail Design', staffMemberId: 's9' }, { kind: 'addon', name: 'French tip' }] }),
    ];
    expect(visitPeople(rows as never, new Map([['s9', 'Anna Tran']]), false)).toEqual([
      { name: 'Thi', lines: [{ service: 'Manicure', tech: 'Lisa' }, { service: 'Nail Design', tech: 'Anna Tran' }], addons: 'French tip' },
      { name: 'Mai', lines: [{ service: 'Gel X', tech: 'Kim' }] },
    ]);
  });
});
