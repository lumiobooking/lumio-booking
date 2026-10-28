jest.mock('@prisma/client', () => {
  const actual = jest.requireActual('@prisma/client');
  return { ...actual, TenantStatus: actual.TenantStatus?.ACTIVE ? actual.TenantStatus : { ACTIVE: 'ACTIVE', SUSPENDED: 'SUSPENDED' }, UserRole: actual.UserRole ?? { SUPER_ADMIN: 'SUPER_ADMIN' } };
});
jest.mock('../auth/password.util', () => ({ hashSecret: jest.fn(async () => 'h') }));
import { BadRequestException } from '@nestjs/common';
import { buildDemoBookings, demoAllowed, DEMO_BOOKINGS, DEMO_CUSTOMERS } from './demo-salon';
import { TenantsService } from './tenants.service';

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const TZ = 'America/Chicago';
// 1:10 PM in Austin on 28 Oct 2026 (CDT, UTC-5).
const NOW = new Date('2026-10-28T18:10:00Z');

describe('demo salon data (pure)', () => {
  it('today\'s bookings sit at salon-local times; over = COMPLETED, now = ARRIVED, later keeps its status', () => {
    const rows = buildDemoBookings(NOW, TZ);
    const first = rows.find((r) => r.dayKey === '2026-10-28' && r.serviceKey === 'gel' && r.customerKey === 'anna')!;
    expect(first.startTime.toISOString()).toBe('2026-10-28T14:30:00.000Z'); // 9:30 AM CDT
    expect(first.status).toBe('COMPLETED');
    const inChair = rows.find((r) => r.dayKey === '2026-10-28' && r.customerKey === 'mia')!; // 1:00–1:45 PM
    expect(inChair.status).toBe('ARRIVED');
    const later = rows.filter((r) => r.dayKey === '2026-10-28' && r.startTime > NOW);
    expect(later.some((r) => r.status === 'PENDING')).toBe(true); // something for "Cần xác nhận"
    expect(rows.filter((r) => r.status === 'CANCELLED').every((r) => r.cancelledBy === 'customer')).toBe(true);
    expect(new Set(rows.map((r) => r.dayKey))).toEqual(new Set(['2026-10-28', '2026-10-29', '2026-10-30']));
    expect(rows).toHaveLength(DEMO_BOOKINGS.length);
  });

  it('a day that already has bookings is skipped — running twice never doubles a day', () => {
    const rows = buildDemoBookings(NOW, TZ, new Set(['2026-10-28', '2026-10-29']));
    expect(new Set(rows.map((r) => r.dayKey))).toEqual(new Set(['2026-10-30']));
  });

  it('only invented contacts: @example.com and 555-01xx numbers', () => {
    for (const c of DEMO_CUSTOMERS) {
      expect(c.email.endsWith('@example.com')).toBe(true);
      expect(c.phone).toMatch(/^\+1512555010\d$|^\+15125550(1\d\d)$/);
    }
  });

  it('never into a working salon', () => {
    expect(demoAllowed({ name: 'Lumio Demo Nails', marked: false, customers: 0, appointments: 0 }).ok).toBe(true);
    expect(demoAllowed({ name: 'VIP Nails Austin', marked: false, customers: 0, appointments: 0 }).ok).toBe(false);
    expect(demoAllowed({ name: 'Demo Nails', marked: false, customers: 3, appointments: 0 }).ok).toBe(false);
    expect(demoAllowed({ name: 'Anything', marked: true, customers: 50, appointments: 900 }).ok).toBe(true);
  });
});

