import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { AppointmentStatus, PaymentStatus, UserRole, TenantStatus } from '@prisma/client';
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

    const [appts, payments, reviews, reviewClicks, messengerThreads, voiceCalls, emailCampaigns, referredNew, newCustomers] = await Promise.all([
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
      this.prisma.customer.count({ where: { tenantId, createdAt: { gte: from, lte: to } } }),
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
      newCustomers,
      // Explicit: paid-channel cost/reach come in Phase 1 (manual) / Phase 3 (API).
      hasCostData: false,
    };
  }

  // ======================= PHASE 1: spend / worklog / report ===============

  private readonly logger = new Logger('Marketing');

  private monthRange(month: string): { from: Date; to: Date } {
    if (!/^\d{4}-\d{2}$/.test(month || '')) throw new BadRequestException('month must be YYYY-MM');
    const [y, m] = month.split('-').map(Number);
    return { from: new Date(y, m - 1, 1, 0, 0, 0), to: new Date(y, m, 0, 23, 59, 59, 999) };
  }

  // ---- Spend (one row per tenant+channel+month) ---------------------------
  async listSpend(user: AuthenticatedUser, month: string, tenantParam?: string) {
    const tenantId = this.tenantId(user, tenantParam);
    return this.prisma.marketingSpend.findMany({ where: { tenantId, periodMonth: month }, orderBy: { channel: 'asc' } });
  }

  async upsertSpend(user: AuthenticatedUser, dto: { channel: string; periodMonth: string; amountCents?: number; currency?: string; reach?: number | null; clicks?: number | null; leads?: number | null; note?: string | null; tenantId?: string }) {
    const tenantId = this.tenantId(user, dto.tenantId);
    const channel = (dto.channel || '').trim().toLowerCase();
    if (!channel) throw new BadRequestException('channel is required');
    if (!/^\d{4}-\d{2}$/.test(dto.periodMonth || '')) throw new BadRequestException('periodMonth must be YYYY-MM');
    const data = {
      amountCents: Math.max(0, Math.round(Number(dto.amountCents) || 0)),
      currency: dto.currency || 'USD',
      reach: dto.reach == null ? null : Math.max(0, Math.round(Number(dto.reach))),
      clicks: dto.clicks == null ? null : Math.max(0, Math.round(Number(dto.clicks))),
      leads: dto.leads == null ? null : Math.max(0, Math.round(Number(dto.leads))),
      note: dto.note?.slice(0, 500) || null,
      source: 'manual',
      createdByUserId: user.userId,
    };
    return this.prisma.marketingSpend.upsert({
      where: { tenantId_channel_periodMonth: { tenantId, channel, periodMonth: dto.periodMonth } },
      create: { tenantId, channel, periodMonth: dto.periodMonth, ...data },
      update: data,
    });
  }

  async deleteSpend(user: AuthenticatedUser, id: string) {
    const tenantId = this.tenantId(user);
    const row = await this.prisma.marketingSpend.findFirst({ where: { id, tenantId } });
    if (!row) throw new NotFoundException('Spend row not found');
    await this.prisma.marketingSpend.delete({ where: { id: row.id } });
    return { ok: true };
  }

  // ---- Work log -----------------------------------------------------------
  async listWorkLog(user: AuthenticatedUser, month: string, tenantParam?: string) {
    const tenantId = this.tenantId(user, tenantParam);
    return this.prisma.marketingWorkLog.findMany({ where: { tenantId, periodMonth: month }, orderBy: { createdAt: 'desc' } });
  }

  async addWorkLog(user: AuthenticatedUser, dto: { periodMonth: string; category?: string; title: string; note?: string; tenantId?: string }) {
    const tenantId = this.tenantId(user, dto.tenantId);
    const title = (dto.title || '').trim();
    if (!title) throw new BadRequestException('title is required');
    if (!/^\d{4}-\d{2}$/.test(dto.periodMonth || '')) throw new BadRequestException('periodMonth must be YYYY-MM');
    return this.prisma.marketingWorkLog.create({
      data: { tenantId, periodMonth: dto.periodMonth, category: (dto.category || 'other').slice(0, 30), title: title.slice(0, 200), note: dto.note?.slice(0, 500) || null, createdByUserId: user.userId },
    });
  }

  async deleteWorkLog(user: AuthenticatedUser, id: string) {
    const tenantId = this.tenantId(user);
    const row = await this.prisma.marketingWorkLog.findFirst({ where: { id, tenantId } });
    if (!row) throw new NotFoundException('Work log not found');
    await this.prisma.marketingWorkLog.delete({ where: { id: row.id } });
    return { ok: true };
  }

  // ---- Assembled month data (the single source the report is written from) --
  async monthlyData(user: AuthenticatedUser, month: string, tenantParam?: string) {
    const tenantId = this.tenantId(user, tenantParam);
    const { from, to } = this.monthRange(month);
    const fromStr = from.toISOString().slice(0, 10);
    const toStr = to.toISOString().slice(0, 10);

    const [ov, spend, workLog] = await Promise.all([
      this.overview(user, fromStr, toStr, tenantParam),
      this.prisma.marketingSpend.findMany({ where: { tenantId, periodMonth: month }, orderBy: { channel: 'asc' } }),
      this.prisma.marketingWorkLog.findMany({ where: { tenantId, periodMonth: month }, orderBy: { createdAt: 'desc' } }),
    ]);

    const totalSpendCents = spend.reduce((sVal, r) => sVal + r.amountCents, 0);
    const bookings = ov.totals.bookings;
    const showed = ov.totals.showed;
    const revenueCents = ov.totals.revenueCents;
    const newCustomers = ov.newCustomers;

    // BLENDED metrics only. Phase 1 has no per-ad attribution (that arrives with
    // UTM in Phase 2), so we deliberately do NOT split cost per channel-outcome.
    // Every ratio is null unless BOTH sides are real numbers — never a guess.
    const blended = {
      totalSpendCents,
      costPerBookingCents: totalSpendCents > 0 && bookings > 0 ? Math.round(totalSpendCents / bookings) : null,
      costPerShowedCents: totalSpendCents > 0 && showed > 0 ? Math.round(totalSpendCents / showed) : null,
      costPerNewCustomerCents: totalSpendCents > 0 && newCustomers > 0 ? Math.round(totalSpendCents / newCustomers) : null,
      // Revenue returned per $1 spent. Only booking-attributed revenue is counted.
      revenuePerSpend: totalSpendCents > 0 ? Math.round((revenueCents / totalSpendCents) * 100) / 100 : null,
    };

    return { month, range: { from: fromStr, to: toStr }, outcome: ov, spend, workLog, blended };
  }

  // ---- AI draft (Anthropic, same pattern as the voice/messenger agents) ----
  private async draftWithAI(data: Awaited<ReturnType<MarketingService['monthlyData']>>): Promise<{ content: any; model: string } | null> {
    const key = process.env.ANTHROPIC_API_KEY || '';
    if (!key) return null;
    const model = process.env.ANTHROPIC_AGENT_MODEL || 'claude-haiku-4-5-20251001';

    const system =
      'You are a marketing analyst writing a SHORT monthly report for a nail-salon owner who is NOT technical. ' +
      'Write in plain language, no marketing jargon. Be honest and specific with the numbers given. ' +
      'STRICT RULES: (1) Use ONLY the numbers in the data. NEVER invent or estimate any figure. ' +
      '(2) Attribution is BLENDED — the data does NOT tell you which ad or channel caused which booking, so do NOT claim a specific channel "generated" specific bookings or revenue. Talk about totals and spend allocation instead. ' +
      '(3) If a needed number is missing or zero, say so plainly (e.g. "chưa nhập chi phí" / "no spend entered") rather than guessing. ' +
      '(4) Output MUST be valid JSON only, matching this exact shape, every string in BOTH Vietnamese (vi) and English (en): ' +
      '{"summary":{"vi":"","en":""},"highlights":[{"vi":"","en":""}],"issues":[{"vi":"","en":""}],"plan":[{"vi":"","en":""}]}. ' +
      'highlights = what went well (2-4). issues = problems or gaps, including missing data (1-3). plan = concrete suggestions for next month (2-4). Keep each item one sentence.';

    const userText = 'DATA (JSON):\n' + JSON.stringify({
      month: data.month,
      bookings: data.outcome.totals.bookings,
      showedUp: data.outcome.totals.showed,
      bookingRevenueCents: data.outcome.totals.revenueCents,
      newCustomers: data.outcome.newCustomers,
      bookingsByChannel: data.outcome.channels.filter((c: any) => c.bookings > 0),
      ownedChannels: data.outcome.owned,
      totalSpendCents: data.blended.totalSpendCents,
      spendByChannel: data.spend.map((r: any) => ({ channel: r.channel, amountCents: r.amountCents, reach: r.reach, clicks: r.clicks, leads: r.leads })),
      blended: data.blended,
      workDone: data.workLog.map((w: any) => ({ category: w.category, title: w.title })),
    });

    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model, max_tokens: 1500, system, messages: [{ role: 'user', content: userText }] }),
      });
      if (!res.ok) { this.logger.warn(`Anthropic ${res.status}: ${(await res.text().catch(() => '')).slice(0, 160)}`); return null; }
      const json = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
      const text = (json.content || []).filter((b) => b.type === 'text').map((b) => b.text || '').join('').trim();
      const start = text.indexOf('{'); const end = text.lastIndexOf('}');
      if (start < 0 || end < 0) return null;
      const content = JSON.parse(text.slice(start, end + 1));
      return { content, model };
    } catch (e) {
      this.logger.warn(`AI draft failed: ${String(e)}`);
      return null;
    }
  }

  // ---- Report lifecycle ---------------------------------------------------
  async generateReport(user: AuthenticatedUser, month: string, tenantParam?: string) {
    const tenantId = this.tenantId(user, tenantParam);
    const data = await this.monthlyData(user, month, tenantParam);
    const ai = await this.draftWithAI(data);
    const content = ai?.content ?? { summary: { vi: '', en: '' }, highlights: [], issues: [], plan: [], _aiUnavailable: true };
    const saved = await this.prisma.marketingReport.upsert({
      where: { tenantId_periodMonth: { tenantId, periodMonth: month } },
      create: { tenantId, periodMonth: month, status: 'review', content, dataSnapshot: data as any, aiModel: ai?.model ?? null },
      update: { content, dataSnapshot: data as any, aiModel: ai?.model ?? null, status: 'review' },
    });
    return { ...saved, aiUsed: !!ai };
  }

  async getReport(user: AuthenticatedUser, month: string, tenantParam?: string) {
    const tenantId = this.tenantId(user, tenantParam);
    return this.prisma.marketingReport.findUnique({ where: { tenantId_periodMonth: { tenantId, periodMonth: month } } });
  }

  async updateReport(user: AuthenticatedUser, month: string, dto: { content: any; tenantId?: string }) {
    const tenantId = this.tenantId(user, dto.tenantId);
    const existing = await this.prisma.marketingReport.findUnique({ where: { tenantId_periodMonth: { tenantId, periodMonth: month } } });
    if (!existing) throw new NotFoundException('Report not generated yet');
    if (existing.status === 'sent') throw new BadRequestException('A sent report cannot be edited');
    return this.prisma.marketingReport.update({ where: { id: existing.id }, data: { content: dto.content, status: existing.status === 'approved' ? 'review' : existing.status } });
  }

  async approveReport(user: AuthenticatedUser, month: string, tenantParam?: string) {
    const tenantId = this.tenantId(user, tenantParam);
    const existing = await this.prisma.marketingReport.findUnique({ where: { tenantId_periodMonth: { tenantId, periodMonth: month } } });
    if (!existing) throw new NotFoundException('Report not generated yet');
    return this.prisma.marketingReport.update({ where: { id: existing.id }, data: { status: 'approved', approvedByUserId: user.userId, approvedAt: new Date() } });
  }

  // ---- Month-end automation ----------------------------------------------

  /** 'YYYY-MM' for the month before the given date (default: now). */
  private previousMonth(ref = new Date()): string {
    const d = new Date(ref.getFullYear(), ref.getMonth() - 1, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  /**
   * Auto-draft last month's report for every active salon that has something to
   * report. Idempotent — a salon whose report already exists is skipped, so
   * running this many times is safe. Reports are left in 'review' so a human
   * always approves before anything reaches a client. A system run acts as a
   * super admin scoped to one explicit tenant, so tenant isolation still holds.
   */
  async runMonthlyAutoGenerate(targetMonth?: string) {
    const month = targetMonth ?? this.previousMonth();
    const { from, to } = this.monthRange(month);
    const tenants = await this.prisma.tenant.findMany({
      where: { status: TenantStatus.ACTIVE, deletedAt: null },
      select: { id: true },
    });
    const sys: AuthenticatedUser = { userId: 'system', email: 'system@lumio.local', role: UserRole.SUPER_ADMIN, tenantId: null };
    let generated = 0, skipped = 0, failed = 0;

    for (const t of tenants) {
      const existing = await this.prisma.marketingReport.findUnique({
        where: { tenantId_periodMonth: { tenantId: t.id, periodMonth: month } },
      });
      if (existing) { skipped++; continue; }
      // Only draft where there is real activity — never an empty report.
      const [spendCount, apptCount] = await Promise.all([
        this.prisma.marketingSpend.count({ where: { tenantId: t.id, periodMonth: month } }),
        this.prisma.appointment.count({ where: { tenantId: t.id, startTime: { gte: from, lte: to } } }),
      ]);
      if (spendCount === 0 && apptCount === 0) { skipped++; continue; }
      try {
        await this.generateReport(sys, month, t.id);
        generated++;
      } catch (e) {
        failed++;
        this.logger.warn(`Auto-report failed for tenant ${t.id} ${month}: ${String(e)}`);
      }
    }
    this.logger.log(`Auto-report ${month}: generated ${generated}, skipped ${skipped}, failed ${failed}.`);
    return { month, generated, skipped, failed };
  }
}
