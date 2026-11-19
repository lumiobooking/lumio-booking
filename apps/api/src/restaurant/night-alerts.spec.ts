import {
  DEFAULT_ALERTS, alertKeyOf, alertText, businessDayKey, cleanAlerts, isBigDiscount, logKindOf, nightlyText, recipientsFor, varianceMatters,
} from './night-alerts';
import { NightLogService, zonedInstant } from './night-log.service';

const vnd = (c: number) => `${c.toLocaleString('vi-VN')} đ`;

describe('restaurant alerts — rules', () => {
  it('cleans saved settings: junk dropped, gaps filled, limits kept in range', () => {
    const a = cleanAlerts({ notify: { paid: { owner: true }, tableOpen: 'yes' }, voidItems: '5', discountPct: 500, witnessOnClose: true, junk: 1 });
    expect(a.notify.paid).toEqual({ owner: true, manager: false });
    expect(a.notify.tableOpen).toEqual(DEFAULT_ALERTS.notify.tableOpen);
    expect(a.voidItems).toBe(5);
    expect(a.discountPct).toBe(DEFAULT_ALERTS.discountPct);
    expect(a.witnessOnClose).toBe(true);
    expect((a as unknown as Record<string, unknown>).junk).toBeUndefined();
    expect(cleanAlerts(null)).toEqual(DEFAULT_ALERTS);
  });

  it('maps till actions to log kinds and alert settings', () => {
    expect(logKindOf('pos.shift_opened')).toBe('shift');
    expect(logKindOf('restaurant.item_voided')).toBe('void');
    expect(logKindOf('restaurant.settings_updated')).toBeNull();
    expect(alertKeyOf('order.voided')).toBe('checkVoid');
    expect(alertKeyOf('restaurant.check_reopened')).toBe('checkVoid');
    expect(alertKeyOf('restaurant.sent_to_kitchen')).toBeNull();
  });

  it('discount and variance thresholds', () => {
    expect(isBigDiscount(300, 1000, 30)).toBe(true);
    expect(isBigDiscount(299, 1000, 30)).toBe(false);
    expect(isBigDiscount(0, 0, 30)).toBe(false);
    expect(varianceMatters(-100_000, 100_000)).toBe(true);
    expect(varianceMatters(99_999, 100_000)).toBe(false);
    expect(varianceMatters(0, 0)).toBe(false);
  });

  it('never alerts the person who did it, and follows owner / manager ticks', () => {
    const people = [{ id: 'o', kind: 'owner' as const }, { id: 'm', kind: 'manager' as const }];
    expect(recipientsFor({ owner: true, manager: true }, people, 'm')).toEqual(['o']);
    expect(recipientsFor({ owner: false, manager: true }, people, null)).toEqual(['m']);
    expect(recipientsFor({ owner: false, manager: false }, people, null)).toEqual([]);
  });

  it('lock-screen words, in Vietnamese', () => {
    const close = alertText('shiftClose', 'pos.shift_closed', { vi: true, money: vnd, who: 'Lan', expectedCents: 13_200_000, countedCents: 12_000_000, varianceCents: -1_200_000, witness: 'Minh' });
    expect(close.title).toBe('Đóng ca · thiếu 1.200.000 đ');
    expect(close.body).toContain('Minh kiểm két');
    const v = alertText('checkVoid', 'order.voided', { vi: true, money: vnd, who: 'Lan', approver: 'Minh', orderNumber: 148, amountCents: 1_850_000, table: 'Bàn 7', reason: 'Khách đổi món' });
    expect(v.title).toBe('Huỷ bill đã thu #148 · 1.850.000 đ');
    expect(v.body).toBe('Bàn 7 · Lan huỷ, Minh duyệt. Lý do: “Khách đổi món”.');
    const self = alertText('checkVoid', 'restaurant.check_voided', { vi: true, money: vnd, who: 'Lan', approver: 'Lan', checkNumber: 9 });
    expect(self.body).not.toContain('duyệt');
    const n = nightlyText({ vi: true, money: vnd, label: 'Đêm 17/11', netCents: 34_962_800, bills: 44, voidedBills: 1, voidedCents: 1_850_000, voidItems: 9, voidItemCents: 1_185_000, openShift: true });
    expect(n.title).toBe('Đêm 17/11: 34.962.800 đ');
    expect(n.body).toBe('44 bill · huỷ 1 bill 1.850.000 đ · huỷ 9 món 1.185.000 đ · ca chưa chốt');
  });

  it('the business day starts at the restaurant’s hour, in its zone', () => {
    // 02:30 in Saigon on 19/11 still belongs to the night of 18/11.
    expect(businessDayKey(new Date('2026-11-18T19:30:00Z'), 'Asia/Ho_Chi_Minh', 4)).toBe('2026-11-18');
    expect(businessDayKey(new Date('2026-11-18T21:30:00Z'), 'Asia/Ho_Chi_Minh', 4)).toBe('2026-11-19');
    expect(zonedInstant('2026-11-19', 4, 'Asia/Ho_Chi_Minh').toISOString()).toBe('2026-11-18T21:00:00.000Z');
    expect(zonedInstant('2026-07-01', 4, 'America/Chicago').toISOString()).toBe('2026-07-01T09:00:00.000Z');
  });
});

