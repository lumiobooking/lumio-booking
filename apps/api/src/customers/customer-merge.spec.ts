/**
 * Two profiles of one client become one — never touching another salon.
 */
jest.mock('../maintenance/trash.service', () => ({ TrashService: class {} }));
import { CustomersService } from './customers.service';

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function make() {
  const customers: Row[] = [
    { id: 'keep', tenantId: 't1', firstName: 'Linda', lastName: null, email: null, phone: '4705550183', notes: 'acetone allergy', birthDate: null, loyaltyPoints: 120, importedSpentCents: 0, importedVisits: 0, lastVisitAt: new Date('2026-10-01'), referredById: null, smsConsent: false, smsConsentAt: null },
    { id: 'dup', tenantId: 't1', firstName: 'Linda', lastName: 'Tran', email: 'linda@x.com', phone: '4705550183', notes: 'likes almond shape', birthDate: new Date('1990-03-14'), loyaltyPoints: 30, importedSpentCents: 5000, importedVisits: 2, lastVisitAt: new Date('2026-10-15'), referredById: null, smsConsent: true, smsConsentAt: new Date('2026-09-01') },
    { id: 'other', tenantId: 't2', firstName: 'X', lastName: null, email: null, phone: null, notes: null, birthDate: null, loyaltyPoints: 0, importedSpentCents: 0, importedVisits: 0, lastVisitAt: null, referredById: null, smsConsent: false, smsConsentAt: null },
  ];
  const rows: Record<string, Row[]> = {
    appointment: [{ tenantId: 't1', customerId: 'dup' }, { tenantId: 't2', customerId: 'dup' }],
    order: [{ tenantId: 't1', customerId: 'dup' }],
    loyaltyTransaction: [{ tenantId: 't1', customerId: 'dup' }],
    customerMemory: [{ tenantId: 't1', customerId: 'dup' }],
  };
  const wheres: Row[] = [];
  const table = (name: string) => ({
    updateMany: async ({ where, data }: Row) => { wheres.push(where); const hit = (rows[name] ?? []).filter((r) => r.tenantId === where.tenantId && r.customerId === where.customerId); hit.forEach((r) => Object.assign(r, data)); return { count: hit.length }; },
    findFirst: async ({ where }: Row) => (rows[name] ?? []).find((r) => r.tenantId === where.tenantId && r.customerId === where.customerId) ?? null,
    deleteMany: async ({ where }: Row) => { rows[name] = (rows[name] ?? []).filter((r) => !(r.tenantId === where.tenantId && r.customerId === where.customerId)); return {}; },
  });
  const customer = {
    findFirst: async ({ where }: Row) => customers.find((c) => c.id === where.id && c.tenantId === where.tenantId) ?? null,
    updateMany: async ({ where, data }: Row) => { wheres.push(where); customers.filter((c) => c.tenantId === where.tenantId && (where.id ? c.id === where.id : c.referredById === where.referredById)).forEach((c) => Object.assign(c, data)); return { count: 1 }; },
    deleteMany: async ({ where }: Row) => { wheres.push(where); const i = customers.findIndex((c) => c.id === where.id && c.tenantId === where.tenantId); if (i >= 0) customers.splice(i, 1); return { count: 1 }; },
  };
  const tx: Row = { customer };
  for (const m of ['appointment', 'walkIn', 'order', 'heldBill', 'feedback', 'feedbackRequest', 'feedbackCase', 'clientFormEntry', 'clientFormLink', 'messengerThread', 'loyaltyTransaction', 'aiSession', 'aiCallbackTask', 'customerMemory']) tx[m] = table(m);
  const prisma = { customer, $transaction: async (fn: (t: Row) => Promise<unknown>) => fn(tx) };
  const audits: Row[] = [];
  const svc = new CustomersService(prisma as never, { log: async (a: Row) => { audits.push(a); } } as never, {} as never);
  (svc as unknown as Row).getById = async (_u: unknown, id: string) => customers.find((c) => c.id === id);
  return { svc, customers, rows, wheres, audits };
}
const admin = { userId: 'u1', tenantId: 't1', role: 'SALON_ADMIN' } as never;

describe('merging two profiles of one client', () => {
  it('moves her history, fills the blanks, adds the points, removes the duplicate', async () => {
    const { svc, customers, rows, audits } = make();
    const kept = await svc.merge(admin, 'keep', 'dup') as Row;
    expect(customers.find((c) => c.id === 'dup')).toBeUndefined();
    expect(rows.appointment[0].customerId).toBe('keep');
    expect(rows.appointment[1].customerId).toBe('dup'); // another salon's row: untouched
    expect(rows.order[0].customerId).toBe('keep');
    expect(rows.customerMemory[0].customerId).toBe('keep');
    expect(kept).toMatchObject({ lastName: 'Tran', email: 'linda@x.com', loyaltyPoints: 150, importedSpentCents: 5000, importedVisits: 2, smsConsent: true });
    expect(kept.notes).toBe('acetone allergy\nlikes almond shape');
    expect(kept.lastVisitAt).toEqual(new Date('2026-10-15'));
    expect(audits[0]).toMatchObject({ action: 'customer.merged', tenantId: 't1', resourceId: 'keep' });
  });
  it("refuses another salon's profile and a merge into itself", async () => {
    const { svc, customers, wheres } = make();
    await expect(svc.merge(admin, 'keep', 'other')).rejects.toThrow(/not found/i);
    await expect(svc.merge(admin, 'keep', 'keep')).rejects.toThrow(/hai hồ sơ/);
    expect(customers).toHaveLength(3);
    expect(wheres).toHaveLength(0);
  });
  it('every write names the salon', async () => {
    const { svc, wheres } = make();
    await svc.merge(admin, 'keep', 'dup');
    for (const w of wheres) expect(w.tenantId).toBe('t1');
  });
});
