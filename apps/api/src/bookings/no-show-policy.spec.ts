jest.mock('@prisma/client', () => {
  const actual = jest.requireActual('@prisma/client');
  return { ...actual, AppointmentStatus: actual.AppointmentStatus ?? { NO_SHOW: 'NO_SHOW' }, UserRole: actual.UserRole ?? { SALON_ADMIN: 'SALON_ADMIN', STAFF: 'STAFF' } };
});
import { BadRequestException } from '@nestjs/common';
import { cleanNoShowPolicy, noShowVerdict, windowStart, DEFAULT_NO_SHOW_POLICY, NO_SHOW_BLOCK_MESSAGE } from './no-show-policy';
import { BookingsService } from './bookings.service';

describe('no-show policy — rules', () => {
  it('defaults: warn from 2, never refuse online, 12 months', () => {
    expect(cleanNoShowPolicy(null)).toEqual(DEFAULT_NO_SHOW_POLICY);
    expect(DEFAULT_NO_SHOW_POLICY).toEqual({ warnAt: 2, blockOnlineAt: null, months: 12 });
  });
  it('cleans input and keeps the rest', () => {
    expect(cleanNoShowPolicy({ warnAt: '3', blockOnlineAt: 99, months: 0 })).toEqual({ warnAt: 3, blockOnlineAt: 20, months: 1 });
    expect(cleanNoShowPolicy({ blockOnlineAt: null }, { warnAt: 4, blockOnlineAt: 3, months: 6 })).toEqual({ warnAt: 4, blockOnlineAt: null, months: 6 });
    expect(cleanNoShowPolicy({ warnAt: 'x' }, { warnAt: 4, blockOnlineAt: 3, months: 6 }).warnAt).toBe(4);
  });
  it('verdicts', () => {
    expect(noShowVerdict(1, DEFAULT_NO_SHOW_POLICY)).toEqual({ warn: false, blockOnline: false });
    expect(noShowVerdict(2, DEFAULT_NO_SHOW_POLICY)).toEqual({ warn: true, blockOnline: false });
    expect(noShowVerdict(9, { warnAt: 0, blockOnlineAt: 3, months: 12 })).toEqual({ warn: false, blockOnline: true });
  });
  it('window', () => {
    expect(windowStart({ warnAt: 2, blockOnlineAt: null, months: 6 }, new Date('2026-10-07T00:00:00Z')).toISOString()).toBe('2026-04-07T00:00:00.000Z');
  });
});

describe('no-show policy — service, one salon at a time', () => {
  type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  function make(policy: Row | null, noShows: number) {
    const calls: Row[] = [];
    const prisma: Row = {
      setting: {
        findUnique: jest.fn(async ({ where }: Row) => { calls.push(where.tenantId_key); return policy ? { value: policy } : null; }),
        upsert: jest.fn(async () => ({})),
      },
      customer: {
        findMany: jest.fn(async ({ where }: Row) => { calls.push(where); return where.tenantId === 't1' ? [{ id: 'c1', phone: '+1 (512) 886-8189' }, { id: 'c9', phone: '9998868189' }] : []; }),
        findFirst: jest.fn(async ({ where }: Row) => { calls.push(where); return where.tenantId === 't1' && where.id === 'c1' ? { id: 'c1' } : null; }),
      },
      appointment: { count: jest.fn(async ({ where }: Row) => { calls.push(where); return where.tenantId === 't1' ? noShows : 0; }) },
    };
    const audit = { log: jest.fn(async () => undefined) };
    const svc = Object.create(BookingsService.prototype) as BookingsService & Row;
    Object.assign(svc, { prisma, audit });
    return { svc, prisma, audit, calls };
  }
  const owner = (t: string) => ({ userId: 'u', role: 'SALON_ADMIN', tenantId: t } as never);

  it('desk check matches the number however it was typed, inside the salon only', async () => {
    const { svc, prisma, calls } = make(null, 3);
    const out = await svc.noShowCheck(owner('t1'), { phone: '512-886-8189' });
    expect(out).toMatchObject({ count: 3, warn: true, blockOnline: false, months: 12 });
    expect(prisma.appointment.count.mock.calls[0][0].where.customerId.in).toEqual(['c1']);
    expect(calls.every((w) => w.tenantId === 't1')).toBe(true);
  });

  it('another salon\'s customer id finds nothing', async () => {
    const { svc } = make(null, 3);
    const out = await svc.noShowCheck(owner('t2'), { customerId: 'c1' });
    expect(out.count).toBe(0);
  });

  it('online booking: refused only when the owner set a limit and it is reached', async () => {
    const off = make(null, 9);
    await expect((off.svc as never as { assertNoShowPolicy: (t: string, p: string) => Promise<void> }).assertNoShowPolicy('t1', '5128868189')).resolves.toBeUndefined();
    expect(off.prisma.appointment.count).not.toHaveBeenCalled();
    const on = make({ blockOnlineAt: 3 }, 3);
    await expect((on.svc as never as { assertNoShowPolicy: (t: string, p: string) => Promise<void> }).assertNoShowPolicy('t1', '5128868189')).rejects.toThrow(new BadRequestException(NO_SHOW_BLOCK_MESSAGE));
    const under = make({ blockOnlineAt: 3 }, 2);
    await expect((under.svc as never as { assertNoShowPolicy: (t: string, p: string) => Promise<void> }).assertNoShowPolicy('t1', '5128868189')).resolves.toBeUndefined();
  });

  it('saving is scoped and audited', async () => {
    const { svc, prisma, audit } = make({ warnAt: 4 }, 0);
    const out = await svc.updateNoShowPolicy(owner('t1'), { blockOnlineAt: 3 });
    expect(out).toEqual({ warnAt: 4, blockOnlineAt: 3, months: 12 });
    expect(prisma.setting.upsert.mock.calls[0][0].where.tenantId_key).toEqual({ tenantId: 't1', key: 'no_show_policy' });
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 't1', action: 'settings.no_show_policy_updated' }));
  });
});
