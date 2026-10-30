/**
 * Third round of the 2026-10 audit: the remaining money, booking and
 * security gaps, each pinned by a test (tenant-scoped where it matters).
 */
jest.mock('@prisma/client', () => {
  const actual = jest.requireActual('@prisma/client');
  return {
    ...actual,
    AppointmentStatus: actual.AppointmentStatus?.ARRIVED ? actual.AppointmentStatus : { PENDING: 'PENDING', ASSIGNED: 'ASSIGNED', ACCEPTED: 'ACCEPTED', CONFIRMED: 'CONFIRMED', ARRIVED: 'ARRIVED', NO_SHOW: 'NO_SHOW', COMPLETED: 'COMPLETED', CANCELLED: 'CANCELLED', REJECTED: 'REJECTED' },
    WalkInStatus: actual.WalkInStatus ?? { WAITING: 'WAITING', SERVING: 'SERVING', DONE: 'DONE', CANCELLED: 'CANCELLED' },
    PaymentStatus: actual.PaymentStatus ?? { PENDING: 'PENDING', PAID: 'PAID', REFUNDED: 'REFUNDED' },
    PaymentType: actual.PaymentType?.PAY_ONLINE ? actual.PaymentType : { PAY_LATER: 'PAY_LATER', PAY_ONLINE: 'PAY_ONLINE' },
    UserRole: actual.UserRole ?? { SALON_ADMIN: 'SALON_ADMIN', STAFF: 'STAFF', SUPER_ADMIN: 'SUPER_ADMIN' },
  };
});
// The terminal connectors pull in vendor SDKs this test never touches.
jest.mock('../payments-hub/provider-registry.service', () => ({ ProviderRegistry: class {} }));
jest.mock('../payments-hub/credential-store.service', () => ({ CredentialStore: class {} }));
import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RateLimitGuard } from './security/rate-limit.guard';
import { lineStaffIds } from '../bookings/booking.util';
import { BookingsService } from '../bookings/bookings.service';
import { PaymentOrchestrator } from '../payments-hub/payment-orchestrator.service';
import { capForApiPath } from '../support/support-scope';

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

describe('rate limits key on the address the client cannot fake', () => {
  const ip = (headers: Row) => (new RateLimitGuard(new Reflector()) as unknown as { clientIp: (r: Row) => string }).clientIp({ headers, ip: '10.0.0.1' });
  it("Cloudflare's header wins over a typed X-Forwarded-For", () => {
    expect(ip({ 'cf-connecting-ip': '203.0.113.7', 'x-forwarded-for': '1.2.3.4, 203.0.113.7' })).toBe('203.0.113.7');
  });
  it('without it, the old rule', () => {
    expect(ip({ 'x-forwarded-for': '1.2.3.4, 5.6.7.8' })).toBe('1.2.3.4');
    expect(ip({})).toBe('10.0.0.1');
  });
});

describe('a public booking never rewrites an existing customer', () => {
  function make(known: Row | null) {
    const calls: Row[] = [];
    const tx: Row = {
      customer: {
        findUnique: async ({ where }: Row) => (known && where.tenantId_email.tenantId === known.tenantId && where.tenantId_email.email === known.email ? known : null),
        update: async (a: Row) => { calls.push({ op: 'update', ...a }); return { id: a.where.id }; },
        upsert: async (a: Row) => { calls.push({ op: 'upsert', ...a }); return { id: 'x' }; },
        findFirst: async () => null,
        create: async (a: Row) => { calls.push({ op: 'create', ...a }); return { id: 'new' }; },
      },
    };
    const svc = Object.create(BookingsService.prototype) as BookingsService;
    (svc as unknown as Row).referral = { resolveReferrerId: async () => null };
    (svc as unknown as Row).normalizedPhone = async (_t: string, p: string) => p ?? null;
    const upsert = (dto: Row, trusted: boolean, tenantId = 'A') => (svc as unknown as { upsertCustomer: (...a: unknown[]) => Promise<unknown> }).upsertCustomer(tx, tenantId, dto, trusted);
    return { upsert, calls };
  }
  const mai = { id: 'c1', tenantId: 'A', email: 'mai@x.com', firstName: 'Mai', lastName: 'Tran', phone: '+15125550123' };
  const typed = { customerEmail: 'MAI@x.com', customerFirstName: 'Stranger', customerLastName: 'Z', customerPhone: '+19995550000' };

  it("a typed email never touches the record on file — the stranger's booking goes under the stranger's own phone", async () => {
    const { upsert, calls } = make(mai);
    await upsert(typed, false);
    expect(calls.some((c) => c.op === 'update' || c.op === 'upsert')).toBe(false);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ op: 'create', data: { tenantId: 'A', firstName: 'Stranger', phone: '+19995550000' } });
    expect(calls[0].data.email).toBeUndefined();
  });
  it("the salon's staff still update the record", async () => {
    const { upsert, calls } = make(mai);
    await upsert(typed, true);
    expect(calls[0].op).toBe('upsert');
    expect(calls[0].update).toMatchObject({ firstName: 'Stranger', phone: '+19995550000' });
  });
  it('a new email, or the same email in another salon, creates as before', async () => {
    const { upsert, calls } = make(mai);
    await upsert(typed, false, 'B');
    expect(calls[0].op).toBe('upsert');
  });
});

