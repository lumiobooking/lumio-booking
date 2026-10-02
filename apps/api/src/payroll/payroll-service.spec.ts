jest.mock('@prisma/client', () => ({
  ...jest.requireActual('@prisma/client'),
  AppointmentStatus: { COMPLETED: 'COMPLETED' },
  OrderStatus: { PAID: 'PAID' },
  UserRole: { SALON_ADMIN: 'SALON_ADMIN' },
  Prisma: { DbNull: null },
}));

import { ConflictException, NotFoundException } from '@nestjs/common';
import { PayrollService } from './payroll.service';
import { AuthenticatedUser } from '../common/tenant/tenant-context';

/**
 * Payroll is money owed to named people: these tests prove one salon's payroll
 * is built only from its own rows, and that one salon can never touch
 * another's staff, runs or settings.
 */
const owner = (tenantId: string): AuthenticatedUser => ({ userId: `u-${tenantId}`, email: 'o@x.test', role: 'SALON_ADMIN' as never, tenantId });

function makePrisma() {
  const calls: { model: string; where: any }[] = [];
  const rec = (model: string, ret: (a: any) => any) => jest.fn(async (a: any) => { calls.push({ model, where: a?.where }); return ret(a); });
  const runs: any[] = [
    { id: 'run-b', tenantId: 'tenant-b', periodFrom: '2026-09-28', periodTo: '2026-10-04', status: 'FINAL', lines: [], totals: { netPayCents: 1 } },
  ];
  const prisma: any = {
    tenant: { findUnique: rec('tenant', () => ({ timezone: 'America/Chicago' })) },
    setting: {
      findUnique: rec('setting', () => null),
      upsert: rec('setting.upsert', () => ({})),
    },
    order: { findMany: rec('order', (a) => (a?.where?.OR ? [] : [{
      id: 'o1', paidAt: new Date('2026-09-29T17:00:00Z'), discountCents: 0, changeCents: 0, giftCardAppliedCents: 0,
      items: [{ kind: 'SERVICE', quantity: 1, lineTotalCents: 10000, tipCents: 1500, staffMemberId: 'kim' }],
      tenders: [{ method: 'CARD', amountCents: 11500 }],
    }])) },
    appointment: { findMany: rec('appointment', () => []) },
    staffMember: {
      findMany: rec('staffMember', () => [{ id: 'kim', firstName: 'Kim', lastName: null, isActive: true, commissionPercent: 60, baseCents: 0, payType: 'COMMISSION', productCommissionPercent: 0, hourlyRateCents: 0, dailyGuaranteeCents: 0, salaryPeriod: 'MONTHLY', checkPercent: null, workingHours: [] }]),
      findFirst: rec('staffMember.findFirst', (a) => (a.where.tenantId === 'tenant-a' && a.where.id === 'kim' ? { id: 'kim' } : null)),
    },
    payrollRun: {
      findUnique: rec('payrollRun', (a) => runs.find((r) => r.tenantId === a.where.tenantId_periodFrom_periodTo.tenantId && r.periodFrom === a.where.tenantId_periodFrom_periodTo.periodFrom) ?? null),
      findFirst: rec('payrollRun.findFirst', (a) => runs.find((r) => r.id === a.where.id && r.tenantId === a.where.tenantId) ?? null),
      findMany: rec('payrollRun.findMany', (a) => runs.filter((r) => r.tenantId === a.where.tenantId)),
      create: rec('payrollRun.create', (a) => { const r = { id: `run-${runs.length}`, ...a.data }; runs.push(r); return r; }),
      updateMany: rec('payrollRun.updateMany', (a) => { for (const r of runs) if (r.id === a.where.id && r.tenantId === a.where.tenantId) Object.assign(r, a.data); return { count: 1 }; }),
    },
  };
  const tenantArg = (c: { where: any }) => c.where?.tenantId ?? c.where?.tenantId_key?.tenantId ?? c.where?.tenantId_periodFrom_periodTo?.tenantId ?? c.where?.id;
  return { prisma, calls, runs, tenantArg };
}
const audit = { log: jest.fn(async () => undefined) };

describe('PayrollService', () => {
  it('builds a period from the caller\'s own rows only', async () => {
    const { prisma, calls, tenantArg } = makePrisma();
    const svc = new PayrollService(prisma, audit as never);
    const res: any = await svc.preview(owner('tenant-a'), '2026-09-28', '2026-10-04');
    expect(res.slips[0]).toMatchObject({ staffId: 'kim', serviceCents: 10000, serviceCommissionCents: 6000, tipsCents: 1500, netPayCents: 7500 });
    for (const c of calls.filter((x) => x.model !== 'tenant')) expect(tenantArg(c)).toBe('tenant-a');
    // Another salon's closed period for the same dates is not "closed" here.
    expect(res.frozen).toBe(false);
  });

  it('a correction can only name the caller\'s own technician', async () => {
    const { prisma } = makePrisma();
    const svc = new PayrollService(prisma, audit as never);
    await expect(svc.saveOverride(owner('tenant-b'), { from: '2026-09-28', to: '2026-10-04', staffId: 'kim', override: { hours: 10 } })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('corrections are kept on a draft and feed the payslip', async () => {
    const { prisma } = makePrisma();
    const svc = new PayrollService(prisma, audit as never);
    const res: any = await svc.saveOverride(owner('tenant-a'), { from: '2026-09-28', to: '2026-10-04', staffId: 'kim', override: { adjustments: [{ label: 'Thưởng', cents: 2000 }] } });
    expect(res.slips[0].netPayCents).toBe(9500);
    expect(res.run.status).toBe('DRAFT');
  });

  it('closing freezes the payslips; a closed period refuses changes until reopened', async () => {
    const { prisma, runs } = makePrisma();
    const svc = new PayrollService(prisma, audit as never);
    const closed: any = await svc.finalize(owner('tenant-a'), { from: '2026-09-28', to: '2026-10-04' });
    expect(closed.frozen).toBe(true);
    expect(closed.slips[0].netPayCents).toBe(7500);
    await expect(svc.finalize(owner('tenant-a'), { from: '2026-09-28', to: '2026-10-04' })).rejects.toBeInstanceOf(ConflictException);
    await expect(svc.saveOverride(owner('tenant-a'), { from: '2026-09-28', to: '2026-10-04', staffId: 'kim', override: {} })).rejects.toBeInstanceOf(ConflictException);
    const mine = runs.find((r) => r.tenantId === 'tenant-a')!;
    const reopened: any = await svc.reopen(owner('tenant-a'), mine.id);
    expect(reopened.frozen).toBe(false);
  });

  it('cannot reopen another salon\'s closed period', async () => {
    const { prisma, runs } = makePrisma();
    const svc = new PayrollService(prisma, audit as never);
    await expect(svc.reopen(owner('tenant-a'), 'run-b')).rejects.toBeInstanceOf(NotFoundException);
    expect(runs.find((r) => r.id === 'run-b')!.status).toBe('FINAL');
  });

  it('settings are written under the caller\'s tenant, clamped', async () => {
    const { prisma } = makePrisma();
    const svc = new PayrollService(prisma, audit as never);
    const s = await svc.updateSettings(owner('tenant-a'), { cardTipFeePercent: 3.5, defaultCheckPercent: 60 });
    expect(s).toMatchObject({ cardTipFeePercent: 3.5, defaultCheckPercent: 60 });
    expect(prisma.setting.upsert.mock.calls[0][0].where.tenantId_key.tenantId).toBe('tenant-a');
  });
});
