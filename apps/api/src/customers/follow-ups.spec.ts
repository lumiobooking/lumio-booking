/**
 * A real-estate office's call-backs: due today or overdue, not closed, most
 * overdue first — and one morning push per office, to that office only.
 */
import { dueFollowUps, followUpPush, todayIn } from './follow-ups';
import { LeadFollowUpScheduler } from './follow-up.scheduler';

const rows = [
  { id: 'a', firstName: 'Anna', lastName: null, phone: '1', industryFields: { stage: 'viewing', nextStep: '2026-10-07' } },
  { id: 'b', firstName: 'Bo', lastName: 'Le', phone: null, industryFields: { stage: 'contacted', nextStep: '2026-10-01' } },
  { id: 'c', firstName: 'Cu', lastName: null, phone: null, industryFields: { stage: 'won', nextStep: '2026-09-01' } },
  { id: 'd', firstName: 'Di', lastName: null, phone: null, industryFields: { nextStep: '2026-10-09' } },
  { id: 'e', firstName: 'Em', lastName: null, phone: null, industryFields: {} },
];

describe('who to call', () => {
  it('today and overdue, not closed, most overdue first', () => {
    const list = dueFollowUps(rows, '2026-10-07');
    expect(list.map((x) => [x.id, x.overdueDays])).toEqual([['b', 6], ['a', 0]]);
    expect(list[0].name).toBe('Bo Le');
  });
  it('the push says how many, and how many are late', () => {
    expect(followUpPush(dueFollowUps(rows, '2026-10-07'), true)).toEqual({ title: '📞 2 khách cần gọi lại hôm nay', body: 'Bo Le, Anna · 1 đã quá hạn' });
    expect(followUpPush([], false)).toBeNull();
  });
  it('"today" is the office’s own date', () => {
    expect(todayIn('America/Los_Angeles', new Date('2026-10-07T05:00:00Z'))).toBe('2026-10-06');
    expect(todayIn('Asia/Ho_Chi_Minh', new Date('2026-10-07T05:00:00Z'))).toBe('2026-10-07');
  });
});

describe('the morning push, per office', () => {
  it('only real-estate offices, after 8:00 their time, once a day, to their own devices', async () => {
    const settings = new Map<string, unknown>();
    const prisma: any = { // eslint-disable-line @typescript-eslint/no-explicit-any
      setting: {
        findMany: jest.fn(async () => [{ tenantId: 'RE', value: { key: 'REAL_ESTATE' } }, { tenantId: 'NAIL', value: { key: 'NAIL' } }]),
        findUnique: jest.fn(async ({ where }: any) => (settings.has(where.tenantId_key.tenantId) ? { value: settings.get(where.tenantId_key.tenantId) } : null)), // eslint-disable-line @typescript-eslint/no-explicit-any
        upsert: jest.fn(async ({ where, create }: any) => { settings.set(where.tenantId_key.tenantId, create.value); return {}; }), // eslint-disable-line @typescript-eslint/no-explicit-any
      },
      tenant: { findUnique: jest.fn(async ({ where }: any) => ({ timezone: 'Asia/Ho_Chi_Minh', businessType: where.id === 'RE' ? 'REAL_ESTATE' : 'SALON', market: 'VN' })) }, // eslint-disable-line @typescript-eslint/no-explicit-any
    };
    const customers = { followUpsForTenant: jest.fn(async () => ({ today: '2026-10-07', items: dueFollowUps(rows, '2026-10-07') })) };
    const push = { sendToTenant: jest.fn(async () => undefined) };
    const s = new LeadFollowUpScheduler(prisma, customers as never, push as never);
    expect(await s.tick(new Date('2026-10-07T00:30:00Z'))).toBe(0); // 7:30 in Vietnam — too early
    expect(await s.tick(new Date('2026-10-07T02:00:00Z'))).toBe(1);
    expect(await s.tick(new Date('2026-10-07T03:00:00Z'))).toBe(0); // once a day
    expect(push.sendToTenant).toHaveBeenCalledTimes(1);
    expect((push.sendToTenant.mock.calls[0] as unknown[])[0]).toBe('RE');
    expect(customers.followUpsForTenant).not.toHaveBeenCalledWith('NAIL', expect.anything());
  });
});
