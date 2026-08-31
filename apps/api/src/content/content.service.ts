import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { AuthenticatedUser, resolveTenantScope } from '../common/tenant/tenant-context';
import { formatMoneyShort, localeForCountry } from '../common/money';
import { buildSignalProfile, signalsToPrompt, SignalProfile } from './content-signals';
import { buildRevenueProfile, revenueToPrompt, RevenueProfile } from './revenue-signals';
import { regionEvents, parseAddress, eventsToPrompt, type ResolvedRegion, type DatedEvent } from './region-events';
import { trendLinks, trendLinksToPrompt } from './trend-sources';
import { buildWeekPlan, weekPlanToPrompt } from './weekly-plan';
import { videoFeeds, productWatch, playbookFor } from './industry-playbook';
import { buildAudienceProfile, audienceToPrompt, type VisitRow, type AudienceProfile } from './audience-signals';
import { promoAdvice, promoToPrompt, capAdvice, type PromoAdvice } from './promo-playbook';
import { fetchCensus, describeArea, type CensusResult } from './census';
import { leadTime, cpaCeiling, budgetPlan, runWindow, platformPick, adAudiences } from './ads-plan';
import { buildSeoReport } from './seo-local';
import { resolveIdentity, identityToPrompt, type ResolvedIdentity } from './business-profile';
import { readWebsite, readFacebookPage, SiteReadError } from '../common/site-reader';
import { buildStrategyBrief } from './strategy-brief';
import { isTransientStatus } from '../messenger/agent-fallback';

/**
 * The weekly marketing playbook, per salon.
 *
 * The pitch an agency makes is "we'll tell you what to post". The pitch this
 * makes is different: it opens the salon's own appointment book, its own Google
 * search terms and its own post history, then says what to film AND which hour
 * to discount AND which hour to protect. Nothing here is generic advice with a
 * salon name pasted on top — every line traces back to a number the owner can
 * check, which is the only reason an owner keeps reading past week two.
 *
 * Drafts are never delivered straight to a salon: the Lumio team approves.
 * That is a product decision, not a technical one — the agency sells judgement,
 * and an unreviewed AI plan quietly turns the agency into a pipe.
 */
@Injectable()
export class ContentService {
  private readonly logger = new Logger('Content');

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  private tenantId(user: AuthenticatedUser): string {
    const id = resolveTenantScope(user);
    if (!id) throw new NotFoundException('No tenant context');
    return id;
  }

  /** The salon's own calendar day — a playbook is useless on the wrong date. */
  private localDay(tz: string, d = new Date()): string {
    try {
      return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
    } catch {
      return d.toISOString().slice(0, 10);
    }
  }

  /**
   * Today's weekday where the salon stands, 0 = Sunday.
   *
   * It has to be the salon's timezone, not the server's. At 22:00 in California
   * the server is already on tomorrow in UTC, and a week plan that starts on
   * the wrong day would tell an owner to film on a day they are closed.
   */
  private localWeekday(tz: string, d = new Date()): number {
    const NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    try {
      const s = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(d);
      const i = NAMES.indexOf(s.slice(0, 3));
      return i >= 0 ? i : d.getUTCDay();
    } catch {
      return d.getUTCDay();
    }
  }

