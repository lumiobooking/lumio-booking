/**
 * What was taken back, and by whom (18/11/2026): the full list of dishes
 * voided after the kitchen had them, for one restaurant and one window —
 * never another restaurant's dishes, tables or people.
 */
import { BadRequestException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { RestaurantService } from './restaurant.service';
import { RestaurantController } from './restaurant.controller';
import { DEFAULT_SETTINGS, cleanSettings, dayStartHourOf } from './check-logic';

type Row = Record<string, any>;
const A = 't-a';
const B = 't-b';
const at = (s: string) => new Date(s);
const user = (tenantId: string) => ({ userId: `u-${tenantId}`, email: 'x@y.z', role: UserRole.SALON_ADMIN, tenantId } as never);

function make() {
  const checks: Row[] = [
    { id: 'c1', tenantId: A, number: 12, tableIds: ['T1'], status: 'PAID' },
    { id: 'c2', tenantId: A, number: 13, tableIds: ['T2'], status: 'VOID', openedAt: at('2026-11-17T12:00:00Z'), closedAt: at('2026-11-17T13:00:00Z'), voidReason: 'khach di' },
    { id: 'c3', tenantId: A, number: 14, tableIds: ['T1'], status: 'VOID', openedAt: at('2026-11-17T12:00:00Z'), closedAt: at('2026-11-17T13:10:00Z'), voidReason: 'MERGED' },
    { id: 'cb', tenantId: B, number: 12, tableIds: ['TB'], status: 'VOID', openedAt: at('2026-11-17T12:00:00Z'), closedAt: at('2026-11-17T13:00:00Z'), voidReason: 'other shop' },
  ];
  const lines: Row[] = [
    { tenantId: A, checkId: 'c1', state: 'VOID', name: 'Lẩu hải sản', quantity: 1, unitPriceCents: 199000, voidReason: 'khách đổi ý', voidByUserId: 'staff-1', voidApprovedBy: 'owner-1', voidedAt: at('2026-11-17T13:30:00Z'), sentAt: at('2026-11-17T13:00:00Z') },
    { tenantId: A, checkId: 'c1', state: 'VOID', name: 'Bia', quantity: 6, unitPriceCents: 21000, voidReason: 'Khách đổi ý', voidByUserId: 'staff-1', voidApprovedBy: 'staff-1', voidedAt: at('2026-11-17T14:00:00Z'), sentAt: null },
    { tenantId: A, checkId: 'c2', state: 'VOID', name: 'Mực', quantity: 1, unitPriceCents: 89000, voidReason: 'khach di', voidByUserId: 'owner-1', voidApprovedBy: null, voidedAt: at('2026-11-17T13:00:00Z'), sentAt: null },
    { tenantId: A, checkId: 'c3', state: 'VOID', name: 'Moved', quantity: 2, unitPriceCents: 10000, voidReason: 'MERGED', voidByUserId: 'staff-1', voidApprovedBy: null, voidedAt: at('2026-11-17T13:10:00Z'), sentAt: null },
    { tenantId: A, checkId: 'c1', state: 'VOID', name: 'Old', quantity: 1, unitPriceCents: 50000, voidReason: 'x', voidByUserId: 'staff-1', voidApprovedBy: null, voidedAt: at('2026-11-10T13:00:00Z'), sentAt: null },
    { tenantId: A, checkId: 'c1', state: 'SENT', name: 'Served', quantity: 1, unitPriceCents: 50000, voidReason: null, voidByUserId: null, voidApprovedBy: null, voidedAt: null, sentAt: null },
    { tenantId: B, checkId: 'cb', state: 'VOID', name: 'Steak', quantity: 9, unitPriceCents: 900000, voidReason: 'other shop', voidByUserId: 'staff-b', voidApprovedBy: null, voidedAt: at('2026-11-17T13:00:00Z'), sentAt: null },
  ];
  const users: Row[] = [
    { id: 'staff-1', tenantId: A, firstName: 'Lan', email: 'lan@a.vn' },
    { id: 'owner-1', tenantId: A, firstName: '', email: 'chu@a.vn' },
    { id: 'staff-b', tenantId: B, firstName: 'Other', email: 'o@b.vn' },
  ];
  const inWin = (v: Date | null, w: Row) => !!v && (!w.gte || v >= w.gte) && (!w.lte || v <= w.lte);
  const asked: Row[] = [];
  const prisma: Row = {
    tableCheckLine: {
      findMany: jest.fn(async (a: Row) => {
        asked.push(a.where);
        return lines.filter((l) => l.tenantId === a.where.tenantId && l.state === a.where.state && inWin(l.voidedAt, a.where.voidedAt) && l.voidReason !== a.where.NOT.voidReason)
          .map((l) => ({ ...l, check: (({ number, tableIds, status }) => ({ number, tableIds, status }))(checks.find((c) => c.id === l.checkId && c.tenantId === l.tenantId)!) }));
      }),
    },
    tableCheck: {
      findMany: jest.fn(async (a: Row) => checks.filter((c) => c.tenantId === a.where.tenantId && c.status === a.where.status && inWin(c.closedAt, a.where.closedAt) && c.voidReason !== a.where.NOT.voidReason)),
    },
    user: { findMany: jest.fn(async (a: Row) => users.filter((u) => u.tenantId === a.where.tenantId && a.where.id.in.includes(u.id))) },
    restaurantTable: { findMany: jest.fn(async (a: Row) => [{ id: 'T1', name: 'Bàn 1', tenantId: A }, { id: 'T2', name: 'Bàn 2', tenantId: A }, { id: 'TB', name: 'Bàn B', tenantId: B }].filter((t) => t.tenantId === a.where.tenantId)) },
    tenant: { findUnique: jest.fn(async () => ({ timezone: 'Asia/Ho_Chi_Minh' })) },
  };
  const settings = { getBookingRules: jest.fn(async () => ({ currency: 'VND' })) };
  const svc = new RestaurantService(prisma as never, { log: jest.fn() } as never, settings as never, {} as never, {} as never);
  return { svc, asked };
}

const WIN = ['2026-11-16T21:00:00.000Z', '2026-11-17T20:59:59.999Z'] as const; // 04:00 → 03:59 in Vietnam

describe('the voids report', () => {
  it('lists every dish taken back in the window, with who took it back and who approved it', async () => {
    const { svc } = make();
    const r = await svc.voidsReport(user(A), ...WIN);
    expect(r.lines.map((l) => l.name).sort()).toEqual(['Bia', 'Lẩu hải sản', 'Mực']);
    expect(r.totals).toEqual({ items: 8, amountCents: 89000 + 199000 + 126000, lines: 3 });
    const lau = r.lines.find((l) => l.name === 'Lẩu hải sản')!;
    expect(lau).toMatchObject({ by: 'Lan', approvedBy: 'chu', table: expect.stringContaining('Bàn 1'), checkNumber: 12, wholeCheck: false, sentAt: '2026-11-17T13:00:00.000Z' });
    expect(r.lines.find((l) => l.name === 'Bia')!.approvedBy).toBeNull(); // approved by themselves: not a second person
    expect(r.lines.find((l) => l.name === 'Mực')!.wholeCheck).toBe(true);
    expect(r.truncated).toBe(false);
  });

  it('groups by reason (case and spacing do not split one reason) and by person', async () => {
    const { svc } = make();
    const r = await svc.voidsReport(user(A), ...WIN);
    expect(r.byReason[0]).toEqual({ key: 'khách đổi ý', items: 7, amountCents: 325000 });
    expect(r.byUser.map((u) => u.key)).toEqual(['Lan', 'chu']);
  });

  it('tables closed without a bill are listed; tables merged into another are not', async () => {
    const { svc } = make();
    const r = await svc.voidsReport(user(A), ...WIN);
    expect(r.checks).toEqual([expect.objectContaining({ number: 13, reason: 'khach di' })]);
    expect(r.lines.some((l) => l.name === 'Moved')).toBe(false);
  });

  it('CROSS-TENANT: another restaurant\'s dishes, tables and people never appear', async () => {
    const { svc, asked } = make();
    const r = await svc.voidsReport(user(A), ...WIN);
    expect(JSON.stringify(r)).not.toMatch(/Steak|Other|Bàn B|other shop/);
    expect(asked.every((w) => w.tenantId === A)).toBe(true);
    const b = await svc.voidsReport(user(B), ...WIN);
    expect(b.lines.map((l) => l.name)).toEqual(['Steak']);
    expect(JSON.stringify(b)).not.toMatch(/Lan|Lẩu|Bàn 1/);
  });

  it('a window must be real and at most 45 days', async () => {
    const { svc } = make();
    await expect(svc.voidsReport(user(A), 'x', 'y')).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.voidsReport(user(A), WIN[1], WIN[0])).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.voidsReport(user(A), '2026-01-01T00:00:00Z', '2026-11-01T00:00:00Z')).rejects.toThrow('RANGE_TOO_LONG');
  });

  it('is a reports screen: the owner, and staff only with the reports right', () => {
    const caps = Reflect.getMetadata('required_caps', RestaurantController.prototype.voids);
    expect(caps).toEqual(['reports']);
  });
});

describe('the business day', () => {
  it('starts at 04:00 unless the owner picks 0–8', () => {
    expect(DEFAULT_SETTINGS.dayStartHour).toBe(4);
    expect(cleanSettings({}).dayStartHour).toBe(4);
    expect(cleanSettings({ dayStartHour: 6 }).dayStartHour).toBe(6);
    expect(cleanSettings({ dayStartHour: 0 }).dayStartHour).toBe(0);
    for (const bad of [9, -1, 4.5, null, 'x', true]) expect(dayStartHourOf(bad)).toBe(4);
  });
});
