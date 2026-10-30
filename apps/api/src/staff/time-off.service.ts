import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PushService } from '../push/push.service';
import { AuthenticatedUser, resolveTenantScope } from '../common/tenant/tenant-context';
import { addDaysToKey, dayKeyTz, wallTimeToUtcTz } from '../common/salon-time';
import { TimeOffLite, nextDay, overlaps, validateRequest } from './time-off';

type Row = TimeOffLite & {
  id: string; tenantId: string; reason: string | null; status: string;
  requestedByUserId: string | null; decidedByUserId: string | null; decidedAt: Date | null; decisionNote: string | null; createdAt: Date;
  staff?: { firstName: string; lastName: string | null; userId: string | null };
};

const LIVE = ['PENDING', 'APPROVED'];
const name = (s?: { firstName: string; lastName: string | null } | null) => (s ? `${s.firstName}${s.lastName ? ' ' + s.lastName : ''}` : '');

/**
 * NGHỈ PHÉP. A technician asks in her app, the owner decides on the Staff page
 * (or marks days off directly). Every read and write carries the caller's
 * tenantId; a technician only ever sees and touches her own requests.
 * What an APPROVED request blocks lives in staff/time-off.ts.
 */
@Injectable()
export class TimeOffService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService, private readonly push: PushService) {}

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
  private async myStaff(tenantId: string, userId: string): Promise<{ id: string; firstName: string; lastName: string | null }> {
    const me = await this.prisma.staffMember.findFirst({ where: { tenantId, userId }, select: { id: true, firstName: true, lastName: true } });
    if (!me) throw new NotFoundException('No staff profile for this login');
    return me;
  }
  private shape(r: Row) {
    return {
      id: r.id, staffId: r.staffId, wholeSalon: r.staffId == null, name: name(r.staff), startDate: r.startDate, endDate: r.endDate, startTime: r.startTime ?? null, endTime: r.endTime ?? null,
      reason: r.reason, status: r.status, decidedAt: r.decidedAt, decisionNote: r.decisionNote, createdAt: r.createdAt,
      byOwner: !!r.requestedByUserId && r.requestedByUserId === r.decidedByUserId,
    };
  }
  private when(r: TimeOffLite): string {
    if (r.startTime && r.endTime) return `${r.startDate} ${r.startTime}–${r.endTime}`;
    return r.startDate === r.endDate ? r.startDate : `${r.startDate} → ${r.endDate}`;
  }
  private async clashes(tenantId: string, next: TimeOffLite, exceptId?: string): Promise<boolean> {
    const live: Row[] = await this.db.timeOffRequest.findMany({
      where: { tenantId, staffId: next.staffId, status: { in: LIVE }, startDate: { lte: next.endDate }, endDate: { gte: next.startDate }, ...(exceptId ? { id: { not: exceptId } } : {}) },
    });
    return live.some((r) => overlaps(r, next));
  }

  // ---------------------------------------------------------------- technician

  async mine(user: AuthenticatedUser, now = new Date()) {
    const tenantId = this.tenantId(user);
    const me = await this.myStaff(tenantId, user.userId);
    const tz = await this.tz(tenantId);
    const today = dayKeyTz(now, tz);
    const rows: Row[] = await this.db.timeOffRequest.findMany({
      where: { tenantId, staffId: me.id, endDate: { gte: addDaysToKey(today, -90) } },
      orderBy: { startDate: 'desc' }, take: 60,
    });
    return { today, requests: rows.map((r) => this.shape(r)) };
  }

  async request(user: AuthenticatedUser, dto: { startDate: string; endDate: string; startTime?: string | null; endTime?: string | null; reason?: string }, now = new Date()) {
    const tenantId = this.tenantId(user);
    const me = await this.myStaff(tenantId, user.userId);
    const tz = await this.tz(tenantId);
    const today = dayKeyTz(now, tz);
    const bad = validateRequest(dto, today);
    if (bad) throw new BadRequestException(bad);
    const next: TimeOffLite = { staffId: me.id, startDate: dto.startDate, endDate: dto.endDate, startTime: dto.startTime || null, endTime: dto.endTime || null };
    if (await this.clashes(tenantId, next)) throw new ConflictException('You already asked for (or have) time off then.');
    const row: Row = await this.db.timeOffRequest.create({
      data: { tenantId, ...next, reason: (dto.reason ?? '').trim().slice(0, 300) || null, status: 'PENDING', requestedByUserId: user.userId },
    });
    await this.audit.log({ tenantId, userId: user.userId, action: 'timeoff.requested', resourceType: 'time_off_request', resourceId: row.id, metadata: { staffId: me.id, when: this.when(next) } });
    // The owner (and the desk) hear about it; never the rest of the team.
    void this.push.sendToTenant(tenantId, {
      title: `${name(me)} xin nghỉ`, body: `${this.when(next)}${row.reason ? ` · ${row.reason}` : ''}`, url: '/salon/staff?timeoff=1', tag: 'lumio-timeoff',
    }, { exceptUserId: user.userId }).catch(() => undefined);
    return this.shape({ ...row, staff: me as never });
  }

  /** She may withdraw a pending request, or an approved one that has not started. */
  async cancel(user: AuthenticatedUser, id: string, now = new Date()) {
    const tenantId = this.tenantId(user);
    const me = await this.myStaff(tenantId, user.userId);
    const tz = await this.tz(tenantId);
    const today = dayKeyTz(now, tz);
    const cur: Row | null = await this.db.timeOffRequest.findFirst({ where: { id, tenantId, staffId: me.id } });
    if (!cur) throw new NotFoundException('Request not found');
    if (!LIVE.includes(cur.status)) throw new BadRequestException('This request is already closed.');
    if (cur.status === 'APPROVED' && cur.startDate <= today) throw new BadRequestException('This leave has started — ask the owner to change it.');
    await this.db.timeOffRequest.updateMany({ where: { id, tenantId }, data: { status: 'CANCELLED' } });
    await this.audit.log({ tenantId, userId: user.userId, action: 'timeoff.cancelled', resourceType: 'time_off_request', resourceId: id, metadata: { staffId: me.id, was: cur.status } });
    if (cur.status === 'APPROVED') {
      void this.push.sendToTenant(tenantId, { title: `${name(me)} huỷ ngày nghỉ`, body: this.when(cur), url: '/salon/staff?timeoff=1', tag: 'lumio-timeoff' }, { exceptUserId: user.userId }).catch(() => undefined);
    }
    return { ok: true };
  }

  // ---------------------------------------------------------------- owner

  async list(user: AuthenticatedUser, q: { status?: string; from?: string; to?: string } = {}, now = new Date()) {
    const tenantId = this.tenantId(user);
    const tz = await this.tz(tenantId);
    const today = dayKeyTz(now, tz);
    const day = /^\d{4}-\d{2}-\d{2}$/;
    const from = q.from && day.test(q.from) ? q.from : addDaysToKey(today, -30);
    const to = q.to && day.test(q.to) ? q.to : addDaysToKey(today, 180);
    const status = q.status && ['PENDING', 'APPROVED', 'DENIED', 'CANCELLED'].includes(q.status) ? q.status : null;
    const rows: Row[] = await this.db.timeOffRequest.findMany({
      where: { tenantId, startDate: { lte: to }, endDate: { gte: from }, ...(status ? { status } : {}) },
      include: { staff: { select: { firstName: true, lastName: true, userId: true } } },
      orderBy: [{ status: 'asc' }, { startDate: 'asc' }], take: 500,
    });
    const pending = rows.filter((r) => r.status === 'PENDING').length;
    return { today, from, to, pending, requests: rows.map((r) => this.shape(r)) };
  }

  async pendingCount(tenantId: string): Promise<number> {
    try { return await this.db.timeOffRequest.count({ where: { tenantId, status: 'PENDING' } }); } catch { return 0; }
  }

  /**
   * The owner marks time off directly: it is approved as it is written.
   * With no technician it is a block on the WHOLE SALON (Calendar → Block).
   * The answer says how many bookings already sit inside it: they are kept,
   * the desk moves them.
   */
  async create(user: AuthenticatedUser, dto: { staffId?: string | null; startDate: string; endDate: string; startTime?: string | null; endTime?: string | null; reason?: string }, now = new Date(), audit = 'timeoff.added') {
    const tenantId = this.tenantId(user);
    const wholeSalon = !dto.staffId;
    const st = wholeSalon ? null : await this.prisma.staffMember.findFirst({ where: { id: dto.staffId as string, tenantId }, select: { id: true, firstName: true, lastName: true, userId: true } });
    if (!wholeSalon && !st) throw new NotFoundException('Staff member not found');
    const tz = await this.tz(tenantId);
    const today = dayKeyTz(now, tz);
    // The owner may also record leave that already happened (payroll).
    const bad = validateRequest(dto, '0000-00-00');
    if (bad) throw new BadRequestException(bad);
    const next: TimeOffLite = { staffId: st?.id ?? null, startDate: dto.startDate, endDate: dto.endDate, startTime: dto.startTime || null, endTime: dto.endTime || null };
    if (await this.clashes(tenantId, next)) throw new ConflictException(wholeSalon ? 'The salon is already blocked then.' : 'There is already a request for that time.');
    const row: Row = await this.db.timeOffRequest.create({
      data: { tenantId, ...next, reason: (dto.reason ?? '').trim().slice(0, 300) || null, status: 'APPROVED', requestedByUserId: user.userId, decidedByUserId: user.userId, decidedAt: now },
    });
    await this.audit.log({ tenantId, userId: user.userId, action: audit, resourceType: 'time_off_request', resourceId: row.id, metadata: { staffId: next.staffId, wholeSalon, when: this.when(next) } });
    if (st?.userId && next.endDate >= today) {
      void this.push.sendToUser(tenantId, st.userId, { title: 'Ngày nghỉ của bạn', body: `${this.when(next)}${row.reason ? ` · ${row.reason}` : ''}`, url: '/staff/timeoff', tag: 'lumio-timeoff' }).catch(() => undefined);
    }
    const bookingsInside = await this.bookingsInside(tenantId, next, tz);
    return { ...this.shape({ ...row, staff: (st ?? undefined) as never }), bookingsInside };
  }

  /** Live bookings that already sit inside a block (kept; the desk decides). */
  private async bookingsInside(tenantId: string, o: TimeOffLite, tz: string): Promise<number> {
    try {
      const start = wallTimeToUtcTz(o.startDate, o.startTime || '00:00', tz);
      const end = o.startTime && o.endTime ? wallTimeToUtcTz(o.startDate, o.endTime, tz) : wallTimeToUtcTz(nextDay(o.endDate), '00:00', tz);
      return await this.prisma.appointment.count({
        where: {
          tenantId, startTime: { lt: end }, endTime: { gt: start },
          status: { in: ['PENDING', 'ASSIGNED', 'ACCEPTED', 'CONFIRMED', 'ARRIVED'] as never },
          ...(o.staffId ? { assignedStaffId: o.staffId } : {}),
        },
      });
    } catch { return 0; }
  }

  // ---------------------------------------------------------------- calendar blocks

  /**
   * What the Calendar paints as blocked between two salon days: every
   * approved time off and every block, whole salon included. The desk may
   * read it (calendar capability) — reasons included, they are the salon's own.
   */
  async calendarBlocks(user: AuthenticatedUser, q: { from?: string; to?: string } = {}, now = new Date()) {
    const tenantId = this.tenantId(user);
    const tz = await this.tz(tenantId);
    const today = dayKeyTz(now, tz);
    const day = /^\d{4}-\d{2}-\d{2}$/;
    const from = q.from && day.test(q.from) ? q.from : today;
    let to = q.to && day.test(q.to) ? q.to : addDaysToKey(from, 7);
    if (to < from) to = from;
    if (to > addDaysToKey(from, 62)) to = addDaysToKey(from, 62);
    const rows: Row[] = await this.db.timeOffRequest.findMany({
      where: { tenantId, status: 'APPROVED', startDate: { lte: to }, endDate: { gte: from } },
      include: { staff: { select: { firstName: true, lastName: true, userId: true } } },
      orderBy: { startDate: 'asc' }, take: 500,
    });
    return { from, to, tz, blocks: rows.map((r) => this.shape(r)) };
  }

  /** A block made at the desk / by the owner (never a technician's own request — that is the Staff page's). */
  async addBlock(user: AuthenticatedUser, dto: { staffId?: string | null; startDate: string; endDate: string; startTime?: string | null; endTime?: string | null; reason?: string }, now = new Date()) {
    return this.create(user, dto, now, 'calendar.block_added');
  }

  async removeBlock(user: AuthenticatedUser, id: string) {
    const tenantId = this.tenantId(user);
    const cur: Row | null = await this.db.timeOffRequest.findFirst({ where: { id, tenantId } });
    if (!cur) throw new NotFoundException('Block not found');
    // Leave a technician asked for and the owner approved is changed on the Staff page.
    if (!cur.requestedByUserId || cur.requestedByUserId !== cur.decidedByUserId) {
      throw new ForbiddenException('This is time off the technician asked for — change it on the Staff page.');
    }
    await this.db.timeOffRequest.deleteMany({ where: { id, tenantId } });
    await this.audit.log({ tenantId, userId: user.userId, action: 'calendar.block_removed', resourceType: 'time_off_request', resourceId: id, metadata: { staffId: cur.staffId, wholeSalon: cur.staffId == null, when: this.when(cur) } });
    return { ok: true };
  }

  async decide(user: AuthenticatedUser, id: string, decision: 'APPROVED' | 'DENIED', note?: string, now = new Date()) {
    const tenantId = this.tenantId(user);
    const cur: Row | null = await this.db.timeOffRequest.findFirst({ where: { id, tenantId }, include: { staff: { select: { firstName: true, lastName: true, userId: true } } } });
    if (!cur) throw new NotFoundException('Request not found');
    if (cur.status === 'CANCELLED') throw new BadRequestException('The technician withdrew this request.');
    if (decision === 'APPROVED' && cur.status !== 'APPROVED' && (await this.clashes(tenantId, cur, cur.id))) throw new ConflictException('It overlaps leave already approved.');
    const decisionNote = (note ?? '').trim().slice(0, 300) || null;
    await this.db.timeOffRequest.updateMany({ where: { id, tenantId }, data: { status: decision, decidedByUserId: user.userId, decidedAt: now, decisionNote } });
    await this.audit.log({ tenantId, userId: user.userId, action: decision === 'APPROVED' ? 'timeoff.approved' : 'timeoff.denied', resourceType: 'time_off_request', resourceId: id, metadata: { staffId: cur.staffId, when: this.when(cur), note: decisionNote } });
    if (cur.staff?.userId) {
      void this.push.sendToUser(tenantId, cur.staff.userId, {
        title: decision === 'APPROVED' ? 'Đã duyệt ngày nghỉ' : 'Chưa duyệt ngày nghỉ',
        body: `${this.when(cur)}${decisionNote ? ` · ${decisionNote}` : ''}`, url: '/staff/timeoff', tag: 'lumio-timeoff',
      }).catch(() => undefined);
    }
    const bookingsInside = decision === 'APPROVED' ? await this.bookingsInside(tenantId, cur, await this.tz(tenantId)) : 0;
    return { ...this.shape({ ...cur, status: decision, decidedAt: now, decisionNote }), bookingsInside };
  }

  /**
   * The owner corrects a request or a recorded day off (the technician, the
   * days, the hours, the reason) in the pop-up. It keeps its status: an
   * approved one stays approved and is enforced at once with the new times
   * (every availability path reads these rows live). Same checks as a new
   * one; never another salon's row; audited with before and after.
   */
  async edit(user: AuthenticatedUser, id: string, dto: { staffId?: string | null; startDate: string; endDate: string; startTime?: string | null; endTime?: string | null; reason?: string }, now = new Date()) {
    const tenantId = this.tenantId(user);
    const cur: Row | null = await this.db.timeOffRequest.findFirst({ where: { id, tenantId } });
    if (!cur) throw new NotFoundException('Request not found');
    if (!LIVE.includes(cur.status)) throw new BadRequestException('This request is closed — record a new one instead.');
    const staffId = dto.staffId === undefined ? cur.staffId : (dto.staffId || null);
    const st = staffId ? await this.prisma.staffMember.findFirst({ where: { id: staffId, tenantId }, select: { id: true, firstName: true, lastName: true, userId: true } }) : null;
    if (staffId && !st) throw new NotFoundException('Staff member not found');
    const bad = validateRequest(dto, '0000-00-00');
    if (bad) throw new BadRequestException(bad);
    const next: TimeOffLite = { staffId, startDate: dto.startDate, endDate: dto.endDate, startTime: dto.startTime || null, endTime: dto.endTime || null };
    if (await this.clashes(tenantId, next, id)) throw new ConflictException(staffId ? 'It overlaps other time off of this technician.' : 'The salon is already blocked then.');
    const reason = dto.reason === undefined ? cur.reason : ((dto.reason ?? '').trim().slice(0, 300) || null);
    const before = this.when(cur); const was = cur.staffId; const status = cur.status;
    await this.db.timeOffRequest.updateMany({ where: { id, tenantId }, data: { ...next, reason } });
    await this.audit.log({ tenantId, userId: user.userId, action: 'timeoff.edited', resourceType: 'time_off_request', resourceId: id, metadata: { staffId, before, after: this.when(next), was } });
    const tz = await this.tz(tenantId);
    if (status === 'APPROVED' && st?.userId && next.endDate >= dayKeyTz(now, tz)) {
      void this.push.sendToUser(tenantId, st.userId, { title: 'Ngày nghỉ đã đổi', body: `${this.when(next)}${reason ? ` · ${reason}` : ''}`, url: '/staff/timeoff', tag: 'lumio-timeoff' }).catch(() => undefined);
    }
    const bookingsInside = status === 'APPROVED' ? await this.bookingsInside(tenantId, next, tz) : 0;
    return { ...this.shape({ ...cur, ...next, reason, status, staff: (st ?? undefined) as never }), bookingsInside };
  }

  async remove(user: AuthenticatedUser, id: string) {
    const tenantId = this.tenantId(user);
    const cur: Row | null = await this.db.timeOffRequest.findFirst({ where: { id, tenantId } });
    if (!cur) throw new NotFoundException('Request not found');
    await this.db.timeOffRequest.deleteMany({ where: { id, tenantId } });
    await this.audit.log({ tenantId, userId: user.userId, action: 'timeoff.deleted', resourceType: 'time_off_request', resourceId: id, metadata: { staffId: cur.staffId, when: this.when(cur), was: cur.status } });
    return { ok: true };
  }
}
