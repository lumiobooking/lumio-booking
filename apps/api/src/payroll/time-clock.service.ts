import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser, resolveTenantScope } from '../common/tenant/tenant-context';
import { addDaysToKey, dayKeyTz, startOfDayTz, wallTimeToUtcTz } from '../common/salon-time';
import { MAX_SHIFT_MIN, entryMinutes, minutesByStaff } from './time-clock';
import { sanitizeSettings } from './pay-calc';
import { PAYROLL_SETTINGS_KEY } from './payroll.service';

type Entry = { id: string; tenantId: string; staffId: string; clockIn: Date; clockOut: Date | null; source: string; note: string | null };

/**
 * CHẤM CÔNG. A technician clocks in and out in her app; the owner sees,
 * corrects and adds entries. Every read and write carries the caller's
 * tenantId; a technician only ever touches her own entries.
 */
@Injectable()
export class TimeClockService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  /** The model is newer than some generated clients: typed loosely here. */
  private get db(): any { return this.prisma as any; } // eslint-disable-line @typescript-eslint/no-explicit-any

  private tenantId(user: AuthenticatedUser): string {
    const id = resolveTenantScope(user);
    if (!id) throw new NotFoundException('No tenant context');
    return id;
  }
  private async tz(tenantId: string): Promise<string> {
    const t = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { timezone: true } }).catch(() => null);
    return t?.timezone || 'UTC';
  }
  private async myStaffId(tenantId: string, userId: string): Promise<string> {
    const me = await this.prisma.staffMember.findFirst({ where: { tenantId, userId }, select: { id: true } });
    if (!me) throw new NotFoundException('No staff profile for this login');
    return me.id;
  }

  /** True when this salon pays hours by the clock. Never throws. */
  private async paysByClock(tenantId: string): Promise<boolean> {
    try {
      const row = await this.prisma.setting.findUnique({ where: { tenantId_key: { tenantId, key: PAYROLL_SETTINGS_KEY } } });
      return sanitizeSettings((row?.value as never) ?? null).hoursSource === 'CLOCK';
    } catch { return false; }
  }

  // ---------------------------------------------------------------- technician

  async mine(user: AuthenticatedUser, now = new Date()) {
    const tenantId = this.tenantId(user);
    const staffId = await this.myStaffId(tenantId, user.userId);
    const tz = await this.tz(tenantId);
    const since = startOfDayTz(addDaysToKey(dayKeyTz(now, tz), -13), tz);
    const rows: Entry[] = await this.db.timeEntry.findMany({ where: { tenantId, staffId, clockIn: { gte: since } }, orderBy: { clockIn: 'desc' }, take: 60 });
    const today = dayKeyTz(now, tz);
    const open = rows.find((r) => !r.clockOut && dayKeyTz(r.clockIn, tz) === today) ?? null;
    const stale = rows.filter((r) => !r.clockOut && dayKeyTz(r.clockIn, tz) !== today).map((r) => ({ id: r.id, clockIn: r.clockIn }));
    const todayMinutes = rows.filter((r) => dayKeyTz(r.clockIn, tz) === today).reduce((a, r) => a + (entryMinutes(r, tz, now) ?? 0), 0);
    // The card shows in her app once the salon pays by the clock, or once she
    // (or the owner) has used it — a salon that never uses it sees nothing new.
    const inUse = rows.length > 0 || (await this.paysByClock(tenantId));
    return {
      timezone: tz, today, inUse, open: open ? { id: open.id, clockIn: open.clockIn } : null, todayMinutes, stale,
      recent: rows.slice(0, 20).map((r) => ({ id: r.id, clockIn: r.clockIn, clockOut: r.clockOut, minutes: entryMinutes(r, tz, now), source: r.source })),
    };
  }

  async clockIn(user: AuthenticatedUser, now = new Date()) {
    const tenantId = this.tenantId(user);
    const staffId = await this.myStaffId(tenantId, user.userId);
    const tz = await this.tz(tenantId);
    const open: Entry | null = await this.db.timeEntry.findFirst({ where: { tenantId, staffId, clockOut: null }, orderBy: { clockIn: 'desc' } });
    if (open && dayKeyTz(open.clockIn, tz) === dayKeyTz(now, tz)) throw new ConflictException('You are already clocked in.');
    const row: Entry = await this.db.timeEntry.create({ data: { tenantId, staffId, clockIn: now, source: 'app', createdByUserId: user.userId } });
    await this.audit.log({ tenantId, userId: user.userId, action: 'time.clock_in', resourceType: 'time_entry', resourceId: row.id });
    return this.mine(user, now);
  }

  async clockOut(user: AuthenticatedUser, now = new Date()) {
    const tenantId = this.tenantId(user);
    const staffId = await this.myStaffId(tenantId, user.userId);
    const tz = await this.tz(tenantId);
    const open: Entry | null = await this.db.timeEntry.findFirst({ where: { tenantId, staffId, clockOut: null }, orderBy: { clockIn: 'desc' } });
    if (!open) throw new BadRequestException('You are not clocked in.');
    if (dayKeyTz(open.clockIn, tz) !== dayKeyTz(now, tz)) {
      throw new BadRequestException('Your last shift was never clocked out. Ask the owner to fix it, then clock in again.');
    }
    const end = new Date(Math.min(now.getTime(), open.clockIn.getTime() + MAX_SHIFT_MIN * 60_000));
    await this.db.timeEntry.updateMany({ where: { id: open.id, tenantId, staffId }, data: { clockOut: end } });
    await this.audit.log({ tenantId, userId: user.userId, action: 'time.clock_out', resourceType: 'time_entry', resourceId: open.id });
    return this.mine(user, now);
  }

  // ---------------------------------------------------------------- owner

  /** Entries of a range of salon days (default: the last 14), with each technician's total. */
  async list(user: AuthenticatedUser, from?: string, to?: string, now = new Date()) {
    const tenantId = this.tenantId(user);
    const tz = await this.tz(tenantId);
    const day = /^\d{4}-\d{2}-\d{2}$/;
    const t = to && day.test(to) ? to : dayKeyTz(now, tz);
    const f = from && day.test(from) ? from : addDaysToKey(t, -13);
    if (f > t) throw new BadRequestException('from must be on or before to');
    const rows: (Entry & { staff?: { firstName: string; lastName: string | null } })[] = await this.db.timeEntry.findMany({
      where: { tenantId, clockIn: { gte: startOfDayTz(f, tz), lt: startOfDayTz(addDaysToKey(t, 1), tz) } },
      include: { staff: { select: { firstName: true, lastName: true } } }, orderBy: { clockIn: 'desc' }, take: 2000,
    });
    const per = minutesByStaff(rows, tz, now);
    const staff = [...per].map(([staffId, v]) => {
      const r = rows.find((x) => x.staffId === staffId);
      return { staffId, name: r?.staff ? `${r.staff.firstName}${r.staff.lastName ? ' ' + r.staff.lastName : ''}` : '', minutes: Object.values(v.minutes).reduce((a, m) => a + m, 0), days: Object.keys(v.minutes).length, stale: v.stale.length };
    }).sort((a, b) => a.name.localeCompare(b.name));
    return {
      from: f, to: t, timezone: tz, staff,
      entries: rows.map((r) => ({ id: r.id, staffId: r.staffId, name: r.staff ? `${r.staff.firstName}${r.staff.lastName ? ' ' + r.staff.lastName : ''}` : '', clockIn: r.clockIn, clockOut: r.clockOut, minutes: entryMinutes(r, tz, now), source: r.source, note: r.note })),
    };
  }

  private async parseWall(tenantId: string, local: string | null | undefined): Promise<Date | null> {
    if (!local) return null;
    const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(local);
    if (!m) throw new BadRequestException('Time must be YYYY-MM-DDTHH:mm');
    return wallTimeToUtcTz(m[1], m[2], await this.tz(tenantId));
  }

  private check(clockIn: Date, clockOut: Date | null, now: Date) {
    if (clockIn.getTime() > now.getTime() + 60_000) throw new BadRequestException('A shift cannot start in the future.');
    if (clockOut) {
      if (clockOut <= clockIn) throw new BadRequestException('The shift must end after it starts.');
      if (clockOut.getTime() - clockIn.getTime() > MAX_SHIFT_MIN * 60_000) throw new BadRequestException('A shift can be at most 16 hours.');
    }
  }

  async create(user: AuthenticatedUser, dto: { staffId: string; clockIn: string; clockOut?: string | null; note?: string }, now = new Date()) {
    const tenantId = this.tenantId(user);
    const st = await this.prisma.staffMember.findFirst({ where: { id: dto.staffId, tenantId }, select: { id: true } });
    if (!st) throw new NotFoundException('Staff member not found');
    const clockIn = (await this.parseWall(tenantId, dto.clockIn)) as Date;
    const clockOut = await this.parseWall(tenantId, dto.clockOut ?? null);
    this.check(clockIn, clockOut, now);
    const row: Entry = await this.db.timeEntry.create({ data: { tenantId, staffId: st.id, clockIn, clockOut, source: 'owner', note: dto.note?.trim() || null, createdByUserId: user.userId } });
    await this.audit.log({ tenantId, userId: user.userId, action: 'time.entry_added', resourceType: 'time_entry', resourceId: row.id, metadata: { staffId: st.id } });
    return row;
  }

  async edit(user: AuthenticatedUser, id: string, dto: { clockIn?: string; clockOut?: string | null; note?: string }, now = new Date()) {
    const tenantId = this.tenantId(user);
    const cur: Entry | null = await this.db.timeEntry.findFirst({ where: { id, tenantId } });
    if (!cur) throw new NotFoundException('Entry not found');
    const clockIn = dto.clockIn ? (await this.parseWall(tenantId, dto.clockIn)) as Date : cur.clockIn;
    const clockOut = dto.clockOut === undefined ? cur.clockOut : await this.parseWall(tenantId, dto.clockOut);
    this.check(clockIn, clockOut, now);
    await this.db.timeEntry.updateMany({ where: { id, tenantId }, data: { clockIn, clockOut, ...(dto.note !== undefined ? { note: dto.note?.trim() || null } : {}), editedByUserId: user.userId } });
    await this.audit.log({ tenantId, userId: user.userId, action: 'time.entry_edited', resourceType: 'time_entry', resourceId: id, metadata: { from: { clockIn: cur.clockIn, clockOut: cur.clockOut }, to: { clockIn, clockOut } } });
    return { ok: true };
  }

  async remove(user: AuthenticatedUser, id: string) {
    const tenantId = this.tenantId(user);
    const cur: Entry | null = await this.db.timeEntry.findFirst({ where: { id, tenantId } });
    if (!cur) throw new NotFoundException('Entry not found');
    await this.db.timeEntry.deleteMany({ where: { id, tenantId } });
    await this.audit.log({ tenantId, userId: user.userId, action: 'time.entry_deleted', resourceType: 'time_entry', resourceId: id, metadata: { staffId: cur.staffId, clockIn: cur.clockIn, clockOut: cur.clockOut } });
    return { ok: true };
  }
}
