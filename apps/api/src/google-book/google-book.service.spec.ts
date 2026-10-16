/**
 * The daily Google feed reads each salon under its own id, lists only live
 * salons, and keeps the ones the lint refuses out of the files.
 */
jest.mock('@prisma/client', () => {
  const actual = jest.requireActual('@prisma/client');
  return { ...actual, TenantStatus: actual.TenantStatus ?? { ACTIVE: 'ACTIVE', SUSPENDED: 'SUSPENDED', CANCELLED: 'CANCELLED' } };
});
import { GoogleBookService } from './google-book.service';

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const TENANTS: Row[] = [
  { id: 't-good', name: 'Lux Nail Spa', slug: 'lux-nail-spa', status: 'ACTIVE', contactPhone: '+15125551234', timezone: 'America/Chicago', market: 'US', deletedAt: null },
  { id: 't-caps', name: 'MT. HAWTHORN NAIL SPA', slug: 'mt-hawthorn', status: 'ACTIVE', contactPhone: null, timezone: 'Australia/Perth', market: 'AU', deletedAt: null },
  { id: 't-pho', name: 'Pho Express', slug: 'pho', status: 'ACTIVE', contactPhone: null, timezone: 'America/Chicago', market: 'US', deletedAt: null, businessType: 'RESTAURANT' },
  { id: 't-gone', name: 'Closed Salon', slug: 'closed', status: 'SUSPENDED', contactPhone: null, timezone: 'UTC', market: 'US', deletedAt: null },
];
const SERVICES: Record<string, Row[]> = {
  't-good': [{ id: 's1', name: 'Gel Manicure', description: null, priceCents: 3500, durationMinutes: 40, isActive: true, category: { name: 'Manicure' } }],
  't-caps': [{ id: 's2', name: 'PEDICURE DELUXE', description: null, priceCents: 4500, durationMinutes: 50, isActive: true, category: null }],
};

function build() {
  const seen: { table: string; where: Row }[] = [];
  const prisma: Row = {
    tenant: {
      findMany: async ({ where }: Row) => { seen.push({ table: 'tenant', where }); return TENANTS.filter((t) => t.status === where.status && t.deletedAt === null).map((t) => ({ id: t.id })); },
      findFirst: async ({ where }: Row) => TENANTS.find((t) => t.id === where.id) ?? null,
    },
    setting: { findUnique: async () => null, upsert: async () => ({}) },
    service: { findMany: async ({ where }: Row) => { seen.push({ table: 'service', where }); return SERVICES[where.tenantId] ?? []; } },
  };
  const settings = {
    getCompanyExtra: async () => ({ address: '1 Main St, Austin, TX', website: '' }),
    getBookingRules: async () => ({ currency: 'USD', selfCancelEnabled: true, selfCancelNoticeHours: 24 }),
    getDepositSettings: async () => ({ enabled: false, scope: 'all' }),
  };
  const google = {
    getSettings: async (tenantId: string) => ({ connected: tenantId !== 't-gone', locationId: 'locations/1', locationTitle: tenantId === 't-good' ? 'Lux Nail Spa' : 'Mt Hawthorn Nail Spa' }),
    fetchProfile: async (tenantId: string) => ({ title: tenantId === 't-caps' ? 'MT. HAWTHORN NAIL SPA' : 'Lux Nail Spa', website: 'https://lux.example', phone: '+15125551234', lat: 30.2, lng: -97.7, address: { country: 'US', locality: 'Austin', region: 'TX', postalCode: '78701', street: '1 Main St' }, placeId: 'p', mapsUri: null, fetchedAt: new Date().toISOString() }),
  };
  const audits: Row[] = [];
  const svc = new GoogleBookService(prisma as never, settings as never, google as never, { log: async (a: Row) => { audits.push(a); } } as never);
  return { svc, seen, audits };
}

describe('the Google feed, salon by salon', () => {
  it('lists live salons only, reads each under its own id, and holds back the one the lint refuses', async () => {
    const { svc, seen } = build();
    const board = await svc.readiness();
    expect(board.map((r) => `${r.id}:${r.status}`)).toEqual(['t-good:ready', 't-caps:fix', 't-pho:off']);
    expect(board[1].issues.map((i) => i.code)).toEqual(expect.arrayContaining(['name_caps', 'svc_caps_fixed']));
    // Every service read carried the salon's own tenantId; the suspended salon was never read.
    const svcReads = seen.filter((x) => x.table === 'service');
    expect(svcReads.map((x) => x.where.tenantId).sort()).toEqual(['t-caps', 't-good', 't-pho']);
    const { files, ready, held } = await svc.buildFeeds(new Date('2026-10-16T03:10:00Z'));
    expect(ready).toEqual(['t-good']);
    expect(held).toEqual(['t-caps']);
    const entity = JSON.parse(files.find((f) => f.name.startsWith('entity_') && !f.name.includes('filesetdesc'))!.body);
    expect(entity.data.map((e: Row) => e.entity_id)).toEqual(['t-good']);
    expect(entity.data[0].location.address.postal_code).toBe('78701');
    const services = JSON.parse(files.find((f) => f.name.startsWith('service_') && !f.name.includes('filesetdesc'))!.body);
    expect(services.data).toHaveLength(1);
    expect(services.data[0].action_link[0].url).toMatch(/\/lux-nail-spa\/gbp\?service=s1$/);
  });

  it('without SFTP credentials the run builds and reports, never throws', async () => {
    const { svc } = build();
    delete process.env.RWG_SFTP_HOST;
    const r = await svc.runDaily(new Date('2026-10-16T03:10:00Z'));
    expect(r.ready).toBe(1);
    expect(r.held).toBe(1);
    expect(r.uploaded).toBe(false);
    expect(r.error).toBe('SFTP not configured');
    expect(svc.getLastRun()).toEqual(r);
  });

  it('fixing a shouted name is audited and touches only that salon', async () => {
    const { svc, audits } = build();
    // The mock has no tenant.update: give it one that records the id.
    const updated: Row[] = [];
    (svc as unknown as { prisma: Row }).prisma.tenant.update = async (a: Row) => { updated.push(a); return {}; };
    await expect(svc.fixName('t-caps', 'u1')).resolves.toEqual({ name: 'Mt. Hawthorn Nail Spa' });
    expect(updated[0].where).toEqual({ id: 't-caps' });
    expect(audits[0].action).toBe('google_book.name_fixed');
  });
});
