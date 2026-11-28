import { StaffService } from './staff.service';

function svc(o: { max: number | null; active: number; exempt?: boolean }) {
  const calls: unknown[] = [];
  const prisma = {
    tenant: { findUnique: jest.fn(async () => ({ billingExempt: !!o.exempt, plan: { name: 'Starter', maxStaff: o.max } })) },
    staffMember: { count: jest.fn(async (a: unknown) => { calls.push(a); return o.active; }) },
  };
  const s = new StaffService(prisma as never, { log: jest.fn() } as never, {} as never) as unknown as { assertStaffRoom: (t: string) => Promise<void> };
  return { s, calls };
}

describe('rt256 the plan staff limit', () => {
  it('Starter (5): a sixth active staff member is refused with a clear reason', async () => {
    await expect(svc({ max: 5, active: 5 }).s.assertStaffRoom('t1')).rejects.toThrow(/tối đa 5 nhân viên/);
  });
  it('under the limit, no limit, or a billing-exempt salon: allowed', async () => {
    await expect(svc({ max: 5, active: 4 }).s.assertStaffRoom('t1')).resolves.toBeUndefined();
    await expect(svc({ max: null, active: 40 }).s.assertStaffRoom('t1')).resolves.toBeUndefined();
    await expect(svc({ max: 5, active: 9, exempt: true }).s.assertStaffRoom('t1')).resolves.toBeUndefined();
  });
  it('counts only THIS salon\'s active staff', async () => {
    const { s, calls } = svc({ max: 5, active: 1 });
    await s.assertStaffRoom('t1');
    expect(calls[0]).toEqual({ where: { tenantId: 't1', isActive: true } });
  });
});
