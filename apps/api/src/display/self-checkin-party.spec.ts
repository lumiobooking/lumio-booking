// The enum is read at run time; a machine whose generated client predates it
// must still run this spec.
jest.mock('@prisma/client', () => ({
  ...jest.requireActual('@prisma/client'),
  WalkInStatus: { WAITING: 'WAITING' },
}));
import { DisplayService } from './display.service';

// "How many of you? 2" — each person picks their own services and becomes
// their own ticket, seated on their own technician. The guest carries no
// contact of their own, and a service id from another salon never lands on
// anyone's ticket. Prisma is a fake that answers like a tenant-scoped DB.
const MENU: Record<string, { tenantId: string; id: string; name: string; priceCents: number; discountPercent: number; durationMinutes: number }> = {
  builder: { tenantId: 'tenant-a', id: 'builder', name: 'Builder Extensions', priceCents: 7000, discountPercent: 0, durationMinutes: 60 },
  shape: { tenantId: 'tenant-a', id: 'shape', name: 'Almond, Coffin, Stiletto Shape Extra', priceCents: 500, discountPercent: 0, durationMinutes: 0 },
  pedi: { tenantId: 'tenant-a', id: 'pedi', name: 'Basic Gel Pedicure', priceCents: 5100, discountPercent: 0, durationMinutes: 45 },
  foreign: { tenantId: 'tenant-b', id: 'foreign', name: 'Other salon service', priceCents: 100, discountPercent: 0, durationMinutes: 30 },
};

function makePrisma() {
  const created: Record<string, any>[] = [];
  const serviceWheres: any[] = [];
  return {
    _created: created,
    _serviceWheres: serviceWheres,
    displaySession: { findUnique: jest.fn(async () => ({ tenantId: 'tenant-a' })) },
    service: {
      findMany: jest.fn(async ({ where }: any) => {
        serviceWheres.push(where);
        return Object.values(MENU).filter((s) => s.tenantId === where.tenantId && where.id.in.includes(s.id));
      }),
    },
    walkIn: { create: jest.fn(async ({ data }: any) => { created.push(data); return { id: `w${created.length}` }; }) },
  };
}
const customers = { findOrCreateByContact: jest.fn(async () => ({ id: 'c1' })) };

describe('self check-in for a party', () => {
  it('two people → two tickets, each with their own services and price, each seated', async () => {
    const prisma = makePrisma();
    const walkins = { seatSelfCheckIn: jest.fn(async (_t: string, id: string) => (id === 'w1' ? 'sang' : 'cindy')) };
    const svc = new DisplayService(prisma as any, customers as any, walkins as any);
    const r = await svc.selfCheckIn('TOK', {
      firstName: 'anna', lastName: 'nguy', phone: '5125235123', partySize: 2,
      serviceIds: ['builder', 'shape'],
      guests: [{ firstName: 'Lisa', serviceIds: ['pedi'] }],
    });
    expect(r).toEqual({ ok: true, id: 'w1', queued: false, seated: true, guestIds: ['w2'], guestsSeated: 1 });
    const [anna, lisa] = prisma._created;
    expect(anna).toMatchObject({ tenantId: 'tenant-a', customerName: 'anna nguy', phone: '5125235123', customerId: 'c1', partySize: 2, status: 'WAITING' });
    expect(anna.items.map((i: any) => i.serviceId)).toEqual(['builder', 'shape']);
    expect(anna.items.reduce((s: number, i: any) => s + i.priceCents, 0)).toBe(7500);
    expect(lisa).toMatchObject({ tenantId: 'tenant-a', customerName: 'Lisa', phone: null, customerId: null, partySize: 2, status: 'WAITING' });
    expect(lisa.items.map((i: any) => i.serviceId)).toEqual(['pedi']);
    expect(lisa.items[0].priceCents).toBe(5100);
    expect(lisa.note).toContain('With anna nguy');
    // One party, one groupId — the floor shows them together, the till can bill them together.
    expect(anna.groupId).toMatch(/^ci-/);
    expect(lisa.groupId).toBe(anna.groupId);
    expect(walkins.seatSelfCheckIn).toHaveBeenCalledWith('tenant-a', 'w1');
    expect(walkins.seatSelfCheckIn).toHaveBeenCalledWith('tenant-a', 'w2');
    // One CRM record — the person holding the phone — never one per guest.
    expect(customers.findOrCreateByContact).toHaveBeenCalledTimes(1);
  });

  it('an unnamed guest is "Guest 2", and a guest with nothing picked still gets a ticket', async () => {
    const prisma = makePrisma();
    const svc = new DisplayService(prisma as any, customers as any);
    const r: any = await svc.selfCheckIn('TOK', { firstName: 'Anna', partySize: 2, serviceIds: ['pedi'], guests: [{}] });
    expect(r.guestIds).toEqual(['w2']);
    expect(prisma._created[1]).toMatchObject({ customerName: 'Guest 2', items: [] });
  });

  it('one person stays one ticket — no guests, no party note', async () => {
    const prisma = makePrisma();
    const svc = new DisplayService(prisma as any, customers as any);
    const r = await svc.selfCheckIn('TOK', { firstName: 'Anna', serviceIds: ['pedi'] });
    expect(r).toEqual({ ok: true, id: 'w1', queued: true, seated: false });
    expect(prisma._created).toHaveLength(1);
    expect(prisma._created[0].note).toBeNull();
    expect(prisma._created[0].groupId).toBeNull();
  });

  it('a service id from another salon never lands on any ticket', async () => {
    const prisma = makePrisma();
    const svc = new DisplayService(prisma as any, customers as any);
    await svc.selfCheckIn('TOK', { firstName: 'Anna', serviceIds: ['foreign', 'pedi'], guests: [{ firstName: 'Lisa', serviceIds: ['foreign'] }] });
    for (const w of prisma._serviceWheres) expect(w.tenantId).toBe('tenant-a');
    for (const t of prisma._created) {
      expect(t.tenantId).toBe('tenant-a');
      expect(t.items.some((i: any) => i.serviceId === 'foreign')).toBe(false);
    }
    expect(prisma._created[0].items.map((i: any) => i.serviceId)).toEqual(['pedi']);
    expect(prisma._created[1].items).toEqual([]);
  });
});
