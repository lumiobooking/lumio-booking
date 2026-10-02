import { StaffRole, UserRole } from '@prisma/client';
import { SearchService } from './search.service';

/**
 * The header search: only the caller's salon, only what their role may open.
 */
type Call = { model: string; where: Record<string, unknown> };

function fake() {
  const calls: Call[] = [];
  const rows: Record<string, unknown[]> = {
    customer: [{ id: 'c1', firstName: 'Anna', lastName: 'Vo', phone: '+16313203255', email: null }],
    appointment: [{ id: 'a1', startTime: new Date('2026-10-02T15:00:00Z'), status: 'CONFIRMED', customer: { firstName: 'Anna', lastName: 'Vo' }, service: { name: 'Gel Manicure' } }],
    service: [{ id: 's1', name: 'Gel Manicure', priceCents: 4400, durationMinutes: 45 }],
    order: [{ id: 'o1', orderNumber: 1042, status: 'PAID', totalCents: 5500, createdAt: new Date() }],
  };
  const model = (m: string) => ({ findMany: async ({ where }: { where: Record<string, unknown> }) => { calls.push({ model: m, where }); return rows[m]; } });
  const prisma = { customer: model('customer'), appointment: model('appointment'), service: model('service'), order: model('order') };
  return { svc: new SearchService(prisma as never), calls };
}
const owner = (tenantId = 't1') => ({ userId: 'u1', email: 'o@x', role: UserRole.SALON_ADMIN, tenantId } as never);

describe('header search', () => {
  it('an owner finds clients, bookings, services — every query pinned to their own salon', async () => {
    const { svc, calls } = fake();
    const r = await svc.search(owner('t1'), 'anna');
    expect(r.customers[0]).toMatchObject({ id: 'c1', name: 'Anna Vo' });
    expect(r.appointments[0]).toMatchObject({ customer: 'Anna Vo', service: 'Gel Manicure' });
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((c) => c.where.tenantId === 't1')).toBe(true);
  });

  it('another salon’s search never carries this salon’s id', async () => {
    const { svc, calls } = fake();
    await svc.search(owner('t2'), 'anna');
    expect(calls.every((c) => c.where.tenantId === 't2')).toBe(true);
  });

  it('a bill number finds the bill', async () => {
    const { svc, calls } = fake();
    const r = await svc.search(owner(), '#1042');
    expect(r.orders[0].orderNumber).toBe(1042);
    expect(calls.find((c) => c.model === 'order')!.where).toMatchObject({ tenantId: 't1', orderNumber: 1042 });
  });

  it('phone digits match however the number was typed', async () => {
    const { svc, calls } = fake();
    await svc.search(owner(), '(631) 320');
    expect(JSON.stringify(calls.find((c) => c.model === 'customer')!.where)).toContain('631320');
  });

  // Needs the generated StaffRole enum (present in CI / deploy; absent from a stale local client).
  const withStaffRoles = (StaffRole as unknown as Record<string, string> | undefined)?.TECHNICIAN ? it : it.skip;
  withStaffRoles('a technician (no admin areas) finds nothing and nothing is queried', async () => {
    const { svc, calls } = fake();
    const r = await svc.search({ userId: 'u2', email: 't@x', role: UserRole.STAFF, staffRole: 'TECHNICIAN', tenantId: 't1' } as never, 'anna');
    expect(r).toEqual({ customers: [], appointments: [], services: [], orders: [] });
    expect(calls).toHaveLength(0);
  });

  it('a Lumio content-support account does not get client data', async () => {
    const { svc, calls } = fake();
    const r = await svc.search({ userId: 'u3', email: 's@x', role: UserRole.SALON_ADMIN, tenantId: 't1', supportSession: true, supportLevel: 'content' } as never, 'anna');
    expect(r.customers).toEqual([]);
    expect(r.appointments).toEqual([]);
    expect(calls.some((c) => c.model === 'customer' || c.model === 'appointment')).toBe(false);
  });

  it('one character or a super admin without a salon → nothing', async () => {
    const { svc, calls } = fake();
    expect((await svc.search(owner(), 'a')).customers).toEqual([]);
    expect((await svc.search({ userId: 'x', email: 'x', role: UserRole.SUPER_ADMIN, tenantId: null } as never, 'anna')).customers).toEqual([]);
    expect(calls).toHaveLength(0);
  });
});
