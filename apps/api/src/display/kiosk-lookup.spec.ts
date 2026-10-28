jest.mock('@prisma/client', () => ({
  ...jest.requireActual('@prisma/client'),
  WalkInStatus: { WAITING: 'WAITING', DONE: 'DONE' },
}));
import { NotFoundException } from '@nestjs/common';
import { DisplayService } from './display.service';

// The kiosk asks "have we seen this phone before?". It must answer from the
// PAIRED salon's own customers only, say no more than a first name and menu
// service ids, and never confuse two salons that share a customer.
const NOW = new Date();
const minsFromNow = (m: number) => new Date(NOW.getTime() + m * 60_000);

function makePrisma(opts: { tenant?: string | null } = {}) {
  const calls: { model: string; where: any }[] = [];
  const log = (model: string) => (args: any) => { calls.push({ model, where: args?.where }); };
  return {
    _calls: calls,
    displaySession: {
      findUnique: jest.fn(async (a: any) => { log('displaySession')(a); return opts.tenant === null ? null : { tenantId: opts.tenant ?? 'tenant-a', pairCode: 'K7M4Q9' }; }),
    },
    service: { findMany: jest.fn(async (a: any) => { log('service')(a); return [{ id: 'gel' }, { id: 'pedi' }]; }) },
    appointment: {
      findMany: jest.fn(async (a: any) => {
        log('appointment')(a);
        if (a.where?.groupId) return [{ serviceId: 'gel' }, { serviceId: 'retired' }];
        return [{ startTime: minsFromNow(30), serviceId: 'pedi', groupId: null, assignedStaff: { firstName: 'Kim' } }];
      }),
      findFirst: jest.fn(async (a: any) => { log('appointment')(a); return { startTime: minsFromNow(-60 * 24 * 40), serviceId: 'gel', groupId: 'g1', assignedStaff: { firstName: 'Lisa' } }; }),
    },
    walkIn: {
      findFirst: jest.fn(async (a: any) => {
        log('walkIn')(a);
        return { createdAt: minsFromNow(-60 * 24 * 10), items: [{ serviceId: 'gel' }, { serviceId: 'pedi' }, { serviceId: 'gone' }], assignedStaff: { firstName: 'Kim' } };
      }),
    },
  };
}

describe('kiosk phone lookup', () => {
  it('returning customer: first name, booking near now, last visit — nothing else', async () => {
    const prisma = makePrisma();
    const customers = { findByPhone: jest.fn(async () => ({ id: 'cust-1', firstName: 'Anna', email: 'a@x.com', phone: '+15128868189' })) };
    const svc = new DisplayService(prisma as any, customers as any);
    const r: any = await svc.kioskLookup('TOK', '(512) 886-8189');

    expect(customers.findByPhone).toHaveBeenCalledWith('tenant-a', '(512) 886-8189');
    expect(r).toEqual({
      returning: true,
      firstName: 'Anna',
      appointment: { at: minsFromNow(30).toISOString(), serviceIds: ['pedi'], staffName: 'Kim' },
      // The ticket 10 days ago beats the booking 40 days ago; a retired service is dropped.
      lastVisit: { at: minsFromNow(-60 * 24 * 10).toISOString(), serviceIds: ['gel', 'pedi'], staffName: 'Kim' },
    });
    // No contact detail or record id ever leaves.
    expect(JSON.stringify(r)).not.toMatch(/a@x\.com|cust-1|8189|Lisa/);
    // Every query is fenced to the token's salon.
    for (const c of prisma._calls.filter((x) => x.model !== 'displaySession')) expect(c.where.tenantId).toBe('tenant-a');
  });

  it('cross-tenant: a phone known only to another salon is a new customer here', async () => {
    const prisma = makePrisma({ tenant: 'tenant-b' });
    // The customers service is tenant-scoped: salon B has no such phone.
    const customers = { findByPhone: jest.fn(async (tenantId: string) => (tenantId === 'tenant-a' ? { id: 'cust-1', firstName: 'Anna' } : null)) };
    const svc = new DisplayService(prisma as any, customers as any);
    const r = await svc.kioskLookup('TOK-B', '5128868189');
    expect(customers.findByPhone).toHaveBeenCalledWith('tenant-b', '5128868189');
    expect(r).toEqual({ returning: false });
    expect(prisma.appointment.findMany).not.toHaveBeenCalled();
  });

  it('too short / junk numbers are never looked up', async () => {
    const prisma = makePrisma();
    const customers = { findByPhone: jest.fn() };
    const svc = new DisplayService(prisma as any, customers as any);
    expect(await svc.kioskLookup('TOK', '12345')).toEqual({ returning: false });
    expect(await svc.kioskLookup('TOK', 'abc')).toEqual({ returning: false });
    expect(customers.findByPhone).not.toHaveBeenCalled();
  });

  it('an unpaired token is refused', async () => {
    const svc = new DisplayService(makePrisma({ tenant: null }) as any, { findByPhone: jest.fn() } as any);
    await expect(svc.kioskLookup('OLD', '5128868189')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('a "Walk-in" placeholder name is not used as a greeting', async () => {
    const prisma = makePrisma();
    prisma.appointment.findMany = jest.fn(async () => []) as any;
    const customers = { findByPhone: jest.fn(async () => ({ id: 'c', firstName: 'Walk-in' })) };
    const svc = new DisplayService(prisma as any, customers as any);
    const r: any = await svc.kioskLookup('TOK', '5128868189');
    expect(r.returning).toBe(true);
    expect(r.firstName).toBeNull();
    expect(r.appointment).toBeNull();
  });
});

describe('kiosk side panel', () => {
  const base = () => ({
    displaySession: { findUnique: jest.fn(async () => ({ tenantId: 'tenant-a', pairCode: 'K7M4Q9' })) },
    tenant: { findUnique: jest.fn(async () => ({ name: 'Friendly Nails', slug: 'friendly-nails', branding: { accentColor: '#a8292d' }, timezone: 'America/Chicago' })) },
    service: { findMany: jest.fn(async () => []) },
    serviceAddon: { findMany: jest.fn(async () => []) },
    setting: { findMany: jest.fn(async () => []) },
    feedback: { aggregate: jest.fn(async () => ({ _avg: { rating: 4.86 }, _count: { _all: 12 } })) },
  });
  const settings = (review: boolean, checkinQr: string) => ({
    brandingFrom: (b: any) => ({ ratingMode: 'auto', ratingValue: 0, ratingCount: 0, checkinQr, ...b }),
    getReviewSettings: jest.fn(async () => ({ enabled: review })),
    effectiveGoogleReviewUrl: jest.fn(async () => (review ? 'https://g.page/r/x/review' : null)),
  });

  it('offers the check-in link, the review link and the rating', async () => {
    const svc = new DisplayService(base() as any, {} as any, undefined, undefined, settings(true, 'both') as any);
    const m: any = await svc.checkInMenu('TOK');
    expect(m.checkinUrl).toMatch(/\/checkin\?c=K7M4Q9$/);
    expect(m.reviewUrl).toMatch(/\/review\/friendly-nails\/salon$/);
    expect(m.rating).toEqual({ value: 4.9, count: 12 });
    expect(m.panelQr).toBe('both');
  });

  it('asked for a review QR but no review link: falls back to the check-in QR', async () => {
    const svc = new DisplayService(base() as any, {} as any, undefined, undefined, settings(false, 'review') as any);
    const m: any = await svc.checkInMenu('TOK');
    expect(m.reviewUrl).toBeNull();
    expect(m.panelQr).toBe('checkin');
  });
});
