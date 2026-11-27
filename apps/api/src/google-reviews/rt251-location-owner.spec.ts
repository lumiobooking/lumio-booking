import { takenLocationOwners } from './location-match';

describe('rt251 which salon holds a Google location', () => {
  const rows = [
    { tenantId: 'A', value: { connected: true, locationId: 'accounts/1/locations/111' } },
    { tenantId: 'B', value: { connected: true, locationId: 'locations/222' } },
    { tenantId: 'C', value: { connected: false, locationId: 'locations/333' } },
  ];
  it('maps each location held by ANOTHER salon to that salon', () => {
    const m = takenLocationOwners(rows, 'A');
    expect(m.get('locations/222')).toBe('B');
    expect(m.has('locations/111')).toBe(false); // my own
    expect(m.has('locations/333')).toBe(false); // disconnected
  });
});

import { GoogleReviewsService } from './google-reviews.service';

describe('rt251 the name is shown to the Lumio team only', () => {
  function setup() {
    const prisma = {
      setting: { findMany: jest.fn(async () => [{ tenantId: 'B', value: { connected: true, locationId: 'locations/222' } }]) },
      tenant: { findMany: jest.fn(async () => [{ id: 'B', name: 'Nancy\'s Nails', slug: 'nancys' }]) },
    };
    const svc = new GoogleReviewsService(prisma as never, {} as never, {} as never);
    const anySvc = svc as unknown as { getSettings: () => Promise<unknown>; accessToken: () => Promise<string> };
    anySvc.getSettings = async () => ({ accountId: 'accounts/1' });
    anySvc.accessToken = async () => 'tok';
    const fetchSpy = jest.spyOn(global, 'fetch' as never).mockImplementation((async (u: string) => ({
      ok: true,
      json: async () => (String(u).includes('/accounts') && !String(u).includes('/locations') ? { accounts: [{ name: 'accounts/1' }] } : { locations: [{ name: 'locations/222', title: 'Nancy\'s Nails' }, { name: 'locations/999', title: 'Free one' }] }),
    })) as never);
    return { svc, prisma, fetchSpy };
  }

  it('Lumio support sees which salon holds it', async () => {
    const { svc, fetchSpy } = setup();
    const r = await svc.listLocations({ userId: 'u', tenantId: 'A', role: 'SALON_ADMIN', supportSession: true } as never);
    expect(r.locations.find((l) => l.name === 'locations/222')).toMatchObject({ takenByOther: true, takenBy: "Nancy's Nails" });
    fetchSpy.mockRestore();
  });

  it('a salon owner is told only "another salon" — no other salon\'s name', async () => {
    const { svc, prisma, fetchSpy } = setup();
    const r = await svc.listLocations({ userId: 'u', tenantId: 'A', role: 'SALON_ADMIN' } as never);
    expect(r.locations.find((l) => l.name === 'locations/222')).toMatchObject({ takenByOther: true, takenBy: null });
    expect(prisma.tenant.findMany).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

describe('rt252 freeing a location an old link holds', () => {
  function setup() {
    const store: Record<string, Record<string, unknown>> = {
      A: { connected: true, locationId: '' },
      B: { connected: true, locationId: 'accounts/1/locations/222', locationTitle: 'Lux Nail Spa', refreshToken: 'keep' },
      C: { connected: true, locationId: 'locations/333', locationTitle: 'Other' },
    };
    const deleted: string[] = [];
    const audits: { tenantId: string; action: string }[] = [];
    const prisma = {
      setting: {
        findMany: jest.fn(async () => Object.entries(store).map(([tenantId, value]) => ({ tenantId, value }))),
        findUnique: jest.fn(async ({ where }: { where: { tenantId_key: { tenantId: string } } }) => ({ value: store[where.tenantId_key.tenantId] })),
        upsert: jest.fn(async ({ where, update }: { where: { tenantId_key: { tenantId: string } }; update: { value: Record<string, unknown> } }) => { store[where.tenantId_key.tenantId] = update.value; return {}; }),
      },
      tenant: { findUnique: jest.fn(async () => ({ name: 'Lux Nail Spa', slug: 'lux-nail-spa' })) },
      googleReview: { deleteMany: jest.fn(async ({ where }: { where: { tenantId: string } }) => { deleted.push(where.tenantId); return { count: 1 }; }) },
      auditLog: { create: jest.fn(async ({ data }: { data: { tenantId: string; action: string } }) => { audits.push(data); return {}; }) },
    };
    const svc = new GoogleReviewsService(prisma as never, {} as never, {} as never);
    return { svc, store, deleted, audits };
  }

  it('a salon owner cannot free another salon\'s location', async () => {
    const { svc, store } = setup();
    await expect(svc.releaseLocation({ userId: 'u', tenantId: 'A', role: 'SALON_ADMIN' } as never, 'locations/222')).rejects.toThrow(/team Lumio/);
    expect(store.B.locationId).toBe('accounts/1/locations/222');
  });

  it('the Lumio team frees it: only that salon\'s location fields are cleared, its login stays, others untouched', async () => {
    const { svc, store, deleted } = setup();
    const r = await svc.releaseLocation({ userId: 'u', tenantId: 'A', role: 'SALON_ADMIN', supportSession: true } as never, 'locations/222');
    expect(r).toEqual({ released: true, from: { name: 'Lux Nail Spa', slug: 'lux-nail-spa' } });
    expect(store.B).toMatchObject({ connected: true, locationId: '', locationTitle: '', refreshToken: 'keep' });
    expect(store.C.locationId).toBe('locations/333');
    expect(deleted).toEqual(['B']);
  });

  it('nothing to free when nobody else holds it', async () => {
    const { svc, deleted } = setup();
    expect(await svc.releaseLocation({ userId: 'u', tenantId: 'A', role: 'SALON_ADMIN', supportSession: true } as never, 'locations/999')).toEqual({ released: false, from: null });
    expect(deleted).toEqual([]);
  });
});

describe('rt253 a deleted salon does not keep a location taken', () => {
  it('only salons not deleted are asked for their Google links', async () => {
    const calls: unknown[] = [];
    const prisma = { setting: { findMany: jest.fn(async (a: unknown) => { calls.push(a); return []; }) } };
    const svc = new GoogleReviewsService(prisma as never, {} as never, {} as never);
    await expect(svc.releaseLocation({ userId: 'u', tenantId: 'A', role: 'SALON_ADMIN', supportSession: true } as never, 'locations/1')).resolves.toEqual({ released: false, from: null });
    expect(calls[0]).toMatchObject({ where: { key: 'googleReviews', tenant: { deletedAt: null } } });
  });
});
