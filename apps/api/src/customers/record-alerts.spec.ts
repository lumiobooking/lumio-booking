jest.mock('../maintenance/trash.service', () => ({ TrashService: class {} }));
import { CustomersService } from './customers.service';
import { alertsFor, idList, samePhone } from './record-alerts';

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

describe('record alerts — rules', () => {
  it('matches a number however it was typed', () => {
    expect(samePhone('512-886-8189', '+1 (512) 886 8189')).toBe(true);
    expect(samePhone('0903 123 456', '+84903123456')).toBe(true);
    expect(samePhone('5128868189', '5128868180')).toBe(false);
    expect(samePhone('123', '123')).toBe(false);
  });
  it('lists only customers with a filled warning field of the industry', () => {
    const out = alertsFor('DENTAL', [
      { id: 'a', industryFields: { allergies: 'Penicillin', insurance: 'Delta' } },
      { id: 'b', industryFields: { insurance: 'Delta' } },
      { id: 'c', industryFields: { allergies: '  ' } },
    ]);
    expect(out.map((x) => x.id)).toEqual(['a']);
    expect(out[0].warnings[0].value).toBe('Penicillin');
  });
  it('ids from a query string: clean, unique, capped', () => {
    expect(idList(' a,b , a,,bad id,c ')).toEqual(['a', 'b', 'c']);
    expect(idList(Array.from({ length: 80 }, (_, i) => `x${i}`).join(',')).length).toBe(60);
    expect(idList(undefined)).toEqual([]);
  });
});

describe('record alerts — one salon only', () => {
  function setup() {
    const rows: Row[] = [
      { id: 'p1', tenantId: 'A', phone: '+1 512 886 8189', industryFields: { allergies: 'Latex' } },
      { id: 'p2', tenantId: 'B', phone: '+1 512 886 8189', industryFields: { allergies: 'Other clinic secret' } },
    ];
    const seen: Row[] = [];
    const prisma: Row = {
      customer: {
        findMany: jest.fn(async ({ where }: Row) => {
          seen.push(where);
          if (!where.tenantId) throw new Error('unscoped');
          return rows.filter((r) => r.tenantId === where.tenantId
            && (!where.id || where.id.in.includes(r.id))
            && (!where.phone || r.phone.replace(/\D/g, '').includes(where.phone.contains)));
        }),
      },
      tenant: { findUnique: jest.fn(async () => ({ businessType: 'DENTAL' })) },
      setting: { findUnique: jest.fn(async () => ({ value: { key: 'DENTAL' } })) },
    };
    return { svc: new CustomersService(prisma as never, { log: jest.fn() } as never, {} as never), seen };
  }
  const user = (t: string) => ({ userId: 'u', tenantId: t, role: 'STAFF' } as never);

  it('by phone: this clinic\'s patient, never the other clinic\'s with the same number', async () => {
    const { svc, seen } = setup();
    const out = await svc.recordAlerts(user('A'), { phone: '(512) 886-8189' });
    expect(out.items).toHaveLength(1);
    expect(out.items[0].warnings[0].value).toBe('Latex');
    expect(JSON.stringify(out)).not.toContain('Other clinic');
    expect(seen.every((w) => w.tenantId === 'A')).toBe(true);
  });

  it('by ids: another clinic\'s id returns nothing', async () => {
    const { svc } = setup();
    expect((await svc.recordAlerts(user('A'), { ids: 'p2' })).items).toEqual([]);
    expect((await svc.recordAlerts(user('B'), { ids: 'p1,p2' })).items.map((x) => x.id)).toEqual(['p2']);
  });

  it('nothing typed yet: no query at all', async () => {
    const { svc, seen } = setup();
    expect((await svc.recordAlerts(user('A'), { phone: '512' })).items).toEqual([]);
    expect(seen).toHaveLength(0);
  });
});
