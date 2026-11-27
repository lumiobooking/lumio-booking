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
      tenant: { findMany: jest.fn(async () => [{ id: 'B', name: 'Nancy\'s Nails' }]) },
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
