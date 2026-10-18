jest.mock('../maintenance/trash.service', () => ({ TrashService: class {} }));
import { CustomersService } from './customers.service';

/**
 * "Actually my name is Ngoc, and here's my new number" — after booking or
 * checking in. The desk corrects the visit; the client record follows, inside
 * this salon only.
 */
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
function setup(rows: Row[]) {
  const ci = (a: unknown, b: unknown) => String(a ?? '').toLowerCase() === String(b ?? '').toLowerCase();
  const match = (r: Row, w: Row): boolean => Object.entries(w).every(([k, v]) => {
    if (k === 'NOT') return !match(r, v as Row);
    if (v && typeof v === 'object' && 'equals' in (v as Row)) return ci(r[k], (v as Row).equals);
    if (v && typeof v === 'object' && 'contains' in (v as Row)) return String(r[k] ?? '').includes(String((v as Row).contains));
    return r[k] === v;
  });
  const prisma: any = { // eslint-disable-line @typescript-eslint/no-explicit-any
    customer: {
      findFirst: async ({ where }: Row) => { if (!where.tenantId) throw new Error('unscoped'); return rows.find((r) => match(r, where)) ?? null; },
      findMany: async ({ where }: Row) => { if (!where.tenantId) throw new Error('unscoped'); return rows.filter((r) => match(r, where)); },
      updateMany: async ({ where, data }: Row) => { if (!where.tenantId) throw new Error('unscoped'); rows.filter((r) => match(r, where)).forEach((r) => Object.assign(r, data)); return { count: 1 }; },
      create: async ({ data }: Row) => { const r = { id: `c${rows.length + 1}`, ...data }; rows.push(r); return { id: r.id }; },
    },
    tenant: { findUnique: async () => ({ market: 'US', timezone: 'America/Chicago' }) },
  };
  return new CustomersService(prisma, { log: async () => undefined } as never, {} as never);
}

describe('correcting a visit\'s contact', () => {
  it('corrects the client in place: name, phone, birthday', async () => {
    const rows = [{ id: 'anna', tenantId: 'A', firstName: 'Ana', lastName: null, phone: '5125550101', email: null, birthDate: null }];
    const svc = setup(rows);
    const r = await svc.correctVisitContact('A', 'anna', { firstName: 'Anna', lastName: 'Lee', phone: '512-555-0199', birthDate: '1990-05-01' });
    expect(r).toEqual({ customerId: 'anna', switched: false, emailSkipped: false });
    expect(rows[0]).toEqual(expect.objectContaining({ firstName: 'Anna', lastName: 'Lee', phone: '5125550199' }));
    expect(rows[0].birthDate).toBeInstanceOf(Date);
  });

  it('a phone that is another client\'s moves the visit to that client and renames nobody', async () => {
    const rows = [
      { id: 'anna', tenantId: 'A', firstName: 'Anna', phone: '5125550101', email: null },
      { id: 'mai', tenantId: 'A', firstName: 'Mai', phone: '5125550202', email: null },
    ];
    const svc = setup(rows);
    const r = await svc.correctVisitContact('A', 'anna', { firstName: 'Mai Tran', phone: '(512) 555-0202' });
    expect(r).toEqual({ customerId: 'mai', switched: true, emailSkipped: false });
    expect(rows[0].firstName).toBe('Anna');
    expect(rows[1].firstName).toBe('Mai');
  });

  it('never borrows another client\'s email, and says so', async () => {
    const rows = [
      { id: 'anna', tenantId: 'A', firstName: 'Anna', phone: '5125550101', email: null },
      { id: 'mai', tenantId: 'A', firstName: 'Mai', phone: '5125550202', email: 'mai@x.com' },
    ];
    const svc = setup(rows);
    const r = await svc.correctVisitContact('A', 'anna', { firstName: 'Anna', email: 'MAI@x.com' });
    expect(r.emailSkipped).toBe(true);
    expect(rows[0].email).toBeNull();
  });

  it('only ever reads and writes this salon\'s clients', async () => {
    const rows = [
      { id: 'anna', tenantId: 'A', firstName: 'Anna', phone: '5125550101', email: null },
      { id: 'other', tenantId: 'B', firstName: 'Bea', phone: '5125550303', email: null },
    ];
    const svc = setup(rows);
    // B's client's number typed on A's ticket: A's own client is corrected, B's record is untouched and never linked.
    const r = await svc.correctVisitContact('A', 'anna', { firstName: 'Anna', phone: '5125550303' });
    expect(r.customerId).toBe('anna');
    expect(rows[1]).toEqual({ id: 'other', tenantId: 'B', firstName: 'Bea', phone: '5125550303', email: null });
    // Another salon's client id is not this salon's: a new record of A is made instead.
    const g = await svc.correctVisitContact('A', 'other', { firstName: 'Lisa', phone: '5125550404' });
    expect(g.customerId).not.toBe('other');
    expect(rows.find((x) => x.id === g.customerId)?.tenantId).toBe('A');
  });

  it('a guest with no record gets one once there is a phone, and stays unlinked without one', async () => {
    const rows: Row[] = [];
    const svc = setup(rows);
    expect((await svc.correctVisitContact('A', null, { firstName: 'Lisa' })).customerId).toBeNull();
    const r = await svc.correctVisitContact('A', null, { firstName: 'Lisa', phone: '5125550505' });
    expect(rows).toHaveLength(1);
    expect(r.customerId).toBe(rows[0].id);
    await expect(svc.correctVisitContact('A', null, { firstName: '  ' })).rejects.toThrow(/name/);
  });
});
