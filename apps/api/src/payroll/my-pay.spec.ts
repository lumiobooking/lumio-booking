/**
 * THU NHẬP in the technician's app: her own payslip only — never a colleague's
 * line, never the salon's totals — and only as much as the owner allows.
 */
import { NotFoundException } from '@nestjs/common';
import { PayrollService } from './payroll.service';
import { sanitizeSettings } from './pay-calc';

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const kim = { userId: 'u-kim', role: 'STAFF', tenantId: 'A' } as never;
const slip = (staffId: string, net: number) => ({ staffId, name: staffId, netPayCents: net, serviceCents: 10000 });

function make(o: { view?: string; finalLines?: Row[] } = {}) {
  const seen: string[] = [];
  const prisma: Row = {
    tenant: { findUnique: async () => ({ timezone: 'America/Edmonton' }) },
    setting: { findUnique: async ({ where }: Row) => { seen.push(where.tenantId_key.tenantId); return where.tenantId_key.key === 'payroll' ? { value: { staffPayView: o.view ?? 'LIVE' } } : null; } },
    staffMember: { findFirst: async ({ where }: Row) => { seen.push(where.tenantId); return where.tenantId === 'A' && where.userId === 'u-kim' ? { id: 'kim' } : null; } },
    payrollRun: {
      findMany: async ({ where }: Row) => { seen.push(where.tenantId); return o.finalLines ? [{ id: 'r1', periodFrom: '2026-09-28', periodTo: '2026-10-04', finalizedAt: new Date(), lines: o.finalLines }] : []; },
      findUnique: async ({ where }: Row) => { seen.push(where.tenantId_periodFrom_periodTo.tenantId); return null; },
    },
  };
  const svc = new PayrollService(prisma as never, { log: jest.fn() } as never);
  const compute = jest.spyOn(svc as never as { compute: () => Promise<unknown> }, 'compute').mockResolvedValue({ slips: [slip('lisa', 99999), slip('kim', 42000)], totals: { netPayCents: 141999 }, unassigned: null } as never);
  return { svc, seen, compute };
}

describe('my pay', () => {
  it('LIVE: her running estimate — her line alone, no totals, no colleague', async () => {
    const { svc, seen } = make();
    const r: Row = await svc.mySlip(kim);
    expect(r.slip).toMatchObject({ staffId: 'kim', netPayCents: 42000 });
    expect(JSON.stringify(r)).not.toContain('lisa');
    expect(JSON.stringify(r)).not.toContain('141999');
    expect(seen.every((t) => t === 'A')).toBe(true);
  });

  it('closed payslips show her line from the frozen run, with her history', async () => {
    const { svc, compute } = make({ finalLines: [slip('lisa', 1), slip('kim', 31000)] });
    const r: Row = await svc.mySlip(kim, '2026-09-28', '2026-10-04');
    expect(r).toMatchObject({ frozen: true, slip: { staffId: 'kim', netPayCents: 31000 } });
    expect(r.history).toEqual([expect.objectContaining({ from: '2026-09-28', netPayCents: 31000 })]);
    expect(compute).not.toHaveBeenCalled();
  });

  it('FINAL: no estimate of the open period; OFF: nothing at all', async () => {
    const f: Row = await make({ view: 'FINAL' }).svc.mySlip(kim);
    expect(f.slip).toBeNull();
    const off: Row = await make({ view: 'OFF', finalLines: [slip('kim', 5)] }).svc.mySlip(kim);
    expect(off).toMatchObject({ view: 'OFF', slip: null, history: [] });
  });

  it('a login with no staff record here (another salon) gets nothing', async () => {
    await expect(make().svc.mySlip({ userId: 'u-kim', role: 'STAFF', tenantId: 'B' } as never)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('the owner\'s choice is kept, LIVE by default', () => {
    expect(sanitizeSettings({}).staffPayView).toBe('LIVE');
    expect(sanitizeSettings({ staffPayView: 'OFF' }).staffPayView).toBe('OFF');
    expect(sanitizeSettings({ staffPayView: 'junk' as never }).staffPayView).toBe('LIVE');
  });
});
