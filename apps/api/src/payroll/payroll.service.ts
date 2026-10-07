import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser, resolveTenantScope } from '../common/tenant/tenant-context';
import { addDaysToKey, dayKeyTz, startOfDayTz } from '../common/salon-time';
import { loadLedger } from './ledger-loader';
import { UNASSIGNED } from './sales-ledger';
import { computePayslip, PayConfig, PayOverride, PayrollSettings, Payslip, sanitizeSettings } from './pay-calc';
import { daysBetween, isDayKey, periodContaining, recentPeriods } from './pay-period';
import { minutesByStaff } from './time-clock';
import { yearSummary, yearsWithPay } from './year-summary';
import { cleanGoal, goalProgress, weekAndMonth } from './goals';
import { loadApprovedTimeOff, wholeDaysOff } from '../staff/time-off';

export const PAYROLL_SETTINGS_KEY = 'payroll';

type Overrides = Record<string, PayOverride>;

const TOTAL_KEYS = [
  'serviceCents', 'productCents', 'serviceCount', 'visits', 'supplyFeeCents', 'serviceCommissionCents', 'productCommissionCents',
  'hourlyPayCents', 'guaranteeTopUpCents', 'salaryForPeriodCents', 'earningsCents', 'tipsCents', 'cardTipFeeCents', 'tipsNetCents',
  'adjustmentsCents', 'netPayCents', 'checkCents', 'cashCents',
] as const;
type Totals = Record<(typeof TOTAL_KEYS)[number], number>;

function sumTotals(slips: Payslip[]): Totals {
  const t = Object.fromEntries(TOTAL_KEYS.map((k) => [k, 0])) as Totals;
  for (const s of slips) for (const k of TOTAL_KEYS) t[k] += (s as unknown as Record<string, number>)[k] ?? 0;
  return t;
}

/**
 * Payroll for one salon: settings, the live (draft) payslips of a pay period,
 * the owner's corrections, and closing the period into a frozen record.
 *
 * Every read and write is pinned to the caller's tenant: staff, sales, runs
 * and settings of another salon are never in reach.
 */
