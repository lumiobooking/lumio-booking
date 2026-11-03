jest.mock('@prisma/client', () => {
  const actual = jest.requireActual('@prisma/client');
  return {
    ...actual,
    UserRole: actual.UserRole?.SALON_ADMIN ? actual.UserRole : { SALON_ADMIN: 'SALON_ADMIN', STAFF: 'STAFF', SUPER_ADMIN: 'SUPER_ADMIN' },
  };
});
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { BookingsService } from './bookings.service';
import { verifyLoginCaptcha } from '../common/security/turnstile';

/**
 * "Thêm mục tìm khách hàng" (3 Nov 2026): the booking drawer can move a
 * booking to another client on file, or to a new client — never to another
 * salon's client, never another salon's booking. And the sign-in's "not a
 * robot" check (Cloudflare Turnstile) on its own secret.
 */
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function make() {
  const appts: Row[] = [
    { id: 'b1', tenantId: 'A', customerId: 'c-anna' },
    { id: 'bB', tenantId: 'B', customerId: 'c-b' },
  ];
  const customers: Row[] = [
    { id: 'c-anna', tenantId: 'A', firstName: 'Anna', lastName: null, phone: '+19415550001' },
    { id: 'c-chris', tenantId: 'A', firstName: 'Christina', lastName: 'Gropes', phone: '+19412682649' },
    { id: 'c-b', tenantId: 'B', firstName: 'Bea', lastName: null, phone: '+19415550002' },
  ];
  const walkIns: Row[] = [{ tenantId: 'A', appointmentId: 'b1', customerId: 'c-anna', customerName: 'Anna' }];
  const svc = Object.create(BookingsService.prototype) as BookingsService;
  const audit = { log: jest.fn(async () => undefined) };
  const prisma = {
    appointment: {
      findFirst: jest.fn(async ({ where }: Row) => appts.find((r) => r.id === where.id && r.tenantId === where.tenantId) ?? null),
      updateMany: jest.fn(async ({ where, data }: Row) => { const hit = appts.filter((r) => r.id === where.id && r.tenantId === where.tenantId); hit.forEach((r) => Object.assign(r, data)); return { count: hit.length }; }),
    },
    customer: { findFirst: jest.fn(async ({ where }: Row) => customers.find((c) => c.id === where.id && c.tenantId === where.tenantId) ?? null) },
    walkIn: { updateMany: jest.fn(async ({ where, data }: Row) => { walkIns.filter((w) => w.tenantId === where.tenantId && w.appointmentId === where.appointmentId).forEach((w) => Object.assign(w, data)); return { count: 1 }; }) },
  };
  const made: Row[] = [];
  const customersSvc = {
    findOrCreateByContact: jest.fn(async (tenantId: string, input: Row) => {
      const hit = customers.find((c) => c.tenantId === tenantId && input.phone && c.phone === input.phone);
      if (hit) return hit;
      const c = { id: `new${made.length + 1}`, tenantId, firstName: input.firstName, lastName: input.lastName ?? null, phone: input.phone ?? null };
      made.push(c); customers.push(c); return c;
    }),
  };
  Object.assign(svc as unknown as Row, { audit, prisma, customers: customersSvc });
  return { svc, appts, walkIns, made, audit };
}
const admin = (tenantId: string) => ({ userId: 'u-' + tenantId, tenantId, role: 'SALON_ADMIN' } as never);

describe('find / change the booking\'s client', () => {
  it('moves the booking (and its checked-in ticket) to another client on file', async () => {
    const { svc, appts, walkIns, audit } = make();
    expect(await svc.switchCustomer(admin('A'), 'b1', { customerId: 'c-chris' })).toEqual({ id: 'b1', customerId: 'c-chris', changed: true });
    expect(appts[0].customerId).toBe('c-chris');
    expect(walkIns[0]).toMatchObject({ customerId: 'c-chris', customerName: 'Christina Gropes' });
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'booking.customer_switched', tenantId: 'A' }));
  });
  it('a new client by name + phone is created (or the client with that phone reused)', async () => {
    const { svc, appts, made } = make();
    await svc.switchCustomer(admin('A'), 'b1', { firstName: 'Mai', phone: '+19415559999' });
    expect(made).toHaveLength(1);
    expect(appts[0].customerId).toBe('new1');
    await expect(svc.switchCustomer(admin('A'), 'b1', { firstName: '' })).rejects.toBeInstanceOf(BadRequestException);
  });
  it('the same client is a no-op', async () => {
    const { svc, audit } = make();
    expect(await svc.switchCustomer(admin('A'), 'b1', { customerId: 'c-anna' })).toMatchObject({ changed: false });
    expect(audit.log).not.toHaveBeenCalled();
  });
  it('another salon\'s client or booking is never reachable', async () => {
    const { svc, appts } = make();
    await expect(svc.switchCustomer(admin('A'), 'b1', { customerId: 'c-b' })).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.switchCustomer(admin('A'), 'bB', { customerId: 'c-chris' })).rejects.toBeInstanceOf(NotFoundException);
    expect(appts.find((a) => a.id === 'bB')?.customerId).toBe('c-b');
    expect(appts.find((a) => a.id === 'b1')?.customerId).toBe('c-anna');
  });
});

describe('sign-in "I am not a robot"', () => {
  const OLD = process.env.LOGIN_TURNSTILE_SECRET;
  afterEach(() => { if (OLD === undefined) delete process.env.LOGIN_TURNSTILE_SECRET; else process.env.LOGIN_TURNSTILE_SECRET = OLD; });
  const cf = (success: boolean) => jest.fn(async () => ({ json: async () => ({ success }) }));
  it('off until LOGIN_TURNSTILE_SECRET is set — the login works as before', async () => {
    delete process.env.LOGIN_TURNSTILE_SECRET;
    expect(await verifyLoginCaptcha(undefined)).toBe(true);
  });
  it('on: no answer or a wrong one is refused; Cloudflare\'s yes passes', async () => {
    process.env.LOGIN_TURNSTILE_SECRET = 'secret';
    expect(await verifyLoginCaptcha(undefined, '1.2.3.4', cf(true))).toBe(false);
    expect(await verifyLoginCaptcha('tok', '1.2.3.4', cf(false))).toBe(false);
    const ok = cf(true);
    expect(await verifyLoginCaptcha('tok', '1.2.3.4', ok)).toBe(true);
    expect(ok).toHaveBeenCalledWith('https://challenges.cloudflare.com/turnstile/v0/siteverify', expect.objectContaining({ method: 'POST' }));
  });
  it('the booking pages\' TURNSTILE_SECRET does not switch the login on (and the other way round)', async () => {
    delete process.env.LOGIN_TURNSTILE_SECRET;
    process.env.TURNSTILE_SECRET = 'booking-only';
    expect(await verifyLoginCaptcha(undefined)).toBe(true);
    delete process.env.TURNSTILE_SECRET;
  });
});