  private monthKey(offset = 0, d = new Date()): string {
    const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + offset, 1));
    return `${x.getUTCFullYear()}-${String(x.getUTCMonth() + 1).padStart(2, '0')}`;
  }

  // ---- gathering ----------------------------------------------------------

  /**
   * Everything the generator reasons from, pulled from data the platform
   * already holds. No new integrations, no scraping, nothing to break.
   */
  async gather(tenantId: string): Promise<{
    tenantName: string;
    industry: string;
    city: string;
    tz: string;
    region: ResolvedRegion;
    events: DatedEvent[];
    signals: SignalProfile;
    revenue: RevenueProfile;
    audience: AudienceProfile;
    promo: PromoAdvice;
    identity: ResolvedIdentity;
    nearbyZips: string | null;
    sourceCounts: Record<string, number>;
    lead: ReturnType<typeof leadTime>;
    money: (c: number) => string;
  }> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      // city/region/postalCode may be absent on a database that has not run the
      // location migration yet; the catch below keeps the whole engine alive
      // rather than blanking a salon's screen over a missing column.
      select: { name: true, timezone: true, businessType: true, market: true, city: true, region: true, postalCode: true, commissionPct: true, nearbyZips: true },
    }).catch(() => this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { name: true, timezone: true, businessType: true, market: true },
    }).catch(() => null));
    const tz = tenant?.timezone || 'America/Los_Angeles';
    const extra = await this.prisma.setting.findFirst({ where: { tenantId, key: 'company_extra' }, select: { value: true } }).catch(() => null);
    // What the business says it is, and what the setup learned from its website
    // and fanpage. Read BEFORE anything keyed off businessType, because a
    // four-value enum cannot describe a business and these can.
    const profileRow = await this.prisma.setting.findFirst({ where: { tenantId, key: 'business_profile' }, select: { value: true } }).catch(() => null);
    const looseP = this.prisma as unknown as Record<string, { findFirst: (a: unknown) => Promise<unknown> }>;
    const conn = await looseP.messengerConnection?.findFirst({
      where: { tenantId }, select: { bizIntro: true, aiInstruction: true },
    }).catch(() => null) as { bizIntro?: string | null; aiInstruction?: string | null } | null;
    const ex = (extra?.value ?? {}) as { address?: string; country?: string };
    const locale = localeForCountry(ex.country ?? '', tz);
    const money = (c: number) => formatMoneyShort(c, 'USD', locale);

    const thisMonth = this.monthKey(0);
    const lastMonth = this.monthKey(-1);

    // Google search terms + own post performance + audience, from the monthly
    // sync the reporting engine already runs.
    const [gbpNow, gbpPrev, metaNow] = await Promise.all([
      this.prisma.socialInsight.findFirst({ where: { tenantId, platform: 'gbp', periodMonth: thisMonth }, select: { raw: true } }).catch(() => null),
      this.prisma.socialInsight.findFirst({ where: { tenantId, platform: 'gbp', periodMonth: lastMonth }, select: { raw: true } }).catch(() => null),
      this.prisma.socialInsight.findFirst({ where: { tenantId, platform: 'instagram', periodMonth: thisMonth }, select: { raw: true } }).catch(() => null),
    ]);
    const rawOf = (r: unknown) => ((r as { raw?: Record<string, unknown> } | null)?.raw ?? {}) as Record<string, unknown>;
    const gNow = rawOf(gbpNow); const gPrev = rawOf(gbpPrev); const mNow = rawOf(metaNow);

    // Bookings: two 30-day windows for service trend, four weeks for capacity.
    const now = new Date();
    const d30 = new Date(now.getTime() - 30 * 86_400_000);
    const d60 = new Date(now.getTime() - 60 * 86_400_000);
    type ApptRow = { startTime: Date; endTime: Date; priceCents: number | null; customerId: string | null; service: { name: string } | null };
    const appts: ApptRow[] = await this.prisma.appointment.findMany({
      where: { tenantId, startTime: { gte: d60 }, status: { notIn: ['CANCELLED', 'NO_SHOW'] } as never },
      select: { startTime: true, endTime: true, priceCents: true, customerId: true, service: { select: { name: true } } },
    }).catch(() => [] as ApptRow[]) as ApptRow[];

    const tally = (rows: ApptRow[]) => {
      const m = new Map<string, number>();
      for (const a of rows) {
        const n = a.service?.name?.trim();
        if (n) m.set(n, (m.get(n) ?? 0) + 1);
      }
      return Array.from(m, ([name, count]) => ({ name, count }));
    };
    const recent = appts.filter((a) => a.startTime >= d30);
    const older = appts.filter((a) => a.startTime < d30);

    // Weekday/hour as the SALON sees them, not as UTC sees them — an 8pm
    // booking in California is next-day UTC and would land in the wrong block.
    const parts = (d: Date) => {
      try {
        const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', hour: 'numeric', hour12: false });
        const p = f.formatToParts(d);
        const wdName = p.find((x) => x.type === 'weekday')?.value ?? 'Sun';
        const hour = Number(p.find((x) => x.type === 'hour')?.value ?? 0);
        const idx = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(wdName);
        return { weekday: idx < 0 ? 0 : idx, hour: Number.isFinite(hour) ? hour % 24 : 0 };
      } catch {
        return { weekday: d.getUTCDay(), hour: d.getUTCHours() };
      }
    };
    const bookingRows = appts
      .filter((a) => a.startTime >= new Date(now.getTime() - 28 * 86_400_000))
      .map((a) => {
        const { weekday, hour } = parts(a.startTime);
        const minutes = Math.max(0, Math.round((a.endTime.getTime() - a.startTime.getTime()) / 60000));
        return { weekday, hour, minutes, revenueCents: a.priceCents ?? 0 };
      });

    // A YEAR of visits, for segmentation. The 60-day window above is right for
    // "what is selling now" and useless for "who comes back": inside two months
    // a customer who visits quarterly looks identical to one who never returned.
    const d365 = new Date(now.getTime() - 365 * 86_400_000);
    type HistRow = {
      startTime: Date; createdAt: Date; priceCents: number | null; customerId: string | null;
      source: string | null; utmSource: string | null; service: { name: string } | null;
    };
    const history: HistRow[] = await this.prisma.appointment.findMany({
      // Walk-ins with no customer record are dropped below in JS rather than in
      // the query: `customerId: { not: null }` types differently across Prisma
      // client versions, and this filter is not worth a build that only fails
      // on the deploy machine.
      where: { tenantId, startTime: { gte: d365 }, status: { notIn: ['CANCELLED', 'NO_SHOW'] } as never },
      select: {
        startTime: true, createdAt: true, priceCents: true, customerId: true,
        source: true, utmSource: true, service: { select: { name: true } },
      } as never,
      take: 20000,
    }).catch(() => [] as HistRow[]) as HistRow[];
    const visitRows: VisitRow[] = history.filter((h) => h.customerId).map((h) => {
      const { weekday, hour } = parts(h.startTime);
      return {
        customerId: String(h.customerId),
        at: h.startTime.getTime(),
        priceCents: h.priceCents ?? 0,
        serviceName: h.service?.name ?? null,
        weekday, hour,
      };
    });

    // Where bookings come from, and how far ahead they are made. Both are read
    // from rows the platform already writes on every booking — no new tracking.
    const sourceCounts: Record<string, number> = {};
    for (const h of history) {
      const raw = String((h as { source?: string | null }).source ?? '').toLowerCase().trim();
      const utm = String((h as { utmSource?: string | null }).utmSource ?? '').toLowerCase().trim();
      const key = utm || raw || 'unknown';
      sourceCounts[key] = (sourceCounts[key] ?? 0) + 1;
    }
    const lead = leadTime(history.map((h) => ({
      createdAt: (h as { createdAt?: Date }).createdAt?.getTime() ?? h.startTime.getTime(),
      startTime: h.startTime.getTime(),
    })));

    // Lapsed customers, measured from their own last visit.
    const lastVisit = new Map<string, { at: number; total: number; n: number }>();
    for (const a of appts) {
      const c = a.customerId;
      if (!c) continue;
      const cur = lastVisit.get(c) ?? { at: 0, total: 0, n: 0 };
      cur.at = Math.max(cur.at, a.startTime.getTime());
      cur.total += a.priceCents ?? 0;
      cur.n += 1;
      lastVisit.set(c, cur);
    }
    const customers = Array.from(lastVisit.values()).map((v) => ({
      daysSinceLastVisit: Math.floor((now.getTime() - v.at) / 86_400_000),
      avgTicketCents: v.n ? Math.round(v.total / v.n) : 0,
    }));

    type SvcRow = { name: string; priceCents: number; durationMinutes: number };
    const services: SvcRow[] = await this.prisma.service.findMany({
      where: { tenantId, isActive: true },
      select: { name: true, priceCents: true, durationMinutes: true },
    }).catch(() => [] as SvcRow[]) as SvcRow[];

    // Where this salon is. Explicit fields win; otherwise read the address the
    // owner already typed into settings, so a hundred salons do not have to
    // re-enter their own city. When neither yields a state, the region stays
    // unknown and every downstream piece is written to say so.
    const t = (tenant ?? {}) as { market?: string; city?: string | null; region?: string | null };
    const fromAddress = parseAddress(ex.address, t.market === 'VN' ? 'VN' : t.market === 'CA' ? 'CA' : 'US');
    const identity = resolveIdentity({
      declared: (profileRow?.value ?? null) as Record<string, string> | null,
      bizIntro: conn?.bizIntro ?? null,
      aiInstruction: conn?.aiInstruction ?? null,
      website: (ex as { website?: string }).website ?? null,
      tenantName: tenant?.name ?? null,
      serviceNames: services.map((s2) => s2.name),
      city: (tenant as { city?: string | null } | null)?.city ?? fromAddress.city,
      region: (tenant as { region?: string | null } | null)?.region ?? fromAddress.region,
      industry: String((tenant as { businessType?: string } | null)?.businessType ?? 'SALON'),
    });

    const { region, events } = regionEvents(now, {
      market: t.market ?? ex.country ?? 'US',
      city: t.city ?? fromAddress.city,
      region: t.region ?? fromAddress.region,
    }, { horizonDays: 45 });

    // The commission rate the shop is already paying, from the staff records it
    // set up for payroll. Nobody types it twice, and it is a measurement rather
    // than an estimate: these are the rates going out every week.
    const staffRows = await this.prisma.staffMember.findMany({
      where: { tenantId, isActive: true },
      select: { commissionPercent: true } as never,
      take: 100,
    }).catch(() => []) as unknown as { commissionPercent?: number | null }[];
    const rates = staffRows.map((r) => Number(r.commissionPercent ?? 0)).filter((n) => n > 0 && n < 100);
    const staffAvgPct = rates.length ? Math.round(rates.reduce((a, b) => a + b, 0) / rates.length) : null;

    const revenue = buildRevenueProfile({ bookings: bookingRows, customers, services });
    const promo = promoAdvice({
      industry: String((tenant as { businessType?: string } | null)?.businessType ?? 'SALON'),
      commissionPct: (tenant as { commissionPct?: number | null } | null)?.commissionPct ?? null,
      staffAvgPct,
      // Falling back to a trade default rather than refusing. The objection to
      // an assumed margin was never the assumption — it was an assumption that
      // reads like a measurement. The source travels with every figure derived
      // from it and the screen says "ước tính", so it cannot be mistaken.
      allowAssumed: true,
      proposedDiscountPct: revenue.advice.discountPct || null,
    });

    // Capped at the source, before the number reaches a prompt or a screen.
    // The rule itself lives in promo-playbook next to the arithmetic it depends
    // on, so it can be tested without standing up a whole booking book.
    capAdvice(revenue.advice, promo);

    return {
      tenantName: tenant?.name || 'Tiệm',
      industry: String((tenant as { businessType?: string } | null)?.businessType ?? 'SALON'),
      city: region.label,
      tz,
      region,
      events,
      money,
      signals: buildSignalProfile({
        keywordsNow: (gNow.keywords as never) ?? null,
        keywordsPrev: (gPrev.keywords as never) ?? null,
        servicesNow: tally(recent),
        servicesPrev: tally(older),
        posts: (mNow.posts as never) ?? null,
        audience: (mNow.audience as never) ?? null,
        today: now,
        country: ex.country,
      }),
      revenue,
      audience: buildAudienceProfile(visitRows, now.getTime()),
      promo,
      identity,
      sourceCounts,
      lead,
      // ZIPs, in order of authority, and never asked for twice: the field
      // someone filled, the extra ZIPs the team added, then the one sitting in
      // the shop's own address. The address has been there since setup — asking
      // for the ZIP separately was asking for data we already had.
      nearbyZips: [
        (tenant as { postalCode?: string | null } | null)?.postalCode ?? '',
        (tenant as { nearbyZips?: string | null } | null)?.nearbyZips ?? '',
        fromAddress.postalCode ?? '',
      ].filter(Boolean).join(',') || null,
    };
  }

  // ---- generating ---------------------------------------------------------

  /**
   * Draft one salon's ideas for a day. Idempotent per (tenant, date): running
   * the scheduler twice must not double a salon's workload.
   */
  async generateForTenant(tenantId: string, opts: { force?: boolean } = {}): Promise<{ created: number; skipped?: string }> {
    const key = process.env.ANTHROPIC_API_KEY || '';
    if (!key) {
      this.logger.error('ANTHROPIC_API_KEY missing — cannot draft content ideas.');
      return { created: 0, skipped: 'no-api-key' };
    }
    const ctx = await this.gather(tenantId);
    const forDate = this.localDay(ctx.tz);

    if (!opts.force) {
      const existing = await this.prisma.contentIdea.count({ where: { tenantId, forDate } }).catch(() => 0);
      if (existing > 0) return { created: 0, skipped: 'already-drafted' };
    }

    // The library and the week's trend note — the human half of the system.
    type FormatRow = { id: string; name: string; summary: string; hookGuide: string | null; lengthSec: number | null; audience: string | null; heat: string };
    type NoteRow = { title: string; body: string };
    type TitleRow = { title: string };
    const [formats, notes, recentTitles] = (await Promise.all([
      this.prisma.contentFormat.findMany({
        where: { industry: ctx.industry, active: true },
        orderBy: [{ heat: 'asc' }, { updatedAt: 'desc' }],
        take: 25,
      }).catch(() => []),
      this.prisma.trendNote.findMany({
        where: { industry: ctx.industry, active: true, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
        orderBy: { createdAt: 'desc' },
        take: 3,
      }).catch(() => []),
      this.prisma.contentIdea.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: { title: true },
      }).catch(() => []),
    ])) as [FormatRow[], NoteRow[], TitleRow[]];

    const formatBlock = formats.length
      ? 'THƯ VIỆN ĐỊNH DẠNG (đội Lumio duy trì — CHỌN TỪ ĐÂY, ưu tiên cái đang nóng):\n'
        + formats.map((f) => `- [${f.heat}] ${f.name}: ${f.summary}${f.hookGuide ? ` | Hook: ${f.hookGuide}` : ''}${f.lengthSec ? ` | ~${f.lengthSec}s` : ''}${f.audience ? ` | Hợp: ${f.audience}` : ''}`).join('\n')
      : 'THƯ VIỆN ĐỊNH DẠNG: chưa có mục nào — tự đề xuất định dạng phổ biến của ngành.';

    const noteBlock = notes.length
      ? 'ĐANG NÓNG TUẦN NÀY (đội Lumio ghi tay, ưu tiên cao nhất):\n' + notes.map((n) => `- ${n.title}: ${n.body}`).join('\n')
      : '';

    const avoid = recentTitles.length
      ? `\nĐÃ GỢI Ý GẦN ĐÂY — KHÔNG LẶP LẠI:\n${recentTitles.map((r) => `- ${r.title}`).join('\n')}`
      : '';

    const system = `Bạn là chuyên gia marketing cho doanh nghiệp địa phương tại Mỹ, đang lập kế hoạch nội dung cho "${ctx.tenantName}"${ctx.city ? ` ở ${ctx.city}` : ''}.

NHIỆM VỤ: đề xuất ĐÚNG 3 ý tưởng nội dung cho hôm nay.
- Ý 1 (rank 1): bài chính, video/reel, đáng công quay nhất.
- Ý 2 (rank 2): video ngắn dễ làm, quay trong 2 phút giữa ca.
- Ý 3 (rank 3): bài ảnh hoặc story đăng bù khi tiệm quá bận.

LUẬT BẮT BUỘC:
1. Mỗi ý phải có trường "reason" nêu CĂN CỨ TỪ SỐ LIỆU THẬT bên dưới. Trích đúng con số. TUYỆT ĐỐI KHÔNG bịa số liệu, không nói "xu hướng cho thấy" nếu dữ liệu không nói vậy.
2. Nếu dữ liệu quá mỏng, nói thẳng trong reason rằng đây là gợi ý nền tảng cho ngành.
3. Về khuyến mãi: BÁM ĐÚNG khuyến nghị đã tính sẵn. Không tự nghĩ mức giảm khác, không đề xuất giảm cho khung giờ bị cấm.
4. Viết tiếng Việt cho chủ tiệm và đội marketing đọc. Riêng "caption" và "hashtags" viết TIẾNG ANH vì khách hàng cuối là người Mỹ.
5. Ngắn gọn, cụ thể, quay được ngay. Không sáo rỗng.
6. Về khu vực: chỉ được nhắc tới địa phương nếu phần dữ liệu bên dưới nói rõ tiệm ở đâu. Nếu ghi "chưa rõ khu vực" thì viết trung lập, KHÔNG đoán tên thành phố, bang, trường học hay lễ hội địa phương nào.
7. Ý tưởng hôm nay phải khớp với việc của hôm nay trong LỊCH TUẦN bên dưới — đừng bảo tiệm quay clip vào ngày lịch ghi là ngày đăng.

TRẢ VỀ JSON THUẦN, không markdown, không lời dẫn:
{"ideas":[{"rank":1,"formatName":"...","title":"...","hook":"...","shotList":"cảnh 1 · cảnh 2 · cảnh 3","caption":"...","hashtags":"#... #...","bestTime":"18:30","reason":"..."}]}`;

    const week = buildWeekPlan({
      today: new Date(),
      todayWeekday: this.localWeekday(ctx.tz),
      industry: ctx.industry,
      loads: ctx.revenue.loads,
      advice: ctx.revenue.advice,
      lapsed: ctx.revenue.lapsed,
      events: ctx.events,
    });

    const userMsg = [
      // First, and phrased as an override. The model will otherwise reason from
      // the industry bucket further down — a bucket is far easier to
      // pattern-match than a sentence, and that is exactly how a marketing
      // agency ended up being given nail-salon advice.
      identityToPrompt(ctx.identity, ctx.industry),
      '',
      signalsToPrompt(ctx.signals),
      '',
      eventsToPrompt(ctx.region, ctx.events),
      '',
      revenueToPrompt(ctx.revenue, ctx.money),
      '',
      audienceToPrompt(ctx.audience),
      '',
      promoToPrompt(ctx.promo),
      '',
      weekPlanToPrompt(week),
      '',
      // The raw material this trade actually has to hand. Without it the model
      // reaches for stock ideas ("quay một video giới thiệu tiệm") instead of
      // the finished set sitting on the table right now.
      `NGUỒN QUAY CÓ SẴN CỦA ${playbookFor(ctx.industry).trade.toUpperCase()} — ý tưởng phải bắt đầu từ một trong số này:\n`
        + week.sources.map((s) => `- ${s.label} (${s.when}) — ${s.why}`).join('\n'),
      '',
      trendLinksToPrompt(),
      '',
      formatBlock,
      noteBlock,
      avoid,
    ].filter(Boolean).join('\n');

    let text = '';
    let retried = false;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: process.env.ANTHROPIC_AGENT_MODEL || 'claude-haiku-4-5-20251001',
          max_tokens: 2000,
          system,
          messages: [{ role: 'user', content: userMsg }],
        }),
        signal: AbortSignal.timeout(60_000),
      }).catch(() => null);
      if (res && res.ok) {
        const data = (await res.json().catch(() => ({}))) as { content?: { type?: string; text?: string }[] };
        text = (data.content || []).filter((c) => c.type === 'text').map((c) => c.text || '').join('').trim();
        break;
      }
      if (!retried && res && isTransientStatus(res.status)) { retried = true; await new Promise((r) => setTimeout(r, 2000)); continue; }
      this.logger.warn(`content draft failed for ${tenantId}: ${res ? res.status : 'network'}`);
      return { created: 0, skipped: 'ai-unavailable' };
    }

    const parsed = this.parseIdeas(text);
    if (!parsed.length) {
      this.logger.warn(`content draft unparseable for ${tenantId}`);
      return { created: 0, skipped: 'unparseable' };
    }

    if (opts.force) await this.prisma.contentIdea.deleteMany({ where: { tenantId, forDate, status: 'draft' } }).catch(() => undefined);

    const snapshot = {
      keywords: ctx.signals.keywords.slice(0, 5),
      services: ctx.signals.services.slice(0, 5),
      postVerdict: ctx.signals.posts.verdict,
      offer: ctx.revenue.advice,
      thin: ctx.signals.thin,
    };
    let created = 0;
    for (const idea of parsed.slice(0, 3)) {
      // Everything in `idea` came out of a model's JSON, so it is `unknown` and
      // has to be coerced before it touches the database — the same String()
      // treatment every other field below gets.
      const rawName = typeof idea.formatName === 'string' ? idea.formatName.trim() : '';
      const match = formats.find((f) => f.name.toLowerCase() === rawName.toLowerCase());
      await this.prisma.contentIdea.create({
        data: {
          tenantId, forDate, status: 'draft',
          rank: Number(idea.rank) || created + 1,
          formatId: match?.id ?? null,
          formatName: (rawName || match?.name || '').slice(0, 200) || null,
          title: String(idea.title ?? '').slice(0, 300) || 'Ý tưởng nội dung',
          hook: idea.hook ? String(idea.hook).slice(0, 500) : null,
          shotList: idea.shotList ? String(idea.shotList).slice(0, 800) : null,
          caption: idea.caption ? String(idea.caption).slice(0, 1200) : null,
          hashtags: idea.hashtags ? String(idea.hashtags).slice(0, 400) : null,
          bestTime: idea.bestTime ? String(idea.bestTime).slice(0, 20) : null,
          reason: idea.reason ? String(idea.reason).slice(0, 800) : null,
          signals: snapshot as never,
          aiModel: process.env.ANTHROPIC_AGENT_MODEL || 'claude-haiku-4-5-20251001',
        },
      }).catch((e: unknown) => this.logger.warn(`idea save failed: ${String(e).slice(0, 120)}`));
      created += 1;
    }
    return { created };
  }

  /** Models wrap JSON in prose or fences no matter how firmly you ask. */
  private parseIdeas(text: string): Record<string, unknown>[] {
    const raw = String(text || '').trim();
    const candidates = [raw, raw.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()];
    const braced = raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1);
    if (braced) candidates.push(braced);
    for (const c of candidates) {
      try {
        const obj = JSON.parse(c) as { ideas?: Record<string, unknown>[] };
        if (Array.isArray(obj?.ideas) && obj.ideas.length) return obj.ideas;
      } catch { /* try the next shape */ }
    }
    return [];
  }

  /**
   * Warm the area figures for every tenant, off the page-load path.
   *
   * The Census is a third party and must never sit in front of a salon opening
   * a screen, so `planFor` reads the cache and stops. Something still has to
   * fill that cache, and a button somebody remembers to press is not a
   * mechanism. This runs on the hourly tick, skips anything already fresh, and
   * stays quiet about failure beyond the log — a demographics lookup that did
   * not work is not a reason to disturb anyone.
   */
  async warmAreas(): Promise<{ warmed: number }> {
    const tenants = await this.prisma.tenant.findMany({
      where: { status: 'ACTIVE', deletedAt: null } as never,
      select: { id: true },
      take: 500,
    }).catch(() => []) as { id: string }[];
    let warmed = 0;
    for (const t of tenants) {
      const zips = await this.gather(t.id).then((c) => c.nearbyZips).catch(() => null);
      if (!zips) continue;
      const r = await this.areaFor(t.id, zips, { allowFetch: true }).catch(() => null);
      if (r?.ok) warmed += 1;
    }
    return { warmed };
  }

  /**
   * Draft for every active tenant — the scheduler's entry point.
   *
   * `industry` is now a FILTER, not a requirement, and it defaults to nothing.
   * It used to default to 'SALON', and the scheduler passed 'SALON' explicitly,
   * which meant a restaurant or an estate agency on this platform never had a
   * single idea generated for it — not a bad idea, none at all. The industry
   * variations underneath were all written and tested and simply never ran.
   */
  async generateAll(industry?: string | null): Promise<{ tenants: number; created: number }> {
    // Checked once, here, rather than once per tenant inside the loop.
    //
    // The Vietnam deployment has no Anthropic key and is not meant to have one,
    // so the hourly run was printing an ERROR line for every active tenant,
    // every hour, forever. Log noise at that volume is not harmless: it buries
    // the lines that matter, and an ERROR that is expected teaches everyone to
    // ignore ERRORs.
    if (!process.env.ANTHROPIC_API_KEY) {
      this.logger.log('Content planner idle: no ANTHROPIC_API_KEY on this deployment.');
      return { tenants: 0, created: 0 };
    }
    const where: Record<string, unknown> = { status: 'ACTIVE', deletedAt: null };
    if (industry) where.businessType = industry;
    const tenants = await this.prisma.tenant.findMany({
      where: where as never,
      select: { id: true },
    }).catch(() => []) as { id: string }[];
    let created = 0;
    for (const t of tenants) {
      const r = await this.generateForTenant(t.id).catch(() => ({ created: 0 }));
      created += r.created;
    }
    return { tenants: tenants.length, created };
  }

  // ---- reading ------------------------------------------------------------

  /** What a salon sees. Published only — drafts belong to the Lumio team. */
  async forSalon(user: AuthenticatedUser, date?: string) {
    const tenantId = this.tenantId(user);
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { timezone: true, businessType: true } });
    const tz = tenant?.timezone || 'America/Los_Angeles';
    const forDate = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : this.localDay(tz);
    const [ideas, notes] = await Promise.all([
      this.prisma.contentIdea.findMany({
        where: { tenantId, forDate, status: { in: ['published', 'filmed', 'posted', 'skipped'] } },
        orderBy: { rank: 'asc' },
      }).catch(() => []),
      this.prisma.trendNote.findMany({
        where: { industry: String((tenant as { businessType?: string } | null)?.businessType ?? 'SALON'), active: true, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
        orderBy: { createdAt: 'desc' }, take: 2,
      }).catch(() => []),
    ]);
    return { forDate, ideas, trendNotes: notes };
  }

  /**
   * The half of the playbook that is computed, not written: what is coming and
   * what to do about the quiet hours. Shown to the salon as its own sections
   * because "sắp tới có sự kiện gì" and "nên giảm giá thế nào" are questions an
   * owner asks directly — they should not have to infer the answers from three
   * content ideas.
   */
  async planFor(user: AuthenticatedUser) {
    const tenantId = this.tenantId(user);
    const ctx = await this.gather(tenantId);
    // Computed once, then shared: the brief needs the same figures the cards
    // show, and fetching them twice is how two numbers on one screen drift.
    const area = await this.areaFor(tenantId, ctx.nearbyZips, { allowFetch: false }).catch(() => null);
    const ads = await this.adsFor(tenantId, ctx).catch(() => null);
    const week = buildWeekPlan({
      today: new Date(),
      todayWeekday: this.localWeekday(ctx.tz),
      industry: ctx.industry,
      loads: ctx.revenue.loads,
      advice: ctx.revenue.advice,
      lapsed: ctx.revenue.lapsed,
      events: ctx.events,
    });
    return {
      // Where we think the salon is, and how sure we are. The screen shows this
      // so a wrong city gets corrected by the person who knows, instead of
      // quietly skewing every suggestion for months.
      region: { label: ctx.region.label, known: ctx.region.regionKnown, market: ctx.region.market },
      // The trade this engine thinks the business is in. On screen next to the
      // region, because "everything looks like a nail salon" is a symptom with
      // two causes — the industry not being set, or the industry being set and
      // ignored — and only one line of UI tells them apart.
      industry: { code: ctx.industry, trade: playbookFor(ctx.industry).trade },
      // The label the screen shows. The business's own sentence when it has
      // given one; the enum is demoted to a footnote beside it.
      identity: {
        label: ctx.identity.label,
        declared: ctx.identity.declared,
        filled: ctx.identity.filled,
        profile: ctx.identity.profile,
        provenance: ctx.identity.provenance,
        gaps: ctx.identity.gaps,
      },
      events: ctx.events,
      // The long list: six months out, so a salon can see Tết or the holidays
      // coming while there is still time to prepare stock and staffing. The
      // 45-day `events` list above stays the urgent one.
      calendar: regionEvents(new Date(), {
        market: ctx.region.market, city: ctx.region.city, region: ctx.region.region,
      }, { horizonDays: 180 }).events,
      week,
      videoFeeds: videoFeeds(ctx.industry, ctx.region.market),
      productWatch: productWatch(ctx.industry),
      // The salon's own numbers steer the trend queries: it is shown Google
      // Trends for the service it actually sells most, not for a generic term
      // someone picked for the whole industry.
      trends: trendLinks({
        industry: ctx.industry,
        market: ctx.region.market,
        region: ctx.region.region,
        city: ctx.region.city,
        services: ctx.signals.services.map((s) => ({ name: s.name, count: s.count })),
        keywords: ctx.signals.keywords.map((k) => ({ keyword: k.keyword, count: k.count })),
        events: ctx.events.map((e) => ({ name: e.name, daysAway: e.daysAway, note: e.note })),
      }),
      offer: ctx.revenue.advice,
      // Who the salon's customers actually are, and the arithmetic behind any
      // discount. Both travel with the plan so the screen and the model are
      // reading the same numbers.
      audience: ctx.audience,
      promo: ctx.promo,
      // Cache only: a salon opening this page must not wait on the Census.
      area,
      ads: ads,
      // The consultant's chain, assembled from every number above. Placed in
      // the payload rather than the UI because the argument's ORDER is part of
      // the reasoning, and a screen that reorders it breaks the logic.
      brief: buildStrategyBrief({
        businessLabel: ctx.identity.declared ? ctx.identity.label : ctx.tenantName,
        declaredWhoWeServe: ctx.identity.profile.whoWeServe || null,
        serviceArea: ctx.identity.profile.serviceArea || null,
        regionLabel: ctx.region.label,
        regionKnown: ctx.region.regionKnown,
        areaPopulation: area?.ok ? area.totalPopulation : null,
        areaMedianIncome: area?.ok ? area.weightedMedianIncomeUsd : null,
        areaZipCount: area?.zips?.length ?? 0,
        censusYear: area?.year ?? null,
        customerCount: ctx.audience.totalCustomers,
        segments: ctx.audience.segments.map((sg) => ({
          key: sg.key, label: sg.label, count: sg.count,
          avgTicketCents: sg.avgTicketCents, medianGapDays: sg.medianGapDays, favouriteTime: sg.favouriteTime,
        })),
        lapsedCount: ctx.revenue.lapsed.count,
        audienceThin: ctx.audience.thin,
        leadDays: ctx.lead.medianDays,
        leadSample: ctx.lead.sample,
        quietLabels: ctx.revenue.loads.slice(0, 3).map((l) => l.label),
        busyLabels: [...ctx.revenue.loads].reverse().slice(0, 2).map((l) => l.label),
        sourceCounts: ctx.sourceCounts,
        grossMarginPct: ctx.promo.margin.grossMarginPct,
        marginSource: ctx.promo.margin.source,
        cpaCeilingCents: ads?.ceiling.strictCents ?? null,
        budgetTotalCents: ads?.budget.totalCents ?? null,
        budgetDays: ads?.budget.days ?? 14,
        bookingsToBreakEven: ads?.budget.bookingsToBreakEven ?? null,
        runDayLabels: ads?.window.labels.run ?? [],
        pauseDayLabels: ads?.window.labels.pause ?? [],
        money: ctx.money,
      }),
      seo: await this.seoFor(tenantId, ctx).catch(() => null),
      lapsed: ctx.revenue.lapsed,
      quietSlots: ctx.revenue.loads.slice(0, 3),
      busySlots: [...ctx.revenue.loads].reverse().slice(0, 3),
      topYields: ctx.revenue.yields.slice(0, 3),
      thin: ctx.signals.thin,
    };
  }

  /**
   * Redraft today's ideas on demand.
   *
   * `/salon/content` is a support-only screen — only a Lumio session ever opens
   * it — so the person pressing this is the agency, and making them wait for
   * tomorrow's 6am run to see a change would be absurd. It therefore drafts AND
   * publishes in one step, skipping the review queue that exists to protect the
   * salon from unreviewed drafts. There is no salon here to protect.
   *
   * Two guards, because this spends money on every press:
   *   - a daily cap per tenant, held in the settings table so a restart cannot
   *     reset it into a free-for-all;
   *   - the cap counts ATTEMPTS, not successes. A failing model that is retried
   *     forty times costs exactly as much as a working one.
   */
  async refreshFor(user: AuthenticatedUser): Promise<{ created: number; left: number; skipped?: string }> {
    const tenantId = this.tenantId(user);
    const LIMIT = 5;
    const tz = (await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { timezone: true } }).catch(() => null))?.timezone
      || 'America/Los_Angeles';
    const today = this.localDay(tz);

    const row = await this.prisma.setting.findFirst({
      where: { tenantId, key: 'content_manual_refresh' }, select: { id: true, value: true },
    }).catch(() => null);
    const state = (row?.value ?? {}) as { date?: string; count?: number };
    const used = state.date === today ? Number(state.count) || 0 : 0;
    if (used >= LIMIT) {
      throw new BadRequestException(`Đã tạo lại ${LIMIT} lần hôm nay — chờ tới ngày mai, hoặc sửa tay ý tưởng đang có.`);
    }

    // Count the attempt BEFORE running it: a crash halfway through has already
    // cost the API call, and must not hand back a free retry.
    const next = { date: today, count: used + 1 };
    if (row?.id) await this.prisma.setting.update({ where: { id: row.id }, data: { value: next as never } }).catch(() => undefined);
    else await this.prisma.setting.create({ data: { tenantId, key: 'content_manual_refresh', value: next as never } }).catch(() => undefined);

    const r = await this.generateForTenant(tenantId, { force: true });
    if (r.created) {
      await this.prisma.contentIdea.updateMany({
        where: { tenantId, forDate: today, status: 'draft' },
        data: { status: 'published', publishedAt: new Date() },
      }).catch(() => undefined);
    }
    return { created: r.created, left: LIMIT - next.count, ...(r.skipped ? { skipped: r.skipped } : {}) };
  }

  /**
   * Area demographics, cached for a month.
   *
   * The ACS moves once a year, so fetching it on every page load would be a lot
   * of traffic to learn the same number. The cache also means a Census outage
   * shows last month's figures instead of an empty panel — but only if they
   * were real: a failed fetch is never written to the cache, because a cached
   * failure would be indistinguishable from a cached fact.
   */
  async areaFor(
    tenantId: string,
    zips: string | null,
    opts: { force?: boolean; allowFetch?: boolean } = {},
  ): Promise<CensusResult & { lines: string[]; cachedAt?: string }> {
    const blank: CensusResult = { ok: false, year: null, zips: [], totalPopulation: null, weightedMedianIncomeUsd: null };
    if (!zips) {
      return { ...blank, lines: [], error: 'Chưa có mã ZIP. Điền ZIP của tiệm (và các ZIP lân cận) ở Super Admin.' };
    }
    const KEY = 'census_cache';
    const row = await this.prisma.setting.findFirst({ where: { tenantId, key: KEY }, select: { id: true, value: true } }).catch(() => null);
    const cached = (row?.value ?? {}) as { at?: string; zips?: string; data?: CensusResult };
    const fresh = cached.at && Date.now() - Date.parse(cached.at) < 30 * 86_400_000;
    if (!opts.force && fresh && cached.zips === zips && cached.data?.ok) {
      return { ...cached.data, lines: describeArea(cached.data), cachedAt: cached.at };
    }

    // Page loads read the cache and stop there.
    //
    // Fetching inline meant a cache miss held the salon's screen for up to
    // twelve seconds waiting on a government API — and it is what dragged the
    // unit tests onto the network, because planFor reaches this. A third party
    // must never be in the critical path of a page load; the team refreshes it
    // from the diagnostic when it needs refreshing.
    if (opts.allowFetch === false) {
      return cached.data?.ok
        ? { ...cached.data, lines: describeArea(cached.data), cachedAt: cached.at }
        : { ...blank, lines: [], error: 'Chưa lấy số liệu dân cư cho khu vực này. Bấm quét ở Super Admin để lấy lần đầu.' };
    }

    const r = await fetchCensus(zips, { apiKey: process.env.CENSUS_API_KEY || null });
    if (r.ok) {
      const value = { at: new Date().toISOString(), zips, data: r };
      if (row?.id) await this.prisma.setting.update({ where: { id: row.id }, data: { value: value as never } }).catch(() => undefined);
      else await this.prisma.setting.create({ data: { tenantId, key: KEY, value: value as never } }).catch(() => undefined);
    } else {
      this.logger.warn(`census failed for ${tenantId}: ${r.diagnostic ?? r.error}`);
      // Serve stale-but-real figures rather than nothing, and say they are old.
      if (cached.data?.ok) return { ...cached.data, lines: describeArea(cached.data), cachedAt: cached.at };
    }
    return { ...r, lines: describeArea(r) };
  }

  /**
   * Whether to advertise, where, when, and at what price it stops paying.
   *
   * Every figure traces to this salon's own book: the ceiling from its ticket
   * and margin, the run days from how far ahead its customers actually book,
   * the platform from where its bookings already arrive for free, the audiences
   * from its own segments. Nothing here forecasts bookings from a budget —
   * see ads-plan.ts for why that question is unanswerable and what replaces it.
   */
  private async adsFor(tenantId: string, ctx: Awaited<ReturnType<ContentService['gather']>>) {
    const regulars = ctx.audience.segments.find((s) => s.key === 'regular');
    const anySeg = ctx.audience.segments[0];
    const ceiling = cpaCeiling({
      avgTicketCents: anySeg?.avgTicketCents ?? null,
      grossMarginPct: ctx.promo.margin.grossMarginPct,
      medianGapDays: regulars?.medianGapDays ?? anySeg?.medianGapDays ?? null,
    });

    // Free capacity to aim at: how many appointments would fit in the quiet
    // blocks over a fortnight, at this salon's own average visit length. A
    // campaign that needs more customers than there are chairs cannot work, and
    // that is worth knowing before the money goes out rather than after.
    const quiet = ctx.revenue.loads.slice(0, 3);
    const peakMinutes = Math.max(...ctx.revenue.loads.map((l) => l.minutes), 0);
    const openSlots = peakMinutes > 0
      ? Math.max(0, Math.round(quiet.reduce((sum, q) => sum + (peakMinutes - q.minutes), 0) / 60) * 2)
      : null;

    const budget = budgetPlan({ ceiling, openSlots });
    const window = runWindow({
      quietWeekdays: quiet.map((q) => q.weekday),
      busyWeekdays: [...ctx.revenue.loads].reverse().slice(0, 2).map((l) => l.weekday),
      leadDays: ctx.lead.medianDays,
    });
    return {
      ceiling,
      budget,
      window,
      lead: ctx.lead,
      platform: platformPick(ctx.sourceCounts),
      audiences: adAudiences({
        lapsedCount: ctx.revenue.lapsed.count,
        customerCount: ctx.audience.totalCustomers,
        regularCount: regulars?.count ?? 0,
        city: ctx.region.city,
        region: ctx.region.region,
      }),
      money: {
        ceilingStrict: ceiling.strictCents !== null ? ctx.money(ceiling.strictCents) : null,
        ceilingRepeat: ceiling.withRepeatCents !== null ? ctx.money(ceiling.withRepeatCents) : null,
        daily: ctx.money(budget.dailyCents),
        total: ctx.money(budget.totalCents),
      },
    };
  }

  /** Local SEO, scored from real reviews and real search terms. */
  private async seoFor(tenantId: string, ctx: Awaited<ReturnType<ContentService['gather']>>) {
    type ReviewRow = { starRating: number; createdAt: Date; reviewCreatedAt: Date | null; repliedAt: Date | null };
    // Reached by name: googleReview exists on the deploy machine's Prisma
    // client and not on the one this was written against, so a typed access
    // compiles in exactly one of the two places.
    const loose = this.prisma as unknown as Record<string, { findMany: (a: unknown) => Promise<unknown> }>;
    const reviewsRaw = await loose.googleReview?.findMany({
      where: { tenantId },
      select: { starRating: true, createdAt: true, reviewCreatedAt: true, repliedAt: true },
      take: 500,
    }).catch(() => []);
    const reviews: ReviewRow[] = Array.isArray(reviewsRaw) ? (reviewsRaw as ReviewRow[]) : [];

    const services = await this.prisma.service.findMany({
      where: { tenantId, isActive: true }, select: { name: true }, take: 40,
    }).catch(() => []) as { name: string }[];

    return buildSeoReport({
      // Google's own timestamp when we have it: createdAt is when WE synced the
      // row, which would make every review look brand new on first import.
      reviews: reviews.map((r) => ({
        starRating: r.starRating,
        createdAt: (r.reviewCreatedAt ?? r.createdAt).getTime(),
        repliedAt: r.repliedAt?.getTime() ?? null,
      })),
      keywords: ctx.signals.keywords.map((k) => ({ keyword: k.keyword, count: k.count })),
      services,
      sources: ctx.sourceCounts,
      city: ctx.region.city,
      region: ctx.region.region,
    });
  }

  /**
   * Fill in what the business is, by reading what it already published.
   *
   * The form asking an owner to type six fields was the wrong answer to a real
   * problem: the business had already said all of this on its own website and
   * its own Facebook page, and both were already connected to this platform.
   * Asking again is asking someone to re-enter data we hold.
   *
   * It DRAFTS, it does not save. Everything downstream — the content, the ad
   * targeting, what the hotline tells a customer — is derived from these
   * sentences, so a model's reading of a marketing page is a proposal for a
   * person to correct, never a fact to act on. The draft comes back with the
   * source named, so the reviewer can see where each line came from.
   */
  async scanProfile(user: AuthenticatedUser, opts: { note?: string } = {}): Promise<{
    draft: Record<string, string>; sources: string[]; warnings: string[];
    saved: boolean; locationSaved: string | null;
  }> {
    const tenantId = this.tenantId(user);
    const note = String(opts.note ?? '').trim().slice(0, 1000);
    const warnings: string[] = [];
    const sources: string[] = [];
    const chunks: string[] = [];

    const extra = await this.prisma.setting.findFirst({ where: { tenantId, key: 'company_extra' }, select: { value: true } }).catch(() => null);
    const website = String(((extra?.value ?? {}) as { website?: string }).website ?? '').trim();

    if (website) {
      try {
        const r = await readWebsite(website);
        chunks.push(`--- ${r.source} ---\n${r.text}`);
        sources.push(r.source);
      } catch (e) {
        warnings.push(e instanceof SiteReadError ? e.message : 'Không đọc được website.');
      }
    } else {
      warnings.push('Chưa có địa chỉ website trong phần cài đặt tiệm.');
    }

    const loose = this.prisma as unknown as Record<string, { findUnique?: (a: unknown) => Promise<unknown>; findFirst?: (a: unknown) => Promise<unknown> }>;
    const conn = await loose.messengerConnection?.findUnique?.({ where: { tenantId } }).catch(() => null) as { pageId?: string | null; pageToken?: string | null } | null;
    const pg = await loose.messengerPage?.findFirst?.({ where: { tenantId }, orderBy: { createdAt: 'asc' } }).catch(() => null) as { pageId?: string | null; pageToken?: string | null } | null;
    const page = conn?.pageId && conn?.pageToken ? conn : pg?.pageId && pg?.pageToken ? pg : null;
    if (page?.pageId && page?.pageToken) {
      try {
        const r = await readFacebookPage(page.pageId, page.pageToken);
        chunks.push(`--- ${r.source} ---\n${r.text}`);
        sources.push(r.source);
      } catch (e) {
        const raw = e instanceof SiteReadError ? e.message : 'Không đọc được fanpage.';
        // Meta's permission errors are three lines of documentation links. The
        // salon cannot act on those; the agency can, and only needs one line.
        warnings.push(/permission|pages_read|Public Content Access/i.test(raw)
          ? 'Fanpage chưa cấp quyền đọc nội dung cho ứng dụng — cần duyệt quyền pages_read_engagement bên Meta. Đã bỏ qua fanpage và dùng các nguồn còn lại.'
          : raw);
      }
    } else {
      warnings.push('Chưa kết nối Facebook Page.');
    }

    // The salon's own service list, which is a fact rather than a claim.
    const services = await this.prisma.service.findMany({
      where: { tenantId, isActive: true }, select: { name: true, description: true }, take: 40,
    }).catch(() => []) as { name: string; description: string | null }[];
    if (services.length) {
      chunks.push(`--- Dịch vụ đã khai trong hệ thống ---\n${services.map((s) => `${s.name}${s.description ? `: ${s.description}` : ''}`).join('\n')}`);
      sources.push(`${services.length} dịch vụ trong hệ thống`);
    }

    if (!chunks.length) {
      return {
        draft: {}, sources, saved: false, locationSaved: null,
        warnings: [...warnings, 'Không có nguồn nào đọc được — thêm website vào cài đặt tiệm rồi quét lại.'],
      };
    }

    const key = process.env.ANTHROPIC_API_KEY || '';
    if (!key) return { draft: {}, sources, saved: false, locationSaved: null, warnings: [...warnings, 'Chưa cấu hình AI trên bản này nên chưa tự đọc được.'] };

    const system = `Bạn đọc tài liệu của một doanh nghiệp và điền một hồ sơ ngắn về chính doanh nghiệp đó.

LUẬT:
1. CHỈ dùng những gì có trong tài liệu. Không suy đoán, không thêm thắt cho đầy đủ.
2. Ô nào tài liệu không nói tới thì để CHUỖI RỖNG. Một ô trống trung thực có ích hơn một câu nghe hợp lý mà sai.
3. Phân biệt DOANH NGHIỆP NÀY với KHÁCH HÀNG CỦA HỌ. Một công ty marketing phục vụ tiệm nail KHÔNG PHẢI là tiệm nail — đây là nhầm lẫn nguy hiểm nhất, hãy đọc kỹ.
4. "whoWeServe" chỉ điền khi tài liệu nói rõ họ phục vụ ai. Không suy ra từ ngôn ngữ trang web hay từ tên.
5. Viết tiếng Việt, ngắn gọn, mỗi ô 1-2 câu.

TRẢ VỀ JSON THUẦN:
{"whatWeDo":"...","whoWeServe":"...","languages":"...","serviceArea":"...","edge":"...","avoid":""}`;

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_AGENT_MODEL || 'claude-haiku-4-5-20251001',
        max_tokens: 1200,
        system,
        messages: [{ role: 'user', content: chunks.join('\n\n').slice(0, 30_000) }],
      }),
      signal: AbortSignal.timeout(45_000),
    }).catch(() => null);

    if (!res || !res.ok) {
      return { draft: {}, sources, saved: false, locationSaved: null, warnings: [...warnings, 'Đọc được nội dung nhưng AI chưa phân tích được. Thử lại sau ít phút.'] };
    }
    const data = (await res.json().catch(() => ({}))) as { content?: { type?: string; text?: string }[] };
    const text = (data.content || []).filter((c) => c.type === 'text').map((c) => c.text || '').join('').trim();
    const braced = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
    let parsed: Record<string, unknown> = {};
    try { parsed = JSON.parse(braced) as Record<string, unknown>; } catch { /* handled below */ }

    const FIELDS = ['whatWeDo', 'whoWeServe', 'languages', 'serviceArea', 'edge', 'avoid'];
    const draft: Record<string, string> = {};
    for (const f of FIELDS) {
      const v = parsed[f];
      draft[f] = typeof v === 'string' ? v.trim().slice(0, 600) : '';
    }
    if (!draft.whatWeDo) {
      warnings.push('Đọc được nguồn nhưng chưa rút ra được mô tả rõ ràng — kiểm tra lại và sửa tay.');
      return { draft, sources, warnings, saved: false, locationSaved: null };
    }

    // The operator's note is authoritative and goes in verbatim.
    //
    // It is the one field a machine cannot produce: it exists to say the thing
    // the website does not, or to correct what the website implies. Appending
    // rather than replacing means a note like "đây KHÔNG phải tiệm nail" sits
    // permanently above the scanned description instead of being overwritten by
    // the next scan.
    if (note) draft.avoid = [draft.avoid, note].filter(Boolean).join(' — ');

    // Saved, not proposed.
    //
    // Asking someone to review six fields they never wrote, every time, is the
    // manual step this was built to remove. What protects the salon instead is
    // that a person's own words are never overwritten: the merge below keeps
    // anything already stored and fills only the blanks.
    const cur = (await this.prisma.setting.findFirst({ where: { tenantId, key: 'business_profile' }, select: { value: true } })
      .catch(() => null))?.value as Record<string, string> | null;
    const merged: Record<string, string> = { ...draft };
    for (const [k, v] of Object.entries(cur ?? {})) {
      if (typeof v === 'string' && v.trim() && k !== 'avoid') merged[k] = v;
    }
    if (cur?.avoid && !merged.avoid.includes(cur.avoid)) {
      merged.avoid = [cur.avoid, merged.avoid].filter(Boolean).join(' — ');
    }
    const row = await this.prisma.setting.findFirst({ where: { tenantId, key: 'business_profile' }, select: { id: true } }).catch(() => null);
    if (row?.id) await this.prisma.setting.update({ where: { id: row.id }, data: { value: merged as never } }).catch(() => undefined);
    else await this.prisma.setting.create({ data: { tenantId, key: 'business_profile', value: merged as never } }).catch(() => undefined);

    // While we are here: the address is in the same sources, and an empty
    // city/state is what makes every calendar fall back to nationwide dates.
    // Filled only when blank — a location someone typed by hand outranks one
    // parsed out of a marketing page.
    let locationSaved: string | null = null;
    const t = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { city: true, region: true, postalCode: true, market: true } as never,
    }).catch(() => null) as unknown as { city?: string | null; region?: string | null; postalCode?: string | null; market?: string | null } | null;
    if (t && !t.region) {
      const addr = String(((extra?.value ?? {}) as { address?: string }).address ?? '');
      const fromArea = parseAddress(`${draft.serviceArea} ${addr}`, t.market === 'VN' ? 'VN' : t.market === 'CA' ? 'CA' : 'US');
      if (fromArea.region) {
        await this.prisma.tenant.update({
          where: { id: tenantId },
          data: {
            city: t.city || fromArea.city || null,
            region: fromArea.region,
            postalCode: t.postalCode || fromArea.postalCode || null,
          } as never,
        }).catch(() => undefined);
        locationSaved = [fromArea.city, fromArea.region].filter(Boolean).join(', ');
      }
    }

    return { draft: merged, sources, warnings, saved: true, locationSaved };
  }

  /** The salon marks progress: filmed, posted, or honestly skipped. */
  async setIdeaStatus(user: AuthenticatedUser, id: string, status: string, resultNote?: string) {
    const tenantId = this.tenantId(user);
    const ALLOWED = ['published', 'filmed', 'posted', 'skipped'];
    if (!ALLOWED.includes(status)) throw new BadRequestException('Trạng thái không hợp lệ');
    const done = status === 'posted' || status === 'filmed';
    const r = await this.prisma.contentIdea.updateMany({
      where: { id, tenantId },
      data: { status, doneAt: done ? new Date() : null, ...(resultNote ? { resultNote: resultNote.slice(0, 500) } : {}) },
    });
    if (!r.count) throw new NotFoundException('Không tìm thấy ý tưởng');
    return { ok: true, status };
  }
}