@Injectable()
export class PayrollService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  private tenantId(user: AuthenticatedUser): string {
    const id = resolveTenantScope(user);
    if (!id) throw new NotFoundException('No tenant context');
    return id;
  }

  private async tzOf(tenantId: string): Promise<string> {
    const t = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { timezone: true } }).catch(() => null);
    return t?.timezone || 'UTC';
  }

  async readSettings(tenantId: string): Promise<PayrollSettings> {
    const row = await this.prisma.setting.findUnique({ where: { tenantId_key: { tenantId, key: PAYROLL_SETTINGS_KEY } } });
    return sanitizeSettings((row?.value as Partial<PayrollSettings>) ?? null);
  }

  async getSettings(user: AuthenticatedUser) {
    return this.readSettings(this.tenantId(user));
  }

  async updateSettings(user: AuthenticatedUser, dto: Partial<PayrollSettings>) {
    const tenantId = this.tenantId(user);
    const next = sanitizeSettings({ ...(await this.readSettings(tenantId)), ...dto });
    await this.prisma.setting.upsert({
      where: { tenantId_key: { tenantId, key: PAYROLL_SETTINGS_KEY } },
      update: { value: next as unknown as Prisma.InputJsonValue },
      create: { tenantId, key: PAYROLL_SETTINGS_KEY, value: next as unknown as Prisma.InputJsonValue },
    });
    await this.audit.log({ tenantId, userId: user.userId, action: 'payroll.settings_updated', resourceType: 'tenant', resourceId: tenantId, metadata: { ...next } });
    return next;
  }

  /** Validates a period, defaulting to the one that contains today. */
  private async periodOf(tenantId: string, from?: string, to?: string) {
    const [tz, settings] = await Promise.all([this.tzOf(tenantId), this.readSettings(tenantId)]);
    const today = dayKeyTz(new Date(), tz);
    let p = periodContaining(settings.payPeriod, today, settings.periodAnchor);
    if (from || to) {
      if (!isDayKey(from) || !isDayKey(to) || to < from) throw new BadRequestException('Pay period must be from/to as YYYY-MM-DD, from ≤ to');
      if (daysBetween(from, to) > 93) throw new BadRequestException('A pay period can be at most 93 days');
      p = { from, to };
    }
    return { tz, settings, today, period: p };
  }

  /** The draft payslips of a period — computed live from sales, schedule and the owner's corrections. */
  private async compute(tenantId: string, tz: string, settings: PayrollSettings, period: { from: string; to: string }, today: string, overrides: Overrides) {
    const from = startOfDayTz(period.from, tz);
    const to = new Date(startOfDayTz(addDaysToKey(period.to, 1), tz).getTime() - 1);
    const [{ ledger }, staff] = await Promise.all([
      loadLedger(this.prisma, tenantId, tz, from, to),
      this.prisma.staffMember.findMany({
        where: { tenantId },
        select: {
          id: true, firstName: true, lastName: true, isActive: true,
          commissionPercent: true, baseCents: true,
          payType: true, productCommissionPercent: true, hourlyRateCents: true, dailyGuaranteeCents: true, salaryPeriod: true, checkPercent: true,
          workingHours: { select: { dayOfWeek: true, startTime: true, endTime: true, isActive: true } },
        } as never,
        orderBy: { firstName: 'asc' },
      }) as unknown as Promise<{
        id: string; firstName: string; lastName: string | null; isActive: boolean; commissionPercent: number; baseCents: number;
        payType?: string; productCommissionPercent?: number; hourlyRateCents?: number; dailyGuaranteeCents?: number; salaryPeriod?: string; checkPercent?: number | null;
        workingHours: { dayOfWeek: number; startTime: string; endTime: string; isActive: boolean }[];
      }[]>,
    ]);

    // Time clock: clocked minutes per technician per salon day (payroll/time-clock.ts).
    let clock = new Map<string, { minutes: Record<string, number>; stale: string[] }>();
    if (settings.hoursSource === 'CLOCK') {
      const entries = await (this.prisma as any).timeEntry.findMany({ // eslint-disable-line @typescript-eslint/no-explicit-any
        where: { tenantId, clockIn: { gte: from, lte: to } }, select: { id: true, staffId: true, clockIn: true, clockOut: true },
      }).catch(() => []);
      clock = minutesByStaff(entries, tz, new Date());
    }

    // Approved whole days off (nghỉ phép) are days off on the payslip, like the
    // owner's own day chips; a day the owner un-marks by hand stays marked here.
    const leave = wholeDaysOff(await loadApprovedTimeOff(this.prisma, tenantId, period.from, period.to), period.from, period.to);

    const slips: Payslip[] = [];
    for (const s of staff) {
      const led = ledger.get(s.id);
      const ov = overrides[s.id];
      const leaveDays = leave.get(s.id) ?? [];
      const override = leaveDays.length ? { ...(ov ?? {}), offDays: [...new Set([...(ov?.offDays ?? []), ...leaveDays])] } : ov;
      const cfg: PayConfig = {
        staffId: s.id,
        name: `${s.firstName}${s.lastName ? ' ' + s.lastName : ''}`,
        payType: s.payType ?? (s.baseCents > 0 ? 'SALARY' : 'COMMISSION'),
        commissionPercent: s.commissionPercent ?? 0,
        productCommissionPercent: s.productCommissionPercent ?? 0,
        hourlyRateCents: s.hourlyRateCents ?? 0,
        dailyGuaranteeCents: s.dailyGuaranteeCents ?? 0,
        salaryCents: s.baseCents ?? 0,
        salaryPeriod: s.salaryPeriod ?? 'MONTHLY',
        checkPercent: s.checkPercent ?? null,
        // A tech who has left earns nothing by the schedule any more.
        workingHours: s.isActive ? s.workingHours : [],
      };
      const slip = computePayslip({ cfg, ledger: led, period, upTo: today, settings, override, clock: settings.hoursSource === 'CLOCK' ? (clock.get(s.id)?.minutes ?? {}) : null });
      if (leaveDays.length) slip.leaveDays = leaveDays;
      // Everyone on the team, plus anyone who has left but still has money in this period.
      const owed = slip.netPayCents !== 0 || slip.serviceCents > 0 || slip.productCents > 0 || slip.tipsCents > 0;
      if (s.isActive || owed) slips.push(slip);
    }
    slips.sort((a, b) => b.netPayCents - a.netPayCents || a.name.localeCompare(b.name));
    const un = ledger.get(UNASSIGNED);
    const unassigned = un ? { serviceCents: un.serviceCents, productCents: un.productCents, tipsCents: un.tipsCents, visits: un.visits } : null;
    return { slips, totals: sumTotals(slips), unassigned };
  }

  async preview(user: AuthenticatedUser, from?: string, to?: string) {
    const tenantId = this.tenantId(user);
    const { tz, settings, today, period } = await this.periodOf(tenantId, from, to);
    const run = await this.prisma.payrollRun.findUnique({ where: { tenantId_periodFrom_periodTo: { tenantId, periodFrom: period.from, periodTo: period.to } } });
    const runs = await this.prisma.payrollRun.findMany({
      where: { tenantId }, orderBy: { periodFrom: 'desc' }, take: 24,
      select: { id: true, periodFrom: true, periodTo: true, status: true, finalizedAt: true, totals: true },
    });
    const periods = recentPeriods(settings.payPeriod, today, 8, settings.periodAnchor).map((p) => {
      const r = runs.find((x) => x.periodFrom === p.from && x.periodTo === p.to);
      return { ...p, status: r?.status ?? null };
    });
    const head = { period, today, running: period.to >= today, settings, periods, history: runs.filter((r) => r.status === 'FINAL') };

    if (run?.status === 'FINAL') {
      return { ...head, run: { id: run.id, status: run.status, finalizedAt: run.finalizedAt, note: run.note }, frozen: true, slips: run.lines as unknown as Payslip[], totals: run.totals, unassigned: null };
    }
    const overrides = (run?.overrides as unknown as Overrides) ?? {};
    const live = await this.compute(tenantId, tz, settings, period, today, overrides);
    return { ...head, run: run ? { id: run.id, status: run.status, finalizedAt: null, note: run.note } : null, frozen: false, ...live };
  }

  /**
   * THU NHẬP — a technician's OWN payslip, in her app. Never anyone else's line,
   * never the salon's totals. What she may see is the owner's choice
   * (settings.staffPayView): the running estimate of the open period (LIVE),
   * only closed payslips (FINAL), or nothing (OFF).
   */
  async mySlip(user: AuthenticatedUser, from?: string, to?: string) {
    const tenantId = this.tenantId(user);
    const me = await this.prisma.staffMember.findFirst({ where: { tenantId, userId: user.userId }, select: { id: true } });
    if (!me) throw new NotFoundException('No staff profile for this login');
    const { tz, settings, today, period } = await this.periodOf(tenantId, from, to);
    const view = settings.staffPayView;
    if (view === 'OFF') return { view, period, today, slip: null, frozen: false, history: [], currency: await this.currencyOf(tenantId) };
    const runs = await this.prisma.payrollRun.findMany({
      where: { tenantId, status: 'FINAL' }, orderBy: { periodFrom: 'desc' }, take: 12,
      select: { id: true, periodFrom: true, periodTo: true, finalizedAt: true, lines: true },
    });
    const mine = (lines: unknown) => (Array.isArray(lines) ? (lines as Payslip[]).find((l) => l.staffId === me.id) ?? null : null);
    const history = runs.map((r) => ({ from: r.periodFrom, to: r.periodTo, finalizedAt: r.finalizedAt, netPayCents: mine(r.lines)?.netPayCents ?? 0 }))
      .filter((h, i) => mine(runs[i].lines));
    const run = runs.find((r) => r.periodFrom === period.from && r.periodTo === period.to);
    let slip: Payslip | null = null;
    let frozen = false;
    if (run) { slip = mine(run.lines); frozen = true; }
    else if (view === 'LIVE' && period.from === (await this.periodOf(tenantId)).period.from) {
      // The running estimate is for the OPEN period only; any other range shows a closed payslip or nothing.
      const open = await this.prisma.payrollRun.findUnique({ where: { tenantId_periodFrom_periodTo: { tenantId, periodFrom: period.from, periodTo: period.to } } });
      const live = await this.compute(tenantId, tz, settings, period, today, (open?.overrides as unknown as Overrides) ?? {});
      slip = live.slips.find((x) => x.staffId === me.id) ?? null;
    }
    return { view, period, today, running: period.to >= today, frozen, slip, history, currency: await this.currencyOf(tenantId), payPeriod: settings.payPeriod };
  }

  /**
   * THU NHẬP CẢ NĂM — her own closed payslips of one year, added up
   * (payroll/year-summary.ts), for the statement she prints for her taxes.
   * Nothing when the owner has switched pay off in the app.
   */
  async myYear(user: AuthenticatedUser, yearRaw?: string, now = new Date()) {
    const tenantId = this.tenantId(user);
    const me = await this.prisma.staffMember.findFirst({ where: { tenantId, userId: user.userId }, select: { id: true, firstName: true, lastName: true } });
    if (!me) throw new NotFoundException('No staff profile for this login');
    const [settings, tenant, currency] = await Promise.all([
      this.readSettings(tenantId),
      this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true, timezone: true } }).catch(() => null),
      this.currencyOf(tenantId),
    ]);
    const name = `${me.firstName}${me.lastName ? ' ' + me.lastName : ''}`;
    const salon = tenant?.name ?? '';
    if (settings.staffPayView === 'OFF') return { view: 'OFF', year: null, years: [], name, salon, currency, rows: [], totals: null };
    const runs = await this.prisma.payrollRun.findMany({
      where: { tenantId, status: 'FINAL' }, orderBy: { periodFrom: 'asc' }, take: 400,
      select: { periodFrom: true, periodTo: true, finalizedAt: true, lines: true },
    });
    const years = yearsWithPay(runs, me.id);
    const thisYear = Number(dayKeyTz(now, tenant?.timezone || 'UTC').slice(0, 4));
    const wanted = Number(yearRaw);
    const year = Number.isInteger(wanted) && wanted >= 2000 && wanted <= thisYear + 1 ? wanted : (years[0] ?? thisYear);
    const { rows, totals } = yearSummary(runs, me.id, year);
    return { view: settings.staffPayView, year, years, name, salon, currency, rows, totals, generatedAt: now };
  }

  // ---------------------------------------------------------------- mục tiêu riêng

  private goalKey(staffId: string) { return `staff_goal:${staffId}`; }

  /**
   * MỤC TIÊU RIÊNG — her own week / month targets and where she stands
   * (payroll/goals.ts). Her service sales and visits come from the same
   * ledger payroll uses; nobody else's numbers are read or returned.
   */
  async myGoals(user: AuthenticatedUser, now = new Date()) {
    const tenantId = this.tenantId(user);
    const me = await this.prisma.staffMember.findFirst({ where: { tenantId, userId: user.userId }, select: { id: true } });
    if (!me) throw new NotFoundException('No staff profile for this login');
    const [tz, row, currency] = await Promise.all([
      this.tzOf(tenantId),
      this.prisma.setting.findUnique({ where: { tenantId_key: { tenantId, key: this.goalKey(me.id) } } }).catch(() => null),
      this.currencyOf(tenantId),
    ]);
    const goal = cleanGoal(row?.value ?? null);
    const today = dayKeyTz(now, tz);
    const { week, month } = weekAndMonth(today);
    const from = week.from < month.from ? week.from : month.from;
    const { ledger } = await loadLedger(this.prisma, tenantId, tz, startOfDayTz(from, tz), now);
    const mine = ledger.get(me.id);
    const sum = (range: { from: string; to: string }): { serviceCents: number; visits: number } => {
      const out = { serviceCents: 0, visits: 0 };
      for (const [day, b] of Object.entries(mine?.days ?? {})) {
        if (day >= range.from && day <= range.to) { out.serviceCents += b.serviceCents; out.visits += b.visits; }
      }
      return out;
    };
    const w = sum(week);
    const m = sum(month);
    return { today, currency, goal, week: { ...week, ...w }, month: { ...month, ...m }, progress: goalProgress(goal, w, m) };
  }

  async saveMyGoals(user: AuthenticatedUser, raw: unknown) {
    const tenantId = this.tenantId(user);
    const me = await this.prisma.staffMember.findFirst({ where: { tenantId, userId: user.userId }, select: { id: true } });
    if (!me) throw new NotFoundException('No staff profile for this login');
    const goal = cleanGoal(raw);
    const key = this.goalKey(me.id);
    await this.prisma.setting.upsert({
      where: { tenantId_key: { tenantId, key } },
      update: { value: goal as unknown as Prisma.InputJsonValue },
      create: { tenantId, key, value: goal as unknown as Prisma.InputJsonValue },
    });
    // Private: no audit line with the numbers; the setting itself is the record.
    return goal;
  }

  private async currencyOf(tenantId: string): Promise<string> {
    try {
      const row = await this.prisma.setting.findUnique({ where: { tenantId_key: { tenantId, key: 'booking_rules' } } });
      return String((row?.value as { currency?: string } | null)?.currency || 'USD');
    } catch { return 'USD'; }
  }

  /** The owner's correction for one tech on a period still open (hours, days off, bonus / deduction lines). */
  async saveOverride(user: AuthenticatedUser, dto: { from: string; to: string; staffId: string; override: PayOverride }) {
    const tenantId = this.tenantId(user);
    const { period } = await this.periodOf(tenantId, dto.from, dto.to);
    const staff = await this.prisma.staffMember.findFirst({ where: { id: dto.staffId, tenantId }, select: { id: true } });
    if (!staff) throw new NotFoundException('Staff member not found');
    const clean: PayOverride = {
      hours: dto.override?.hours == null || dto.override.hours === ('' as never) ? null : Math.max(0, Math.min(744, Number(dto.override.hours) || 0)),
      offDays: (dto.override?.offDays ?? []).filter((d) => isDayKey(d) && d >= period.from && d <= period.to).slice(0, 93),
      adjustments: (dto.override?.adjustments ?? []).slice(0, 20).map((a) => ({ label: String(a.label ?? '').slice(0, 80), cents: Math.max(-10_000_000, Math.min(10_000_000, Math.round(Number(a.cents) || 0))) })),
    };
    const run = await this.prisma.payrollRun.findUnique({ where: { tenantId_periodFrom_periodTo: { tenantId, periodFrom: period.from, periodTo: period.to } } });
    if (run?.status === 'FINAL') throw new ConflictException('This pay period is closed. Reopen it to make changes.');
    const overrides = { ...((run?.overrides as unknown as Overrides) ?? {}), [dto.staffId]: clean };
    if (run) {
      await this.prisma.payrollRun.updateMany({ where: { id: run.id, tenantId }, data: { overrides: overrides as unknown as Prisma.InputJsonValue } });
    } else {
      await this.prisma.payrollRun.create({ data: { tenantId, periodFrom: period.from, periodTo: period.to, status: 'DRAFT', overrides: overrides as unknown as Prisma.InputJsonValue, createdByUserId: user.userId } });
    }
    await this.audit.log({ tenantId, userId: user.userId, action: 'payroll.adjusted', resourceType: 'staff_member', resourceId: dto.staffId, metadata: { period, override: clean } as never });
    return this.preview(user, period.from, period.to);
  }

  /** Close the period: freeze every payslip as it stands now. */
  async finalize(user: AuthenticatedUser, dto: { from: string; to: string; note?: string }) {
    const tenantId = this.tenantId(user);
    const { tz, settings, today, period } = await this.periodOf(tenantId, dto.from, dto.to);
    const run = await this.prisma.payrollRun.findUnique({ where: { tenantId_periodFrom_periodTo: { tenantId, periodFrom: period.from, periodTo: period.to } } });
    if (run?.status === 'FINAL') throw new ConflictException('This pay period is already closed.');
    const overrides = (run?.overrides as unknown as Overrides) ?? {};
    const { slips, totals } = await this.compute(tenantId, tz, settings, period, today, overrides);
    const data = {
      status: 'FINAL',
      lines: slips as unknown as Prisma.InputJsonValue,
      totals: { ...totals, settings } as unknown as Prisma.InputJsonValue,
      note: dto.note?.slice(0, 500) ?? null,
      finalizedAt: new Date(),
      finalizedByUserId: user.userId,
    };
    let id = run?.id;
    if (run) await this.prisma.payrollRun.updateMany({ where: { id: run.id, tenantId }, data });
    else id = (await this.prisma.payrollRun.create({ data: { tenantId, periodFrom: period.from, periodTo: period.to, createdByUserId: user.userId, ...data } })).id;
    await this.audit.log({ tenantId, userId: user.userId, action: 'payroll.finalized', resourceType: 'payroll_run', resourceId: id, metadata: { period, netPayCents: totals.netPayCents, staff: slips.length } });
    return this.preview(user, period.from, period.to);
  }

  /** Reopen a closed period (e.g. a ticket was fixed). The frozen record is dropped; corrections are kept. */
  async reopen(user: AuthenticatedUser, id: string) {
    const tenantId = this.tenantId(user);
    const run = await this.prisma.payrollRun.findFirst({ where: { id, tenantId } });
    if (!run) throw new NotFoundException('Pay period not found');
    await this.prisma.payrollRun.updateMany({ where: { id, tenantId }, data: { status: 'DRAFT', lines: Prisma.DbNull, totals: Prisma.DbNull, finalizedAt: null, finalizedByUserId: null } });
    await this.audit.log({ tenantId, userId: user.userId, action: 'payroll.reopened', resourceType: 'payroll_run', resourceId: id, metadata: { period: { from: run.periodFrom, to: run.periodTo }, wasNetPayCents: (run.totals as { netPayCents?: number } | null)?.netPayCents ?? null } });
    return this.preview(user, run.periodFrom, run.periodTo);
  }
}
