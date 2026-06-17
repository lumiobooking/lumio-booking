import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'crypto';
import { AppointmentStatus, OrderStatus, TenantStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { SettingsService } from '../settings/settings.service';
import { AuthenticatedUser, resolveTenantScope } from '../common/tenant/tenant-context';

/** Resolve a 'YYYY-MM' string (or now) to its [start, end) date range + label. */
function monthRange(month?: string): { start: Date; end: Date; ym: string; label: string } {
  const now = new Date();
  let y = now.getFullYear();
  let m = now.getMonth(); // 0-based
  if (month && /^\d{4}-\d{2}$/.test(month)) {
    const [yy, mm] = month.split('-').map(Number);
    y = yy; m = mm - 1;
  }
  const start = new Date(y, m, 1);
  const end = new Date(y, m + 1, 1);
  const ym = `${y}-${String(m + 1).padStart(2, '0')}`;
  const label = start.toLocaleString('en-US', { month: 'long', year: 'numeric' });
  return { start, end, ym, label };
}

@Injectable()
export class ReviewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
  ) {}

  private tenantId(user: AuthenticatedUser): string {
    const id = resolveTenantScope(user);
    if (!id) throw new NotFoundException('No tenant context');
    return id;
  }

  /**
   * Build the customer-facing "write a Google review" link.
   *
   * Prefers the salon's Google Place ID, which produces the official
   * `search.google.com/local/writereview` link. On a phone this hands off to
   * the Google Maps app — where the customer is almost always already signed in —
   * instead of a browser that may demand a login they don't remember. Falls back
   * to a manually-pasted URL only when no Place ID is configured.
   */
  private buildGoogleUrl(settings: { googlePlaceId?: string; googleReviewUrl?: string }): string | null {
    const placeId = (settings.googlePlaceId ?? '').trim();
    if (placeId) return `https://search.google.com/local/writereview?placeid=${encodeURIComponent(placeId)}`;
    const url = (settings.googleReviewUrl ?? '').trim();
    return url || null;
  }

  // ---------------------------- Public ----------------------------

  /** Data to render the customer feedback page (by salon slug + staff id). */
  async context(slug: string, staffId: string) {
    const tenant = await this.prisma.tenant.findFirst({
      where: { slug, deletedAt: null, status: TenantStatus.ACTIVE },
      select: { id: true, name: true, branding: true },
    });
    if (!tenant) throw new NotFoundException('Salon not found');
    const staff = await this.prisma.staffMember.findFirst({
      where: { id: staffId, tenantId: tenant.id, isActive: true },
      select: { id: true, firstName: true, lastName: true, avatarUrl: true },
    });
    const review = await this.settings.getReviewSettings(tenant.id);
    const googleUrl = this.buildGoogleUrl(review);
    return {
      salonName: tenant.name,
      branding: this.settings.brandingFrom(tenant.branding),
      staff: staff ? { id: staff.id, name: `${staff.firstName} ${staff.lastName ?? ''}`.trim(), avatarUrl: staff.avatarUrl } : null,
      enabled: review.enabled,
      reviewMode: review.reviewMode ?? 'direct',
      customerPoints: review.customerPoints,
      minRatingForGoogle: review.minRatingForGoogle,
      hasGoogle: !!googleUrl,
      // In direct mode the landing needs the actual URL to render the one-tap button.
      googleUrl: (review.reviewMode ?? 'direct') === 'direct' ? googleUrl : null,
    };
  }

  /** Is the salon open right now, in its own timezone? (Used to gate reward counting.) */
  private isOpenNow(timezone: string, rules: { businessHours?: { closed: boolean; openMinutes: number; closeMinutes: number }[]; daysOff?: string[] }): boolean {
    try {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone || 'UTC', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
        year: 'numeric', month: '2-digit', day: '2-digit',
      }).formatToParts(new Date());
      const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
      const wd: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
      const day = wd[get('weekday')] ?? new Date().getDay();
      let hour = parseInt(get('hour'), 10); if (hour === 24) hour = 0;
      const mins = hour * 60 + parseInt(get('minute'), 10);
      const dateStr = `${get('year')}-${get('month')}-${get('day')}`;
      if (rules.daysOff?.includes(dateStr)) return false;
      const dh = rules.businessHours?.[day];
      if (!dh || dh.closed) return false;
      return mins >= dh.openMinutes && mins <= dh.closeMinutes;
    } catch {
      return true; // never block on a clock/parse error
    }
  }

  /**
   * Direct mode: log a "send to Google" tap and decide whether it earns the
   * technician reward points, through layered anti-fraud:
   *   1) device/IP dedupe within a cooldown window,
   *   2) business-hours gate (optional),
   *   3) hard daily cap,
   *   4) "soft anchor" — counted sends/day ≤ (completed appts + POS checkouts) + a
   *      grace buffer for untracked walk-ins (optional).
   * Every tap is logged with a reason (ok | dedup | off-hours | cap | over-visits |
   * disabled) so the salon can audit. NOTE: Google gives no callback, so this
   * counts sends/intent — NOT confirmed posted reviews.
   */
  async logSend(dto: { slug: string; staffId: string; deviceId?: string; ip?: string }) {
    const tenant = await this.prisma.tenant.findFirst({
      where: { slug: dto.slug, deletedAt: null, status: TenantStatus.ACTIVE },
      select: { id: true, timezone: true },
    });
    if (!tenant) throw new NotFoundException('Salon not found');
    const tenantId = tenant.id;

    const settings = await this.settings.getReviewSettings(tenantId);
    const googleUrl = this.buildGoogleUrl(settings);

    const staff = await this.prisma.staffMember.findFirst({
      where: { id: dto.staffId, tenantId, isActive: true },
      select: { id: true },
    });

    const deviceId = (dto.deviceId ?? '').slice(0, 80) || null;
    const ipHash = dto.ip ? createHash('sha256').update(dto.ip).digest('hex').slice(0, 32) : null;
    const dedupHours = settings.sendDedupHours ?? 12;
    const dailyCap = settings.sendDailyCap ?? 20;
    const pts = settings.staffPointsPerSend ?? 0;
    const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);

    let counted = false;
    let reason = 'disabled';

    if (settings.enabled && staff && pts > 0) {
      // 2) Business-hours gate.
      let blocked = false;
      if (settings.onlyBusinessHours ?? true) {
        const rules = await this.settings.getBookingRules(tenantId);
        if (!this.isOpenNow(tenant.timezone, rules)) { reason = 'off-hours'; blocked = true; }
      }

      // 1) Dedupe: same device (or IP) counts once per staff in the window.
      if (!blocked) {
        const dedupSince = new Date(Date.now() - dedupHours * 3600 * 1000);
        const dupWhere = deviceId
          ? { tenantId, staffId: staff.id, deviceId, counted: true, createdAt: { gte: dedupSince } }
          : ipHash
            ? { tenantId, staffId: staff.id, ipHash, counted: true, createdAt: { gte: dedupSince } }
            : null;
        const dup = dupWhere ? await this.prisma.reviewClick.count({ where: dupWhere }) : 0;
        if (dup > 0) { reason = 'dedup'; blocked = true; }
      }

      if (!blocked) {
        const countedToday = await this.prisma.reviewClick.count({ where: { tenantId, staffId: staff.id, counted: true, createdAt: { gte: startOfDay } } });
        // 3) Hard daily cap.
        if (countedToday >= dailyCap) { reason = 'cap'; blocked = true; }
        // 4) Soft anchor: cap to real customer volume + grace buffer.
        else if (settings.anchorToVisits ?? true) {
          const [appts, posOrders] = await Promise.all([
            this.prisma.appointment.count({ where: { tenantId, assignedStaffId: staff.id, status: AppointmentStatus.COMPLETED, startTime: { gte: startOfDay } } }),
            this.prisma.order.count({ where: { tenantId, status: OrderStatus.PAID, appointmentId: null, createdAt: { gte: startOfDay }, items: { some: { staffMemberId: staff.id } } } }),
          ]);
          const allowance = appts + posOrders + (settings.visitBuffer ?? 3);
          if (countedToday >= allowance) { reason = 'over-visits'; blocked = true; }
        }
      }

      if (!blocked) { counted = true; reason = 'ok'; }
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.reviewClick.create({ data: { tenantId, staffId: staff?.id ?? null, deviceId, ipHash, counted, reason } });
      if (counted && staff && pts > 0) {
        const updated = await tx.staffMember.update({ where: { id: staff.id }, data: { rewardPoints: { increment: pts } }, select: { rewardPoints: true } });
        await tx.staffRewardTransaction.create({ data: { tenantId, staffId: staff.id, points: pts, balanceAfter: updated.rewardPoints, reason: 'Google review send' } });
      }
    });

    return { ok: true, counted, reason, googleUrl };
  }

  /** Recent send log for the salon dashboard (audit trail). */
  async recentSends(user: AuthenticatedUser) {
    const tenantId = this.tenantId(user);
    const rows = await this.prisma.reviewClick.findMany({
      where: { tenantId },
      select: { id: true, createdAt: true, counted: true, reason: true, deviceId: true, staff: { select: { firstName: true, lastName: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return rows.map((r) => ({
      id: r.id,
      createdAt: r.createdAt,
      counted: r.counted,
      reason: r.reason,
      staff: r.staff ? `${r.staff.firstName} ${r.staff.lastName ?? ''}`.trim() : '—',
      device: r.deviceId ? `…${r.deviceId.slice(-4)}` : '—', // masked
    }));
  }

  /** Customer submits a rating; awards staff points + (if phone) customer points. */
  async submit(dto: { slug: string; staffId: string; rating: number; comment?: string; phone?: string }) {
    const rating = Math.round(Number(dto.rating));
    if (!(rating >= 1 && rating <= 5)) throw new BadRequestException('Rating must be 1–5');

    const tenant = await this.prisma.tenant.findFirst({
      where: { slug: dto.slug, deletedAt: null, status: TenantStatus.ACTIVE },
      select: { id: true },
    });
    if (!tenant) throw new NotFoundException('Salon not found');
    const tenantId = tenant.id;

    const settings = await this.settings.getReviewSettings(tenantId);
    if (!settings.enabled) throw new BadRequestException('The review program is not active');

    const staff = await this.prisma.staffMember.findFirst({
      where: { id: dto.staffId, tenantId, isActive: true },
      select: { id: true },
    });

    // Match the customer by phone (no anonymous junk customers any more).
    let customerId: string | null = null;
    const phone = (dto.phone ?? '').trim();
    if (phone) {
      const customer = await this.prisma.customer.findFirst({ where: { tenantId, phone }, select: { id: true } });
      customerId = customer?.id ?? null;
    }

    // ---- Anti-abuse: only REWARD feedback anchored to a real recent visit. ----
    const requireRealVisit = settings.requireRealVisit ?? true;
    const windowH = settings.visitWindowHours ?? 48;
    const dailyCap = settings.dailyCapPerStaff ?? 10;
    const dedupDays = settings.dedupDays ?? 7;

    let matchedAppointmentId: string | null = null;
    let verified = false;
    let blockReason: string | null = null;

    if (staff && customerId) {
      // 1) A real, recent appointment with THIS staff for THIS customer.
      const since = new Date(Date.now() - windowH * 3600 * 1000);
      const appt = await this.prisma.appointment.findFirst({
        where: {
          tenantId, customerId, assignedStaffId: staff.id,
          startTime: { gte: since },
          status: { in: [AppointmentStatus.COMPLETED, AppointmentStatus.CONFIRMED, AppointmentStatus.ACCEPTED] },
        },
        orderBy: { startTime: 'desc' },
        select: { id: true },
      });
      // Ensure that visit hasn't already been reviewed (one reward per visit).
      if (appt) {
        const already = await this.prisma.feedback.count({ where: { tenantId, appointmentId: appt.id } });
        matchedAppointmentId = already > 0 ? null : appt.id;
      }

      if (requireRealVisit && !matchedAppointmentId) {
        blockReason = appt ? 'duplicate' : 'no-visit';
      } else {
        // 2) Same customer can only reward the same staff once per dedupDays.
        const dupSince = new Date(Date.now() - dedupDays * 86400 * 1000);
        const recentDup = await this.prisma.feedback.count({ where: { tenantId, staffId: staff.id, customerId, verified: true, createdAt: { gte: dupSince } } });
        if (recentDup > 0) blockReason = 'duplicate';
        else {
          // 3) Daily cap of rewarded feedbacks per staff.
          const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
          const todayCount = await this.prisma.feedback.count({ where: { tenantId, staffId: staff.id, verified: true, createdAt: { gte: startOfDay } } });
          if (todayCount >= dailyCap) blockReason = 'cap';
          else verified = true;
        }
      }
    } else if (!requireRealVisit && staff) {
      // Lenient mode (admin turned off real-visit requirement): still cap per day.
      const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
      const todayCount = await this.prisma.feedback.count({ where: { tenantId, staffId: staff.id, verified: true, createdAt: { gte: startOfDay } } });
      if (todayCount >= dailyCap) blockReason = 'cap';
      else verified = true;
    }

    const googleUrl = this.buildGoogleUrl(settings);
    const invitedToGoogle = rating >= settings.minRatingForGoogle && !!googleUrl;
    let customerPointsAwarded = 0;

    await this.prisma.$transaction(async (tx) => {
      await tx.feedback.create({
        data: {
          tenantId, staffId: staff?.id ?? null, customerId, rating,
          comment: dto.comment?.slice(0, 1000) || null,
          invitedToGoogle, appointmentId: matchedAppointmentId, verified,
        },
      });

      if (!verified) return; // store the feedback, but award nothing

      // Staff reward points.
      if (staff) {
        const pts = settings.staffPointsPerFeedback + (rating === 5 ? settings.staffBonusFor5Star : 0);
        if (pts > 0) {
          const updated = await tx.staffMember.update({ where: { id: staff.id }, data: { rewardPoints: { increment: pts } }, select: { rewardPoints: true } });
          await tx.staffRewardTransaction.create({ data: { tenantId, staffId: staff.id, points: pts, balanceAfter: updated.rewardPoints, reason: `Feedback ${rating}★` } });
        }
      }
      // Customer loyalty points (our own survey — allowed).
      if (customerId && settings.customerPoints > 0) {
        const c = await tx.customer.update({ where: { id: customerId }, data: { loyaltyPoints: { increment: settings.customerPoints } }, select: { loyaltyPoints: true } });
        await tx.loyaltyTransaction.create({ data: { tenantId, customerId, points: settings.customerPoints, balanceAfter: c.loyaltyPoints, reason: 'Feedback reward', refType: 'feedback' } });
        customerPointsAwarded = settings.customerPoints;
      }
    });

    return {
      ok: true,
      rating,
      verified,
      reason: blockReason,
      customerPointsAwarded,
      googleReviewUrl: invitedToGoogle ? googleUrl : null,
    };
  }

  // ---------------------------- Admin ----------------------------

  /**
   * Staff leaderboard for a given month (default = current month). The lifetime
   * point *balance* is always shown (that's what gets redeemed), alongside what
   * each tech earned/sent/was-rated within the selected month.
   */
  async leaderboard(user: AuthenticatedUser, month?: string) {
    const tenantId = this.tenantId(user);
    const { start, end, ym, label } = monthRange(month);
    const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);

    const staff = await this.prisma.staffMember.findMany({
      where: { tenantId },
      select: { id: true, firstName: true, lastName: true, avatarUrl: true, rewardPoints: true },
    });

    const inMonth = { gte: start, lt: end };
    const [earned, sendsM, blockedM, fbM, blockedToday] = await Promise.all([
      this.prisma.staffRewardTransaction.groupBy({ by: ['staffId'], where: { tenantId, points: { gt: 0 }, createdAt: inMonth }, _sum: { points: true } }),
      this.prisma.reviewClick.groupBy({ by: ['staffId'], where: { tenantId, createdAt: inMonth }, _count: { _all: true } }),
      this.prisma.reviewClick.groupBy({ by: ['staffId'], where: { tenantId, counted: false, createdAt: inMonth }, _count: { _all: true } }),
      this.prisma.feedback.groupBy({ by: ['staffId'], where: { tenantId, createdAt: inMonth }, _avg: { rating: true }, _count: { _all: true } }),
      // Today's rejected sends — a spike signals self-farming.
      this.prisma.reviewClick.groupBy({ by: ['staffId'], where: { tenantId, counted: false, createdAt: { gte: startOfDay } }, _count: { _all: true } }),
    ]);
    const cnt = (rows: { staffId: string | null; _count: { _all: number } }[]) => new Map(rows.map((r) => [r.staffId, r._count._all]));
    const earnedById = new Map(earned.map((r) => [r.staffId, r._sum.points ?? 0]));
    const sendsById = cnt(sendsM); const blockedById = cnt(blockedM); const blockedTodayById = cnt(blockedToday);
    const fbCountById = cnt(fbM);
    const avgById = new Map(fbM.map((r) => [r.staffId, r._avg.rating ?? 0]));

    const rows = staff.map((s) => {
      const blockedTodayN = blockedTodayById.get(s.id) ?? 0;
      return {
        id: s.id,
        name: `${s.firstName} ${s.lastName ?? ''}`.trim(),
        avatarUrl: s.avatarUrl,
        balance: s.rewardPoints, // lifetime, redeemable
        earnedMonth: earnedById.get(s.id) ?? 0,
        sendsMonth: sendsById.get(s.id) ?? 0,
        blockedMonth: blockedById.get(s.id) ?? 0,
        feedbackMonth: fbCountById.get(s.id) ?? 0,
        avgMonth: Math.round((avgById.get(s.id) ?? 0) * 10) / 10,
        flagged: blockedTodayN >= 5,
      };
    }).sort((a, b) => b.earnedMonth - a.earnedMonth || b.balance - a.balance);

    return { ym, label, rows };
  }

  /** Reset one technician's point balance to 0 (logged in the ledger). */
  async resetStaffPoints(user: AuthenticatedUser, staffId: string) {
    const tenantId = this.tenantId(user);
    const staff = await this.prisma.staffMember.findFirst({ where: { id: staffId, tenantId }, select: { rewardPoints: true } });
    if (!staff) throw new NotFoundException('Staff not found');
    if (staff.rewardPoints !== 0) {
      await this.prisma.$transaction([
        this.prisma.staffMember.update({ where: { id: staffId }, data: { rewardPoints: 0 } }),
        this.prisma.staffRewardTransaction.create({ data: { tenantId, staffId, points: -staff.rewardPoints, balanceAfter: 0, reason: 'Reset to 0' } }),
      ]);
    }
    await this.audit.log({ tenantId, userId: user.userId, action: 'staff_reward.reset', resourceType: 'staff', resourceId: staffId });
    return { ok: true };
  }

  /** Wipe ALL review/reward data for the salon and zero every balance (start fresh). */
  async wipeAll(user: AuthenticatedUser) {
    const tenantId = this.tenantId(user);
    await this.prisma.$transaction([
      this.prisma.feedback.deleteMany({ where: { tenantId } }),
      this.prisma.reviewClick.deleteMany({ where: { tenantId } }),
      this.prisma.staffRewardTransaction.deleteMany({ where: { tenantId } }),
      this.prisma.staffMember.updateMany({ where: { tenantId }, data: { rewardPoints: 0 } }),
    ]);
    await this.audit.log({ tenantId, userId: user.userId, action: 'review.wipe_all', resourceType: 'tenant', resourceId: tenantId });
    return { ok: true };
  }

  /** Delete review/reward data within a date range (e.g. clean up test days). */
  async cleanupRange(user: AuthenticatedUser, from: string, to: string) {
    const tenantId = this.tenantId(user);
    const start = new Date(from); start.setHours(0, 0, 0, 0);
    const end = new Date(to); end.setHours(23, 59, 59, 999);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) throw new BadRequestException('Invalid date range');
    const range = { gte: start, lte: end };
    // Remove the points those transactions granted, then delete the rows.
    const txns = await this.prisma.staffRewardTransaction.findMany({ where: { tenantId, createdAt: range }, select: { staffId: true, points: true } });
    const perStaff = new Map<string, number>();
    for (const t of txns) perStaff.set(t.staffId, (perStaff.get(t.staffId) ?? 0) + t.points);
    await this.prisma.$transaction(async (tx) => {
      for (const [sid, sum] of perStaff) {
        if (sum !== 0) await tx.staffMember.update({ where: { id: sid }, data: { rewardPoints: { decrement: sum } } });
      }
      await tx.staffRewardTransaction.deleteMany({ where: { tenantId, createdAt: range } });
      await tx.feedback.deleteMany({ where: { tenantId, createdAt: range } });
      await tx.reviewClick.deleteMany({ where: { tenantId, createdAt: range } });
    });
    await this.audit.log({ tenantId, userId: user.userId, action: 'review.cleanup_range', resourceType: 'tenant', resourceId: tenantId, metadata: { from, to } });
    return { ok: true, removedTransactions: txns.length };
  }

  /** Recent feedback for the salon dashboard. */
  recentFeedback(user: AuthenticatedUser) {
    const tenantId = this.tenantId(user);
    return this.prisma.feedback.findMany({
      where: { tenantId },
      select: {
        id: true, rating: true, comment: true, createdAt: true, invitedToGoogle: true, verified: true,
        staff: { select: { firstName: true, lastName: true } },
        customer: { select: { firstName: true, phone: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  /** Admin adjusts a staff member's reward points (e.g. redeem a prize). */
  async adjustPoints(user: AuthenticatedUser, staffId: string, delta: number, reason: string) {
    const tenantId = this.tenantId(user);
    const staff = await this.prisma.staffMember.findFirst({ where: { id: staffId, tenantId }, select: { id: true } });
    if (!staff) throw new NotFoundException('Staff not found');
    const d = Math.round(Number(delta));
    if (!d) throw new BadRequestException('Enter a non-zero amount');
    const updated = await this.prisma.staffMember.update({ where: { id: staffId }, data: { rewardPoints: { increment: d } }, select: { rewardPoints: true } });
    await this.prisma.staffRewardTransaction.create({ data: { tenantId, staffId, points: d, balanceAfter: updated.rewardPoints, reason: reason?.slice(0, 120) || (d > 0 ? 'Manual add' : 'Redeemed') } });
    await this.audit.log({ tenantId, userId: user.userId, action: 'staff_reward.adjusted', resourceType: 'staff', resourceId: staffId, metadata: { delta: d } });
    return { ok: true, rewardPoints: updated.rewardPoints };
  }

  // ---------------------------- Staff (self) ----------------------------

  /** The signed-in staff member's own review link + points + recent feedback. */
  async mine(user: AuthenticatedUser) {
    const tenantId = this.tenantId(user);
    const staff = await this.prisma.staffMember.findFirst({
      where: { tenantId, userId: user.userId },
      select: { id: true, rewardPoints: true, tenant: { select: { slug: true } } },
    });
    if (!staff) throw new NotFoundException('No staff profile linked to your account');
    const recent = await this.prisma.feedback.findMany({
      where: { tenantId, staffId: staff.id },
      select: { id: true, rating: true, comment: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    return { staffId: staff.id, slug: staff.tenant.slug, rewardPoints: staff.rewardPoints, recent };
  }
}
