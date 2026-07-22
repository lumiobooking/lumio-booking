import { Injectable, NotFoundException } from '@nestjs/common';
import { AppointmentStatus, PaymentStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthenticatedUser, resolveTenantScope } from '../common/tenant/tenant-context';
import { CANONICAL_SOURCES, CanonicalSource, normalizeSource } from '../common/source.util';

/**
 * Marketing module — Phase 0 (read-only).
 *
 * Tells the "marketing → booking → showed up → revenue" story per channel using
 * ONLY data the system already captures. No new tables, no external APIs, and
 * crucially: nothing is fabricated. A channel with no bookings shows real zeros;
 * ratios that need cost data (CPL/CPA/ROI) are NOT computed here — they arrive in
 * Phase 1 once spend is entered, so the UI never shows a made-up number.
 *
 * Everything is strictly tenant-scoped via resolveTenantScope (a super admin may
 * target one salon; a salon admin is pinned to their own).
 */

// Statuses that mean the customer physically came and used the service.
const SHOWED_STATUSES: AppointmentStatus[] = [AppointmentStatus.ARRIVED, AppointmentStatus.COMPLETED];
const REVENUE_EXCLUDED = new Set<string>([AppointmentStatus.CANCELLED, AppointmentStatus.REJECTED]);

type ChannelRow = { key: CanonicalSource; bookings: number; showed: number; revenueCents: number };

@Injectable()
export class MarketingService {
  constructor(private readonly prisma: PrismaService) {}

  private tenantId(user: AuthenticatedUser, requested?: string): string {
    const id = resolveTenantScope(user, requested);
    if (!id) throw new NotFoundException('No tenant context');
    return id;
  }

  private range(fromStr?: string, toStr?: string) {
    const now = new Date();
    let from = fromStr ? new Date(`${fromStr}T00:00:00`) : new Date(now.getFullYear(), now.getMonth(), 1);
    let to = toStr ? new Date(`${toStr}T23:59:59.999`) : now;
    if (Number.isNaN(from.getTime())) from = new Date(now.getFullYear(), now.getMonth(), 1);
    if (Number.isNaN(to.getTime())) to = now;
    return { from, to };
  }

  /**
   * Per-channel funnel + owned-channel signals for a date range. Read-only.
   */
  async overview(user: AuthenticatedUser, fromStr?: string, toStr?: string, tenantParam?: string) {
    const tenantId = this.tenantId(user, tenantParam);
    const { from, to } = this.range(fromStr, toStr);

    const [appts, payments, reviews, reviewClicks, messengerThreads, voiceCalls, emailCampaigns, referredNew] = await Promise.all([
      this.prisma.appointment.findMany({
        where: { tenantId, startTime: { gte: from, lte: to } },
        select: { id: true, source: true, status: true },
      }),
      // Revenue attributed to a booking's channel: PAID payments tied to an
      // appointment, in the period, excluding cancelled/rejected bookings.
      this.prisma.payment.findMany({
        where: { tenantId, status: PaymentStatus.PAID, paidAt: { gte: from, lte: to }, appointmentId: { not: null } },
        select: { amountCents: true, appointmentId: true },
      }),
      this.prisma.googleReview.count({ where: { tenantId, createdAt: { gte: from, lte: to } } }),
      this.prisma.reviewClick.count({ where: { tenantId, createdAt: { gte: from, lte: to } } }),
      this.prisma.messengerThread.count({ where: { tenantId, createdAt: { gte: from, lte: to } } }),
      this.prisma.voiceCall.findMany({ where: { tenantId, createdAt: { gte: from, lte: to } }, select: { outcome: true } }),
      this.prisma.emailCampaign.findMany({ where: { tenantId, status: 'sent', createdAt: { gte: from, lte: to } }, select: { sent: true } }),
      this.prisma.customer.count({ where: { tenantId, createdAt: { gte: from, lte: to }, referredById: { not: null } } }),
    ]);

    // --- Per-channel bookings + showed -------------------------------------
    const rows = new Map<CanonicalSource, ChannelRow>(
      CANONICAL_SOURCES.map((k) => [k, { key: k, bookings: 0, showed: 0, revenueCents: 0 }]),
    );
    const sourceByAppt = new Map<string, CanonicalSource>();
    const excludedAppt = new Set<string>();
    for (const a of appts) {
      const ch = normalizeSource(a.source);
      sourceByAppt.set(a.id, ch);
      if (REVENUE_EXCLUDED.has(a.status)) excludedAppt.add(a.id);
      const row = rows.get(ch)!;
      row.bookings += 1;
      if (SHOWED_STATUSES.includes(a.status)) row.showed += 1;
    }
    // --- Revenue per channel (via appointment → source) --------------------
    for (const p of payments) {
      if (!p.appointmentId || excludedAppt.has(p.appointmentId)) continue;
      const ch = sourceByAppt.get(p.appointmentId);
      if (!ch) continue; // payment for an appointment outside the window
      rows.get(ch)!.revenueCents += p.amountCents;
    }

    const channels = CANONICAL_SOURCES.map((k) => rows.get(k)!);
    const totals = channels.reduce(
      (acc, r) => ({ bookings: acc.bookings + r.bookings, showed: acc.showed + r.showed, revenueCents: acc.revenueCents + r.revenueCents }),
      { bookings: 0, showed: 0, revenueCents: 0 },
    );

    const voiceBooked = voiceCalls.filter((c) => c.outcome === 'booked').length;
    const emailsSent = emailCampaigns.reduce((s, c) => s + (c.sent ?? 0), 0);

    return {
      range: { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) },
      channels,
      totals,
      // Owned-channel signals — real activity we already capture. No spend here.
      owned: {
        googleReviews: reviews,
        reviewClicks,
        messengerThreads,
        voiceCalls: voiceCalls.length,
        voiceBooked,
        emailsSent,
        referredNewCustomers: referredNew,
      },
      // Explicit: paid-channel cost/reach come in Phase 1 (manual) / Phase 3 (API).
      hasCostData: false,
    };
  }
}
