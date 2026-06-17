import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AppointmentStatus, TenantStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { SettingsService } from '../settings/settings.service';
import { AuthenticatedUser, resolveTenantScope } from '../common/tenant/tenant-context';

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
    return {
      salonName: tenant.name,
      branding: this.settings.brandingFrom(tenant.branding),
      staff: staff ? { id: staff.id, name: `${staff.firstName} ${staff.lastName ?? ''}`.trim(), avatarUrl: staff.avatarUrl } : null,
      enabled: review.enabled,
      customerPoints: review.customerPoints,
      minRatingForGoogle: review.minRatingForGoogle,
      hasGoogle: !!this.buildGoogleUrl(review),
    };
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

  /** Staff leaderboard by reward points, with feedback count + average rating. */
  async leaderboard(user: AuthenticatedUser) {
    const tenantId = this.tenantId(user);
    const staff = await this.prisma.staffMember.findMany({
      where: { tenantId },
      select: { id: true, firstName: true, lastName: true, avatarUrl: true, rewardPoints: true, _count: { select: { feedbacks: true } } },
      orderBy: { rewardPoints: 'desc' },
    });
    // Average rating per staff.
    const grouped = await this.prisma.feedback.groupBy({ by: ['staffId'], where: { tenantId }, _avg: { rating: true } });
    const avgById = new Map(grouped.map((g) => [g.staffId, g._avg.rating ?? 0]));
    return staff.map((s) => ({
      id: s.id,
      name: `${s.firstName} ${s.lastName ?? ''}`.trim(),
      avatarUrl: s.avatarUrl,
      rewardPoints: s.rewardPoints,
      feedbackCount: s._count.feedbacks,
      avgRating: Math.round((avgById.get(s.id) ?? 0) * 10) / 10,
    }));
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
