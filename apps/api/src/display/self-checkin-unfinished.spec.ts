jest.mock('@prisma/client', () => ({
  ...jest.requireActual('@prisma/client'),
  WalkInStatus: { WAITING: 'WAITING' },
}));
import { DisplayService, UNFINISHED_NOTE } from './display.service';

// The guest typed her number and name, then walked away from the tablet. The
// kiosk's "Still there?" ran out: she is KEPT — in line, on the paired salon's
// own floor, with a note for the desk — and never seated on a technician by
// itself, because nobody knows yet what she wants.
function makePrisma(tenant: string) {
  const created: Record<string, unknown>[] = [];
  return {
    _created: created,
    displaySession: { findUnique: jest.fn(async () => ({ tenantId: tenant })) },
    service: { findMany: jest.fn(async () => [{ id: 's1', name: 'Pedicure', priceCents: 4500, discountPercent: 0, durationMinutes: 45 }]) },
    walkIn: { create: jest.fn(async ({ data }: any) => { created.push(data); return { id: `w${created.length}` }; }) },
  };
}

describe('kiosk: a guest who stepped away is saved and put in line', () => {
  it('keeps her in WAITING with the desk note, and does not seat her', async () => {
    const prisma = makePrisma('tenant-a');
    const customers = { findOrCreateByContact: jest.fn(async () => ({ id: 'c1' })) };
    const walkins = { seatSelfCheckIn: jest.fn(async () => 'staff-1') };
    const svc = new DisplayService(prisma as any, customers as any, walkins as any);
    const r = await svc.selfCheckIn('TOK', { firstName: 'Viet', phone: '5128868189', unfinished: true });
    expect(r).toMatchObject({ ok: true, queued: true, seated: false });
    expect(walkins.seatSelfCheckIn).not.toHaveBeenCalled();
    expect(prisma._created[0]).toMatchObject({ tenantId: 'tenant-a', status: 'WAITING', customerName: 'Viet', customerId: 'c1' });
    expect(String(prisma._created[0].note)).toContain(UNFINISHED_NOTE);
    // Her contact is saved in the paired salon only.
    expect(customers.findOrCreateByContact).toHaveBeenCalledWith('tenant-a', expect.objectContaining({ firstName: 'Viet', phone: '5128868189' }));
  });

  it('services she had already picked stay on the ticket', async () => {
    const prisma = makePrisma('tenant-a');
    const svc = new DisplayService(prisma as any, { findOrCreateByContact: jest.fn(async () => ({ id: 'c1' })) } as any, { seatSelfCheckIn: jest.fn() } as any);
    await svc.selfCheckIn('TOK', { firstName: 'Viet', serviceIds: ['s1'], unfinished: true });
    expect(prisma._created[0]).toMatchObject({ serviceId: 's1' });
  });

  it('a finished check-in carries no such note and is seated as before', async () => {
    const prisma = makePrisma('tenant-a');
    const walkins = { seatSelfCheckIn: jest.fn(async () => 'staff-1') };
    const svc = new DisplayService(prisma as any, { findOrCreateByContact: jest.fn(async () => ({ id: 'c1' })) } as any, walkins as any);
    await svc.selfCheckIn('TOK', { firstName: 'Viet', serviceIds: ['s1'] });
    expect(String(prisma._created[0].note ?? '')).not.toContain(UNFINISHED_NOTE);
    expect(walkins.seatSelfCheckIn).toHaveBeenCalledWith('tenant-a', 'w1');
  });

  it('cross-tenant: the ticket goes to the salon the TOKEN is paired with, whatever the body says', async () => {
    const prisma = makePrisma('tenant-b');
    const customers = { findOrCreateByContact: jest.fn(async () => ({ id: 'cb' })) };
    const svc = new DisplayService(prisma as any, customers as any);
    await svc.selfCheckIn('TOK-B', { firstName: 'Viet', unfinished: true, tenantId: 'tenant-a' } as any);
    expect(prisma._created[0]).toMatchObject({ tenantId: 'tenant-b' });
    expect(customers.findOrCreateByContact).not.toHaveBeenCalledWith('tenant-a', expect.anything());
  });

  it('no name, nothing saved', async () => {
    const prisma = makePrisma('tenant-a');
    const svc = new DisplayService(prisma as any, { findOrCreateByContact: jest.fn() } as any);
    await expect(svc.selfCheckIn('TOK', { firstName: '  ', unfinished: true })).rejects.toThrow();
    expect(prisma._created).toHaveLength(0);
  });
});
