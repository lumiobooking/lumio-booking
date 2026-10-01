jest.mock('../maintenance/trash.service', () => ({ TrashService: class {} }));
import { CustomersService } from './customers.service';

/**
 * "Lưu khách" at the till: one phone, one email, and a salon whose customers
 * were saved over months by different screens. The save must never fail on
 * the salon's own (tenantId, email) unique key.
 */
type Row = Record<string, any>;
function setup(rows: Row[]) {
  const ci = (a: unknown, b: unknown) => String(a ?? '').toLowerCase() === String(b ?? '').toLowerCase();
  const match = (r: Row, w: Row): boolean => Object.entries(w).every(([k, v]) => {
    if (k === 'NOT') return !match(r, v as Row);
    if (v && typeof v === 'object' && 'equals' in (v as Row)) return ci(r[k], (v as Row).equals);
    return r[k] === v;
  });
  const prisma: any = {
    customer: {
      findFirst: jest.fn(async ({ where }: Row) => { if (!where.tenantId) throw new Error('unscoped'); return rows.find((r) => match(r, where)) ?? null; }),
      updateMany: jest.fn(async ({ where, data }: Row) => {
        if (data.email && rows.some((r) => r.tenantId === where.tenantId && r.id !== where.id && r.email === data.email)) throw Object.assign(new Error('Unique'), { code: 'P2002' });
        rows.filter((r) => match(r, where)).forEach((r) => Object.assign(r, data)); return { count: 1 };
      }),
      create: jest.fn(async ({ data }: Row) => {
        if (data.email && rows.some((r) => r.tenantId === data.tenantId && r.email === data.email)) throw Object.assign(new Error('Unique'), { code: 'P2002' });
        const r = { id: `c${rows.length + 1}`, ...data }; rows.push(r); return { id: r.id };
      }),
    },
  };
  const audit: any = { log: jest.fn() };
  return { svc: new CustomersService(prisma, audit, {} as never), rows };
}
const owner = { userId: 'u', tenantId: 'A', role: 'SALON_ADMIN' } as any;

describe('quick-adding a customer at the till', () => {
  it('phone matches one customer, email belongs to another: saves, never 500s, keeps the other email intact', async () => {
    const { svc, rows } = setup([
      { id: 'x', tenantId: 'A', firstName: 'Walk-in', phone: '5125235123', email: null },
      { id: 'y', tenantId: 'A', firstName: 'Viet', phone: null, email: 'nguyenviet14546@gmail.com' },
    ]);
    const c = await svc.quickCreate(owner, { firstName: 'A Viet', phone: '5125235123', email: 'nguyenviet14546@gmail.com' });
    expect(c?.id).toBe('x');
    expect(rows.find((r) => r.id === 'x')!.email).toBeNull();
    expect(rows.find((r) => r.id === 'x')!.firstName).toBe('A Viet');
  });

  it('an email saved with capitals long ago is the same person', async () => {
    const { svc, rows } = setup([{ id: 'y', tenantId: 'A', firstName: 'Viet', phone: null, email: 'NguyenViet14546@gmail.com' }]);
    const c = await svc.quickCreate(owner, { firstName: 'A Viet', phone: '5125235123', email: 'nguyenviet14546@gmail.com' });
    expect(c?.id).toBe('y');
    expect(rows).toHaveLength(1);
    expect(rows[0].phone).toBe('5125235123');
  });

  it('the same email in ANOTHER salon is a different customer', async () => {
    const { svc, rows } = setup([{ id: 'b1', tenantId: 'B', firstName: 'Viet', phone: null, email: 'nguyenviet14546@gmail.com' }]);
    const c = await svc.quickCreate(owner, { firstName: 'A Viet', phone: '5125235123', email: 'nguyenviet14546@gmail.com' });
    expect(c?.id).not.toBe('b1');
    expect(rows.filter((r) => r.tenantId === 'A')).toHaveLength(1);
  });
});