// ------------------------------------------------------------------ service
type Row = Record<string, any>;
function setup(opts: { industry?: string; logs?: Row[]; staffCards?: Row[] } = {}) {
  const users: Row[] = [
    { id: 'oA', tenantId: 'A', role: 'SALON_ADMIN', firstName: 'Thuận', lastName: null, email: 'o@a', isActive: true },
    { id: 'mA', tenantId: 'A', role: 'STAFF', firstName: 'Minh', lastName: null, email: 'm@a', isActive: true },
    { id: 'cA', tenantId: 'A', role: 'STAFF', firstName: 'Lan', lastName: null, email: 'c@a', isActive: true },
    { id: 'oB', tenantId: 'B', role: 'SALON_ADMIN', firstName: 'Bình', lastName: null, email: 'o@b', isActive: true },
  ];
  const cards = opts.staffCards ?? [{ userId: 'mA', tenantId: 'A', staffRole: 'MANAGER', permissions: null }, { userId: 'cA', tenantId: 'A', staffRole: 'WAITER', permissions: null }];
  const logs = opts.logs ?? [];
  const sent: { tenantId: string; title: string; to: string[] }[] = [];
  const settingsRows: Row[] = [];
  const prisma: any = {
    user: { findMany: jest.fn(async ({ where }: any) => users.filter((u) => u.tenantId === where.tenantId && (!where.id?.in || where.id.in.includes(u.id)) && (!where.role?.in || where.role.in.includes(u.role)))) },
    staffMember: { findMany: jest.fn(async ({ where }: any) => cards.filter((c) => c.tenantId === where.tenantId && where.userId.in.includes(c.userId))) },
    tenant: { findUnique: jest.fn(async () => ({ timezone: 'Asia/Ho_Chi_Minh' })) },
    setting: {
      findMany: jest.fn(async ({ where }: any) => settingsRows.filter((r) => r.tenantId === where.tenantId && where.key.in.includes(r.key))),
      findUnique: jest.fn(async () => null),
      upsert: jest.fn(async ({ create }: any) => { settingsRows.push(create); return create; }),
    },
    tableCheck: { findMany: jest.fn(async ({ where }: any) => [{ id: 'k1', tenantId: 'A', number: 148, tableIds: ['t7'] }].filter((c) => c.tenantId === where.tenantId && where.id.in.includes(c.id))) },
    restaurantTable: { findMany: jest.fn(async ({ where }: any) => [{ id: 't7', tenantId: 'A', name: 'Bàn 7' }].filter((t) => t.tenantId === where.tenantId)) },
    tableCheckLine: { findMany: jest.fn(async ({ where }: any) => (where.tenantId === 'A' ? [{ quantity: 2, unitPriceCents: 100_000 }, { quantity: 1, unitPriceCents: 85_000 }] : [])) },
    order: { findMany: jest.fn(async () => []) },
    auditLog: { findMany: jest.fn(async ({ where }: any) => logs.filter((l) => l.tenantId === where.tenantId && where.action.in.includes(l.action) && (!where.userId || l.userId === where.userId))) },
  };
  const push: any = {
    sendToTenant: jest.fn(async (tenantId: string, p: any, o: any) => { sent.push({ tenantId, title: p.title, to: o.onlyUserIds }); }),
    sendToUser: jest.fn(async () => 1),
    countForUser: jest.fn(async () => ({ web: 1, native: 0 })),
  };
  const settings: any = { getBookingRules: jest.fn(async () => ({ currency: 'VND' })), getIndustry: jest.fn(async () => opts.industry ?? 'RESTAURANT') };
  const audit: any = { log: jest.fn(async () => undefined) };
  return { svc: new NightLogService(prisma, audit, settings, push), sent, settingsRows, audit };
}

