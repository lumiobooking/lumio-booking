import { BadRequestException, NotFoundException } from '@nestjs/common';
import { addMonthsDay, isDay, markRenewal, serviceTermOf, setServiceTerm, SERVICE_TERM_KEY } from './service-term';

/** An in-memory Setting table, keyed by tenant + key — enough to see which salon a write lands on. */
function store(tenants = ['salon-a', 'salon-b']) {
  const rows = new Map<string, unknown>();
  const k = (t: string, key: string) => `${t}|${key}`;
  const prisma = {
    tenant: { findFirst: jest.fn(async ({ where }: any) => (tenants.includes(where.id) ? { id: where.id } : null)) },
    setting: {
      findUnique: jest.fn(async ({ where }: any) => {
        const v = rows.get(k(where.tenantId_key.tenantId, where.tenantId_key.key));
        return v === undefined ? null : { value: v };
      }),
      upsert: jest.fn(async ({ where, create }: any) => { rows.set(k(where.tenantId_key.tenantId, where.tenantId_key.key), create.value); return {}; }),
      deleteMany: jest.fn(async ({ where }: any) => { rows.delete(k(where.tenantId, where.key)); return {}; }),
    },
    auditLog: { create: jest.fn(async () => ({})) },
  };
  return { prisma, read: (t: string) => serviceTermOf(rows.get(k(t, SERVICE_TERM_KEY))) };
}
const lan = { userId: 'u-lan', email: 'lan@lumio.test' };

describe('service term', () => {
  it('reads calendar days, clamps month ends', () => {
    expect(isDay('2026-10-19')).toBe(true);
    for (const v of ['2026-02-30', '19/10/2026', '', null, 5]) expect(isDay(v)).toBe(false);
    expect(addMonthsDay('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonthsDay('2026-07-19', 3)).toBe('2026-10-19');
    expect(addMonthsDay('2026-11-15', 3)).toBe('2027-02-15');
  });

  it('reads junk as no term, and defaults the alert to 14 days', () => {
    expect(serviceTermOf(null)).toBeNull();
    expect(serviceTermOf({ end: 'soon' })).toBeNull();
    expect(serviceTermOf({ end: '2026-10-19' })).toMatchObject({ end: '2026-10-19', start: null, alertDays: 14, renew: null });
  });

  it('works the end out from start + months, on that salon only, and audits it', async () => {
    const { prisma, read } = store();
    const r = await setServiceTerm(prisma as never, lan, 'salon-a', { start: '2026-07-19', months: 3 });
    expect(r.serviceTerm).toMatchObject({ start: '2026-07-19', end: '2026-10-19', months: 3, alertDays: 14 });
    expect(read('salon-a')?.end).toBe('2026-10-19');
    expect(read('salon-b')).toBeNull(); // the other salon is untouched
    expect((prisma.auditLog.create.mock.calls[0] as any)[0].data).toMatchObject({ tenantId: 'salon-a', action: 'support.service_term_set' });
  });

  it('refuses bad input and a salon that does not exist', async () => {
    const { prisma } = store();
    await expect(setServiceTerm(prisma as never, lan, 'salon-a', { start: '2026-07-19' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(setServiceTerm(prisma as never, lan, 'salon-a', { start: '2026-07-19', end: '2026-07-01' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(setServiceTerm(prisma as never, lan, 'salon-a', { end: '2026-10-19', months: 0 })).rejects.toBeInstanceOf(BadRequestException);
    await expect(setServiceTerm(prisma as never, lan, 'nope', { end: '2026-10-19' })).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.setting.upsert).not.toHaveBeenCalled();
  });

  it('told → renewed moves the term on and starts the next cycle un-told', async () => {
    const { prisma, read } = store();
    await setServiceTerm(prisma as never, lan, 'salon-a', { start: '2026-07-19', end: '2026-10-19', months: 3 });
    await markRenewal(prisma as never, lan, 'salon-a', { action: 'told', note: '  Khách hỏi gói 6 tháng ' });
    expect(read('salon-a')?.renew).toMatchObject({ state: 'told', by: 'lan@lumio.test', forEnd: '2026-10-19', note: 'Khách hỏi gói 6 tháng' });
    const r = await markRenewal(prisma as never, lan, 'salon-a', { action: 'renewed', months: 6 });
    expect(r.serviceTerm).toMatchObject({ start: '2026-10-19', end: '2027-04-19', renew: { state: 'renewed', prevEnd: '2026-10-19', renewedTo: '2027-04-19' } });
    await markRenewal(prisma as never, lan, 'salon-a', { action: 'undo' });
    expect(read('salon-a')?.renew).toBeNull();
    expect(read('salon-a')?.end).toBe('2027-04-19');
  });

  it('keeps one salon\'s renewal off another', async () => {
    const { prisma, read } = store();
    await setServiceTerm(prisma as never, lan, 'salon-a', { end: '2026-10-19' });
    await setServiceTerm(prisma as never, lan, 'salon-b', { end: '2026-11-30' });
    await markRenewal(prisma as never, lan, 'salon-b', { action: 'told' });
    expect(read('salon-a')?.renew).toBeNull();
    expect(read('salon-b')?.renew?.forEnd).toBe('2026-11-30');
  });

  it('refuses a renewal with no term, no length, or an end that goes backwards', async () => {
    const { prisma } = store();
    await expect(markRenewal(prisma as never, lan, 'salon-a', { action: 'told' })).rejects.toBeInstanceOf(BadRequestException);
    await setServiceTerm(prisma as never, lan, 'salon-a', { end: '2026-10-19' });
    await expect(markRenewal(prisma as never, lan, 'salon-a', { action: 'renewed' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(markRenewal(prisma as never, lan, 'salon-a', { action: 'renewed', end: '2026-10-01' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(markRenewal(prisma as never, lan, 'salon-a', { action: 'wipe' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(markRenewal(prisma as never, lan, 'nope', { action: 'told' })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('clearing removes only that salon\'s row', async () => {
    const { prisma, read } = store();
    await setServiceTerm(prisma as never, lan, 'salon-a', { end: '2026-10-19' });
    await setServiceTerm(prisma as never, lan, 'salon-b', { end: '2026-10-19' });
    await setServiceTerm(prisma as never, lan, 'salon-a', { clear: true });
    expect(read('salon-a')).toBeNull();
    expect(read('salon-b')?.end).toBe('2026-10-19');
  });
});