function makeDb(tenants: Row[]) {
  const writes: { model: string; data: Row }[] = [];
  const settings = new Map<string, unknown>();
  const appts: Row[] = [];
  const named = (model: string) => ({
    findFirst: jest.fn(async () => null),
    create: jest.fn(async ({ data }: Row) => { writes.push({ model, data }); return { id: `${model}-${writes.length}` }; }),
    createMany: jest.fn(async ({ data }: Row) => { for (const d of data) writes.push({ model, data: d }); return { count: data.length }; }),
  });
  const tx: Row = {
    setting: {
      findUnique: jest.fn(async ({ where }: Row) => (settings.has(`${where.tenantId_key.tenantId}:${where.tenantId_key.key}`) ? { value: settings.get(`${where.tenantId_key.tenantId}:${where.tenantId_key.key}`) } : null)),
      upsert: jest.fn(async ({ where, create, update }: Row) => { const k = `${where.tenantId_key.tenantId}:${where.tenantId_key.key}`; settings.set(k, settings.has(k) ? update.value : create.value); writes.push({ model: 'setting', data: create }); }),
    },
    service: named('service'),
    staffMember: named('staff'),
    staffWorkingHour: named('hours'),
    staffService: named('skill'),
    customer: { upsert: jest.fn(async ({ create }: Row) => { writes.push({ model: 'customer', data: create }); return { id: `cust-${create.email}` }; }) },
    appointment: {
      findMany: jest.fn(async ({ where }: Row) => appts.filter((a) => a.tenantId === where.tenantId && a.startTime >= where.startTime.gte && a.startTime < where.startTime.lt)),
      createMany: jest.fn(async ({ data }: Row) => { for (const d of data) { appts.push(d); writes.push({ model: 'appointment', data: d }); } return { count: data.length }; }),
    },
  };
  const prisma: Row = {
    ...tx,
    tenant: {
      findFirst: jest.fn(async ({ where }: Row) => tenants.find((t) => t.id === where.id) ?? null),
      update: jest.fn(async ({ where, data }: Row) => { writes.push({ model: 'tenant', data: { ...data, id: where.id } }); }),
    },
    customer: { ...tx.customer, count: jest.fn(async ({ where }: Row) => tenants.find((t) => t.id === where.tenantId)?.customers ?? 0) },
    appointment: { ...tx.appointment, count: jest.fn(async ({ where }: Row) => appts.filter((a) => a.tenantId === where.tenantId).length + (tenants.find((t) => t.id === where.tenantId)?.appointments ?? 0)) },
    $transaction: jest.fn(async (cb: (t: Row) => unknown) => cb(tx)),
  };
  const audit = { log: jest.fn(async () => undefined) };
  return { svc: new TenantsService(prisma as never, audit as never), writes, settings, appts, audit };
}
const admin = { userId: 'sa', email: 'sa@lumio', role: 'SUPER_ADMIN', tenantId: null } as never;

describe('loading the demo salon', () => {
  it('fills the demo salon only: every row carries its tenantId; notifications and reminders off; trial never runs out', async () => {
    const { svc, writes, settings, audit } = makeDb([{ id: 'demo', name: 'Lumio Demo Nails', timezone: TZ }, { id: 'real', name: 'VIP Nails', timezone: TZ }]);
    const r = await svc.loadDemoData('demo', admin, NOW);
    expect(r.bookingsCreated).toBe(DEMO_BOOKINGS.length);
    for (const w of writes) {
      if (w.model === 'tenant') expect(w.data.id).toBe('demo');
      else expect(w.data.tenantId).toBe('demo');
    }
    expect(settings.get('demo:notifications')).toMatchObject({ emailCustomerOnBooking: false, smsCustomerOnBooking: false, emailAdminOnBooking: false, smsAdminOnBooking: false });
    expect(settings.get('demo:reminder_settings')).toMatchObject({ enabled: false });
    expect(writes.find((w) => w.model === 'tenant')?.data).toMatchObject({ billingExempt: true });
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'demo', action: 'tenant.demo_data_loaded' }));
  });

  it('cross-tenant / safety: a working salon is refused and nothing is written', async () => {
    const { svc, writes } = makeDb([{ id: 'real', name: 'VIP Nails', timezone: TZ, customers: 120, appointments: 900 }]);
    await expect(svc.loadDemoData('real', admin, NOW)).rejects.toBeInstanceOf(BadRequestException);
    expect(writes).toHaveLength(0);
  });

  it('running it again the same day adds no bookings', async () => {
    const { svc } = makeDb([{ id: 'demo', name: 'Lumio Demo Nails', timezone: TZ }]);
    await svc.loadDemoData('demo', admin, NOW);
    const again = await svc.loadDemoData('demo', admin, NOW);
    expect(again.bookingsCreated).toBe(0);
  });
});