describe('restaurant alerts — wiring', () => {
  it('a voided paid bill buzzes the owner and the manager, not the cashier who did it', async () => {
    const { svc, sent } = setup();
    await svc.onAudit({ tenantId: 'A', userId: 'cA', action: 'order.voided', resourceType: 'order', resourceId: 'o9', metadata: { reason: 'Khách đổi món', totalCents: 1_850_000, approvedByUserId: 'mA' } }, new Date());
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ tenantId: 'A', to: ['oA', 'mA'] });
    expect(sent[0].title).toContain('1.850.000');
  });

  it('a nail salon gets no restaurant alerts until it saves settings', async () => {
    const { svc, sent } = setup({ industry: 'NAIL_SALON' });
    await svc.onAudit({ tenantId: 'A', userId: 'cA', action: 'pos.shift_opened', metadata: { openingCents: 3_000_000 } }, new Date());
    expect(sent).toHaveLength(0);
  });

  it('dishes taken back alert once the count reaches the threshold, then wait out the window', async () => {
    const { svc, sent } = setup();
    const at = new Date();
    await svc.onAudit({ tenantId: 'A', userId: 'cA', action: 'restaurant.item_voided', resourceType: 'table_check', resourceId: 'k1', metadata: {} }, at);
    await svc.onAudit({ tenantId: 'A', userId: 'cA', action: 'restaurant.item_voided', resourceType: 'table_check', resourceId: 'k1', metadata: {} }, new Date(at.getTime() + 60_000));
    expect(sent).toHaveLength(1);
    expect(sent[0].title).toBe('Huỷ nhiều món · 3 món trong 30 phút');
  });

  it('“paid” alerts are off by default', async () => {
    const { svc, sent } = setup();
    await svc.onAudit({ tenantId: 'A', userId: 'cA', action: 'restaurant.check_paid', resourceType: 'table_check', resourceId: 'k1', metadata: {} }, new Date());
    expect(sent).toHaveLength(0);
  });

  it('the log: owner sees everyone, a waiter only their own; CROSS-TENANT rows never show', async () => {
    const at = new Date('2026-11-18T15:00:00Z');
    const logs = [
      { id: '1', tenantId: 'A', userId: 'cA', action: 'pos.shift_opened', resourceType: 'cash_shift', resourceId: 's', metadata: { openingCents: 3_000_000 }, createdAt: at },
      { id: '2', tenantId: 'A', userId: 'mA', action: 'restaurant.check_voided', resourceType: 'table_check', resourceId: 'k1', metadata: { reason: 'x', approvedBy: 'oA' }, createdAt: at },
      { id: '3', tenantId: 'B', userId: 'oB', action: 'pos.shift_opened', resourceType: 'cash_shift', resourceId: 's2', metadata: {}, createdAt: at },
      { id: '4', tenantId: 'A', userId: 'oA', action: 'restaurant.settings_updated', metadata: {}, createdAt: at },
    ];
    const { svc } = setup({ logs });
    const owner = await svc.log({ userId: 'oA', tenantId: 'A', role: 'SALON_ADMIN' } as never, '2026-11-18T00:00:00Z', '2026-11-19T00:00:00Z');
    expect(owner.events.map((e) => e.id)).toEqual(['1', '2']);
    expect(owner.events[1]).toMatchObject({ by: 'Minh', approvedBy: 'Thuận', table: 'Bàn 7', checkNumber: 148, kind: 'void' });
    const waiter = await svc.log({ userId: 'cA', tenantId: 'A', role: 'STAFF', staffRole: 'WAITER' } as never, '2026-11-18T00:00:00Z', '2026-11-19T00:00:00Z');
    expect(waiter.mine).toBe(true);
    expect(waiter.events.map((e) => e.id)).toEqual(['1']);
    await expect(svc.log({ userId: 'oA', tenantId: 'A', role: 'SALON_ADMIN' } as never, 'x', 'y')).rejects.toThrow('BAD_RANGE');
  });

  it('saves cleaned settings for this salon only, and logs it', async () => {
    const { svc, settingsRows, audit } = setup();
    await svc.saveAlerts({ userId: 'oA', tenantId: 'A', role: 'SALON_ADMIN' } as never, { voidItems: 4, notify: { paid: { owner: true, manager: false } } });
    expect(settingsRows[0]).toMatchObject({ tenantId: 'A', key: 'restaurant.alerts' });
    expect(settingsRows[0].value.voidItems).toBe(4);
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'restaurant.alerts_updated', tenantId: 'A' }));
    const read = await svc.readAlerts({ userId: 'oA', tenantId: 'A', role: 'SALON_ADMIN' } as never);
    expect(read.people.map((p) => p.id)).toEqual(['oA', 'mA']);
  });
});
