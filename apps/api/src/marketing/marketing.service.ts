import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { AppointmentStatus, PaymentStatus, UserRole, TenantStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthenticatedUser, resolveTenantScope } from '../common/tenant/tenant-context';
import { deriveAcquisition, AcquisitionSource } from './acquisition.util';
import { CANONICAL_SOURCES, CanonicalSource, normalizeSource } from '../common/source.util';
import { SocialRegistry } from './connectors/social-registry';
import { ChannelCreds } from './connectors/social-connector.interface';
import { encryptSecret, decryptSecret, maskHint, encConfigured } from '../payments-hub/crypto.util';

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
  constructor(private readonly prisma: PrismaService, private readonly social: SocialRegistry) {}

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
        select: { id: true, source: true, status: true, utmCampaign: true, utmSource: true, utmMedium: true, gclid: true, gbraid: true, wbraid: true, attrReferrer: true },
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
    // Campaign-level attribution (UTM). Keyed by campaign, falling back to the
    // utm_source when no campaign name is present. Only bookings that actually
    // carry a UTM are counted here — everything else stays channel-level.
    type CampRow = { key: string; source: string | null; bookings: number; showed: number; revenueCents: number };
    const camps = new Map<string, CampRow>();
    const campByAppt = new Map<string, string>();
    // First-party ACQUISITION classification (separate from booking surface):
    // google_ads (click id) > google_maps_organic (GBP link) > website (embed)
    // > referral > direct. `gbp` stays as the google_maps_organic alias so
    // existing consumers keep working.
    const ACQ_KEYS: AcquisitionSource[] = ['google_ads', 'google_maps_organic', 'website', 'referral', 'direct', 'unknown'];
    const acquisition = Object.fromEntries(ACQ_KEYS.map((k) => [k, { bookings: 0, showed: 0, revenueCents: 0 }])) as Record<AcquisitionSource, { bookings: number; showed: number; revenueCents: number }>;
    const acqByAppt = new Map<string, AcquisitionSource>();
    const gbp = acquisition.google_maps_organic;
    const gbpAppt = new Set<string>();
    for (const a of appts) {
      const acq = deriveAcquisition(a as any);
      acqByAppt.set(a.id, acq);
      acquisition[acq].bookings += 1;
      if (SHOWED_STATUSES.includes(a.status)) acquisition[acq].showed += 1;
      if (acq === 'google_maps_organic') gbpAppt.add(a.id);
      const ch = normalizeSource(a.source);
      sourceByAppt.set(a.id, ch);
      if (REVENUE_EXCLUDED.has(a.status)) excludedAppt.add(a.id);
      const row = rows.get(ch)!;
      row.bookings += 1;
      if (SHOWED_STATUSES.includes(a.status)) row.showed += 1;
      const campKey = (a.utmCampaign || a.utmSource || '').trim();
      if (campKey) {
        campByAppt.set(a.id, campKey);
        const cr = camps.get(campKey) ?? { key: campKey, source: a.utmSource ?? null, bookings: 0, showed: 0, revenueCents: 0 };
        cr.bookings += 1;
        if (SHOWED_STATUSES.includes(a.status)) cr.showed += 1;
        camps.set(campKey, cr);
      }
    }
    // --- Revenue per channel (via appointment → source) --------------------
    for (const p of payments) {
      if (!p.appointmentId || excludedAppt.has(p.appointmentId)) continue;
      const ch = sourceByAppt.get(p.appointmentId);
      if (!ch) continue; // payment for an appointment outside the window
      rows.get(ch)!.revenueCents += p.amountCents;
      const acq = acqByAppt.get(p.appointmentId);
      if (acq) acquisition[acq].revenueCents += p.amountCents;
      const campKey = campByAppt.get(p.appointmentId);
      if (campKey) { const cr = camps.get(campKey); if (cr) cr.revenueCents += p.amountCents; }
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
      // Bookings PROVEN to come from Google Maps via the salon's GBP link.
      gbp,
      // Full first-party acquisition breakdown (surface-independent).
      acquisition,
      // Campaign-level attribution (only bookings that carried a UTM).
      byCampaign: Array.from(camps.values()).sort((x, y) => y.revenueCents - x.revenueCents || y.bookings - x.bookings).slice(0, 20),
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

    // --- Month-over-month comparison (clients love "up X% vs last month") ---
    const prev = this.previousMonth(new Date(from.getFullYear(), from.getMonth(), 15));
    const pr = this.monthRange(prev);
    const [prevOv, prevSpend] = await Promise.all([
      this.overview(user, pr.from.toISOString().slice(0, 10), pr.to.toISOString().slice(0, 10), tenantParam),
      this.prisma.marketingSpend.findMany({ where: { tenantId, periodMonth: prev }, select: { channel: true, amountCents: true, reach: true, clicks: true, leads: true } }),
    ]);
    const prevSpendCents = prevSpend.reduce((a: number, r: { amountCents: number }) => a + r.amountCents, 0);
    const delta = (cur: number, prv: number) => ({ value: cur, prev: prv, pct: prv > 0 ? Math.round(((cur - prv) / prv) * 100) : (cur > 0 ? null : 0) });
    const deltas = {
      bookings: delta(bookings, prevOv.totals.bookings),
      showed: delta(showed, prevOv.totals.showed),
      revenueCents: delta(revenueCents, prevOv.totals.revenueCents),
      newCustomers: delta(newCustomers, prevOv.newCustomers),
      spendCents: delta(totalSpendCents, prevSpendCents),
    };

    // --- Per-channel month-over-month movement (spend / reach / clicks / leads).
    // This is what lets the report say "Facebook: reach up 24%, clicks down 8%"
    // instead of only judging totals. null = metric absent in both months.
    const prevByCh = new Map<string, any>((prevSpend as any[]).map((r: any) => [r.channel, r]));
    const chDelta = (cur?: number | null, prv?: number | null) => {
      const c = cur ?? 0; const pv = prv ?? 0;
      if (c === 0 && pv === 0) return null;
      return { value: c, prev: pv, pct: pv > 0 ? Math.round(((c - pv) / pv) * 100) : (c > 0 ? null : -100) };
    };
    const chNames = Array.from(new Set([...(spend as any[]).map((r: any) => r.channel), ...(prevSpend as any[]).map((r: any) => r.channel)]));
    const channelTrends = chNames.map((ch: string) => {
      const cur = (spend as any[]).find((r: any) => r.channel === ch);
      const prv = prevByCh.get(ch);
      return {
        channel: ch,
        spend: chDelta(cur?.amountCents, prv?.amountCents),
        reach: chDelta(cur?.reach, prv?.reach),
        clicks: chDelta(cur?.clicks, prv?.clicks),
        leads: chDelta(cur?.leads, prv?.leads),
      };
    }).filter((t) => t.spend || t.reach || t.clicks || t.leads);

    // --- Simple effectiveness verdict (only when there is spend to judge) ---
    // good: >=3x return; ok: >=1x; low: <1x. No spend => "organic" (can't rate ROI).
    let effectiveness: 'good' | 'ok' | 'low' | 'organic' = 'organic';
    if (totalSpendCents > 0) {
      const r = revenueCents / totalSpendCents;
      effectiveness = r >= 3 ? 'good' : r >= 1 ? 'ok' : 'low';
    }

    // --- Organic social (Facebook/Instagram) with month-over-month movement ---
    // Concrete owned-channel numbers for the report: total + new followers,
    // reach, views, engagement. null = Meta no longer exposes that metric.
    const [socRows, prevSocRows] = await Promise.all([
      this.prisma.socialInsight.findMany({ where: { tenantId, periodMonth: month } }),
      this.prisma.socialInsight.findMany({ where: { tenantId, periodMonth: prev } }),
    ]);
    const prevSoc = new Map<string, any>((prevSocRows as any[]).map((r: any) => [r.platform, r]));

    // Monthly follower snapshots for a growth chart (esp. Facebook, which has no
    // live daily-follower metric) — built from our own stored months, not Meta.
    const seriesMonths: string[] = [];
    {
      const [yy, mm] = month.split('-').map(Number);
      for (let i = 5; i >= 0; i--) { const d = new Date(yy, mm - 1 - i, 1); seriesMonths.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`); }
    }
    const seriesRows = await this.prisma.socialInsight.findMany({ where: { tenantId, periodMonth: { in: seriesMonths } }, select: { platform: true, periodMonth: true, followers: true } });
    const monthlySeriesFor = (platform: string) => seriesMonths
      .map((mm) => { const row = (seriesRows as any[]).find((x: any) => x.platform === platform && x.periodMonth === mm); return row && row.followers != null ? { month: mm, followers: row.followers as number } : null; })
      .filter(Boolean) as Array<{ month: string; followers: number }>;
    const socDelta = (cur?: number | null, prv?: number | null) => {
      if (cur == null && prv == null) return null;
      const c = cur ?? 0; const pv = prv ?? 0;
      return { value: cur ?? null, prev: prv ?? null, pct: pv > 0 && cur != null ? Math.round(((c - pv) / pv) * 100) : null };
    };
    const socialInsights = (socRows as any[]).filter((r: any) => r.platform !== 'gbp').map((r: any) => ({
      platform: r.platform,
      followers: r.followers,
      // Fall back to month-over-month net new followers when Meta's direct metric is null (esp. Facebook).
      newFollowers: r.newFollowers ?? ((): number | null => { const pf = prevSoc.get(r.platform)?.followers; return (pf != null && r.followers != null) ? r.followers - pf : null; })(),
      monthlySeries: monthlySeriesFor(r.platform),
      reach: r.reach, views: r.views, engagement: r.engagement,
      profileViews: r.profileViews, postsCount: r.postsCount,
      posts: (r.raw && (r.raw as any).posts) ? (r.raw as any).posts : [],
      series: (r.raw && (r.raw as any).series) ? (r.raw as any).series : [],
      audience: (r.raw && (r.raw as any).audience) ? (r.raw as any).audience : null,
      fbDebug: (r.raw && (r.raw as any).fbDebug) ? (r.raw as any).fbDebug : null,
      syncedAt: r.syncedAt,
      vsPrev: {
        followers: socDelta(r.followers, prevSoc.get(r.platform)?.followers),
        reach: socDelta(r.reach, prevSoc.get(r.platform)?.reach),
        views: socDelta(r.views, prevSoc.get(r.platform)?.views),
        engagement: socDelta(r.engagement, prevSoc.get(r.platform)?.engagement),
        newFollowers: socDelta(r.newFollowers, prevSoc.get(r.platform)?.newFollowers),
      },
    }));

    // --- Google Business Profile (Maps) monthly performance — its own deck ---
    const gbpRow = (socRows as any[]).find((r: any) => r.platform === 'gbp');
    let gbp: any = null;
    if (gbpRow) {
      const cur = ((gbpRow.raw as any)?.gbp) || {};
      const prv = ((prevSoc.get('gbp')?.raw as any)?.gbp) || {};
      const gbpSeriesRows = await this.prisma.socialInsight.findMany({ where: { tenantId, platform: 'gbp', periodMonth: { in: seriesMonths } }, select: { periodMonth: true, raw: true } });
      const gbpSeries = seriesMonths.map((mm) => {
        const row = (gbpSeriesRows as any[]).find((x: any) => x.periodMonth === mm);
        const g = (row?.raw as any)?.gbp;
        return g ? { month: mm, impressions: g.impressions ?? null, calls: g.calls ?? null, directions: g.directions ?? null, websiteClicks: g.websiteClicks ?? null, bookings: g.bookings ?? null } : null;
      }).filter(Boolean);
      gbp = {
        ...cur,
        vsPrev: {
          impressions: socDelta(cur.impressions, prv.impressions),
          calls: socDelta(cur.calls, prv.calls),
          directions: socDelta(cur.directions, prv.directions),
          websiteClicks: socDelta(cur.websiteClicks, prv.websiteClicks),
          bookings: socDelta(cur.bookings, prv.bookings),
          conversations: socDelta(cur.conversations, prv.conversations),
        },
        series: gbpSeries,
        syncedAt: gbpRow.syncedAt,
      };
    }

    return { month, range: { from: fromStr, to: toStr }, outcome: ov, spend, workLog, blended, prevMonth: prev, deltas, channelTrends, socialInsights, gbp, effectiveness };
  }

  // ---- AI draft (Anthropic, same pattern as the voice/messenger agents) ----

  /**
   * Deterministic report writer — builds the SAME content shape as the AI purely
   * from the real numbers. Used to backfill sections the AI leaves empty, and as a
   * full fallback when ANTHROPIC_API_KEY is missing / the AI call fails, so the
   * monthly report is NEVER blank (true "100% automated" behaviour).
   */
  private ruleBasedDraft(data: any): any {
    const S: any[] = (data.socialInsights ?? []);
    const ig = S.find((x) => x.platform === 'instagram');
    const fb = S.find((x) => x.platform === 'facebook');
    const n = (x: any) => (x == null ? null : String(Math.round(Number(x))).replace(/\B(?=(\d{3})+(?!\d))/g, ','));
    const pctTxt = (d: any) => (d && d.pct != null ? (d.pct >= 0 ? `+${d.pct}%` : `${d.pct}%`) : null);
    const bi = (vi: string, en: string) => ({ vi, en });
    const platLabel = (pf: string) => (pf === 'facebook' ? 'Facebook' : 'Instagram');

    const totalReach = S.reduce((a, x) => a + (x.reach ?? 0), 0);
    const totalViews = S.reduce((a, x) => a + (x.views ?? 0), 0);
    const totalEng = S.reduce((a, x) => a + (x.engagement ?? 0), 0);
    const newFol = S.reduce((a, x) => a + (x.newFollowers ?? 0), 0);
    const postsAll = S.reduce((a, x) => a + (x.postsCount ?? (x.posts?.length ?? 0)), 0);
    const igER = (ig && ig.engagement != null && ig.reach) ? Math.round((ig.engagement / ig.reach) * 1000) / 10 : null;

    // ---- channels: one line per organic network, judged on momentum ----
    const channels: any[] = [];
    for (const sIns of S) {
      const rp = sIns.vsPrev?.reach, ep = sIns.vsPrev?.engagement, fp = sIns.vsPrev?.followers;
      const anyNum = sIns.reach != null || sIns.engagement != null || sIns.followers != null;
      const grew = [rp, ep, fp].some((d) => d && d.pct != null && d.pct > 0);
      const fell = [rp, ep, fp].some((d) => d && d.pct != null && d.pct < 0);
      let verdict: string = 'nodata';
      if (anyNum) verdict = grew && !fell ? 'good' : fell && !grew ? 'weak' : 'ok';
      const vp: string[] = [], ep2: string[] = [];
      if (sIns.reach != null) { vp.push(`reach ${n(sIns.reach)}${pctTxt(rp) ? ` (${pctTxt(rp)})` : ''}`); ep2.push(`reach ${n(sIns.reach)}${pctTxt(rp) ? ` (${pctTxt(rp)})` : ''}`); }
      if (sIns.engagement != null) { vp.push(`tương tác ${n(sIns.engagement)}${pctTxt(ep) ? ` (${pctTxt(ep)})` : ''}`); ep2.push(`${n(sIns.engagement)} engagements${pctTxt(ep) ? ` (${pctTxt(ep)})` : ''}`); }
      if (sIns.views != null) { vp.push(`${n(sIns.views)} lượt xem`); ep2.push(`${n(sIns.views)} views`); }
      if (sIns.followers != null) { vp.push(`${n(sIns.followers)} follower${sIns.newFollowers ? ` (+${sIns.newFollowers})` : ''}`); ep2.push(`${n(sIns.followers)} followers${sIns.newFollowers ? ` (+${sIns.newFollowers})` : ''}`); }
      const viStr = vp.length ? vp.join(', ') : 'Meta đã ngừng cung cấp phần lớn chỉ số của trang — chỉ còn follower & bài đăng.';
      const enStr = ep2.length ? ep2.join(', ') : 'Meta discontinued most Page metrics — only followers & posts remain.';
      channels.push({ name: `${platLabel(sIns.platform)} (organic)`, verdict, vi: viStr, en: enStr });
    }

    // ---- top post across all networks ----
    let top: any = null;
    for (const sIns of S) for (const pp of (sIns.posts ?? [])) {
      const score = pp.interactions ?? ((pp.likes ?? 0) + (pp.comments ?? 0));
      if (!top || score > top._score) top = { ...pp, _score: score, _pf: sIns.platform };
    }

    // ---- highlights (wins) ----
    const highlights: any[] = [];
    if (ig && ig.reach != null) highlights.push(bi(
      `Instagram tiếp cận ${n(ig.reach)} người${pctTxt(ig.vsPrev?.reach) ? ` (${pctTxt(ig.vsPrev?.reach)} so với tháng trước)` : ''}.`,
      `Instagram reached ${n(ig.reach)} people${pctTxt(ig.vsPrev?.reach) ? ` (${pctTxt(ig.vsPrev?.reach)} vs last month)` : ''}.`));
    if (newFol > 0) highlights.push(bi(`Có thêm ${newFol} người theo dõi mới trong tháng.`, `Gained ${newFol} new followers this month.`));
    if (totalViews > 0) highlights.push(bi(`Nội dung đạt tổng ${n(totalViews)} lượt xem.`, `Content reached ${n(totalViews)} total views.`));
    if (top && top._score > 0) highlights.push(bi(
      `Bài nổi bật (${top.type || 'post'}): ${n(top.likes ?? 0)} thích, ${n(top.comments ?? 0)} bình luận${top.views ? `, ${n(top.views)} lượt xem` : ''}.`,
      `Top post (${top.type || 'post'}): ${n(top.likes ?? 0)} likes, ${n(top.comments ?? 0)} comments${top.views ? `, ${n(top.views)} views` : ''}.`));
    if (!highlights.length) highlights.push(bi('Đã đăng bài đều đặn và duy trì hiện diện kênh trong tháng.', 'Posted consistently and maintained channel presence this month.'));

    // ---- issues (challenges + the fix) ----
    const issues: any[] = [];
    if (fb && fb.reach == null && fb.engagement == null) issues.push(bi(
      'Facebook: Meta đã ngừng cung cấp reach & tương tác của trang (2025-2026). Khắc phục: bật chia sẻ Reels từ Instagram sang Facebook Page để vẫn có số liệu và mở rộng phủ sóng.',
      'Facebook: Meta discontinued Page reach & engagement (2025-2026). Fix: enable sharing Instagram Reels to the Facebook Page to keep data flowing and widen reach.'));
    for (const sIns of S) {
      const rp = sIns.vsPrev?.reach;
      if (rp && rp.pct != null && rp.pct < -5) issues.push(bi(
        `${platLabel(sIns.platform)} reach giảm ${rp.pct}% — tăng tần suất đăng và thử thêm Reels để phục hồi hiển thị.`,
        `${platLabel(sIns.platform)} reach fell ${rp.pct}% — increase posting cadence and add more Reels to recover visibility.`));
    }
    if (postsAll > 0 && postsAll < 10) issues.push(bi(
      `Tần suất đăng còn thấp (${postsAll} bài) — nên tăng lên 12-16 bài/tháng để giữ nhịp hiển thị.`,
      `Posting cadence is low (${postsAll} posts) — raise to 12-16/month to sustain reach.`));
    if (!issues.length) issues.push(bi('Chưa có vấn đề nổi cộm; tiếp tục theo dõi nhịp tăng trưởng.', 'No major issues; keep monitoring the growth trend.'));

    // ---- insights (observations) ----
    const insights: any[] = [];
    const age = ig?.audience?.age;
    if (age) {
      const keys = Object.keys(age); const tot = keys.reduce((a, k) => a + (age[k] || 0), 0) || 1;
      const bestK = keys.sort((a, b) => (age[b] || 0) - (age[a] || 0))[0];
      if (bestK) insights.push(bi(
        `Nhóm tuổi ${bestK} chiếm ${Math.round((age[bestK] / tot) * 1000) / 10}% người theo dõi Instagram — nội dung nên nhắm vào nhóm này.`,
        `The ${bestK} age group is ${Math.round((age[bestK] / tot) * 1000) / 10}% of Instagram followers — aim content at this group.`));
    }
    const gd = ig?.audience?.gender;
    if (gd) {
      const tot = (gd.F || 0) + (gd.M || 0) + (gd.U || 0) || 1;
      if ((gd.F || 0) >= (gd.M || 0)) insights.push(bi(
        `Khách nữ chiếm ${Math.round((gd.F / tot) * 1000) / 10}% — ưu tiên mẫu nail nữ và xu hướng theo mùa.`,
        `Female audience is ${Math.round((gd.F / tot) * 1000) / 10}% — prioritise female nail designs and seasonal trends.`));
    }
    const posts = ig?.posts ?? [];
    const avgOf = (pred: (p: any) => boolean) => { const g = posts.filter(pred); if (!g.length) return null; return Math.round(g.reduce((a: number, p: any) => a + (p.interactions ?? ((p.likes ?? 0) + (p.comments ?? 0))), 0) / g.length); };
    const reelAvg = avgOf((p) => /reel|video/i.test(p.type || ''));
    const imgAvg = avgOf((p) => /image|photo|carousel/i.test(p.type || ''));
    if (reelAvg != null && imgAvg != null) insights.push(reelAvg >= imgAvg
      ? bi(`Reels tạo tương tác cao hơn ảnh tĩnh (${reelAvg} vs ${imgAvg} trung bình/bài) — nên tăng tỷ trọng Reels.`, `Reels drive higher engagement than static photos (${reelAvg} vs ${imgAvg} avg/post) — shift toward Reels.`)
      : bi(`Ảnh tĩnh đang tương tác tốt hơn Reels (${imgAvg} vs ${reelAvg} trung bình/bài) — giữ tỷ trọng ảnh chất lượng cao.`, `Static photos currently out-engage Reels (${imgAvg} vs ${reelAvg} avg/post) — keep high-quality photos.`));
    if (igER != null) insights.push(bi(
      `Tỷ lệ tương tác Instagram ${igER}% trên lượng reach — ${igER >= 2 ? 'ở mức tốt' : 'còn dư địa cải thiện bằng CTA & câu hỏi'}.`,
      `Instagram engagement rate ${igER}% of reach — ${igER >= 2 ? 'a healthy level' : 'room to improve with CTAs & questions'}.`));
    if (!insights.length) insights.push(bi('Chưa đủ dữ liệu nhân khẩu/nội dung để rút ra insight — kết nối Instagram đầy đủ để có thêm phân tích.', 'Not enough audience/content data for insights yet — connect Instagram fully for deeper analysis.'));

    // ---- nextMonth (4 buckets) ----
    const ceil50 = (x: any, f = 1.12) => (x == null ? null : Math.ceil((Number(x) * f) / 50) * 50);
    const nextMonth = {
      content: [
        bi(`Đăng 12-16 bài/tháng, ${reelAvg != null && imgAvg != null && reelAvg >= imgAvg ? 'ưu tiên Reels (định dạng đang thắng)' : 'cân bằng Reels và ảnh chất lượng cao'}.`,
           `Post 12-16/month, ${reelAvg != null && imgAvg != null && reelAvg >= imgAvg ? 'favouring Reels (the winning format)' : 'balancing Reels and high-quality photos'}.`),
        bi('Xoay vòng chủ đề: mẫu nail mới, review khách, ảnh trước/sau, ưu đãi trong tuần.', 'Rotate themes: new nail designs, client reviews, before/after, weekly offers.'),
      ],
      ads: [ (data.blended?.totalSpendCents ?? 0) > 0
        ? bi('Tối ưu ngân sách quảng cáo hiện có về kênh cho chi phí/khách thấp nhất.', 'Optimise the current ad budget toward the lowest cost-per-customer channel.')
        : bi('Chưa chạy quảng cáo — cân nhắc thử $50-100 boost cho Reels tốt nhất để mở rộng reach.', 'No ads yet — consider a $50-100 boost on the best Reel to expand reach.') ],
      growth: [
        bi('Bật chia sẻ Reels Instagram sang Facebook Page để lấp số liệu Facebook và tăng phủ sóng.', 'Enable sharing Instagram Reels to the Facebook Page to fill Facebook data and widen reach.'),
        bi('Trả lời bình luận & tin nhắn trong 1 giờ; chạy 1 mini-game tặng buổi làm nail để tăng tương tác.', 'Reply to comments & DMs within 1 hour; run one giveaway (a free nail session) to lift engagement.'),
      ],
      kpi: [
        ig?.reach != null ? bi(`Reach Instagram ≥ ${n(ceil50(ig.reach))} (hiện ${n(ig.reach)}).`, `Instagram reach ≥ ${n(ceil50(ig.reach))} (now ${n(ig.reach)}).`) : null,
        bi(`Follower mới +${Math.max(30, newFol)} trên các kênh.`, `New followers +${Math.max(30, newFol)} across channels.`),
        igER != null ? bi(`Tỷ lệ tương tác Instagram ≥ ${Math.round((igER + 0.5) * 10) / 10}%.`, `Instagram engagement rate ≥ ${Math.round((igER + 0.5) * 10) / 10}%.`) : null,
        bi(`Đăng ≥ ${Math.max(14, postsAll)} bài trong tháng.`, `Publish ≥ ${Math.max(14, postsAll)} posts in the month.`),
      ].filter(Boolean),
    };
    const plan = [...nextMonth.content, ...nextMonth.growth, ...nextMonth.ads]; // flat legacy fallback

    // ---- headline / tldr / summary ----
    let headline = bi('Kênh mạng xã hội duy trì hiện diện ổn định trong tháng.', 'Social channels held a steady presence this month.');
    if (ig?.vsPrev?.reach?.pct != null && ig.vsPrev.reach.pct > 0) headline = bi(`Reach Instagram tăng ${ig.vsPrev.reach.pct}% so với tháng trước.`, `Instagram reach grew ${ig.vsPrev.reach.pct}% vs last month.`);
    else if (newFol > 0) headline = bi(`Có thêm ${newFol} người theo dõi mới trong tháng.`, `Gained ${newFol} new followers this month.`);
    else if (totalReach > 0) headline = bi(`Tiếp cận tổng ${n(totalReach)} người qua các kênh.`, `Reached ${n(totalReach)} people across channels.`);

    const tldr = bi(
      `Tháng này các kênh organic tiếp cận ${n(totalReach)} người với ${n(totalEng)} lượt tương tác${newFol ? `, thêm ${newFol} follower mới` : ''}. ${ig ? `Instagram là kênh mạnh nhất${igER != null ? ` (tỷ lệ tương tác ${igER}%)` : ''}.` : ''} ${fb && fb.reach == null ? 'Facebook thiếu số liệu do Meta ngừng cung cấp — nên bật crosspost Reels từ Instagram.' : ''} Trọng tâm tháng tới: tăng tần suất Reels và mở rộng phủ sóng sang Facebook.`.replace(/\s+/g, ' ').trim(),
      `This month organic channels reached ${n(totalReach)} people with ${n(totalEng)} engagements${newFol ? `, adding ${newFol} new followers` : ''}. ${ig ? `Instagram was the strongest channel${igER != null ? ` (engagement rate ${igER}%)` : ''}.` : ''} ${fb && fb.reach == null ? 'Facebook lacks data because Meta discontinued it — enable Reel crossposting from Instagram.' : ''} Next month: increase Reels cadence and extend reach to Facebook.`.replace(/\s+/g, ' ').trim());

    const summary = bi(
      `Tổng reach ${n(totalReach)}${pctTxt(ig?.vsPrev?.reach) ? ` (${pctTxt(ig?.vsPrev?.reach)} so với tháng trước trên Instagram)` : ''}, ${n(totalEng)} lượt tương tác, ${n(totalViews)} lượt xem, ${postsAll} bài đăng. Đây là kết quả tự nhiên (organic), chưa tính quảng cáo.`,
      `Total reach ${n(totalReach)}${pctTxt(ig?.vsPrev?.reach) ? ` (${pctTxt(ig?.vsPrev?.reach)} MoM on Instagram)` : ''}, ${n(totalEng)} engagements, ${n(totalViews)} views, ${postsAll} posts. These are organic results, excluding paid ads.`);

    return { headline, tldr, summary, channels, highlights, issues, plan, insights, nextMonth, _ruleBased: true };
  }

  private async draftWithAI(data: Awaited<ReturnType<MarketingService['monthlyData']>>, history: any[] = []): Promise<{ content?: any; model?: string; error?: string }> {
    const key = process.env.ANTHROPIC_API_KEY || '';
    if (!key) return { error: 'ANTHROPIC_API_KEY chưa được đặt trên server' };
    const model = process.env.ANTHROPIC_AGENT_MODEL || 'claude-haiku-4-5-20251001';

    const system =
      'You are a senior marketing analyst at an agency, writing the MONTHLY client report for a nail-salon owner who is NOT technical. ' +
      'The report must read as detailed, clear, specific and PROFESSIONAL, yet in plain language with no marketing jargon. ' +
      'STRICT RULES: (1) Use ONLY the numbers in the data. NEVER invent or estimate any figure. ' +
      '(2) Attribution is BLENDED — the data does NOT tell you which ad or channel caused which booking, so do NOT claim a specific channel "generated" specific bookings or revenue. Talk about totals and spend allocation instead. ' +
      '(3) If a needed number is missing or zero, say so plainly (e.g. "chưa nhập chi phí" / "no spend entered") rather than guessing. ' +
      '(4) Output MUST be valid JSON only, matching this EXACT shape, every string in BOTH Vietnamese (vi) and English (en): ' +
      '{"headline":{"vi":"","en":""},"tldr":{"vi":"","en":""},"summary":{"vi":"","en":""},"channels":[{"name":"","verdict":"good","vi":"","en":""}],"highlights":[{"vi":"","en":""}],"issues":[{"vi":"","en":""}],"plan":[{"vi":"","en":""}],"insights":[{"vi":"","en":""}],"nextMonth":{"content":[{"vi":"","en":""}],"ads":[{"vi":"","en":""}],"growth":[{"vi":"","en":""}],"kpi":[{"vi":"","en":""}]}}. ' +
      'headline = the SINGLE most important takeaway of the month in ONE short sentence a busy owner remembers at a glance (e.g. "Doanh thu tăng 31% so với tháng trước"). ' +
      'tldr = the EXECUTIVE SUMMARY: EXACTLY 2 short sentences — how the month went + the single biggest win + the main gap. ' +
      'summary = supporting detail: MUST mention the month-over-month trend from vsLastMonth (e.g. "up 20% vs last month") and state the effectiveness in plain words. ' +
      'channels = evaluate EACH channel that has spend in spendByChannel. verdict = "good" (cheap results / clearly working), "ok" (working, room to improve), "weak" (expensive / little to show), or "nodata" (only spend entered, no reach/clicks/leads to judge). Judge by cost-per-lead or cost-per-click when those numbers exist and CITE that number in the sentence; if they do not exist, verdict MUST be "nodata". ALSO use channelTrends (month-over-month movement per channel): cite the most significant change with its % (e.g. "reach tăng 24%, click giảm 8%"). If a channel FELL while its spend stayed or rose, say so plainly and reflect it in the verdict. Give ONE short line per channel: numbers + trend + action (keep / tăng / giảm / thử lại / tạm dừng). Never invent a number. ' +
      'socialOrganic = per-network ORGANIC (non-paid) results: platform (facebook|instagram), followers (total), newFollowers, reach, views, engagement, and vsPrev month-over-month % for each. For EACH network present, ADD one entry to "channels" named "Facebook (organic)" or "Instagram (organic)" judging MOMENTUM (not ROI, since organic has no spend): verdict "good" if reach/engagement/followers grew, "ok" if roughly flat, "weak" if they fell, "nodata" if all numbers are null. CITE the concrete number and its vsPrev % (e.g. "IG reach 12,400, tăng 18% vs tháng trước; +240 follower mới"). Some Facebook metrics are null because Meta deprecated them in 2025-2026 — NEVER invent them; report only the numbers present (for a nail salon, Instagram is usually the richer channel). Surface the single best organic win in highlights. ' +
      'bookingsFromGoogleMaps = bookings PROVEN to come from Google Maps via the salon\'s Business Profile link (first-party UTM) — when > 0, mention it in summary or highlights as a verified Google Maps result. ' +
      'highlights = concrete wins this month (2-3). issues = CHALLENGES: for each, name the problem AND the solution or recommendation together (1-2) — naming a problem and your response builds trust. ' +
      'plan = set to an EMPTY array []. We derive next-month actions from nextMonth below — do not fill plan. ' +
      'insights = INSIGHT NỔI BẬT: 2-3 sharp OBSERVATIONS (patterns, NOT actions) — best content format (Reels vs photos from topPosts), dominant audience segment (age/gender from socialOrganic.audience), engagement-rate read. Base ONLY on socialOrganic. ' +
      'nextMonth = FOUR buckets, each 1-2 SHORT bullets grounded in THIS month\'s real numbers: ' +
      'nextMonth.content = content plan (cadence, formats to push — e.g. more Reels if Reels won, UGC/review topics). ' +
      'nextMonth.ads = paid plan; if there is NO spend data, put ONE bullet like "Chưa chạy quảng cáo — cân nhắc thử ngân sách nhỏ để tăng reach". ' +
      'nextMonth.growth = growth/community plan (collab/KOC, mini-game, reply faster; if Facebook numbers are thin, recommend bật chia sẻ Reels IG sang Facebook Page). ' +
      'nextMonth.kpi = 2-3 MEASURABLE targets computed from current numbers, each citing the current value, e.g. "Reach IG ≥ X (hiện Y)", "Follower +N". Round sensibly. ' +
      'BREVITY IS REQUIRED — the owner wants short, complete notes, NOT an essay. HARD CAPS: headline ≤ 12 words; every other bullet = ONE plain sentence ≤ 18 words in EACH language; keep vi and en equally short. Output ONLY compact minified JSON (no markdown, no comments), based ONLY on the real numbers; never invent.';

    const userText = 'DATA (JSON):\n' + JSON.stringify({
      month: data.month,
      bookings: data.outcome.totals.bookings,
      showedUp: data.outcome.totals.showed,
      bookingRevenueCents: data.outcome.totals.revenueCents,
      newCustomers: data.outcome.newCustomers,
      bookingsByChannel: data.outcome.channels.filter((c: any) => c.bookings > 0),
      ownedChannels: data.outcome.owned,
      bookingsFromGoogleMaps: (data.outcome as any).gbp,
      totalSpendCents: data.blended.totalSpendCents,
      spendByChannel: data.spend.map((r: any) => ({ channel: r.channel, amountCents: r.amountCents, reach: r.reach, clicks: r.clicks, leads: r.leads })),
      blended: data.blended,
      vsLastMonth: (data as any).deltas,
      channelTrends: (data as any).channelTrends,
      socialOrganic: ((data as any).socialInsights ?? []).map((si: any) => ({
        platform: si.platform,
        followers: si.followers, newFollowers: si.newFollowers, reach: si.reach, views: si.views, engagement: si.engagement,
        engagementRatePct: (si.engagement != null && si.reach) ? Math.round((si.engagement / si.reach) * 1000) / 10 : null,
        postsCount: si.postsCount, vsPrev: si.vsPrev, audience: si.audience,
        topPosts: (si.posts ?? []).slice(0, 5).map((pp: any) => ({ type: pp.type, likes: pp.likes, comments: pp.comments, reach: pp.reach, views: pp.views, caption: pp.caption })),
      })),
      effectiveness: (data as any).effectiveness,
      last4Months: history,
      workDone: data.workLog.map((w: any) => ({ category: w.category, title: w.title })),
    });

    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model, max_tokens: 8000, system, messages: [{ role: 'user', content: userText }] }),
      });
      if (!res.ok) { const body = (await res.text().catch(() => '')).slice(0, 200); this.logger.warn(`Anthropic ${res.status}: ${body}`); return { error: `Anthropic API ${res.status}: ${body}` }; }
      const json = (await res.json()) as { content?: Array<{ type: string; text?: string }>; stop_reason?: string };
      let text = (json.content || []).filter((b) => b.type === 'text').map((b) => b.text || '').join('').trim();
      // Strip ```json fences the model sometimes adds.
      text = text.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
      const start = text.indexOf('{'); const end = text.lastIndexOf('}');
      if (start < 0 || end < 0) return { error: 'AI trả về nội dung không đọc được' };
      let content: any;
      try {
        content = JSON.parse(text.slice(start, end + 1));
      } catch {
        // Model output was likely truncated. Report clearly rather than a raw JSON error.
        const cut = json.stop_reason === 'max_tokens' ? ' (bị cắt vì quá dài)' : '';
        return { error: `AI trả về JSON chưa hoàn chỉnh${cut} — bấm Tạo lại` };
      }
      return { content, model };
    } catch (e) {
      this.logger.warn(`AI draft failed: ${String(e)}`);
      return { error: String((e as Error).message).slice(0, 200) };
    }
  }

  // ---- Report lifecycle ---------------------------------------------------
  /** Last N months of headline figures, oldest -> newest, for trend analysis. */
  async monthlyHistory(user: AuthenticatedUser, month: string, tenantParam?: string, count = 4) {
    const [y, m] = month.split('-').map(Number);
    const out: Array<{ month: string; spendCents: number; revenueCents: number; bookings: number; newCustomers: number }> = [];
    for (let i = count - 1; i >= 0; i--) {
      const d = new Date(y, m - 1 - i, 1);
      const mm = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const { from, to } = this.monthRange(mm);
      const [ov, spend] = await Promise.all([
        this.overview(user, from.toISOString().slice(0, 10), to.toISOString().slice(0, 10), tenantParam),
        this.prisma.marketingSpend.findMany({ where: { tenantId: this.tenantId(user, tenantParam), periodMonth: mm }, select: { amountCents: true } }),
      ]);
      out.push({ month: mm, spendCents: spend.reduce((a: number, r: { amountCents: number }) => a + r.amountCents, 0), revenueCents: ov.totals.revenueCents, bookings: ov.totals.bookings, newCustomers: ov.newCustomers });
    }
    return out;
  }

  async generateReport(user: AuthenticatedUser, month: string, tenantParam?: string) {
    const tenantId = this.tenantId(user, tenantParam);
    const data = await this.monthlyData(user, month, tenantParam);
    const history = await this.monthlyHistory(user, month, tenantParam, 4).catch(() => [] as any[]);
    const ai = await this.draftWithAI(data, history);
    const ok = !!ai.content;
    const rule = this.ruleBasedDraft(data);
    let content: any;
    if (ok) {
      content = ai.content;
      // Backfill any section the AI left empty so the report is never partial.
      const isEmptyArr = (v: any) => !Array.isArray(v) || v.length === 0;
      for (const k of ['highlights', 'issues', 'insights', 'plan', 'channels']) if (isEmptyArr(content[k])) content[k] = rule[k];
      const nm = content.nextMonth;
      const nmEmpty = !nm || (isEmptyArr(nm.content) && isEmptyArr(nm.ads) && isEmptyArr(nm.growth) && isEmptyArr(nm.kpi));
      if (nmEmpty) content.nextMonth = rule.nextMonth;
      if (!content.headline?.vi) content.headline = rule.headline;
      if (!content.tldr?.vi) content.tldr = rule.tldr;
      if (!content.summary?.vi) content.summary = rule.summary;
    } else {
      // No AI (key missing / call failed) — ship the deterministic report so it is NEVER blank.
      content = { ...rule, _aiUnavailable: true, _aiError: ai.error ?? 'unknown' };
    }
    const saved = await this.prisma.marketingReport.upsert({
      where: { tenantId_periodMonth: { tenantId, periodMonth: month } },
      create: { tenantId, periodMonth: month, status: 'review', content, dataSnapshot: data as any, aiModel: ok ? (ai.model ?? null) : null },
      update: { content, dataSnapshot: data as any, aiModel: ok ? (ai.model ?? null) : null, status: 'review' },
    });
    return { ...saved, aiUsed: ok, aiError: ok ? null : ai.error, reportSource: ok ? 'ai' : 'auto' };
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
        // Pull spend/metrics from any connected API channels first, so the
        // auto-drafted report reflects real platform numbers. A failing channel
        // never blocks the report — its error is recorded on the connection.
        await this.syncAllChannels(sys, t.id, month).catch(() => undefined);
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

  // ======================= PHASE 3: social/ads API channels =================

  /** List every platform (incl. scaffolds) with this tenant's connection status. */
  async listChannels(user: AuthenticatedUser, tenantParam?: string) {
    const tenantId = this.tenantId(user, tenantParam);
    const conns = (await this.prisma.marketingChannelConnection.findMany({ where: { tenantId } })) as any[];
    const byPlatform = new Map<string, any>(conns.map((c: any) => [c.platform, c]));
    return this.social.list().map((p) => {
      const c = byPlatform.get(p.platform);
      return {
        ...p,
        connected: !!c && c.status === 'ACTIVE',
        status: c?.status ?? null,
        accountName: c?.accountName ?? null,
        externalAccountId: c?.externalAccountId ?? null,
        keyHint: c?.keyHint ?? null,
        lastSyncedAt: c?.lastSyncedAt ?? null,
        lastError: c?.lastError ?? null,
      };
    });
  }

  async connectChannel(user: AuthenticatedUser, dto: { platform: string; externalAccountId?: string; token?: string; refreshToken?: string; clientId?: string; clientSecret?: string; developerToken?: string; tenantId?: string }) {
    const tenantId = this.tenantId(user, dto.tenantId);
    const connector = this.social.get(dto.platform); // throws if unknown/disabled
    const own: ChannelCreds = {
      token: dto.token?.trim() || undefined,
      refreshToken: dto.refreshToken?.trim() || undefined,
      clientId: dto.clientId?.trim() || undefined,
      clientSecret: dto.clientSecret?.trim() || undefined,
      developerToken: dto.developerToken?.trim() || undefined,
      externalAccountId: dto.externalAccountId?.trim() || undefined,
    };
    // No secret pasted? Fall back to the shared agency token — the salon only
    // supplies its account id. We then store NO per-tenant secret at all.
    const shared = !own.token && !own.refreshToken ? this.agencyCreds(dto.platform) : null;
    // Encryption key is only needed when we must STORE a per-tenant secret.
    if (!shared && !encConfigured()) throw new BadRequestException('PAYMENT_ENC_KEY not configured on the server');
    const creds: ChannelCreds = shared ? ({ ...shared, externalAccountId: own.externalAccountId } as ChannelCreds) : own;
    const verify = await connector.verify(creds);
    if (!verify.ok) throw new BadRequestException(verify.error || 'Could not verify the credentials with the platform');
    const hint = shared ? 'AGENCY' : maskHint(creds.token || creds.refreshToken || '');
    const data = {
      externalAccountId: creds.externalAccountId ?? null,
      accountName: verify.accountName ?? null,
      credentialEnc: shared ? null : encryptSecret(JSON.stringify(creds)),
      keyHint: hint,
      status: 'ACTIVE',
      lastError: null,
    };
    const saved = await this.prisma.marketingChannelConnection.upsert({
      where: { tenantId_platform: { tenantId, platform: dto.platform } },
      create: { tenantId, platform: dto.platform, ...data },
      update: data,
    });
    await this.audit(tenantId, user.userId, 'marketing.channel.connect', { platform: dto.platform });
    return this.channelView(saved);
  }

  async testChannel(user: AuthenticatedUser, platform: string, tenantParam?: string) {
    const tenantId = this.tenantId(user, tenantParam);
    const creds = await this.loadChannelCreds(tenantId, platform);
    const r = await this.social.get(platform).verify(creds);
    await this.prisma.marketingChannelConnection.updateMany({ where: { tenantId, platform }, data: { status: r.ok ? 'ACTIVE' : 'ERROR', lastError: r.ok ? null : (r.error ?? 'error') } });
    return r;
  }

  async disconnectChannel(user: AuthenticatedUser, platform: string) {
    const tenantId = this.tenantId(user);
    await this.prisma.marketingChannelConnection.updateMany({ where: { tenantId, platform }, data: { status: 'REVOKED', credentialEnc: null } });
    await this.audit(tenantId, user.userId, 'marketing.channel.disconnect', { platform });
    return { ok: true };
  }

  /** Pull last-month figures from the platform API into the spend table. */
  async syncChannel(user: AuthenticatedUser, platform: string, month: string, tenantParam?: string) {
    // Organic owned-channel (Facebook Page + IG) uses a different pull + store.
    if (platform === 'meta_social' || platform === 'tiktok') return this.syncOrganic(user, platform, month, tenantParam);
    const tenantId = this.tenantId(user, tenantParam);
    if (!/^\d{4}-\d{2}$/.test(month || '')) throw new BadRequestException('month must be YYYY-MM');
    const connector = this.social.get(platform);
    const creds = await this.loadChannelCreds(tenantId, platform);
    try {
      const m = await connector.fetchMonthly(creds, month);
      // Map platform metrics onto the manual spend row (source='api'), so a synced
      // number simply replaces what a human would have typed. Nothing invented.
      const reach = m.reach ?? m.impressions ?? null;
      const leads = m.leads ?? m.calls ?? null;
      await this.prisma.marketingSpend.upsert({
        where: { tenantId_channel_periodMonth: { tenantId, channel: platform, periodMonth: month } },
        create: { tenantId, channel: platform, periodMonth: month, amountCents: m.spendCents ?? 0, reach, clicks: m.clicks ?? null, leads, source: 'api', createdByUserId: user.userId, note: 'Auto-synced' },
        update: { amountCents: m.spendCents ?? 0, reach, clicks: m.clicks ?? null, leads, source: 'api', note: 'Auto-synced' },
      });
      // Google Business Profile: also store a rich monthly snapshot (for the GBP deck).
      if (platform === 'gbp' && m.raw && (m.raw as any).gbp) {
        const g = (m.raw as any).gbp;
        const actions = (g.calls ?? 0) + (g.directions ?? 0) + (g.websiteClicks ?? 0) + (g.bookings ?? 0) + (g.conversations ?? 0);
        const gdata = {
          followers: g.impressions ?? null,   // repurposed so the monthly-series machinery charts impressions
          reach: g.impressions ?? null, views: g.websiteClicks ?? null, engagement: actions,
          raw: { gbp: g } as any, syncedAt: new Date(),
        };
        await this.prisma.socialInsight.upsert({
          where: { tenantId_platform_periodMonth: { tenantId, platform: 'gbp', periodMonth: month } },
          create: { tenantId, platform: 'gbp', periodMonth: month, ...gdata },
          update: gdata,
        });
      }
      await this.prisma.marketingChannelConnection.updateMany({ where: { tenantId, platform }, data: { lastSyncedAt: new Date(), status: 'ACTIVE', lastError: null } });
      await this.audit(tenantId, user.userId, 'marketing.channel.sync', { platform, month });
      return { ok: true, platform, month, metrics: m };
    } catch (e) {
      await this.prisma.marketingChannelConnection.updateMany({ where: { tenantId, platform }, data: { status: 'ERROR', lastError: String((e as Error).message).slice(0, 300) } });
      throw new BadRequestException(String((e as Error).message));
    }
  }

  /**
   * Pull last-month ORGANIC Facebook Page + linked Instagram numbers
   * (platform 'meta_social') into the social_insights table — one row per
   * network. Zero fabrication: whatever the API omits stays null. A failing
   * pull is recorded on the connection and never blocks the report.
   */
  async syncOrganic(user: AuthenticatedUser, platform: string, month: string, tenantParam?: string) {
    const tenantId = this.tenantId(user, tenantParam);
    if (!/^\d{4}-\d{2}$/.test(month || '')) throw new BadRequestException('month must be YYYY-MM');
    const connector = this.social.get(platform);
    if (!connector.fetchOrganic) throw new BadRequestException(`${platform} does not support organic insights`);
    const creds = await this.loadChannelCreds(tenantId, platform);
    try {
      const res = await connector.fetchOrganic(creds, month);
      const rows: Array<{ ch: string; m: any }> = [];
      if (res.facebook) rows.push({ ch: 'facebook', m: res.facebook });
      if (res.instagram) rows.push({ ch: 'instagram', m: res.instagram });
      if (res.tiktok) rows.push({ ch: 'tiktok', m: res.tiktok });
      for (const { ch, m } of rows) {
        const data = {
          followers: m.followers ?? null,
          newFollowers: m.newFollowers ?? null,
          reach: m.reach ?? null,
          views: m.views ?? null,
          engagement: m.engagement ?? null,
          profileViews: m.profileViews ?? null,
          postsCount: m.postsCount ?? null,
          raw: { ...((m.raw as Record<string, unknown>) ?? {}), posts: m.posts ?? [], series: m.series ?? [], audience: m.audience ?? null } as any,
          source: 'api',
          syncedAt: new Date(),
        };
        await this.prisma.socialInsight.upsert({
          where: { tenantId_platform_periodMonth: { tenantId, platform: ch, periodMonth: month } },
          create: { tenantId, platform: ch, periodMonth: month, ...data },
          update: data,
        });
      }
      await this.prisma.marketingChannelConnection.updateMany({ where: { tenantId, platform }, data: { lastSyncedAt: new Date(), status: 'ACTIVE', lastError: null } });
      await this.audit(tenantId, user.userId, 'marketing.channel.syncOrganic', { platform, month, channels: rows.map((r) => r.ch) });
      return { ok: true, platform, month, channels: rows.map((r) => ({ platform: r.ch, ...r.m })) };
    } catch (e) {
      await this.prisma.marketingChannelConnection.updateMany({ where: { tenantId, platform }, data: { status: 'ERROR', lastError: String((e as Error).message).slice(0, 300) } });
      throw new BadRequestException(String((e as Error).message));
    }
  }

  /** Sync every ACTIVE, enabled channel for a tenant/month. Best-effort. */
  async syncAllChannels(user: AuthenticatedUser, tenantId: string, month: string) {
    const conns = (await this.prisma.marketingChannelConnection.findMany({ where: { tenantId, status: 'ACTIVE' } })) as any[];
    let synced = 0;
    for (const c of conns) {
      const meta = this.social.list().find((x) => x.platform === c.platform);
      if (!meta || !meta.enabled) continue;
      try {
        if (c.platform === 'meta_social') await this.syncOrganic(user, c.platform, month, tenantId);
        else await this.syncChannel(user, c.platform, month, tenantId);
        synced++;
      } catch { /* recorded on the connection */ }
    }
    return { synced };
  }

  /**
   * Manually entered social numbers for a month (e.g. TikTok before its API is
   * approved). Stored exactly like a synced row (source='manual') so it flows into
   * the report card, month-over-month deltas and the AI analysis with no special-casing.
   * The period is the whole calendar month selected — 1st to last day.
   */
  async saveSocialManual(user: AuthenticatedUser, dto: { platform: string; month: string; followers?: number | null; newFollowers?: number | null; views?: number | null; engagement?: number | null; postsCount?: number | null; notes?: string | null; tenantId?: string }) {
    const tenantId = this.tenantId(user, dto.tenantId);
    if (!/^\d{4}-\d{2}$/.test(dto.month || '')) throw new BadRequestException('month must be YYYY-MM');
    if (!dto.platform) throw new BadRequestException('platform is required');
    const n = (v: any) => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));
    const data = {
      followers: n(dto.followers), newFollowers: n(dto.newFollowers),
      reach: null as number | null, views: n(dto.views), engagement: n(dto.engagement),
      profileViews: null as number | null, postsCount: n(dto.postsCount),
      raw: { manual: true, notes: dto.notes ?? null } as any,
      source: 'manual', syncedAt: new Date(),
    };
    const saved = await this.prisma.socialInsight.upsert({
      where: { tenantId_platform_periodMonth: { tenantId, platform: dto.platform, periodMonth: dto.month } },
      create: { tenantId, platform: dto.platform, periodMonth: dto.month, ...data },
      update: data,
    });
    await this.audit(tenantId, user.userId, 'marketing.social.manual', { platform: dto.platform, month: dto.month });
    return { ok: true, platform: dto.platform, month: dto.month, id: (saved as any).id };
  }

  /**
   * Shared AGENCY credentials from env. Lumio Agency runs the ads for every
   * salon from its own Business Manager, so ONE token can read all managed ad
   * accounts. A salon connection then only needs the account id — no token
   * pasted per tenant, and rotating the env token updates everyone at once.
   *   META_AGENCY_TOKEN                      (system-user token, ads_read)
   *   GBP_AGENCY_CLIENT_ID / _CLIENT_SECRET / _REFRESH_TOKEN
   */
  private agencyCreds(platform: string): Partial<ChannelCreds> | null {
    if ((platform === 'meta' || platform === 'meta_social') && process.env.META_AGENCY_TOKEN) return { token: process.env.META_AGENCY_TOKEN };
    if (platform === 'gbp' && process.env.GBP_AGENCY_REFRESH_TOKEN && process.env.GBP_AGENCY_CLIENT_ID && process.env.GBP_AGENCY_CLIENT_SECRET) {
      return { refreshToken: process.env.GBP_AGENCY_REFRESH_TOKEN, clientId: process.env.GBP_AGENCY_CLIENT_ID, clientSecret: process.env.GBP_AGENCY_CLIENT_SECRET };
    }
    if (platform === 'tiktok' && process.env.TIKTOK_AGENCY_CLIENT_KEY && process.env.TIKTOK_AGENCY_CLIENT_SECRET) {
      // TikTok app key/secret are agency-level; each salon stores only its own refresh token.
      return { clientId: process.env.TIKTOK_AGENCY_CLIENT_KEY, clientSecret: process.env.TIKTOK_AGENCY_CLIENT_SECRET };
    }
    return null;
  }

  private async loadChannelCreds(tenantId: string, platform: string): Promise<ChannelCreds> {
    const conn = await this.prisma.marketingChannelConnection.findUnique({ where: { tenantId_platform: { tenantId, platform } } });
    if (!conn || conn.status === 'REVOKED') throw new NotFoundException('Channel not connected');
    // No per-tenant secret stored -> the connection rides on the agency token.
    if (!conn.credentialEnc) {
      const shared = this.agencyCreds(platform);
      if (!shared) throw new NotFoundException('Channel not connected (agency token missing on server)');
      return { ...shared, externalAccountId: conn.externalAccountId ?? undefined } as ChannelCreds;
    }
    const stored = JSON.parse(decryptSecret(conn.credentialEnc)) as ChannelCreds;
    // TikTok stores only the salon refresh token; backfill the agency app key/secret from env.
    const shared = this.agencyCreds(platform);
    return { ...(shared ?? {}), ...stored } as ChannelCreds;
  }

  private channelView(c: any) {
    return { platform: c.platform, status: c.status, accountName: c.accountName, externalAccountId: c.externalAccountId, keyHint: c.keyHint, lastSyncedAt: c.lastSyncedAt, lastError: c.lastError };
  }

  private async audit(tenantId: string, userId: string | null, action: string, meta: any) {
    try { await this.prisma.auditLog.create({ data: { tenantId, userId: userId ?? undefined, action, resourceType: 'marketing', metadata: meta as any } }); } catch { /* never break */ }
  }
}
