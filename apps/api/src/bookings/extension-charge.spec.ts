jest.mock('@prisma/client', () => {
  const actual = jest.requireActual('@prisma/client');
  return {
    ...actual,
    UserRole: actual.UserRole?.SALON_ADMIN ? actual.UserRole : { SALON_ADMIN: 'SALON_ADMIN', STAFF: 'STAFF', SUPER_ADMIN: 'SUPER_ADMIN' },
    AppointmentStatus: actual.AppointmentStatus?.CONFIRMED ? actual.AppointmentStatus : { PENDING: 'PENDING', ASSIGNED: 'ASSIGNED', ACCEPTED: 'ACCEPTED', CONFIRMED: 'CONFIRMED', ARRIVED: 'ARRIVED', COMPLETED: 'COMPLETED', CANCELLED: 'CANCELLED', NO_SHOW: 'NO_SHOW', REJECTED: 'REJECTED' },
  };
});
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { BookingsService } from './bookings.service';

/**
 * Gia hạn with money (./extension-price): a longer visit adds a priced line by
 * the salon's own policy, taking the time back gives the money back, and one
 * salon's policy never prices another salon's visit.
 */
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const T0 = new Date('2030-03-09T17:00:00Z');
function make() {
  const appts: Row[] = [
    { id: 'b1', tenantId: 'A', status: 'CONFIRMED', serviceId: 'fill', priceCents: 6000, startTime: T0, endTime: new Date(T0.getTime() + 75 * 60_000), addons: [{ id: 'art', name: 'Nail art', priceCents: 1000, durationMinutes: 15, kind: 'service' }], assignedStaffId: null, source: 'desk', notes: null },
    { id: 'bB', tenantId: 'B', status: 'CONFIRMED', serviceId: 'x', priceCents: 1000, startTime: T0, endTime: T0, addons: [], assignedStaffId: null, source: 'desk', notes: 'B only' },
  ];
  const services: Row[] = [
    { id: 'fill', tenantId: 'A', name: 'Gel fill', priceCents: 5000, durationMinutes: 60, isActive: true, discountPercent: 0, categoryId: null },
    { id: 'full', tenantId: 'A', name: 'Full set', priceCents: 7000, durationMinutes: 90, isActive: true, discountPercent: 0, categoryId: null },
    { id: 'theirs', tenantId: 'B', name: 'Their full set', priceCents: 100, durationMinutes: 10, isActive: true, discountPercent: 0, categoryId: null },
  ];
  const svc = Object.create(BookingsService.prototype) as BookingsService;
  const audit = { log: jest.fn(async () => undefined) };
  const appointment = {
    findFirst: jest.fn(async ({ where }: Row) => appts.find((r) => r.id === where.id && r.tenantId === where.tenantId) ?? null),
    updateMany: jest.fn(async ({ where, data }: Row) => {
      const hit = appts.filter((r) => r.id === where.id && r.tenantId === where.tenantId);
      hit.forEach((r) => Object.assign(r, data));
      return { count: hit.length };
    }),
  };
  const settings: Row[] = [{ tenantId: 'B', key: 'extension_pricing', value: { mode: 'per15', per15Cents: 99900 } }];
  const prisma = {
    appointment,
    setting: {
      findFirst: jest.fn(async ({ where }: Row) => settings.find((r) => r.tenantId === where.tenantId && r.key === where.key) ?? null),
      upsert: jest.fn(async ({ where, create, update }: Row) => { const r = settings.find((x) => x.tenantId === where.tenantId_key.tenantId && x.key === where.tenantId_key.key); if (r) Object.assign(r, update); else settings.push(create); return {}; }),
    },
    service: {
      findFirst: jest.fn(async ({ where }: Row) => services.find((s) => s.id === where.id && s.tenantId === where.tenantId && (where.isActive === undefined || s.isActive === where.isActive)) ?? null),
      findMany: jest.fn(async ({ where }: Row) => services.filter((s) => where.id.in.includes(s.id) && s.tenantId === where.tenantId)),
    },
    $transaction: jest.fn(async (fn: (tx: Row) => unknown) => fn({ appointment })),
  };
  Object.assign(svc as unknown as Row, {
    audit, prisma,
    promoDiscountPercent: jest.fn(async () => 0),
    getById: jest.fn(async (_u: Row, id: string) => appts.find((r) => r.id === id)),
  });
  return { svc, appts, audit, settings };
}
const desk = (tenantId: string) => ({ userId: 'u-' + tenantId, email: 'x@y', role: 'SALON_ADMIN', tenantId }) as never;


describe('gia hạn — a longer visit and its price', () => {
  it('prorates the main service: Gel fill $50 / 60 min → +30 min = +$25, a line on the bill', async () => {
    const { svc, appts } = make();
    const q = await svc.extensionQuote(desk('A'), 'b1', 30);
    expect(q).toEqual({ mode: 'prorate', priceCents: 2500, currency: undefined });
    await svc.editLines(desk('A'), 'b1', { extraMinutes: 30, chargeExtra: true, lang: 'vi' });
    const b = appts[0];
    expect(b.priceCents).toBe(6000 + 2500);
    expect((b.endTime.getTime() - T0.getTime()) / 60_000).toBe(75 + 30);
    expect(b.addons[1]).toEqual({ kind: 'extension', name: 'Gia hạn 30 phút', durationMinutes: 30, priceCents: 2500 });
  });

  it('"Không tính" keeps the old behaviour: time only', async () => {
    const { svc, appts } = make();
    await svc.editLines(desk('A'), 'b1', { extraMinutes: 30, chargeExtra: false });
    expect(appts[0].priceCents).toBe(6000);
    expect((appts[0].endTime.getTime() - T0.getTime()) / 60_000).toBe(105);
  });

  it('taking 15 minutes back gives back half of a 30-minute extension', async () => {
    const { svc, appts } = make();
    await svc.editLines(desk('A'), 'b1', { extraMinutes: 30, chargeExtra: true, lang: 'vi' });
    expect((await svc.extensionQuote(desk('A'), 'b1', -15)).priceCents).toBe(-1250);
    await svc.editLines(desk('A'), 'b1', { extraMinutes: -15, chargeExtra: true, lang: 'vi' });
    expect(appts[0].priceCents).toBe(6000 + 1250);
    expect((appts[0].endTime.getTime() - T0.getTime()) / 60_000).toBe(90);
    expect(appts[0].addons[1]).toMatchObject({ name: 'Gia hạn 15 phút', priceCents: 1250, durationMinutes: 15 });
  });

  it('one salon\'s policy never prices another\'s visit; another salon\'s booking is not found', async () => {
    const { svc, settings } = make();
    expect(await svc.getExtensionPolicy(desk('A'))).toEqual({ mode: 'prorate', per15Cents: 0 });
    expect((await svc.getExtensionPolicy(desk('B'))).mode).toBe('per15');
    await svc.setExtensionPolicy(desk('A'), { mode: 'free' });
    expect(settings.find((r) => r.tenantId === 'B')!.value.mode).toBe('per15');
    expect((await svc.extensionQuote(desk('A'), 'b1', 30)).priceCents).toBe(0);
    await expect(svc.extensionQuote(desk('A'), 'bB', 30)).rejects.toBeInstanceOf(NotFoundException);
  });
});
