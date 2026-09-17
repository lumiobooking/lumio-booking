import { DisplayService } from './display.service';
import { liveEvents } from '../common/live-events';

// A phone check-in should land ON a technician (the up-next one), not sit
// as a WAITING card until somebody at the desk presses "Giao". And when no
// technician is free — or the seating fails — it must still be queued, never
// lost. Prisma is a fake; the walk-ins service is a fake with one method.
function makePrisma() {
  const created: Record<string, unknown>[] = [];
  return {
    _created: created,
    displaySession: { findUnique: jest.fn(async () => ({ tenantId: 'tenant-a' })) },
    service: { findMany: jest.fn(async () => [{ id: 's1', name: 'Pedicure', priceCents: 4500, discountPercent: 0, durationMinutes: 45 }]) },
    walkIn: { create: jest.fn(async ({ data }: any) => { created.push(data); return { id: 'w1' }; }) },
  };
}
const customers = { findOrCreateByContact: jest.fn(async () => ({ id: 'c1' })) };

describe('phone self check-in → seated on the up-next technician', () => {
  it('reports seated when the walk-ins service finds a free technician, and nudges the board', async () => {
    const prisma = makePrisma();
    const walkins = { seatSelfCheckIn: jest.fn(async () => 'staff-cindy') };
    const svc = new DisplayService(prisma as any, customers as any, walkins as any);
    const got: string[] = [];
    const sub = liveEvents.stream('tenant-a').subscribe((e) => got.push(`${e.topic}:${e.id}`));
    const r = await svc.selfCheckIn('TOK', { firstName: 'Viet', serviceIds: ['s1'], partySize: 1 });
    sub.unsubscribe();
    expect(r).toEqual({ ok: true, id: 'w1', queued: false, seated: true });
    expect(walkins.seatSelfCheckIn).toHaveBeenCalledWith('tenant-a', 'w1');
    expect(got).toEqual(['walkins:w1']);
    // The ticket itself is still created WAITING; seating is the walk-ins
    // service's job, through the same rotation the desk uses.
    expect(prisma._created[0]).toMatchObject({ status: 'WAITING', tenantId: 'tenant-a' });
  });

  it('stays queued when every technician is busy', async () => {
    const prisma = makePrisma();
    const walkins = { seatSelfCheckIn: jest.fn(async () => null) };
    const svc = new DisplayService(prisma as any, customers as any, walkins as any);
    const r = await svc.selfCheckIn('TOK', { firstName: 'Viet', serviceIds: ['s1'] });
    expect(r).toEqual({ ok: true, id: 'w1', queued: true, seated: false });
  });

  it('a seating crash never loses the check-in', async () => {
    const prisma = makePrisma();
    const walkins = { seatSelfCheckIn: jest.fn(async () => { throw new Error('db down'); }) };
    const svc = new DisplayService(prisma as any, customers as any, walkins as any);
    const r = await svc.selfCheckIn('TOK', { firstName: 'Viet' });
    expect(r).toEqual({ ok: true, id: 'w1', queued: true, seated: false });
  });

  it('works without a walk-ins service at all (old wiring)', async () => {
    const prisma = makePrisma();
    const svc = new DisplayService(prisma as any, customers as any);
    const r = await svc.selfCheckIn('TOK', { firstName: 'Viet' });
    expect(r).toEqual({ ok: true, id: 'w1', queued: true, seated: false });
  });
});
