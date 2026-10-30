/**
 * "I typed new details on the booking page and it booked the old ones."
 *
 *  - An email already on file with ANOTHER phone no longer pulls the booking
 *    onto that record (its old name, its old phone): the phone typed now is
 *    the booking's contact. The other record is left exactly as it was.
 *  - On the salon's own booking form the name the customer typed is the name
 *    on the visit; the hotline and chat bots still keep the name on file.
 *  - Every lookup stays inside one salon.
 */
import { BookingsService } from './bookings.service';

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function harness(customers: Row[]) {
  const db = customers.map((c) => ({ ...c }));
  let n = 0;
  const seenTenants = new Set<string>();
  const match = (c: Row, w: Row): boolean => Object.entries(w).every(([k, v]) => k === 'OR' ? (v as Row[]).some((o) => match(c, o)) : c[k] === v);
  const tx = {
    customer: {
      findUnique: async ({ where }: Row) => {
        if (where.tenantId_email) { seenTenants.add(where.tenantId_email.tenantId); return db.find((c) => c.tenantId === where.tenantId_email.tenantId && c.email === where.tenantId_email.email) ?? null; }
        return db.find((c) => c.id === where.id) ?? null;
      },
      findFirst: async ({ where }: Row) => { seenTenants.add(where.tenantId); return db.find((c) => match(c, where)) ?? null; },
      update: async ({ where, data }: Row) => { const c = db.find((x) => x.id === where.id)!; Object.assign(c, data); return c; },
      upsert: async ({ where, update, create }: Row) => {
        const c = db.find((x) => x.tenantId === where.tenantId_email.tenantId && x.email === where.tenantId_email.email);
        if (c) { Object.assign(c, update); return c; }
        const r = { id: `new${++n}`, ...create }; db.push(r); return r;
      },
      create: async ({ data }: Row) => { const r = { id: `new${++n}`, email: null, ...data }; db.push(r); return r; },
    },
  };
  const svc = Object.create(BookingsService.prototype) as Row;
  svc.referral = { resolveReferrerId: async () => null };
  svc.normalizedPhone = async (_t: string, raw?: string) => {
    const d = String(raw ?? '').replace(/\D/g, '');
    return d ? `+1${d.slice(-10)}` : null;
  };
  const up = (tenantId: string, dto: Row, typed = true) => svc.upsertCustomer(tx, tenantId, dto, false, typed);
  return { db, up, seenTenants };
}

const old = { id: 'c-old', tenantId: 'lumio', email: 'lumioagency.com@gmail.com', firstName: 'Agency', lastName: 'Lumio', phone: '+15125550100' };

describe('the booking uses the details typed for it', () => {
  it('a remembered email with a NEW phone books under the new phone — the old record is untouched', async () => {
    const { db, up } = harness([old]);
    const c = await up('lumio', { customerFirstName: 'Tina', customerLastName: 'Tran', customerEmail: 'lumioagency.com@gmail.com', customerPhone: '(512) 555-0199' });
    expect(c.id).not.toBe('c-old');
    expect(c).toMatchObject({ firstName: 'Tina', lastName: 'Tran', phone: '+15125550199' });
    expect(db.find((x) => x.id === 'c-old')).toEqual(old);
  });

  it('the same email with the SAME phone is the same customer — with the name they typed now', async () => {
    const { up } = harness([old]);
    const c = await up('lumio', { customerFirstName: 'Agency2', customerLastName: 'New', customerEmail: 'lumioagency.com@gmail.com', customerPhone: '512-555-0100' });
    expect(c.id).toBe('c-old');
    expect(c).toMatchObject({ firstName: 'Agency2', lastName: 'New', phone: '+15125550100' });
  });

  it('a returning phone on the booking form takes the name typed now', async () => {
    const { up } = harness([{ id: 'p1', tenantId: 'lumio', email: null, firstName: 'Mom', lastName: null, phone: '+15125550123' }]);
    const c = await up('lumio', { customerFirstName: 'Lily', customerLastName: 'Ng', customerPhone: '5125550123' });
    expect(c.id).toBe('p1');
    expect(c).toMatchObject({ firstName: 'Lily', lastName: 'Ng' });
  });

  it('the hotline / a chat bot still keeps the name on file (they write down what they heard)', async () => {
    const { up } = harness([{ id: 'p1', tenantId: 'lumio', email: null, firstName: 'Trang', lastName: 'Le', phone: '+15125550123' }]);
    const c = await up('lumio', { customerFirstName: 'Chang', customerPhone: '5125550123' }, false);
    expect(c).toMatchObject({ id: 'p1', firstName: 'Trang', lastName: 'Le' });
  });

  it('never reaches into another salon', async () => {
    const { up, seenTenants, db } = harness([{ ...old, tenantId: 'other-salon' }]);
    const c = await up('lumio', { customerFirstName: 'Tina', customerEmail: 'lumioagency.com@gmail.com', customerPhone: '5125550199' });
    expect(c.tenantId).toBe('lumio');
    expect([...seenTenants]).toEqual(['lumio']);
    expect(db.find((x) => x.tenantId === 'other-salon')!.firstName).toBe('Agency');
  });
});
