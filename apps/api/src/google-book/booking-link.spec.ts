/**
 * The "Book" link on each salon's own Google profile: only a salon that is on,
 * linked to its own listing and has something to book gets one — on ITS OWN
 * connection — and the result is written under that salon's id only.
 */
jest.mock('@prisma/client', () => {
  const actual = jest.requireActual('@prisma/client');
  return { ...actual, TenantStatus: actual.TenantStatus ?? { ACTIVE: 'ACTIVE', SUSPENDED: 'SUSPENDED', CANCELLED: 'CANCELLED' } };
});
import { GoogleBookService, bookingLinkBlock } from './google-book.service';

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const TENANTS: Row[] = [
  { id: 't-a', name: 'Lux Nail Spa', slug: 'lux-nail-spa', status: 'ACTIVE', contactPhone: '+15125551234', timezone: 'America/Chicago', market: 'US', deletedAt: null },
  { id: 't-b', name: 'Q Nail Spa', slug: 'q-nail-spa', status: 'ACTIVE', contactPhone: null, timezone: 'America/Chicago', market: 'US', deletedAt: null },
  { id: 't-c', name: 'Empty Menu Nails', slug: 'empty', status: 'ACTIVE', contactPhone: null, timezone: 'America/Chicago', market: 'US', deletedAt: null },
  { id: 't-d', name: 'Pho Express', slug: 'pho', status: 'ACTIVE', contactPhone: null, timezone: 'America/Chicago', market: 'US', deletedAt: null, businessType: 'RESTAURANT' },
];
const SERVICES: Record<string, Row[]> = {
  't-a': [{ id: 's1', name: 'Gel Manicure', description: null, priceCents: 3500, durationMinutes: 40, isActive: true, category: null }],
  't-b': [{ id: 's2', name: 'Pedicure', description: null, priceCents: 4000, durationMinutes: 45, isActive: true, category: null }],
};

function build() {
  const writes: Row[] = [];
  const calls: Row[] = [];
  const prisma: Row = {
    tenant: {
      findMany: async () => TENANTS.map((t) => ({ id: t.id })),
      findFirst: async ({ where }: Row) => TENANTS.find((t) => t.id === where.id) ?? null,
    },
    setting: {
      findUnique: async () => null,
      upsert: async (a: Row) => { writes.push(a); return {}; },
    },
    service: { findMany: async ({ where }: Row) => SERVICES[where.tenantId] ?? [] },
  };
  const settings = {
    getCompanyExtra: async () => ({ address: '1 Main St, Austin, TX', website: '' }),
    getBookingRules: async () => ({ currency: 'USD', selfCancelEnabled: true, selfCancelNoticeHours: 24 }),
    getDepositSettings: async () => ({ enabled: false, scope: 'all' }),
  };
  const google = {
    // t-b is linked to ANOTHER business's listing.
    getSettings: async (tenantId: string) => ({ connected: true, locationId: `locations/${tenantId}`, locationTitle: tenantId === 't-b' ? 'Totally Different Bakery' : TENANTS.find((t) => t.id === tenantId)?.name }),
    fetchProfile: async () => null,
    syncBookingActionLink: async (tenantId: string, uri: string, hosts: string[], wanted: boolean) => { calls.push({ tenantId, uri, hosts, wanted }); return { steps: ['create'], others: 0 }; },
  };
  const svc = new GoogleBookService(prisma as never, settings as never, google as never, { log: async () => undefined } as never);
  return { svc, writes, calls };
}

describe('the Book link on each salon\'s Google profile', () => {
  it('links the salon\'s own booking page on its own connection', async () => {
    const { svc, writes, calls } = build();
    const s = await svc.syncBookingLink('t-a');
    expect(s.state).toBe('linked');
    expect(s.uri).toMatch(/\/lux-nail-spa\/gbp$/);
    expect(calls).toEqual([expect.objectContaining({ tenantId: 't-a', wanted: true })]);
    expect(writes[0].where.tenantId_key.tenantId).toBe('t-a');
  });

  it('never puts a link on a listing that is not the salon\'s, on an empty menu, or on a restaurant', async () => {
    const { svc, calls } = build();
    expect((await svc.syncBookingLink('t-b')).state).toBe('skipped');
    expect((await svc.syncBookingLink('t-c')).state).toBe('skipped');
    expect((await svc.syncBookingLink('t-d')).state).toBe('skipped');
    expect(calls).toEqual([]);
  });

  it('runs every live salon, each under its own id', async () => {
    const { svc, calls, writes } = build();
    const rep = await svc.syncAllBookingLinks();
    expect(rep).toEqual(expect.objectContaining({ linked: 1, skipped: 3, failed: 0 }));
    expect(calls.map((c) => c.tenantId)).toEqual(['t-a']);
    expect(writes.map((w) => w.where.tenantId_key.tenantId).sort()).toEqual(['t-a', 't-b', 't-c', 't-d']);
  });

  it('records a Google refusal instead of throwing', async () => {
    const { svc } = build();
    (svc as unknown as { google: Row }).google.syncBookingActionLink = async () => { throw new Error('Google Cloud chưa bật "My Business Place Actions API"'); };
    const s = await svc.syncBookingLink('t-a');
    expect(s.state).toBe('error');
    expect(s.reason).toMatch(/Place Actions API/);
  });

  it('says why a salon gets no link', () => {
    expect(bookingLinkBlock({ tenantId: 'x', status: 'ready', issues: [], feedable: 1 } as never)).toBeNull();
    expect(bookingLinkBlock({ tenantId: 'x', status: 'fix', issues: [{ code: 'name_caps', level: 'error', message: 'caps' }], feedable: 1 } as never)).toBeNull();
    expect(bookingLinkBlock({ tenantId: 'x', status: 'fix', issues: [{ code: 'google_mismatch', level: 'error', message: 'wrong listing' }], feedable: 1 } as never)).toBe('wrong listing');
  });
});