describe('group bookings: extra-line technicians are busy', () => {
  it('names the technicians on service lines, not the booking’s own', () => {
    expect(lineStaffIds([{ kind: 'service', staffMemberId: 'kim' }, { kind: 'service', staffMemberId: 'lisa' }, { kind: 'addon', staffMemberId: 'x' }], 'lisa')).toEqual(['kim']);
    expect(lineStaffIds(null)).toEqual([]);
  });
});

describe('Complete and No-show only from a sensible state', () => {
  function make(status: string, onFloor = false) {
    const svc = Object.create(BookingsService.prototype) as BookingsService;
    const writes: Row[] = [];
    (svc as unknown as Row).prisma = {
      appointment: {
        findFirst: async ({ where }: Row) => (where.tenantId === 'A' ? { status, customerId: 'c1' } : null),
        updateMany: async (a: Row) => { writes.push(a); return { count: 1 }; },
      },
      walkIn: { findFirst: async ({ where }: Row) => (onFloor && where.tenantId === 'A' ? { id: 'w1' } : null) },
    };
    (svc as unknown as Row).getById = async () => ({ id: 'a1', status });
    (svc as unknown as Row).audit = { log: async () => undefined };
    const settled: string[] = [];
    (svc as unknown as Row).payments = { settleOnComplete: async () => { settled.push('settle'); } };
    (svc as unknown as Row).referral = { rewardOnCompletion: async () => { settled.push('referral'); } };
    return { svc, writes, settled };
  }
  const admin = { userId: 'u', tenantId: 'A', role: 'SALON_ADMIN' } as never;
  it('completing a completed booking settles nothing a second time', async () => {
    const { svc, writes, settled } = make('COMPLETED');
    await svc.complete(admin, 'a1');
    expect(writes).toHaveLength(0);
    expect(settled).toEqual([]);
  });
  it('a completed visit, or one with a ticket on the floor, cannot be marked No-show', async () => {
    await expect(make('COMPLETED').svc.noShow(admin, 'a1')).rejects.toBeInstanceOf(BadRequestException);
    await expect(make('ARRIVED', true).svc.noShow(admin, 'a1')).rejects.toBeInstanceOf(BadRequestException);
    const ok = make('CONFIRMED');
    await ok.svc.noShow(admin, 'a1');
    expect(ok.writes[0]).toMatchObject({ where: { id: 'a1', tenantId: 'A' }, data: { status: 'NO_SHOW' } });
  });
});

describe('money handed back on the terminal leaves the ledger', () => {
  it('a refund writes one negative card row, tied to its order, in the same salon', async () => {
    const rows: Row[] = [];
    const prisma: Row = { payment: { create: async ({ data }: Row) => { rows.push(data); return data; } } };
    const hub = new PaymentOrchestrator(prisma as never, {} as never, {} as never);
    await (hub as unknown as { refundToLedger: (...a: unknown[]) => Promise<void> }).refundToLedger('A', { orderId: 'o1', currency: 'USD' }, 2500, 'r1');
    await (hub as unknown as { refundToLedger: (...a: unknown[]) => Promise<void> }).refundToLedger('A', { orderId: null, currency: 'USD' }, 1000, 'r2');
    expect(rows[0]).toMatchObject({ tenantId: 'A', amountCents: -2500, status: 'PAID', providerReference: 'order:o1' });
    expect(rows[1]).toMatchObject({ amountCents: -1000, providerReference: 'refund:r2' });
  });
});

describe('support sessions: every salon area belongs to a screen', () => {
  it('search, time off, my pay, TikTok, Drive and the salon profile', () => {
    expect(capForApiPath('/api/search?q=mai')).toBe('customers');
    expect(capForApiPath('/api/time-off')).toBe('staff');
    expect(capForApiPath('/api/my-pay/week')).toBe('payroll');
    expect(capForApiPath('/api/tiktok/connect')).toBe('marketing');
    expect(capForApiPath('/api/storage/gdrive/files')).toBe('marketing');
    expect(capForApiPath('/api/tenants/me')).toBe('settings');
  });
});
