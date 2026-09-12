import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { dueForRelease, localHourIn } from './auto-release';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { UserRole } from '@prisma/client';
import { AuthenticatedUser, resolveTenantScope } from '../common/tenant/tenant-context';
import { formatMoneyShort, localeForCountry } from '../common/money';
import { marketOf } from '../common/markets';
import { bookingChannel, PLATFORM_OF } from '../common/booking-channel';
import { channelReports, platformPlans, CAMPAIGN_DAYS, type ChannelBooking } from './channel-plan';
import { topQuestions, type TopicData, type TurnLike } from './week-topics';
import { CAPTION_RULES, REASON_RULES, SHOTLIST_RULES, captionIssues } from './caption-style';
import { evidenceForDay, autoDone, type AutoKey, type PostEvidence } from './auto-ticks';
import { buildCampaignSpec } from './campaign-spec';
import { buildSignalProfile, signalsToPrompt, SignalProfile } from './content-signals';
import { applyCapToOffer, buildRevenueProfile, revenueToPrompt, RevenueProfile } from './revenue-signals';
import { regionEvents, eventsToPrompt, type ResolvedRegion, type DatedEvent } from './region-events';
import { resolveShopLocation, type ResolvedShopLocation } from './shop-location';
import { trendLinks, trendLinksToPrompt } from './trend-sources';
import { buildWeekPlan, weekPlanToPrompt } from './weekly-plan';
import { estimateTicket, isEstimate } from './ticket-estimate';
import { assessSalon, adsAim } from './salon-assessment';
import { adCapacity, isFull, openMinutesPerWeek, openDaysPerWeek } from './ad-capacity';
import { SHOP } from './client-view';
import { pickAdServices } from './ad-service';
import type { BankContext } from './no-media-content';
import { dueReviews, nextReview, reviewReport, reviewJobText, type Campaign } from './ads-review';
import { pickStage, weekIndex } from './roadmap';
import { weekKey, weekStart, isPastWeek, weekLabel } from './week-key';
import { seasonFor, seasonToPrompt, pillarFor, pillarToPrompt, trendsToPrompt, type TrendForPrompt, type RisingForPrompt } from './season-pillars';
import { scopeOf, knownTrades } from './trends/trend-feed';
import { tradeKeywordsFor, fillKeyword } from './trends/trade-keywords';
import { buildRoadmap, manualTaskIds, asTier, type Tier } from './seo-roadmap';
import { buildOnboardingReport } from './onboarding-report';

/** Where one salon's roadmap ticks live. JSON per tenant — adding a task needs
 *  no migration, and an id that disappears simply stops being read. */
/**
 * The agreed ad campaign, and the reviews it owes.
 *
 * The pitch card promises a review on day 7 and day 14 and a message with
 * three numbers in it. Nothing recorded that a campaign existed, so nothing
 * could be due, so nothing ever was. This row is the smallest thing that makes
 * the promise checkable: what was agreed, when it went live, and which reviews
 * have actually been sent.
 */
const ADS_CAMPAIGN_KEY = 'ads_campaign';

const SEO_ROADMAP_KEY = 'seo_roadmap';
const PROFILE_SCAN_KEY = 'profile_scan';
/** Attempts before a shop nothing can be read about is left alone. */
const SCAN_TRIES = 3;
const SCAN_RETRY_DAYS = 7;

/**
 * The menu, with how often each item was actually booked.
 *
 * `menu` carries the money (price, duration) and `signals.services` carries the
 * demand (a count per service name over the last 30 days) — and until now the ad
 * plan only ever read the first. That is how a five-minute chin wax, top of the
 * per-chair-hour table and booked by nobody, became the service the card told a
 * salon to advertise. Joined on the name, both halves reach pickAdServices.
 */
const menuWithBookings = (
  menu: { name: string; priceCents: number; durationMinutes: number }[],
  counts: { name: string; count: number }[],
) => {
  const seen = new Map<string, number>();
  for (const c of counts ?? []) {
    const k = String(c?.name ?? '').trim().toLowerCase();
    if (k) seen.set(k, (seen.get(k) ?? 0) + (c.count ?? 0));
  }
  return (menu ?? []).map((m) => ({
    name: m.name,
    priceCents: m.priceCents,
    durationMinutes: m.durationMinutes,
    bookings: seen.get(String(m.name ?? '').trim().toLowerCase()) ?? 0,
  }));
};
import { addDaysToKey, wallTimeToUtcTz as wallTimeToUtc } from '../common/salon-time';
import { buildWeekOutcome, describeOutcome, describeDelta, type WeekOutcome } from './week-outcome';
import { videoFeeds, productWatch, playbookFor } from './industry-playbook';
import { detectIndustry, pickTrade } from './industry-detect';
import {
  TRADE_PROFILE_KEY, cleanTradeProfile, playbookOf, feedsOf, profileFingerprint, tradeProfilePrompt, wantsTradeProfile,
  type TradeProfile,
} from './trade-profile';
import type { Playbook } from './industry-playbook';
import { buildAudienceProfile, audienceToPrompt, type VisitRow, type AudienceProfile } from './audience-signals';
import { promoAdvice, promoToPrompt, capAdvice, type PromoAdvice } from './promo-playbook';
import { fetchCensus, describeArea, normaliseZips, type CensusResult } from './census';
import { fetchAreaAudience, type AreaAudience } from './census-audience';
import { buildMarketPlan } from './market-target';
import { leadTime, cpaCeiling, budgetPlan, runWindow, adAudiences } from './ads-plan';
import { adsCalendar } from './ads-calendar';
import { adsReceipt, type AdsReceipt } from './ads-receipt';
import { adsPitch, type AdsPitch } from './ads-pitch';
import { PlacesService } from './places.service';
import { buildSeoReport } from './seo-local';
import { resolveIdentity, identityToPrompt, type ResolvedIdentity } from './business-profile';
import { readWebsite, readFacebookPage, SiteReadError } from '../common/site-reader';
import { buildStrategyBrief } from './strategy-brief';
import { bi, localizeDeep, viOf, enOf, type Txt } from './i18n';
import { sanitizeDays } from './week-edit';
import { shopPatchToDays, type ShopWeekPatch } from './shop-week-edit';
import { holidayIdeas, ideaAsRequest, type HolidayIdea } from './holiday-offers';
import { hasAgencyWork } from './agency-work';
import { parseOffer, DEFAULT_OFFER, type WeekOffer } from './week-offer';
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
    private readonly places: PlacesService,
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
    /** 'vi' | 'en' | null — null means "decide from the market", the old default. */
    contentLang: string | null;
    industry: string;
    /** The playbook this business runs on: its own (see trade-profile) or the trade's built-in. */
    playbook: Playbook;
    /** Its own profile when it has one — null for every trade with a real built-in playbook. */
    tradeProfile: TradeProfile | null;
    city: string;
    /** ISO code the salon bills in ('USD', 'VND'). */
    currency: string;
    /** The offer form for this salon. */
    offer: WeekOffer;
    tz: string;
    region: ResolvedRegion;
    /** Where the region came from, so the screen can name its own source. */
    loc: ResolvedShopLocation;
    events: DatedEvent[];
    signals: SignalProfile;
    revenue: RevenueProfile;
    audience: AudienceProfile;
    promo: PromoAdvice;
    identity: ResolvedIdentity;
    nearbyZips: string | null;
    sourceCounts: Record<string, number>;
    /** Every booking reduced to the facts a channel verdict rests on. */
    channelBookings: ChannelBooking[];
    /** What a genuinely new customer pays on the first visit. */
    firstVisitTicketCents: number | null;
    /** Minutes an average appointment takes here, from the service list. */
    avgServiceMinutes: number | null;
    /**
     * How many people can serve a customer at the same time, and how many
     * minutes a week the salon is open.
     *
     * Both are on file from the day a salon is set up — before one appointment
     * exists. They are here because free capacity used to be derived entirely
     * from booking history, which is the one source guaranteed to be empty for
     * a new client, and the answer it gave for an empty salon was "no room".
     * See ./ad-capacity.
     */
    chairs: number | null;
    openMinutesPerWeek: number | null;
    openDaysPerWeek: number | null;
    /** The salon's website, when it has one. A source the assessment reads. */
    website: string | null;
    /**
     * The salon's OWN price list, with prices and durations.
     *
     * `signals.services` next to it is a popularity count and carries no money,
     * which is why the ad budget could not read it. This is the menu itself —
     * the only statement about what a visit costs that exists before a single
     * appointment has been booked here.
     */
    menu: { name: string; priceCents: number; durationMinutes: number }[];
    lead: ReturnType<typeof leadTime>;
    money: (c: number) => string;
  }> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      // city/region/postalCode may be absent on a database that has not run the
      // location migration yet; the catch below keeps the whole engine alive
      // rather than blanking a salon's screen over a missing column.
      select: { name: true, timezone: true, businessType: true, market: true, city: true, region: true, postalCode: true, commissionPct: true, nearbyZips: true, contentLang: true },
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
    // The trade the business DECLARED, one level finer than the enum, and the
    // same order of authority as every other field on that profile: declared
    // first, enum last. An unknown or empty value falls back to the enum, so
    // this can never make the industry worse than it was — only sharper.
    const declaredTrade = String((profileRow?.value as { trade?: string } | null)?.trade ?? '').toUpperCase();
    const industry = knownTrades().includes(declaredTrade)
      ? declaredTrade
      : String((tenant as { businessType?: string } | null)?.businessType ?? 'SALON');
    // A business outside the built-in trades runs on a playbook written for
    // it (trade-profile.ts). Only the catch-all trade reads it: a person who
    // chose RESTAURANT gets the restaurant book, whatever the scan wrote.
    const tradeProfile = wantsTradeProfile(industry)
      ? cleanTradeProfile((await this.prisma.setting.findFirst({ where: { tenantId, key: TRADE_PROFILE_KEY }, select: { value: true } }).catch(() => null))?.value)
      : null;
    const playbook = tradeProfile ? playbookOf(tradeProfile) : playbookFor(industry);

    const ex = (extra?.value ?? {}) as { address?: string; country?: string };
    const locale = localeForCountry(ex.country ?? '', tz);
    // The salon's own currency, not USD.
    //
    // Every money figure on this screen was formatted as US dollars regardless
    // of market. On the Vietnam deployment that is wrong twice over: the symbol
    // is wrong, and USD carries two decimal places while the dong carries none
    // — so a 200,000₫ manicure printed as $2,000.00. Order of authority: what
    // the salon set in its booking rules, then its market's default.
    const rules = await this.prisma.setting.findFirst({
      where: { tenantId, key: 'booking_rules' }, select: { value: true },
    }).catch(() => null);
    const currency = String((rules?.value as { currency?: string } | null)?.currency || '').trim().toUpperCase()
      || marketOf((tenant as { market?: string } | null)?.market).currency;
    const money = (c: number) => formatMoneyShort(c, currency, locale);

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
      source: string | null; utmSource: string | null; attrReferrer: string | null;
      attrLandingUrl: string | null;
      service: { name: string } | null;
    };
    const history: HistRow[] = await this.prisma.appointment.findMany({
      // Walk-ins with no customer record are dropped below in JS rather than in
      // the query: `customerId: { not: null }` types differently across Prisma
      // client versions, and this filter is not worth a build that only fails
      // on the deploy machine.
      where: { tenantId, startTime: { gte: d365 }, status: { notIn: ['CANCELLED', 'NO_SHOW'] } as never },
      select: {
        startTime: true, createdAt: true, priceCents: true, customerId: true,
        // THREE columns, because each one can be the only evidence there is.
        //
        // utm is present only once the salon has pasted the /gbp link into its
        // Google profile. attrReferrer is empty for most Google Maps traffic —
        // the Maps app opens the link in an in-app browser, where there is no
        // document.referrer at all. attrLandingUrl still ends in /gbp whatever
        // else failed, which is why it was added: see fromLanding in
        // common/booking-channel.ts. Leaving any of them out of the query is
        // what made Google bookings land in "nguồn chưa rõ" and vanish.
        source: true, utmSource: true, attrReferrer: true, attrLandingUrl: true,
        service: { select: { name: true } },
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

    // Where bookings come from, resolved the SAME way the calendar resolves it.
    //
    // This used to be `utmSource || source`, which is the attribution rule
    // backwards — a Messenger booking carrying a stray utm was filed under the
    // utm — and it emitted raw keys ('plugin', 'hosted', 'admin') that the ads
    // engine then looked for under invented names ('google', 'gbp', 'organic').
    // The result was a channel report that could not see Google Maps at all.
    const channels = history.map((h) => bookingChannel({
      source: h.source, utmSource: h.utmSource, attrReferrer: h.attrReferrer,
      attrLandingUrl: h.attrLandingUrl,
    }));
    const sourceCounts: Record<string, number> = {};
    for (const c of channels) sourceCounts[c] = (sourceCounts[c] ?? 0) + 1;

    // First-ever visit per customer, and how many times they have been since.
    // This is what separates a channel that FINDS customers from one that is
    // merely where the regulars rebook — the distinction the whole ads tab
    // turns on, and it costs one pass over rows already in memory.
    const firstVisitAt = new Map<string, number>();
    const visitCount = new Map<string, number>();
    for (const h of history) {
      if (!h.customerId) continue;
      const id = String(h.customerId);
      const t = h.startTime.getTime();
      firstVisitAt.set(id, Math.min(firstVisitAt.get(id) ?? t, t));
      visitCount.set(id, (visitCount.get(id) ?? 0) + 1);
    }
    const channelBookings: ChannelBooking[] = history.map((h, i) => {
      const id = h.customerId ? String(h.customerId) : null;
      return {
        channel: channels[i],
        at: h.startTime.getTime(),
        priceCents: h.priceCents ?? 0,
        customerId: id,
        isFirstVisit: Boolean(id) && firstVisitAt.get(id as string) === h.startTime.getTime(),
        customerVisits: id ? (visitCount.get(id) ?? 1) : 1,
      };
    });

    // What a genuinely NEW customer pays on the first visit.
    //
    // The CPA ceiling was being taken from `segments[0]` — the largest segment
    // by head count, whichever that happens to be. When the largest group is
    // "khách quen" (a higher ticket than a first-timer), the ceiling inflates
    // and the salon is told it may pay more for a new customer than a new
    // customer is worth. Ads buy first visits, so the ceiling must be built on
    // what a first visit is actually worth here.
    const firstTickets = channelBookings.filter((b) => b.isFirstVisit && b.priceCents > 0).map((b) => b.priceCents);
    const firstVisitTicketCents = firstTickets.length >= 5
      ? Math.round(firstTickets.reduce((a, b) => a + b, 0) / firstTickets.length)
      : null;
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

    // Where this salon is, from what the salon itself already holds: its own
    // record, the address in its settings, the service area the scan read off
    // its website, and finally the ZIP — which pins the state on its own.
    // Nothing here waits on our staff typing anything, because a tenant whose
    // calendar depends on Super Admin has no calendar on its first day.
    const t = (tenant ?? {}) as { market?: string; city?: string | null; region?: string | null };
    const loc = resolveShopLocation({
      market: t.market ?? ex.country,
      tenantCity: t.city,
      tenantRegion: t.region,
      tenantPostal: (tenant as { postalCode?: string | null } | null)?.postalCode,
      nearbyZips: (tenant as { nearbyZips?: string | null } | null)?.nearbyZips,
      address: ex.address,
      serviceArea: (profileRow?.value as { serviceArea?: string } | null)?.serviceArea,
    });
    const identity = resolveIdentity({
      declared: (profileRow?.value ?? null) as Record<string, string> | null,
      bizIntro: conn?.bizIntro ?? null,
      aiInstruction: conn?.aiInstruction ?? null,
      website: (ex as { website?: string }).website ?? null,
      tenantName: tenant?.name ?? null,
      serviceNames: services.map((s2) => s2.name),
      city: loc.city,
      region: loc.region,
      industry,
    });

    const { region, events } = regionEvents(now, {
      market: t.market ?? ex.country ?? 'US',
      city: loc.city,
      region: loc.region,
    }, { horizonDays: 45 });

    // The commission rate the shop is already paying, from the staff records it
    // set up for payroll. Nobody types it twice, and it is a measurement rather
    // than an estimate: these are the rates going out every week.
    const staffRows = await this.prisma.staffMember.findMany({
      where: { tenantId, isActive: true },
      select: { commissionPercent: true } as never,
      take: 100,
    }).catch(() => []) as unknown as { commissionPercent?: number | null }[];
    // Anybody active can take a customer; how many of them there are is the
    // other half of "how many visits could this salon absorb". Zero is read as
    // "not set up yet", never as "no capacity" — see ./ad-capacity.
    const chairs = staffRows.length || null;
    // The salon's own opening hours, from the booking rules it set up.
    const hoursRow = await this.prisma.setting.findFirst({
      where: { tenantId, key: 'booking_rules' }, select: { value: true },
    }).catch(() => null);
    const businessHours = (hoursRow?.value as { businessHours?: unknown } | null)?.businessHours as never;
    const openWeek = openMinutesPerWeek(businessHours);
    const openDays = openDaysPerWeek(businessHours);
    const rates = staffRows.map((r) => Number(r.commissionPercent ?? 0)).filter((n) => n > 0 && n < 100);
    const staffAvgPct = rates.length ? Math.round(rates.reduce((a, b) => a + b, 0) / rates.length) : null;

    const revenue = buildRevenueProfile({ bookings: bookingRows, customers, services });
    const promo = promoAdvice({
      industry,
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
    //
    // capAdvice corrects the advice by mutating plain strings; the offer advice
    // carries both languages now (see ./i18n), so it caps a Vietnamese view of
    // it and applyCapToOffer folds what changed back onto the advice itself.
    // Dropping the view would leave the uncapped discount on the screen — the
    // exact failure capAdvice exists to prevent.
    //
    // `appended` is the one sentence capAdvice writes, in both languages, so
    // the English detail line ends with the English explanation of the cut.
    const capView = {
      kind: revenue.advice.kind,
      discountPct: revenue.advice.discountPct,
      headline: viOf(revenue.advice.headline),
      detail: viOf(revenue.advice.detail),
    };
    const capped = capAdvice(capView, promo);
    applyCapToOffer(revenue.advice, { ...capView, appended: capped.appended }, promo.margin.grossMarginPct);

    // The offer the team set for this salon, if any. Read here so the week
    // and the screen are built from one read.
    const offerRow = await this.prisma.setting.findFirst({ where: { tenantId, key: 'content_offer' }, select: { value: true } }).catch(() => null);
    const offer: WeekOffer = offerRow?.value ? { ...parseOffer(offerRow.value), ...pickMeta(offerRow.value) } : { ...DEFAULT_OFFER };

    return {
      tenantName: tenant?.name || 'Tiệm',
      contentLang: (tenant as { contentLang?: string | null } | null)?.contentLang ?? null,
      industry,
      playbook,
      tradeProfile,
      city: region.label,
      currency,
      offer,
      tz,
      region,
      loc,
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
      channelBookings,
      firstVisitTicketCents,
      // How long an appointment takes HERE. The capacity estimate used to
      // assume two per hour for every business on the platform, while the
      // salon's own service list has been sitting right there with the real
      // durations in it.
      avgServiceMinutes: services.length
        ? Math.max(15, Math.round(services.reduce((s2, x) => s2 + (x.durationMinutes || 0), 0) / services.length))
        : null,
      chairs,
      openMinutesPerWeek: openWeek,
      openDaysPerWeek: openDays,
      menu: services,
      website: (ex as { website?: string }).website ?? null,
      lead,
      // ZIPs, in order of authority, and never asked for twice: the field
      // someone filled, the extra ZIPs the team added, then the one the shop's
      // own address or service area yielded. All of it has been on file since
      // setup — asking for the ZIP separately was asking for data we hold.
      nearbyZips: [
        (tenant as { postalCode?: string | null } | null)?.postalCode ?? '',
        (tenant as { nearbyZips?: string | null } | null)?.nearbyZips ?? '',
        loc.postalCode ?? '',
      ].filter(Boolean).join(',') || null,
    };
  }


  /**
   * This week's plan, including where the shop stands on its own path.
   *
   * Shared by the generator and the screen ON PURPOSE. They used to build the
   * week separately from the same inputs, which was fine only for as long as
   * the inputs stayed identical — and the moment the roadmap was added, the
   * daily ideas would have been written against a different week than the one
   * on screen. One plan, two readers.
   */
  private async weekPlanFor(tenantId: string, ctx: Awaited<ReturnType<ContentService['gather']>>) {
    const loose = this.prisma as unknown as Record<string, {
      count?: (a: unknown) => Promise<number>;
      findFirst?: (a: unknown) => Promise<unknown>;
    }>;
    // Last week's archived outcome — the plan reads its own scorecard before
    // deciding how heavy this week should be.
    const thisWeekKey = weekKey(new Date(), ctx.tz);
    const lastWeekRow = await loose.contentWeek?.findFirst?.({
      where: { tenantId, weekKey: { not: thisWeekKey }, outcome: { not: null } } as never,
      orderBy: { startDate: 'desc' },
      select: { outcome: true },
    } as never).catch(() => null) ?? null;
    const lastOutcome = (lastWeekRow as { outcome?: { plannedJobs?: number; doneJobs?: number; posted?: number } | null } | null)?.outcome ?? null;
    const [reviewCount, postedLast30, firstIdea] = await Promise.all([
      loose.googleReview?.count?.({ where: { tenantId } }).catch(() => null) ?? Promise.resolve(null),
      loose.contentIdea?.count?.({
        where: {
          tenantId,
          status: { in: ['posted', 'filmed'] },
          doneAt: { gte: new Date(Date.now() - 30 * 86_400_000) },
        },
      } as never).catch(() => 0) ?? Promise.resolve(0),
      loose.contentIdea?.findFirst?.({
        where: { tenantId }, orderBy: { createdAt: 'asc' }, select: { createdAt: true },
      } as never).catch(() => null) ?? Promise.resolve(null),
    ]);

    // 'online' is a booking with no channel on it — see common/booking-channel.
    const attributed = Object.entries(ctx.sourceCounts)
      .filter(([k]) => k !== 'online')
      .reduce((n, [, v]) => n + v, 0);

    const stage = pickStage({
      reviewCount: typeof reviewCount === 'number' ? reviewCount : null,
      postedLast30: typeof postedLast30 === 'number' ? postedLast30 : 0,
      lapsedCount: ctx.revenue.lapsed.count,
      customerCount: ctx.audience.totalCustomers,
      hasQuietSlot: ctx.revenue.advice?.kind === 'fill-slot',
      marginKnown: ctx.promo.margin.grossMarginPct !== null,
      attributedBookings: attributed,
    });

    return buildWeekPlan({
      today: new Date(),
      todayWeekday: this.localWeekday(ctx.tz),
      industry: ctx.industry,
      playbook: ctx.playbook,
      topics: await this.topicsFor(tenantId, ctx),
      loads: ctx.revenue.loads,
      advice: ctx.revenue.advice,
      lapsed: ctx.revenue.lapsed,
      events: ctx.events,
      stage,
      week: weekIndex((firstIdea as { createdAt?: Date } | null)?.createdAt ?? null, new Date()),
      lastWeek: lastOutcome && typeof lastOutcome.plannedJobs === 'number'
        ? { planned: lastOutcome.plannedJobs, done: lastOutcome.doneJobs ?? 0, posted: lastOutcome.posted ?? 0 }
        : null,
      offer: ctx.offer,
      salonName: ctx.tenantName,
      city: ctx.city,
      currency: currencySign(ctx.currency),
      // The week's floor: work built from what we already hold, so a week the
      // shop sends nothing still ships something. See ./no-media-content.
      bank: await this.bankFor(tenantId, ctx).catch(() => null),
    });
  }

  /**
   * EVERYTHING WE ALREADY HAVE ON A MONDAY MORNING.
   *
   * Three cheap reads and no network: how much media this salon has ever sent,
   * its best Google reviews, and its own price list. None of it needs the shop
   * to do anything, which is the whole point — a remote agency cannot make
   * footage appear, and a plan that stalls without it stalls often.
   */
  private async bankFor(tenantId: string, ctx: Awaited<ReturnType<ContentService['gather']>>): Promise<BankContext> {
    const loose = this.prisma as unknown as Record<string, {
      count?: (a: unknown) => Promise<number>;
      findMany?: (a: unknown) => Promise<unknown[]>;
    }>;
    const [bankItems, reviewRows] = await Promise.all([
      loose.contentSuggestion?.count?.({ where: { tenantId, createdByName: SHOP } }).catch(() => 0) ?? Promise.resolve(0),
      loose.googleReview?.findMany?.({
        where: { tenantId, starRating: 5 },
        select: { starRating: true, comment: true, reviewerName: true },
        orderBy: { reviewCreatedAt: 'desc' },
        take: 20,
      }).catch(() => []) ?? Promise.resolve([]),
    ]);
    const reviews = (reviewRows as { starRating?: number; comment?: string | null; reviewerName?: string | null }[])
      .map((r) => ({ stars: Number(r.starRating ?? 0), text: String(r.comment ?? ''), author: r.reviewerName ?? null }))
      .filter((r) => r.text.trim().length >= 40);
    return {
      bankItems: Number(bankItems) || 0,
      reviews,
      menu: (ctx.menu ?? []).map((m) => ({ name: m.name, priceCents: m.priceCents })),
      city: ctx.region.city,
      week: 0,
    };
  }

  /**
   * The shop's own numbers, in the shape a post subject is made from.
   *
   * Three sources, all already on hand or one cheap read away: the bookings
   * (most booked, fastest rising), the price list (best earner per hour), and
   * the Messenger inbox — the only place customers' questions exist in their
   * own words. Nothing here is estimated; a source that is empty stays empty
   * and the subject says the shop chooses. See ./week-topics.
   */
  private async topicsFor(tenantId: string, ctx: Awaited<ReturnType<ContentService['gather']>>): Promise<TopicData> {
    const services = ctx.signals.services ?? [];
    const top = [...services].sort((a, b) => b.count - a.count)[0] ?? null;
    const rising = services
      .filter((sv) => sv.trend === 'up' && typeof sv.pct === 'number' && sv.count >= 3)
      .sort((a, b) => (b.pct ?? 0) - (a.pct ?? 0))[0] ?? null;
    const yields = ctx.revenue.yields ?? [];
    const best = yields.filter((y) => y.minutes > 0).sort((a, b) => b.perHourCents - a.perHourCents)[0] ?? null;

    // Recent threads only, and only their turns: enough to hear what is being
    // asked this season without reading a year of chat on every plan build.
    const threads = await this.prisma.messengerThread.findMany({
      where: { tenantId },
      orderBy: { updatedAt: 'desc' },
      take: 80,
      select: { history: true },
    }).catch(() => []) as { history: unknown }[];
    const question = topQuestions(threads.map((t) => (Array.isArray(t.history) ? t.history : []) as TurnLike[]))[0] ?? null;

    return {
      mostBooked: top ? { name: top.name, count: top.count } : null,
      rising: rising ? { name: rising.name, pct: Math.round(rising.pct ?? 0) } : null,
      bestYield: best ? { name: best.name, minutes: best.minutes, perHourCents: best.perHourCents } : null,
      question,
    };
  }

  // ---- the offer, as the team sets it ------------------------------------------

  /** Read the offer form. Anyone on the salon may read; the plan is built from it. */
  async getOffer(user: AuthenticatedUser): Promise<WeekOffer> {
    const tenantId = this.tenantId(user);
    const row = await this.prisma.setting.findFirst({ where: { tenantId, key: 'content_offer' }, select: { value: true } }).catch(() => null);
    return row?.value ? { ...parseOffer(row.value), ...pickMeta(row.value) } : { ...DEFAULT_OFFER };
  }

  /** Write the offer form. Team only — it changes what the salon is told to promise. */
  async setOffer(user: AuthenticatedUser, raw: unknown): Promise<WeekOffer> {
    const tenantId = this.tenantId(user);
    if (user.role !== UserRole.SUPER_ADMIN && !user.supportSession) {
      throw new ForbiddenException('Chỉ team Lumio đặt ưu đãi cho tiệm.');
    }
    const offer: WeekOffer = { ...parseOffer(raw), updatedAt: new Date().toISOString(), updatedBy: user.email ?? 'Lumio' };
    if (offer.mode === 'custom' && offer.kind !== 'gift' && offer.value <= 0) {
      throw new BadRequestException('Ưu đãi cần một con số — % hoặc số tiền giảm.');
    }
    if (offer.mode === 'custom' && offer.kind === 'gift' && !offer.gift) {
      throw new BadRequestException('Ghi rõ tặng gì.');
    }
    const existing = await this.prisma.setting.findFirst({ where: { tenantId, key: 'content_offer' }, select: { id: true } }).catch(() => null);
    if (existing) {
      await this.prisma.setting.update({ where: { id: existing.id }, data: { value: offer as never } });
    } else {
      await this.prisma.setting.create({ data: { tenantId, key: 'content_offer', value: offer as never } });
    }
    await this.prisma.auditLog.create({
      data: { tenantId, userId: user.userId ?? null, action: 'content.offer_set', resourceType: 'setting', resourceId: 'content_offer', metadata: { mode: offer.mode, kind: offer.kind, value: offer.value } } as never,
    }).catch(() => undefined);
    return offer;
  }

  // ---- ticks on the sheet ----------------------------------------------------------

  /**
   * One step of one job, ticked or unticked, on this week.
   *
   * Stored on the week row and keyed by the job's stable id (see job-brief),
   * so a tick survives the hourly regeneration of the generated side. Either
   * side may tick: the shop ticking "photo 3 done" is exactly the signal the
   * team wants, and there is nothing here worth protecting from it.
   */
  async tickStep(user: AuthenticatedUser, key: string, dto: { jobId?: unknown; step?: unknown; done?: unknown }) {
    const tenantId = this.tenantId(user);
    const jobId = String(dto?.jobId ?? '').replace(/[^a-z0-9-]/g, '').slice(0, 24);
    const step = Math.max(0, Math.min(31, Math.round(Number(dto?.step))));
    if (!jobId || !Number.isFinite(step)) throw new BadRequestException('Thiếu việc hoặc bước.');
    const loose = this.prisma as unknown as Record<string, {
      findFirst: (a: unknown) => Promise<unknown>;
      update: (a: unknown) => Promise<unknown>;
    }>;
    const row = await loose.contentWeek?.findFirst({ where: { tenantId, weekKey: key }, select: { id: true, ticks: true } })
      .catch(() => null) as { id: string; ticks: Record<string, number[]> | null } | null;
    if (!row) throw new NotFoundException('Chưa có kế hoạch nào được lưu cho tuần này.');
    const ticks: Record<string, number[]> = { ...(row.ticks ?? {}) };
    const set = new Set(ticks[jobId] ?? []);
    if (dto?.done === false) set.delete(step); else set.add(step);
    if (set.size) ticks[jobId] = Array.from(set).sort((a, b) => a - b); else delete ticks[jobId];
    await loose.contentWeek?.update({ where: { id: row.id }, data: { ticks: ticks as never } }).catch(() => undefined);
    return { ok: true, weekKey: key, ticks };
  }



  /** The salon's own currency formatter, without gathering the whole context. */
  private async moneyFor(tenantId: string): Promise<(c: number) => string> {
    const [tenant, rules, extra] = await Promise.all([
      // `market` is on the deployed schema but missing from the Prisma client
      // this was written against — the same cast the rest of this file uses.
      this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { timezone: true, market: true } as never })
        .catch(() => null) as Promise<{ timezone?: string | null; market?: string | null } | null>,
      this.prisma.setting.findFirst({ where: { tenantId, key: 'booking_rules' }, select: { value: true } }).catch(() => null),
      this.prisma.setting.findFirst({ where: { tenantId, key: 'company_extra' }, select: { value: true } }).catch(() => null),
    ]);
    const currency = String((rules?.value as { currency?: string } | null)?.currency || '').trim().toUpperCase()
      || marketOf((tenant as { market?: string } | null)?.market).currency;
    const locale = localeForCountry(
      String(((extra?.value ?? {}) as { country?: string }).country ?? ''),
      tenant?.timezone ?? null,
    );
    return (c: number) => formatMoneyShort(c, currency, locale);
  }

  // ---- the week, kept ------------------------------------------------------

  /**
   * Freeze this week's plan, and hand back the version to show.
   *
   * WHY THE ARCHIVE EXISTS
   *
   * The plan was computed on every read and stored nowhere, so last week's plan
   * ceased to exist the moment Monday arrived. Neither the team nor the salon
   * could point at what had been agreed, and "are we further along than last
   * week" had no answer because there was nothing to compare against.
   *
   * TWO RULES THAT MAKE THE ARCHIVE WORTH HAVING
   *
   *   - A PAST week is never rewritten. Refreshing it with today's numbers
   *     would turn the record of what was agreed into a record of what we would
   *     say now, which is the one thing an archive must not do.
   *   - An EDIT is never overwritten. The generated side keeps refreshing while
   *     the week is current; the team's version is what the screen shows, and
   *     both are kept so "what did we change" stays answerable.
   */
  private async keepWeek(
    tenantId: string,
    tz: string,
    plan: Awaited<ReturnType<ContentService['weekPlanFor']>>,
  ): Promise<{
    weekKey: string; startDate: string; edited: boolean; editedByName: string | null; editedAt: Date | null;
    approvedAt: Date | null; approvedByName: string | null; ticks: Record<string, number[]>;
  }> {
    const key = weekKey(new Date(), tz);
    const start = weekStart(new Date(), tz);
    const loose = this.prisma as unknown as Record<string, {
      findFirst: (a: unknown) => Promise<unknown>;
      update: (a: unknown) => Promise<unknown>;
      create: (a: unknown) => Promise<unknown>;
    }>;
    const row = await loose.contentWeek?.findFirst({
      where: { tenantId, weekKey: key },
    }).catch(() => null) as {
      id: string; edited?: unknown; editedByName?: string | null; editedAt?: Date | null;
      approvedAt?: Date | null; approvedByName?: string | null; ticks?: Record<string, number[]> | null;
    } | null;

    const data = {
      startDate: start,
      stageKey: plan.stage?.key ?? null,
      stageStep: plan.stage?.step ?? null,
      generated: plan as never,
    };

    if (!row) {
      await loose.contentWeek?.create({ data: { tenantId, weekKey: key, ...data } }).catch(() => undefined);
      return { weekKey: key, startDate: start, edited: false, editedByName: null, editedAt: null, approvedAt: null, approvedByName: null, ticks: {} };
    }
    // Current week: keep the generated side fresh. The edit is untouched.
    await loose.contentWeek?.update({ where: { id: row.id }, data }).catch(() => undefined);
    return {
      weekKey: key,
      // The Monday this week actually starts on, so the screen can print real
      // dates instead of asking the reader to work out which week is meant.
      startDate: start,
      edited: Boolean(row.edited),
      editedByName: row.editedByName ?? null,
      editedAt: row.editedAt ?? null,
      // Whether the salon has said "yes, run this". The team needs to see it
      // before spending the week's budget, and the salon needs somewhere to
      // say it other than a chat message nobody re-reads.
      approvedAt: row.approvedAt ?? null,
      approvedByName: row.approvedByName ?? null,
      ticks: row.ticks ?? {},
    };
  }

  /** Every week this salon has on file, newest first. */
  async weekHistory(user: AuthenticatedUser) {
    const tenantId = this.tenantId(user);
    const loose = this.prisma as unknown as Record<string, { findMany: (a: unknown) => Promise<unknown> }>;
    const rows = await loose.contentWeek?.findMany({
      where: { tenantId },
      orderBy: { startDate: 'desc' },
      take: 52,
      select: {
        weekKey: true, startDate: true, stageKey: true, stageStep: true,
        editedByName: true, editedAt: true, generated: true, edited: true,
        outcome: true, approvedAt: true, approvedByName: true,
      },
    }).catch(() => []) as {
      weekKey: string; startDate: string; stageKey: string | null; stageStep: number | null;
      editedByName: string | null; editedAt: Date | null;
      generated: { focus?: string } | null; edited: { focus?: string } | null;
      outcome: WeekOutcome | null; approvedAt: Date | null; approvedByName: string | null;
    }[];
    const money = await this.moneyFor(this.tenantId(user)).catch(() => (c: number) => `$${Math.round(c / 100)}`);
    return (rows ?? []).map((r) => {
      const row = {
        weekKey: r.weekKey,
        label: weekLabel(r.weekKey),
        startDate: r.startDate,
        stageKey: r.stageKey,
        stageStep: r.stageStep,
        focus: (r.edited ?? r.generated)?.focus ?? '',
        edited: Boolean(r.edited),
        editedByName: r.editedByName,
        editedAt: r.editedAt,
        approvedAt: r.approvedAt,
        approvedByName: r.approvedByName,
        // What the week produced, in one line — the half the archive used to
        // be missing. Absent for the current week, which has not finished.
        outcome: r.outcome,
        outcomeLine: r.outcome ? describeOutcome(r.outcome, money) : null,
        deltaLine: r.outcome ? describeDelta(r.outcome) : null,
      };
      // Same rule as the plan payload: Vietnamese stays where callers already
      // look for it, and the English rendering rides alongside under `en`.
      return { ...localizeDeep(row, 'vi'), en: localizeDeep(row, 'en') };
    });
  }

  /**
   * One archived week, as it should be read: the edit if there is one.
   *
   * Two entry points on purpose. `weekAtRaw` hands back the week with its
   * phrases still bilingual, because `planFor` embeds it in a payload it is
   * about to render in both languages itself — localising here would flatten a
   * team-edited week to Vietnamese and quietly undo the whole pass for exactly
   * the salons a human has spent time on. `weekAt` is the HTTP shape, rendered
   * the same way as the plan and the archive.
   */
  private async weekAtRaw(user: AuthenticatedUser, key: string) {
    const tenantId = this.tenantId(user);
    const loose = this.prisma as unknown as Record<string, { findFirst: (a: unknown) => Promise<unknown> }>;
    const row = await loose.contentWeek?.findFirst({
      where: { tenantId, weekKey: key },
    }).catch(() => null) as {
      weekKey: string; startDate: string; generated: unknown; edited: unknown;
      editedByName: string | null; editedAt: Date | null;
    } | null;
    if (!row) throw new NotFoundException('Chưa có kế hoạch nào được lưu cho tuần này.');
    // One week, rendered the same way the plan and the archive are: Vietnamese
    // in place, English alongside. `week` here is a stored plan object whose
    // phrases are already bilingual, so the walk reaches those too.
    const out = {
      weekKey: row.weekKey,
      label: weekLabel(row.weekKey),
      startDate: row.startDate,
      week: (row.edited ?? row.generated) as unknown,
      /// The system's own version, so an edit can always be compared with it.
      original: row.generated as unknown,
      edited: Boolean(row.edited),
      editedByName: row.editedByName,
      editedAt: row.editedAt,
    };
    return out;
  }

  async weekAt(user: AuthenticatedUser, key: string) {
    const out = await this.weekAtRaw(user, key);
    return { ...localizeDeep(out, 'vi'), en: localizeDeep(out, 'en') };
  }

  /**
   * The Lumio team rewrites a week before handing it to the salon.
   *
   * Support-session only, deliberately. The salon reads the plan and marks work
   * done; the team is accountable for what the plan SAYS, and a plan two people
   * can rewrite from opposite ends is a plan neither of them trusts.
   *
   * The generated version is kept beside the edit, always. Without it nobody
   * can answer "what did the system suggest, and did our change do better" —
   * which is the only way this feature ever improves.
   */
  /**
   * This week's plan for the signed-in salon, and nothing else.
   *
   * The full `plan()` payload builds twenty other things — trends, keywords,
   * the ads model, the roadmap — none of which the salon's own screen may see.
   * Rather than build all of it and throw most away, this walks the same three
   * steps `plan()` uses for the week and stops: gather, generate, and prefer
   * the team's edit when there is one.
   *
   * It returns the FULL week. Narrowing it to what a shop may see is the job of
   * client-view.ts, in one place, tested there.
   */
  async weekForSalon(user: AuthenticatedUser) {
    return (await this.weekForSalonKept(user)).plan;
  }

  /** The salon's week plus the two things only the week row knows: its key and its ticks. */
  async weekForSalonKept(user: AuthenticatedUser): Promise<{
    plan: Awaited<ReturnType<ContentService['weekPlanFor']>>; weekKey: string | null; ticks: Record<string, number[]>;
    /** Steps the posting queue proved, per job — see auto-ticks. */
    auto: Record<string, number[]>;
  }> {
    const tenantId = this.tenantId(user);
    const ctx = await this.gather(tenantId);
    const generated = await this.weekPlanFor(tenantId, ctx);
    const kept = await this.keepWeek(tenantId, ctx.tz, generated).catch(() => null);
    const row = kept?.edited ? await this.weekAtRaw(user, kept.weekKey).catch(() => null) : null;
    const plan = (row?.week as typeof generated) ?? generated;
    const auto = await this.autoTicksFor(tenantId, ctx.tz, plan).catch(() => ({}));
    return { plan, weekKey: kept?.weekKey ?? null, ticks: kept?.ticks ?? {}, auto };
  }

  /**
   * What the posting queue can prove about each job on the week.
   *
   * Day index 0 is today in the salon's own zone; a post scheduled on that
   * local day is that day's evidence. The match is by DAY and not by a stored
   * link, because the queue's posts come from the daily ideas and the week's
   * jobs come from the plan — two lists that are meant to describe the same
   * day, and the day is the thing they share. See ./auto-ticks.
   */
  private async autoTicksFor(
    tenantId: string, tz: string, plan: { days: { jobs: { id?: string; brief?: { auto?: Record<number, AutoKey> } }[] }[] },
  ): Promise<Record<string, number[]>> {
    const today = this.localDay(tz);
    const dayOf = (i: number) => {
      const d = new Date(`${today}T12:00:00Z`);
      d.setUTCDate(d.getUTCDate() + i);
      return d.toISOString().slice(0, 10);
    };
    const from = new Date(`${today}T00:00:00Z`); from.setUTCDate(from.getUTCDate() - 1);
    const to = new Date(`${today}T00:00:00Z`); to.setUTCDate(to.getUTCDate() + 9);
    const loose = this.prisma as unknown as { scheduledPost?: { findMany: (a: unknown) => Promise<unknown> } };
    const rows = await loose.scheduledPost?.findMany({
      where: { tenantId, scheduledAt: { gte: from, lt: to } },
      select: { scheduledAt: true, status: true, media: true, imageUrl: true, message: true },
      take: 200,
    }).catch(() => []) as { scheduledAt: Date; status: string; media: unknown; imageUrl: string | null; message: string }[] ?? [];
    const posts: PostEvidence[] = rows.map((r) => {
      const media = Array.isArray(r.media) ? r.media as { kind?: string }[] : [];
      const count = media.length || (r.imageUrl ? 1 : 0);
      return {
        day: this.localDay(tz, new Date(r.scheduledAt)),
        status: String(r.status ?? ''),
        mediaCount: count,
        hasVideo: media.some((m) => m?.kind === 'video'),
        hasMessage: Boolean(String(r.message ?? '').trim()),
      };
    });
    const out: Record<string, number[]> = {};
    plan.days.forEach((d, i) => {
      const ev = evidenceForDay(posts, dayOf(i));
      for (const j of d.jobs) {
        if (!j.id || !j.brief?.auto) continue;
        const done = autoDone(j.brief.auto, ev);
        if (done.length) out[j.id] = done;
      }
    });
    return out;
  }

  /**
   * What the salon actually GOT last week — its own numbers, nothing inferred.
   *
   * The client screen used to open on a list of chores. It now opens on this,
   * because it is the only part of the screen that answers the question the
   * owner is actually asking when she opens the app: what am I paying for.
   *
   * Every figure is the salon's own row count, and the change against the week
   * before travels with it. Nothing here attributes a booking to a post — see
   * week-outcome for why that line is not crossed.
   */
  async lastWeekForSalon(user: AuthenticatedUser): Promise<{
    label: Txt; posted: number; reviews: number; newCustomers: number; bookings: number;
    delta: { reviews: number | null; newCustomers: number | null; bookings: number | null };
  } | null> {
    const tenantId = this.tenantId(user);
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { timezone: true } })
      .catch(() => null);
    const thisWeek = weekKey(new Date(), tenant?.timezone || 'America/New_York');
    const loose = this.prisma as unknown as Record<string, { findFirst: (a: unknown) => Promise<unknown> }>;
    const row = await loose.contentWeek?.findFirst({
      where: { tenantId, weekKey: { not: thisWeek }, outcome: { not: null } },
      orderBy: { startDate: 'desc' },
      select: { weekKey: true, outcome: true },
    }).catch(() => null) as { weekKey: string; outcome: WeekOutcome | null } | null;
    const o = row?.outcome;
    if (!o) return null;
    return {
      label: weekLabel(row!.weekKey),
      posted: o.posted ?? 0,
      reviews: o.reviews ?? 0,
      newCustomers: o.newCustomers ?? 0,
      bookings: o.bookings ?? 0,
      // Money is deliberately left out. It is the salon's own figure and it
      // already has a screen; on a marketing card beside a post count it reads
      // as a claim about what the posts earned, which is exactly the line
      // week-outcome refuses to cross.
      delta: {
        reviews: o.delta?.reviews ?? null,
        newCustomers: o.delta?.newCustomers ?? null,
        bookings: o.delta?.bookings ?? null,
      },
    };
  }

  /**
   * What this salon SHOULD spend — the number a person is otherwise inventing.
   *
   * The monthly report asks staff to type what was spent, and until now gave
   * them nothing to decide it against, so the figure came out of somebody's
   * head. It is not a matter of taste: the ceiling is the salon's own first
   * visit ticket times its own margin, the daily budget is what it takes to
   * buy enough conversions to measure anything, and the month's total is that
   * daily figure placed against the dates people book for (ads-calendar).
   *
   * Deliberately SEPARATE from the spend field and never pre-filled into it.
   * A recommendation written into a receipt is a receipt for money nobody
   * spent, and every number downstream — cost per customer, the line on the
   * client's own screen — would then be computed from a wish.
   */
  async adsBudgetFor(user: AuthenticatedUser) {
    const tenantId = this.tenantId(user);
    const ctx = await this.gather(tenantId);
    const regulars = ctx.audience.segments.find((sg) => sg.key === 'regular');
    const ceiling = cpaCeiling({
      avgTicketCents: ctx.firstVisitTicketCents ?? ctx.audience.segments[0]?.avgTicketCents ?? null,
      grossMarginPct: ctx.promo.margin.grossMarginPct,
      medianGapDays: regulars?.medianGapDays ?? null,
    });
    const budget = budgetPlan({ ceiling });
    // The calendar is the only part that can be done without: a month total is
    // nice, the daily figure and the ceiling are the answer. A salon whose
    // region cannot be resolved must still be told what a customer may cost.
    const calendar = (() => {
      try {
        return adsCalendar({
          baseDailyCents: budget.dailyCents,
          events: regionEvents(new Date(), {
            market: ctx.region.market, city: ctx.region.city, region: ctx.region.region,
          }, { horizonDays: 90 }).events,
          leadDays: ctx.lead.medianDays,
        });
      } catch { return null; }
    })();
    const month = new Date().toISOString().slice(0, 7);
    const thisMonth = calendar?.months.find((m) => m.month === month) ?? null;
    return {
      month,
      // Null when the salon has no ticket or no margin on file. The screen then
      // says which one is missing rather than printing a confident zero.
      ceilingCents: ceiling.strictCents,
      ceiling: ceiling.strictCents !== null ? ctx.money(ceiling.strictCents) : null,
      dailyCents: budget.dailyCents,
      daily: ctx.money(budget.dailyCents),
      days: budget.days,
      testCents: budget.totalCents,
      test: ctx.money(budget.totalCents),
      monthCents: thisMonth?.totalCents ?? null,
      monthTotal: thisMonth ? ctx.money(thisMonth.totalCents) : null,
      feasible: budget.feasible,
      why: viOf(ceiling.plain),
      whyEn: enOf(ceiling.plain),
      note: viOf(budget.plain),
      noteEn: enOf(budget.plain),
    };
  }

  /**
   * The ad budget offered to the SALON, in the salon's own words.
   *
   * Shown only when there is no spend this month: a shop already advertising
   * gets the receipt instead (adsReceiptForSalon), and one card in one place
   * is the difference between a screen a busy owner reads and one she skims.
   * The wording, and the state that declines to offer anything, live in
   * ./ads-pitch.
   */
  /**
   * Every source, read once, for whichever screen is asking.
   *
   * Built as its own method precisely so the ad screen and the plan screen
   * cannot end up with two different opinions about one salon — the bug that
   * shape invites is not hypothetical, it is what happens the first time
   * somebody adds a threshold to one of them and not the other.
   */
  /**
   * The whole-salon reading, plus the raw figures it was read FROM.
   *
   * The assessment on its own answers "what is wrong"; the ad screen also has
   * to answer "what did you look at", which is a different question and the one
   * an agency owner asks when a recommendation does not convince him. Returning
   * the counts alongside the verdict means the screen quotes the same numbers
   * the verdict was formed from, rather than fetching them a second time and
   * risking two answers.
   */
  private async lookAtSalon(
    tenantId: string,
    ctx: Awaited<ReturnType<ContentService['gather']>>,
  ): Promise<ReturnType<typeof assessSalon> & { raw: { reviews: number | null; posted30: number | null; fanpage: boolean } }> {
    const loose = this.prisma as unknown as Record<string, { count?: (a: unknown) => Promise<number> }>;
    const since90 = new Date(Date.now() - 90 * 86_400_000);
    const [reviews, posted30, bookings90, conn] = await Promise.all([
      loose.googleReview?.count?.({ where: { tenantId } }).catch(() => null) ?? Promise.resolve(null),
      loose.contentIdea?.count?.({
        where: { tenantId, status: { in: ['posted', 'filmed'] }, doneAt: { gte: new Date(Date.now() - 30 * 86_400_000) } },
      } as never).catch(() => 0) ?? Promise.resolve(0),
      this.prisma.appointment.count({ where: { tenantId, startTime: { gte: since90 } } }).catch(() => null),
      this.prisma.messengerConnection.findUnique({ where: { tenantId }, select: { pageId: true } }).catch(() => null),
    ]);
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId }, select: { createdAt: true },
    }).catch(() => null);
    const daysWithUs = tenant?.createdAt
      ? Math.floor((Date.now() - new Date(tenant.createdAt).getTime()) / 86_400_000)
      : null;
    const raw = {
      reviews: typeof reviews === 'number' ? reviews : null,
      posted30: typeof posted30 === 'number' ? posted30 : null,
      fanpage: Boolean(conn?.pageId),
    };
    return { ...assessSalon({
      googleConnected: typeof reviews === 'number',
      googleReviews: typeof reviews === 'number' ? reviews : null,
      postedLast30: typeof posted30 === 'number' ? posted30 : null,
      fanpageConnected: Boolean(conn?.pageId),
      websiteUrl: ctx.website ?? null,
      menuSize: ctx.menu.filter((m) => (m.priceCents ?? 0) > 0).length,
      bookings90: typeof bookings90 === 'number' ? bookings90 : null,
      customers: ctx.audience.totalCustomers,
      daysWithUs,
      areaKnown: Boolean(ctx.nearbyZips),
    }), raw };
  }

  async adsPitchForSalon(user: AuthenticatedUser): Promise<AdsPitch | null> {
    const tenantId = this.tenantId(user);
    const ctx = await this.gather(tenantId);
    const regulars = ctx.audience.segments.find((sg) => sg.key === 'regular');
    // Measured first, the salon's own price list second. Without the fallback
    // this screen says "not enough appointments yet" to a shop that has traded
    // for nine years on somebody else's system, and to a shop that has not
    // opened — the two cases where an ad budget is most wanted. See
    // ticket-estimate.ts for why it is the median of the menu and not the mean.
    const est = estimateTicket({
      firstVisitCents: ctx.firstVisitTicketCents,
      anySegmentCents: ctx.audience.segments[0]?.avgTicketCents ?? null,
      anySegmentCount: ctx.audience.segments[0]?.count ?? null,
      services: ctx.menu,
    });
    const ticket = est.cents;
    const margin = ctx.promo.margin.grossMarginPct;

    // The SAME reading of this salon the plan screen uses. Two screens that
    // describe one business differently is how a product stops being believed:
    // "spend $30 a day" on one page and "your profile has three reviews" on the
    // next are both true and cannot both be advice.
    const look = await this.lookAtSalon(tenantId, ctx);
    // Not a veto — it decides where the paid clicks land, and what runs
    // alongside the campaign. See adsAim in salon-assessment.ts.
    const aimFinding = adsAim(look);
    const aim = aimFinding ? { key: aimFinding.key, because: aimFinding.because, doNext: aimFinding.doNext } : null;
    const ceiling = cpaCeiling({ avgTicketCents: ticket, grossMarginPct: margin, medianGapDays: regulars?.medianGapDays ?? null });

    // The same free-capacity figure the team's plan is checked against, so the
    // two screens cannot disagree about whether there are chairs to fill.
    const LOAD_WINDOW_DAYS = 28;
    const quiet = ctx.revenue.loads.slice(0, 3);
    /**
     * FREE CAPACITY, FROM THE SHOP RATHER THAN FROM ITS BOOKING HISTORY.
     *
     * What stood here measured the gap between the busiest weekday and the
     * quietest three. A salon with two appointments a day, every day, has no
     * gap — so it reported no room, for a shop that was almost entirely empty.
     * A salon being set up got the same answer, and the ad screen used it to
     * refuse a campaign: "your quiet hours only hold 0". See ./ad-capacity for
     * the whole account; the short version is that open hours times chairs is
     * a fact about the salon, and it exists before the first booking does.
     */
    // The busiest single day this salon has worked, so a shop that never filled
    // in its staff list still gets an answer: the loads are weekday x block
    // summed over the window, so one weekday's total divided by the weeks in it
    // is what that day looks like.
    const perWeekday = new Map<number, number>();
    for (const l of ctx.revenue.loads) perWeekday.set(l.weekday, (perWeekday.get(l.weekday) ?? 0) + l.minutes);
    const weeksInWindow = LOAD_WINDOW_DAYS / 7;
    const busiestDayMinutes = perWeekday.size
      ? Math.max(...Array.from(perWeekday.values())) / weeksInWindow
      : null;

    const capacity = adCapacity({
      openMinutesPerWeek: ctx.openMinutesPerWeek,
      openDaysPerWeek: ctx.openDaysPerWeek,
      chairs: ctx.chairs,
      busiestDayMinutes,
      bookedMinutes: ctx.revenue.loads.reduce((sum, l) => sum + l.minutes, 0),
      historyDays: LOAD_WINDOW_DAYS,
      slotMinutes: ctx.avgServiceMinutes,
      campaignDays: CAMPAIGN_DAYS,
    });
    // A salon that is genuinely full is the one case where more traffic has
    // nowhere to sit. Everything else — thin data, no hours on file, no staff
    // yet — comes through as null, and budgetPlan reports 'unknown' rather
    // than printing a zero it cannot stand behind.
    const openSlots = capacity.slots === null ? null : (isFull(capacity) ? 0 : capacity.slots);

    const budget = budgetPlan({ ceiling, openSlots });

    // The four questions the owner asks after "how much": where, what, when,
    // and then what. Every answer below is a fact this salon already produced —
    // its own channel history, its own per-chair-hour earners, its own booking
    // lead time, its own quiet blocks. None of the reasoning behind them
    // crosses over; only the conclusion in her words. See ./ads-pitch.
    const window = runWindow({
      quietWeekdays: quiet.map((q) => q.weekday),
      busyWeekdays: [...ctx.revenue.loads].reverse().slice(0, 2).map((l) => l.weekday),
      leadDays: ctx.lead.medianDays,
    });
    // WHICH SERVICE THE AD MAY SELL — decided once, here, and used by the ad
    // copy, the keyword list and the card the owner reads, so those three can
    // never name three different services. See ./ad-service for the three gates.
    const sells = pickAdServices(menuWithBookings(ctx.menu, ctx.signals.services), ticket);

    const { reports } = channelReports(ctx.channelBookings, Date.now());
    const plans = platformPlans(reports, {
      grossMarginPct: margin,
      firstVisitTicketCents: ticket,
      openSlots,
      runDayLabels: window.labels.run,
      pauseDayLabels: window.labels.pause,
      quietLabels: quiet.map((q) => q.label),
      leadDays: ctx.lead.medianDays,
      topServiceName: sells.names[0] ?? ctx.signals.services[0]?.name ?? null,
      city: ctx.region.city,
      region: ctx.region.region,
      lapsedCount: ctx.revenue.lapsed.count,
      customerCount: ctx.audience.totalCustomers,
      market: ctx.region.market,
      money: ctx.money,
    });
    const first = plans[0] ?? null;
    const second = plans[1] ?? null;

    // The week's offer only goes into the ad when the advice was actually to
    // discount. 'raise-price' and 'hold' mean the opposite, and pasting a
    // headline from them into an ad would sell something we advised against.
    const advice = ctx.revenue.advice;
    const offerLine = advice && advice.discountPct > 0 ? advice.headline : null;

    /**
     * THE WORKING, SHOWN.
     *
     * Six sources, each with the figure it produced and whether it answered at
     * all. This exists because the screen was making a confident recommendation
     * out of sight of its own evidence, and the honest response to "too little
     * data" is not a better sentence — it is the list, including the blanks.
     */
    const basis: { label: Txt; value: Txt; known: boolean }[] = [
      {
        label: bi('Một lần khách tới thu', 'What one visit brings in'),
        value: ticket
          ? bi(`${ctx.money(ticket)}${isEstimate(est.source) ? ' (ước tính từ bảng giá)' : ' (từ lịch hẹn tại tiệm)'}`,
            `${ctx.money(ticket)}${isEstimate(est.source) ? ' (estimated from the price list)' : ' (from bookings here)'}`)
          : bi('chưa có — nhập bảng giá là tính được', 'not yet — enter the price list'),
        known: Boolean(ticket),
      },
      {
        label: bi('Lãi gộp mỗi khách', 'Gross margin per visit'),
        value: margin
          ? bi(`${margin}%${ctx.promo.margin.source === 'assumed' ? ' (ước tính theo ngành)' : ' (từ hoa hồng thợ đang trả)'}`,
            `${margin}%${ctx.promo.margin.source === 'assumed' ? ' (trade estimate)' : ' (from the commission you pay)'}`)
          : bi('chưa có', 'not yet'),
        known: Boolean(margin),
      },
      {
        label: bi('Chỗ trống 2 tuần tới', 'Free visits over two weeks'),
        value: capacity.slots === null
          ? bi(`chưa tính được — thiếu ${capacity.missing.includes('chairs') ? 'danh sách thợ' : 'giờ mở cửa'}`,
            `cannot compute — ${capacity.missing.includes('chairs') ? 'no staff on file' : 'no opening hours on file'}`)
          : bi(
            `${capacity.slots} lượt — ${capacity.chairs} thợ × ${CAMPAIGN_DAYS} ngày × 1 khách thêm/ngày`
              + `${capacity.chairsFrom === 'busiest-day' ? ' (số thợ suy từ ngày đông nhất tiệm đã làm, vì tiệm chưa nhập danh sách thợ)' : ''}`
              + `${capacity.basis === 'assumed-hours' ? ' (giờ mở cửa là giả định)' : ''}`
              + ` · tiệm đang kín ${capacity.utilisationPct}%`,
            `${capacity.slots} visits — ${capacity.chairs} staff × ${CAMPAIGN_DAYS} days × 1 extra a day`
              + `${capacity.chairsFrom === 'busiest-day' ? ' (staff count inferred from the busiest day worked — no staff list on file)' : ''}`
              + `${capacity.basis === 'assumed-hours' ? ' (opening hours assumed)' : ''}`
              + ` · ${capacity.utilisationPct}% full`),
        known: capacity.slots !== null,
      },
      {
        label: bi('Hồ sơ Google', 'Google profile'),
        value: look.read.find((r) => r.source === 'google')?.answered
          ? bi(`${look.raw.reviews ?? 0} đánh giá`, `${look.raw.reviews ?? 0} reviews`)
          : bi('chưa nối', 'not connected'),
        known: Boolean(look.read.find((r) => r.source === 'google')?.answered),
      },
      {
        label: bi('Fanpage / Instagram', 'Facebook / Instagram'),
        value: look.read.find((r) => r.source === 'fanpage')?.answered
          ? bi(`đã nối · ${look.raw.posted30 ?? 0} bài trong 30 ngày`, `connected · ${look.raw.posted30 ?? 0} posts in 30 days`)
          : bi('chưa nối', 'not connected'),
        known: Boolean(look.read.find((r) => r.source === 'fanpage')?.answered),
      },
      {
        label: bi('Khách hiện tới từ đâu', 'Where customers come from now'),
        value: plans[0]?.label
          ? bi(viOf(plans[0].label), enOf(plans[0].label))
          : bi('chưa đủ lịch hẹn để biết', 'not enough bookings to tell'),
        known: Boolean(plans[0]?.label),
      },
    ];

    return adsPitch({
      basis,
      ticketEstimated: isEstimate(est.source),
      aim,
      ceilingCents: ceiling.strictCents,
      dailyCents: budget.dailyCents,
      days: budget.days,
      totalCents: budget.totalCents,
      bookingsToBreakEven: budget.bookingsToBreakEven,
      openSlots: budget.openSlots,
      feasible: budget.feasible,
      missing: ticket === null ? 'ticket' : margin === null ? 'margin' : null,
      platform: first ? { label: first.label, key: first.platform } : null,
      secondPlatform: second?.label ?? null,
      // The same two channels in two words, for the sentences. The long form
      // ("Google (Tìm kiếm + Maps)") belongs on a headline, said once — inside
      // a paragraph it turns the plan into something no owner reads.
      platformShort: first?.short ?? null,
      secondShort: second?.short ?? null,
      // The number the "when do we open the second channel" test hangs on:
      // the bookings this campaign has to produce before its cost per customer
      // is a reading rather than noise. Same figure the break-even line quotes,
      // so the two cannot drift apart on one screen.
      provingBookings: budget.bookingsToBreakEven,
      // 'unproven' is the default order speaking, not this salon's book.
      platformFromData: first ? first.status !== 'unproven' : false,
      sells,
      offerLine,
      runDays: window.labels.run,
      pauseDays: window.labels.pause,
      leadDays: ctx.lead.medianDays,
      quietBlocks: quiet.slice(0, 2).map((q) => q.label),
      returnDays: regulars?.medianGapDays ?? null,
    });
  }

  /**
   * This month's ad money and what came back — for the SALON's own screen.
   *
   * Spend is what a person typed into MarketingSpend for the paid channels;
   * nothing is estimated. The customers are the ones whose FIRST appointment
   * this month was booked through a paid channel, which is the only divisor
   * that does not quietly credit the ads with the sign outside. See
   * ./ads-receipt for the arithmetic and for what it refuses to claim.
   */
  async adsReceiptForSalon(user: AuthenticatedUser): Promise<AdsReceipt | null> {
    const tenantId = this.tenantId(user);
    const now = new Date();
    const month = now.toISOString().slice(0, 7);
    const from = new Date(`${month}-01T00:00:00Z`);

    const [spendRows, appts] = await Promise.all([
      this.prisma.marketingSpend.findMany({
        where: { tenantId, periodMonth: month },
        select: { channel: true, amountCents: true },
      }).catch(() => []) as Promise<{ channel: string; amountCents: number }[]>,
      this.prisma.appointment.findMany({
        where: { tenantId, startTime: { gte: from }, status: { notIn: ['CANCELLED', 'NO_SHOW'] } as never },
        select: { customerId: true, startTime: true, source: true, utmSource: true, attrReferrer: true, attrLandingUrl: true } as never,
        take: 5000,
      }).catch(() => []) as Promise<{ customerId: string | null; startTime: Date; source?: string | null; utmSource?: string | null; attrReferrer?: string | null; attrLandingUrl?: string | null }[]>,
    ]);

    // Only money that bought clicks. SEO, email and SMS are billed work, not
    // ad spend, and folding them in would inflate the cost of an ad customer.
    const PAID = new Set(['facebook', 'instagram', 'google_ads', 'tiktok', 'zalo']);
    const spendCents = spendRows.filter((r) => PAID.has(String(r.channel))).reduce((n, r) => n + (r.amountCents ?? 0), 0);
    if (spendCents <= 0) return null;

    // Which of this month's customers had never been in before.
    const ids = Array.from(new Set(appts.map((a) => a.customerId).filter(Boolean))) as string[];
    const earliest = new Map<string, number>();
    if (ids.length) {
      const hist = await this.prisma.appointment.findMany({
        where: { tenantId, customerId: { in: ids }, status: { notIn: ['CANCELLED', 'NO_SHOW'] } as never },
        select: { customerId: true, startTime: true },
        take: 20000,
      }).catch(() => []) as { customerId: string | null; startTime: Date }[];
      for (const h of hist) {
        if (!h.customerId) continue;
        const t = h.startTime.getTime();
        earliest.set(h.customerId, Math.min(earliest.get(h.customerId) ?? t, t));
      }
    }
    const firsts = appts.filter((a) => a.customerId && earliest.get(a.customerId) === a.startTime.getTime());
    const fromAds = firsts.filter((a) => {
      const p = PLATFORM_OF[bookingChannel({ source: a.source, utmSource: a.utmSource, attrReferrer: a.attrReferrer, attrLandingUrl: a.attrLandingUrl })];
      return p === 'google' || p === 'meta' || p === 'zalo';
    }).length;

    const ctx = await this.gather(tenantId);
    const regulars = ctx.audience.segments.find((sg) => sg.key === 'regular');
    const ceiling = cpaCeiling({
      avgTicketCents: ctx.firstVisitTicketCents ?? ctx.audience.segments[0]?.avgTicketCents ?? null,
      grossMarginPct: ctx.promo.margin.grossMarginPct,
      medianGapDays: regulars?.medianGapDays ?? null,
    });
    return adsReceipt({ spendCents, fromAds, newTotal: firsts.length, ceilingCents: ceiling.strictCents });
  }

  /**
   * The SHOP rewriting its own week.
   *
   * The owner asked to work on the plan with the team, not only read it, so
   * the shop's screen edits in place the way the team's does. The edit comes
   * in the shop's own shape (jobs by id — see shop-week-edit) and is rebuilt
   * on the same skeleton and through the same sanitiser as the team's; the
   * fields the shop never saw (why, when, caption, hashtags) are carried
   * over untouched, because there is no field in its patch to put them in.
   * Stored under the shop's name so the team's board says who changed what.
   */
  async editWeekAsShop(user: AuthenticatedUser, patch: ShopWeekPatch & { lang?: string }) {
    const tenantId = this.tenantId(user);
    const loose = this.prisma as unknown as Record<string, {
      findFirst: (a: unknown) => Promise<unknown>;
      update: (a: unknown) => Promise<unknown>;
    }>;
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true, city: true, timezone: true } as never })
      .catch(() => null) as { name?: string | null; city?: string | null; timezone?: string | null } | null;
    const key = weekKey(new Date(), tenant?.timezone || 'America/New_York');
    const row = await loose.contentWeek?.findFirst({ where: { tenantId, weekKey: key } })
      .catch(() => null) as { id: string; generated: Record<string, unknown>; edited: Record<string, unknown> | null } | null;
    if (!row) throw new NotFoundException('Chưa có kế hoạch nào được lưu cho tuần này.');
    const base = (row.edited ?? row.generated ?? {}) as Record<string, unknown>;
    const days = Array.isArray(base.days) ? (base.days as never[]) : [];
    const raw = shopPatchToDays(days, patch);
    if (!raw) return { ok: true, weekKey: key, changed: false };
    const lang = patch.lang === 'en' ? 'en' : 'vi';
    const next = { ...base, days: sanitizeDays(raw, days, lang, { salonName: tenant?.name, city: tenant?.city }) };
    await loose.contentWeek?.update({
      where: { id: row.id },
      data: { edited: next as never, editedById: user.userId ?? null, editedByName: `Tiệm · ${user.email ?? tenant?.name ?? 'salon'}`, editedAt: new Date() },
    }).catch(() => undefined);
    await this.prisma.auditLog.create({
      data: { tenantId, userId: user.userId ?? null, action: 'content.week_edited_by_shop', resourceType: 'content_week', resourceId: key } as never,
    }).catch(() => undefined);
    return { ok: true, weekKey: key, changed: true };
  }

  /**
   * The holidays ahead, each with one programme the shop can say yes to.
   * Sixty days: far enough to prepare stock and staff, near enough to act.
   */
  async holidayIdeasFor(user: AuthenticatedUser): Promise<HolidayIdea[]> {
    const tenantId = this.tenantId(user);
    const ctx = await this.gather(tenantId);
    const { events } = regionEvents(new Date(), {
      market: ctx.region.market, city: ctx.region.city, region: ctx.region.region,
    }, { horizonDays: 60 });
    return holidayIdeas(events, { industry: ctx.industry, ceilingPct: ctx.promo?.ceiling ?? null, horizonDays: 60 });
  }

  /**
   * The shop saying "run this one" — a holiday programme by key, or a
   * programme in its own words. Returned as the line the team reads; the
   * caller files it where the team looks (the shop's own inbox).
   */
  async offerRequestLine(user: AuthenticatedUser, dto: { key?: unknown; text?: unknown }): Promise<string> {
    const key = String(dto?.key ?? '').trim().slice(0, 60);
    const text = String(dto?.text ?? '').replace(/\s+/g, ' ').trim().slice(0, 500);
    if (key) {
      const idea = (await this.holidayIdeasFor(user)).find((i) => i.key === key);
      if (!idea) throw new NotFoundException('Ngày lễ này không còn trong danh sách.');
      return text ? `${ideaAsRequest(idea)} · Tiệm ghi thêm: ${text}` : ideaAsRequest(idea);
    }
    if (!text) throw new BadRequestException('Ghi vài chữ tiệm muốn chạy chương trình gì.');
    return `Tiệm muốn chạy ưu đãi: ${text}`;
  }

  async editWeek(
    user: AuthenticatedUser,
    key: string,
    patch: { focus?: string; days?: unknown; note?: string; lang?: string; reset?: boolean },
  ) {
    const tenantId = this.tenantId(user);
    if (user.role !== UserRole.SUPER_ADMIN && !user.supportSession) {
      throw new ForbiddenException('Chỉ team Lumio sửa được kế hoạch. Tiệm xem và đánh dấu đã làm.');
    }
    const loose = this.prisma as unknown as Record<string, {
      findFirst: (a: unknown) => Promise<unknown>;
      update: (a: unknown) => Promise<unknown>;
    }>;
    const row = await loose.contentWeek?.findFirst({ where: { tenantId, weekKey: key } })
      .catch(() => null) as { id: string; generated: Record<string, unknown>; edited: Record<string, unknown> | null } | null;
    if (!row) throw new NotFoundException('Chưa có kế hoạch nào được lưu cho tuần này.');

    /**
     * Back to the system's own week.
     *
     * Dropping the edit rather than copying the generated plan over it: the
     * generated side is rewritten every hour with fresh numbers, so a copy
     * would freeze this salon on whatever the figures said the moment somebody
     * pressed the button.
     */
    if (patch.reset === true) {
      await loose.contentWeek?.update({
        where: { id: row.id },
        data: { edited: null, editedById: null, editedByName: null, editedAt: null },
      }).catch(() => undefined);
      await this.prisma.auditLog.create({
        data: {
          tenantId, userId: user.userId ?? null,
          action: 'content.week_edit_reset',
          resourceType: 'content_week', resourceId: key,
        } as never,
      }).catch(() => undefined);
      return { ok: true, weekKey: key, edited: false };
    }

    // Edits build on the last edit, or on the generated plan the first time.
    const base = (row.edited ?? row.generated ?? {}) as Record<string, unknown>;
    const next: Record<string, unknown> = { ...base };
    if (typeof patch.focus === 'string') next.focus = patch.focus.slice(0, 300);
    if (typeof patch.note === 'string') next.teamNote = patch.note.slice(0, 2000);
    /**
     * The week's own work, rewritten by a person.
     *
     * Never stored as sent. The days that come back are rebuilt on the
     * skeleton that went out — see ./week-edit — because this JSON is read by
     * the screen, the archive, the nightly drafter, the prompts and the
     * bilingual walk, and a blob shaped by the browser would break all of them
     * a week later, somewhere with no visible connection to the edit.
     */
    if (patch.days !== undefined) {
      const lang = patch.lang === 'en' ? 'en' : 'vi';
      const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true, city: true } as never })
        .catch(() => null) as { name?: string | null; city?: string | null } | null;
      next.days = sanitizeDays(patch.days, (base.days ?? []) as never, lang, { salonName: tenant?.name, city: tenant?.city });
    }

    await loose.contentWeek?.update({
      where: { id: row.id },
      data: {
        edited: next as never,
        editedById: user.userId ?? null,
        editedByName: user.email ?? 'Lumio',
        editedAt: new Date(),
      },
    }).catch(() => undefined);

    await this.prisma.auditLog.create({
      data: {
        tenantId, userId: user.userId ?? null,
        action: 'content.week_edited',
        resourceType: 'content_week', resourceId: key,
      } as never,
    }).catch(() => undefined);
    return { ok: true, weekKey: key, edited: true };
  }


  /**
   * Freeze this week for every active salon, on the hourly tick.
   *
   * The read path freezes the week too, but only for a salon somebody opened.
   * A plan nobody looked at is still the plan that was in force that week, and
   * next Monday this row is the only record that it existed.
   */
  async keepAllWeeks(): Promise<{ kept: number; outcomes: number }> {
    const tenants = await this.prisma.tenant.findMany({
      where: { status: 'ACTIVE', deletedAt: null } as never,
      select: { id: true, timezone: true },
      take: 500,
    }).catch(() => []) as { id: string; timezone: string | null }[];
    let kept = 0;
    let outcomes = 0;
    for (const t of tenants) {
      const ctx = await this.gather(t.id).catch(() => null);
      if (!ctx) continue;
      const plan = await this.weekPlanFor(t.id, ctx).catch(() => null);
      if (!plan) continue;
      const r = await this.keepWeek(t.id, t.timezone || ctx.tz, plan).catch(() => null);
      if (r) kept += 1;
      outcomes += await this.keepOutcome(t.id, t.timezone || ctx.tz).catch(() => 0);
    }
    return { kept, outcomes };
  }


  /**
   * Freeze what a PAST week produced, once, and never again.
   *
   * Written when the week has rolled over and the row has no outcome yet. Once
   * written it is never recomputed: the point of the record is what was true
   * then, and a figure that keeps moving is not a record of anything.
   */
  private async keepOutcome(tenantId: string, tz: string): Promise<number> {
    const loose = this.prisma as unknown as Record<string, {
      findMany: (a: unknown) => Promise<unknown>;
      update: (a: unknown) => Promise<unknown>;
      count?: (a: unknown) => Promise<number>;
    }>;
    const rows = await loose.contentWeek?.findMany({
      where: { tenantId, outcome: null },
      orderBy: { startDate: 'desc' },
      take: 8,
      select: { id: true, weekKey: true, startDate: true, generated: true, edited: true },
    }).catch(() => []) as {
      id: string; weekKey: string; startDate: string;
      generated: { days?: { jobs?: { kind?: string }[] }[] } | null;
      edited: { days?: { jobs?: { kind?: string }[] }[] } | null;
    }[];

    let written = 0;
    for (const w of rows ?? []) {
      if (!isPastWeek(w.weekKey, new Date(), tz)) continue;

      // The frozen record of a salon's week must cover the SALON's week:
      // UTC midnights here filed Sunday-evening bookings under next week.
      // DST-safe: each edge is derived for its own date, not offset by 168h.
      const start = wallTimeToUtc(w.startDate, '00:00', tz);
      const end = wallTimeToUtc(addDaysToKey(w.startDate, 7), '00:00', tz);
      const prevStart = wallTimeToUtc(addDaysToKey(w.startDate, -7), '00:00', tz);

      type Row = { priceCents: number | null; customerId: string | null; startTime: Date };
      const window = async (from: Date, to: Date) => await this.prisma.appointment.findMany({
        where: { tenantId, startTime: { gte: from, lt: to }, status: { notIn: ['CANCELLED', 'NO_SHOW'] } as never },
        select: { priceCents: true, customerId: true, startTime: true },
        take: 5000,
      }).catch(() => [] as Row[]) as Row[];

      const [cur, prev] = await Promise.all([window(start, end), window(prevStart, start)]);

      // A first visit means the customer had NOTHING before this appointment —
      // checked against the whole book, not against the week, or every customer
      // would look new every Monday.
      const ids = Array.from(new Set([...cur, ...prev].map((r) => r.customerId).filter(Boolean))) as string[];
      const earliest = new Map<string, number>();
      if (ids.length) {
        const hist = await this.prisma.appointment.findMany({
          where: { tenantId, customerId: { in: ids }, status: { notIn: ['CANCELLED', 'NO_SHOW'] } as never },
          select: { customerId: true, startTime: true },
          take: 20000,
        }).catch(() => []) as { customerId: string | null; startTime: Date }[];
        for (const h of hist) {
          if (!h.customerId) continue;
          const t = h.startTime.getTime();
          earliest.set(h.customerId, Math.min(earliest.get(h.customerId) ?? t, t));
        }
      }
      const shape = (rows2: Row[]) => rows2.map((r) => ({
        priceCents: r.priceCents ?? 0,
        isFirstVisit: Boolean(r.customerId) && earliest.get(r.customerId as string) === r.startTime.getTime(),
      }));

      const days = ((w.edited ?? w.generated)?.days ?? []) as { jobs?: { kind?: string }[] }[];
      // Rest days are deliberate, not work. Counting them would make a quiet
      // week look like a week somebody ignored.
      const plannedJobs = days.reduce((n, d) => n + (d.jobs ?? []).filter((j) => j.kind !== 'rest').length, 0);

      const dates: string[] = [];
      for (let k = 0; k < 7; k += 1) {
        dates.push(new Date(start.getTime() + k * 86_400_000).toISOString().slice(0, 10));
      }
      const looseIdea = this.prisma as unknown as Record<string, { findMany: (a: unknown) => Promise<unknown> }>;
      const ideas = await looseIdea.contentIdea?.findMany({
        where: { tenantId, forDate: { in: dates } },
        select: { status: true, postedUrl: true },
        take: 200,
      }).catch(() => []) as { status: string; postedUrl: string | null }[];

      const reviewsIn = async (from: Date, to: Date) => (await loose.googleReview?.count?.({
        where: { tenantId, createdAt: { gte: from, lt: to } },
      }).catch(() => 0)) ?? 0;
      const [reviews, prevReviews] = await Promise.all([
        reviewsIn(start, end), reviewsIn(prevStart, start),
      ]);

      const outcome = buildWeekOutcome({
        weekKey: w.weekKey,
        bookings: shape(cur),
        prevBookings: prev.length || w.startDate ? shape(prev) : null,
        reviews,
        prevReviews,
        plannedJobs,
        ideas: ideas ?? [],
      });

      await loose.contentWeek?.update({
        where: { id: w.id },
        data: { outcome: outcome as never, outcomeAt: new Date() },
      }).catch(() => undefined);
      written += 1;
    }
    return written;
  }

  /** The salon accepting the week the team wrote. */
  async approveWeek(user: AuthenticatedUser, key: string) {
    const tenantId = this.tenantId(user);
    const loose = this.prisma as unknown as Record<string, {
      findFirst: (a: unknown) => Promise<unknown>; update: (a: unknown) => Promise<unknown>;
    }>;
    const row = await loose.contentWeek?.findFirst({ where: { tenantId, weekKey: key }, select: { id: true } })
      .catch(() => null) as { id: string } | null;
    if (!row) throw new NotFoundException('Chưa có kế hoạch nào được lưu cho tuần này.');
    await loose.contentWeek?.update({
      where: { id: row.id },
      data: { approvedAt: new Date(), approvedByName: user.email ?? 'Tiệm' },
    }).catch(() => undefined);
    return { ok: true, weekKey: key, approvedAt: new Date() };
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
        take: 40,
        select: { title: true },
      }).catch(() => []),
    ])) as [FormatRow[], NoteRow[], TitleRow[]];

    // ---- the three anchors: live trends, the design season, today's pillar --
    //
    // Cached rows only — the trend feed pulls once a day on its own clock, so
    // this read costs nothing and never blocks drafting on an external API.
    const scope = scopeOf(ctx.industry, ctx.region.market);
    const looseTrend = this.prisma as unknown as { trendSnapshot?: { findMany: (a: unknown) => Promise<unknown> } };
    const trendRows = await looseTrend.trendSnapshot?.findMany({
      where: { scope, OR: [{ tenantId: null }, { tenantId }] },
      select: { source: true, items: true },
    }).catch(() => []) as { source: string; items: unknown }[] ?? [];
    const trendItems: TrendForPrompt[] = [];
    const trendRising: RisingForPrompt[] = [];
    for (const row of trendRows) {
      if (!Array.isArray(row.items)) continue;
      if (row.source === 'youtube' || row.source === 'instagram') {
        for (const it of row.items.slice(0, 4) as { title?: string; perDay?: number | null; thumbUrl?: string | null; url?: string | null }[]) {
          if (it?.title) trendItems.push({ title: it.title, source: row.source, perDay: it.perDay, thumbUrl: it.thumbUrl, url: it.url });
        }
      } else {
        for (const q of row.items.slice(0, 5) as { query?: string; growthPct?: number | null }[]) {
          if (q?.query) trendRising.push({ query: q.query, growthPct: q.growthPct, source: row.source });
        }
      }
    }
    // Busiest first, so the prompt's five slots go to what is actually moving.
    trendItems.sort((a, b) => (b.perDay ?? 0) - (a.perDay ?? 0));
    const trendBlock = trendsToPrompt(trendItems, trendRising);

    const monthNow = Number(this.localDay(ctx.tz).slice(5, 7));
    const season = seasonFor(ctx.industry, monthNow);
    const seasonBlock = seasonToPrompt(season, monthNow);

    const pillar = pillarFor(ctx.playbook, forDate);
    const pillarBlock = pillarToPrompt(pillar);

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

    // ---- which language the plan is WRITTEN in ----
    //
    // Not the interface language, and not derived from the market either. Both
    // would get this backwards for the customers this product was built for: a
    // Vietnamese owner running a salon in Texas reads the plan in Vietnamese and
    // posts captions in English, because her customers are American. Only the
    // salon can say which it wants, so the column decides and falls back to the
    // behaviour that existed before it.
    const writeEn = ctx.contentLang === 'en';
    const langRule = writeEn
      ? '4. Write in ENGLISH — the plan, the reasons, the captions and the hashtags.'
      : '4. Viết tiếng Việt cho chủ tiệm và đội marketing đọc. Riêng "caption" và "hashtags" viết TIẾNG ANH vì khách hàng cuối là người Mỹ.';

    const system = `Bạn là chuyên gia marketing cho doanh nghiệp địa phương tại Mỹ, đang lập kế hoạch nội dung cho "${ctx.tenantName}"${ctx.city ? ` ở ${ctx.city}` : ''}.

NHIỆM VỤ: đề xuất ĐÚNG 3 ý tưởng nội dung cho hôm nay.
- Ý 1 (rank 1): bài chính, video/reel, đáng công quay nhất.
- Ý 2 (rank 2): video ngắn dễ làm, quay trong 2 phút giữa ca.
- Ý 3 (rank 3): bài ảnh hoặc story đăng bù khi tiệm quá bận.

LUẬT BẮT BUỘC:
1. Mỗi ý phải có trường "reason" nêu CĂN CỨ TỪ SỐ LIỆU THẬT bên dưới. Trích đúng con số. TUYỆT ĐỐI KHÔNG bịa số liệu, không nói "xu hướng cho thấy" nếu dữ liệu không nói vậy.
2. Nếu dữ liệu quá mỏng, nói thẳng trong reason rằng đây là gợi ý nền tảng cho ngành.
3. Về khuyến mãi: BÁM ĐÚNG khuyến nghị đã tính sẵn. Không tự nghĩ mức giảm khác, không đề xuất giảm cho khung giờ bị cấm.
${langRule}
5. Ngắn gọn, cụ thể, quay được ngay. Không sáo rỗng.
6. Về khu vực: chỉ được nhắc tới địa phương nếu phần dữ liệu bên dưới nói rõ tiệm ở đâu. Nếu ghi "chưa rõ khu vực" thì viết trung lập, KHÔNG đoán tên thành phố, bang, trường học hay lễ hội địa phương nào.
7. Ý tưởng hôm nay phải khớp với việc của hôm nay trong LỊCH TUẦN bên dưới — đừng bảo tiệm quay clip vào ngày lịch ghi là ngày đăng. Nếu việc hôm nay ghi CHỦ ĐỀ (sau dấu "—"), ý 1 phải làm đúng chủ đề đó.
8. "title": một dòng ≤ 10 từ, nêu đúng chủ đề, không dùng dấu hai chấm để nối hai vế.
9. ${SHOTLIST_RULES}
10. ${CAPTION_RULES}
11. ${REASON_RULES}

TRẢ VỀ JSON THUẦN, không markdown, không lời dẫn:
{"ideas":[{"rank":1,"formatName":"...","title":"...","hook":"...","shotList":"cảnh 1 · cảnh 2 · cảnh 3","caption":"...","hashtags":"#... #...","bestTime":"18:30","reason":"...","trendTitle":"chỉ điền khi phỏng theo một trend trong danh sách, sao chép đúng nguyên văn tiêu đề"}]}`;

    const week = await this.weekPlanFor(tenantId, ctx);

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
      pillarBlock,
      '',
      seasonBlock,
      '',
      trendBlock,
      '',
      // The raw material this trade actually has to hand. Without it the model
      // reaches for stock ideas ("quay một video giới thiệu tiệm") instead of
      // the finished set sitting on the table right now.
      `NGUỒN QUAY CÓ SẴN CỦA ${viOf(ctx.playbook.trade).toUpperCase()} — ý tưởng phải bắt đầu từ một trong số này:\n`
        + week.sources.map((s) => `- ${viOf(s.label)} (${viOf(s.when)}) — ${viOf(s.why)}`).join('\n'),
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
    const pillarLabel = { vi: viOf(pillar.label), en: enOf(pillar.label) };
    for (const idea of parsed.slice(0, 3)) {
      // The trend the model says it adapted — accepted only when it names a
      // row we actually fed it. That check is what makes the reference image
      // on the card trustworthy: it can never point at an invented clip.
      const claimed = typeof idea.trendTitle === 'string' ? idea.trendTitle.trim().toLowerCase() : '';
      const trendRef = claimed ? trendItems.find((t) => t.title.trim().toLowerCase() === claimed) ?? null : null;
      // Everything in `idea` came out of a model's JSON, so it is `unknown` and
      // has to be coerced before it touches the database — the same String()
      // treatment every other field below gets.
      const rawName = typeof idea.formatName === 'string' ? idea.formatName.trim() : '';
      const match = formats.find((f) => f.name.toLowerCase() === rawName.toLowerCase());
      // Read back against the house standard. A caption that fails is still
      // saved — the person can fix a sentence, and a blank card helps nobody —
      // but it is named in the log, so the prompt gets tightened rather than
      // the failure repeating quietly on every salon.
      const issues = idea.caption ? captionIssues(String(idea.caption)) : [];
      if (issues.length) this.logger.warn(`caption off-standard for ${tenantId} (${String(idea.title ?? '').slice(0, 40)}): ${issues.join(' | ')}`);
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
          signals: {
            ...snapshot,
            trend: trendRef ? { title: trendRef.title, source: trendRef.source, thumbUrl: trendRef.thumbUrl ?? null, url: trendRef.url ?? null } : null,
            pillar: Number(idea.rank) === 1 || created === 0 ? pillarLabel : null,
          } as never,
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
      const ctx = await this.gather(t.id).catch(() => null);
      if (!ctx) continue;

      // Write the resolved location back onto the tenant, once.
      //
      // The content screen works this out on every read, but the rest of the
      // platform reads the tenant columns — so a shop whose state lives only in
      // its address stays "unknown" everywhere else. Filling it here keeps the
      // read path pure and means nobody has to type a city we already know.
      // Only ever fills a blank: a value someone entered by hand outranks one
      // parsed out of an address.
      if (ctx.loc.region && ctx.loc.source !== 'tenant') {
        const cur = await this.prisma.tenant.findUnique({
          where: { id: t.id },
          select: { city: true, region: true, postalCode: true } as never,
        }).catch(() => null) as unknown as { city?: string | null; region?: string | null; postalCode?: string | null } | null;
        const data: Record<string, string> = {};
        if (cur && !cur.region) data.region = ctx.loc.region;
        if (cur && !cur.city && ctx.loc.city) data.city = ctx.loc.city;
        if (cur && !cur.postalCode && ctx.loc.postalCode) data.postalCode = ctx.loc.postalCode;
        if (Object.keys(data).length) {
          await this.prisma.tenant.update({ where: { id: t.id }, data: data as never }).catch(() => undefined);
        }
      }

      if (!ctx.nearbyZips) continue;
      const r = await this.areaFor(t.id, ctx.nearbyZips, { allowFetch: true }).catch(() => null);
      // The demand side warms on the same tick. It is three more requests to a
      // government API once a month per tenant, off the page-load path.
      await this.audienceFor(t.id, ctx.nearbyZips, { allowFetch: true, year: r?.year ?? null }).catch(() => null);
      if (r?.ok) warmed += 1;
    }
    return { warmed };
  }

  /**
   * Read the shops nobody has read yet — the scheduler's entry point.
   *
   * The profile scan was good and ran exactly never on its own. It fires only
   * when a person opens the content screen and presses a button, and that
   * person is Lumio, and Lumio does not open every salon. So a shop sat on
   * `businessType: SALON` — the enum default, not a decision anyone made — and
   * every keyword set, playbook and calendar built downstream was built for a
   * generic salon rather than for the nail bar, spa or barber it actually was.
   *
   * Rate: a few tenants per hourly tick, not the whole table. Each scan is an
   * AI call and two network reads; doing five hundred at once would be a
   * self-inflicted outage on the hour the feature ships.
   *
   * Retry policy, which is the part worth getting right: a shop with no website
   * and no Facebook page has nothing to read, and retrying it hourly for ever
   * would burn calls to learn the same nothing. A shop whose scan failed
   * because the model was briefly down deserves another go. So the marker
   * records the attempt count and the outcome: a failure is retried after a
   * week, three times, and then left alone. Pressing the button always works.
   */
  async scanNewProfiles(limit = 5): Promise<{ scanned: number; saved: number }> {
    // No key, no scan — and no error line per tenant per hour to bury the logs.
    // The Vietnam deployment runs without one by design.
    if (!process.env.ANTHROPIC_API_KEY) return { scanned: 0, saved: 0 };

    const tenants = await this.prisma.tenant.findMany({
      where: { status: 'ACTIVE', deletedAt: null } as never,
      select: { id: true },
      take: 500,
    }).catch(() => []) as { id: string }[];
    if (!tenants.length) return { scanned: 0, saved: 0 };

    const ids = tenants.map((t) => t.id);
    const marks = await this.prisma.setting.findMany({
      where: { tenantId: { in: ids }, key: PROFILE_SCAN_KEY },
      select: { tenantId: true, value: true },
    }).catch(() => []) as { tenantId: string; value: unknown }[];

    const now = Date.now();
    const skip = new Set<string>();
    for (const m of marks) {
      const v = (m.value ?? {}) as { ok?: boolean; tries?: number; at?: string };
      const tries = Number(v.tries ?? 1);
      const age = now - Date.parse(String(v.at ?? '')) || 0;
      // Done, out of attempts, or not yet due for another try.
      if (v.ok || tries >= SCAN_TRIES || age < SCAN_RETRY_DAYS * 86_400_000) skip.add(m.tenantId);
    }

    const todo = ids.filter((id) => !skip.has(id)).slice(0, Math.max(1, limit));
    let saved = 0;
    for (const tenantId of todo) {
      // One salon's bad website must not stop the sweep for the rest.
      const r = await this.scanProfileFor(tenantId).catch(() => null);
      if (r?.saved) saved += 1;
      const prev = marks.find((m) => m.tenantId === tenantId)?.value as { tries?: number } | undefined;
      await this.markScan(tenantId, Boolean(r?.saved), Number(prev?.tries ?? 0) + 1);
    }
    return { scanned: todo.length, saved };
  }

  /** Remember that we tried, so nothing is scanned in a loop for ever. */
  private async markScan(tenantId: string, ok: boolean, tries: number) {
    const value = { ok, tries, at: new Date().toISOString() };
    const row = await this.prisma.setting
      .findFirst({ where: { tenantId, key: PROFILE_SCAN_KEY }, select: { id: true } })
      .catch(() => null);
    if (row?.id) await this.prisma.setting.update({ where: { id: row.id }, data: { value: value as never } }).catch(() => undefined);
    else await this.prisma.setting.create({ data: { tenantId, key: PROFILE_SCAN_KEY, value: value as never } }).catch(() => undefined);
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

  /**
   * Write (or rewrite) the business's own playbook — see trade-profile.ts.
   *
   * Only for a trade with no real built-in book (wantsTradeProfile), only
   * when there is a description to write from, and only when that
   * description has changed since the last time: the fingerprint is stored
   * with the profile. Returns the profile in force, or null when the trade
   * has a built-in book or nothing could be written.
   */
  async ensureTradeProfile(tenantId: string, opts: { force?: boolean } = {}): Promise<TradeProfile | null> {
    const key = process.env.ANTHROPIC_API_KEY || '';
    if (!key) return null;
    const [tenant, profRow, curRow, services] = await Promise.all([
      this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true, businessType: true, market: true } as never })
        .catch(() => null) as Promise<{ name?: string | null; businessType?: string | null; market?: string | null } | null>,
      this.prisma.setting.findFirst({ where: { tenantId, key: 'business_profile' }, select: { value: true } }).catch(() => null),
      this.prisma.setting.findFirst({ where: { tenantId, key: TRADE_PROFILE_KEY }, select: { id: true, value: true } }).catch(() => null),
      this.prisma.service.findMany({ where: { tenantId, isActive: true }, select: { name: true }, take: 40 }).catch(() => []) as Promise<{ name: string }[]>,
    ]);
    const prof = (profRow?.value ?? {}) as Record<string, string>;
    const industry = knownTrades().includes(String(prof.trade ?? '').toUpperCase())
      ? String(prof.trade).toUpperCase()
      : String(tenant?.businessType ?? 'SALON');
    if (!wantsTradeProfile(industry)) return null;
    const whatWeDo = String(prof.whatWeDo ?? '').trim();
    if (whatWeDo.length < 15) return null;
    const names = services.map((x) => x.name);
    const fp = profileFingerprint(prof, names);
    const cur = cleanTradeProfile(curRow?.value);
    if (cur && cur.generatedFrom === fp && !opts.force) return cur;

    const market = String(tenant?.market ?? 'US').toUpperCase();
    const { system, user } = tradeProfilePrompt({
      whatWeDo, whoWeServe: prof.whoWeServe, edge: prof.edge, services: names, market, tenantName: tenant?.name ?? '',
    });
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_AGENT_MODEL || 'claude-haiku-4-5-20251001',
        max_tokens: 3000,
        system,
        messages: [{ role: 'user', content: user }],
      }),
      signal: AbortSignal.timeout(60_000),
    }).catch(() => null);
    if (!res || !res.ok) { this.logger.warn(`trade profile: model call failed for ${tenantId} (${res ? res.status : 'network'})`); return cur; }
    const data = (await res.json().catch(() => ({}))) as { content?: { type?: string; text?: string }[] };
    const text = (data.content || []).filter((c) => c.type === 'text').map((c) => c.text || '').join('').trim();
    const braced = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
    let parsed: unknown = null;
    try { parsed = JSON.parse(braced); } catch { parsed = null; }
    const next = cleanTradeProfile({ ...((parsed ?? {}) as Record<string, unknown>), generatedFrom: fp, generatedAt: new Date().toISOString() });
    if (!next) { this.logger.warn(`trade profile: unusable answer for ${tenantId}`); return cur; }
    if (curRow?.id) await this.prisma.setting.update({ where: { id: curRow.id }, data: { value: next as never } }).catch(() => undefined);
    else await this.prisma.setting.create({ data: { tenantId, key: TRADE_PROFILE_KEY, value: next as never } }).catch(() => undefined);
    this.logger.log(`trade profile written for ${tenantId}: ${next.trade.en}`);
    return next;
  }

  /**
   * The businesses on the catch-all trade that have a description but no
   * playbook of their own yet — a few per tick, each one a model call.
   */
  async writeMissingTradeProfiles(limit = 3): Promise<{ checked: number; written: number }> {
    if (!process.env.ANTHROPIC_API_KEY) return { checked: 0, written: 0 };
    const [profiles, existing, tenants] = await Promise.all([
      this.prisma.setting.findMany({ where: { key: 'business_profile' }, select: { tenantId: true, value: true }, take: 2000 }).catch(() => []) as Promise<{ tenantId: string; value: unknown }[]>,
      this.prisma.setting.findMany({ where: { key: TRADE_PROFILE_KEY }, select: { tenantId: true }, take: 2000 }).catch(() => []) as Promise<{ tenantId: string }[]>,
      this.prisma.tenant.findMany({ where: { status: 'ACTIVE', deletedAt: null } as never, select: { id: true, businessType: true } as never, take: 2000 })
        .catch(() => []) as Promise<{ id: string; businessType?: string | null }[]>,
    ]);
    const has = new Set(existing.map((e) => e.tenantId));
    const enumOf = new Map(tenants.map((t) => [t.id, String(t.businessType ?? 'SALON')]));
    let checked = 0; let written = 0;
    for (const p of profiles) {
      if (written >= limit) break;
      if (has.has(p.tenantId) || !enumOf.has(p.tenantId)) continue;
      const v = (p.value ?? {}) as Record<string, string>;
      const industry = knownTrades().includes(String(v.trade ?? '').toUpperCase()) ? String(v.trade).toUpperCase() : enumOf.get(p.tenantId)!;
      if (!wantsTradeProfile(industry) || String(v.whatWeDo ?? '').trim().length < 15) continue;
      checked += 1;
      const r = await this.ensureTradeProfile(p.tenantId).catch(() => null);
      if (r) written += 1;
    }
    return { checked, written };
  }

  /**
   * One pass over every profile that describes the business but never got a
   * trade: fill it from the words alone (no model call), never over a
   * person's choice. This is how the restaurants and agencies that signed up
   * before the scan learned to read trades stop getting nail content — on
   * the next tick, without anybody pressing "Quét lại" salon by salon.
   */
  async fillMissingTrades(): Promise<{ checked: number; filled: number }> {
    const rows = await this.prisma.setting.findMany({
      where: { key: 'business_profile' },
      select: { id: true, tenantId: true, value: true },
      take: 2000,
    }).catch(() => []) as { id: string; tenantId: string; value: unknown }[];
    let checked = 0;
    let filled = 0;
    for (const r of rows) {
      const v = (r.value ?? {}) as Record<string, string>;
      if (!v.whatWeDo || v.trade || v.tradeSource === 'manual') continue;
      checked += 1;
      const [tenant, services] = await Promise.all([
        this.prisma.tenant.findUnique({ where: { id: r.tenantId }, select: { name: true, businessType: true } }).catch(() => null) as Promise<{ name?: string | null; businessType?: string | null } | null>,
        this.prisma.service.findMany({ where: { tenantId: r.tenantId, isActive: true }, select: { name: true }, take: 40 }).catch(() => []) as Promise<{ name: string }[]>,
      ]);
      const detection = detectIndustry({
        declaredWhatWeDo: v.whatWeDo,
        serviceNames: services.map((x) => x.name),
        tenantName: tenant?.name ?? null,
        currentIndustry: String(tenant?.businessType || 'SALON'),
      });
      const picked = pickTrade({ modelTrade: '', detection, manual: false, known: knownTrades() });
      if (!picked) continue;
      await this.prisma.setting.update({ where: { id: r.id }, data: { value: { ...v, trade: picked, tradeSource: 'auto' } as never } }).catch(() => undefined);
      filled += 1;
    }
    return { checked, filled };
  }

  /**
   * Release every drafted day whose salon morning has begun (see auto-release).
   *
   * Runs on the planner's hourly tick right after drafting, so a day drafted
   * at 10:00 local is on the salon's screen the same minute, and one drafted
   * at 03:00 waits for the 07:00 tick — the hours a person may still sweep
   * the queue. A salon held with Setting content_release {mode:'manual'} is
   * left for the queue. Idempotent: published rows are not drafts.
   */
  async releaseDue(now = new Date()): Promise<{ released: number; tenants: number }> {
    const drafts = await this.prisma.contentIdea.findMany({
      where: { status: 'draft' },
      select: { id: true, tenantId: true, forDate: true },
      take: 2000,
    }).catch(() => []) as { id: string; tenantId: string; forDate: string }[];
    if (!drafts.length) return { released: 0, tenants: 0 };
    const tenantIds = Array.from(new Set(drafts.map((d) => d.tenantId)));
    const [tenants, holds] = await Promise.all([
      this.prisma.tenant.findMany({ where: { id: { in: tenantIds } }, select: { id: true, timezone: true } }).catch(() => []) as Promise<{ id: string; timezone: string | null }[]>,
      this.prisma.setting.findMany({ where: { tenantId: { in: tenantIds }, key: 'content_release' }, select: { tenantId: true, value: true } }).catch(() => []) as Promise<{ tenantId: string; value: unknown }[]>,
    ]);
    const tzOf = new Map(tenants.map((t) => [t.id, t.timezone || 'America/Los_Angeles']));
    const modeOf = new Map(holds.map((h) => [h.tenantId, String((h.value as { mode?: string } | null)?.mode ?? '')]));
    const due = drafts.filter((d) => {
      const tz = tzOf.get(d.tenantId);
      if (!tz) return false; // a tenant that is gone keeps nothing on any screen
      return dueForRelease({ forDate: d.forDate, localDay: this.localDay(tz, now), localHour: localHourIn(tz, now), mode: modeOf.get(d.tenantId) });
    });
    if (!due.length) return { released: 0, tenants: 0 };
    const r = await this.prisma.contentIdea.updateMany({
      where: { id: { in: due.map((d) => d.id) }, status: 'draft' },
      data: { status: 'published', publishedAt: now },
    }).catch(() => ({ count: 0 }));
    return { released: r.count, tenants: new Set(due.map((d) => d.tenantId)).size };
  }

  /**
   * The trade this tenant's content engine works in: what the business
   * declared, falling back to the businessType enum. Kept in one place so the
   * two readers can never disagree about which industry a salon is in.
   */
  private async industryOf(tenantId: string, businessType: string | null): Promise<string> {
    const row = await this.prisma.setting
      .findFirst({ where: { tenantId, key: 'business_profile' }, select: { value: true } })
      .catch(() => null);
    const declared = String((row?.value as { trade?: string } | null)?.trade ?? '').toUpperCase();
    return knownTrades().includes(declared) ? declared : String(businessType ?? 'SALON');
  }

  // ---- reading ------------------------------------------------------------

  /** What a salon sees. Published only — drafts belong to the Lumio team. */
  async forSalon(user: AuthenticatedUser, date?: string) {
    const tenantId = this.tenantId(user);
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { timezone: true, businessType: true } });
    const tz = tenant?.timezone || 'America/Los_Angeles';
    // The same declared-trade-then-enum order gather() uses. Reading the enum
    // here alone would file this salon's trend notes under a different
    // industry than every other part of the engine — the notes would simply
    // never appear, with nothing on screen to say why.
    const industry = await this.industryOf(tenantId, (tenant as { businessType?: string } | null)?.businessType ?? null);
    const forDate = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : this.localDay(tz);
    const [ideas, notes] = await Promise.all([
      this.prisma.contentIdea.findMany({
        where: { tenantId, forDate, status: { in: ['published', 'filmed', 'posted', 'skipped'] } },
        orderBy: { rank: 'asc' },
      }).catch(() => []),
      this.prisma.trendNote.findMany({
        where: { industry: industry, active: true, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
        orderBy: { createdAt: 'desc' }, take: 2,
      }).catch(() => []),
    ]);
    return { forDate, ideas, trendNotes: notes };
  }

  /**
   * Does the SALON see its plan yet?
   *
   * The same question, and the same evidence, as SuggestionsService.hasAgencyWork
   * — asked here so the team's own screen can say which side of the line this
   * salon is on. Duplicated as a query, not as a rule: the rule itself lives in
   * one place (./agency-work) and both callers read it from there.
   */
  private async shopSeesPlan(tenantId: string): Promise<boolean> {
    const loose = this.prisma as unknown as Record<string, {
      findFirst: (a: unknown) => Promise<unknown>;
      findMany: (a: unknown) => Promise<unknown>;
    }>;
    const [sug, post, weeks, offer] = await Promise.all([
      loose.contentSuggestion?.findFirst({ where: { tenantId, NOT: { createdByName: 'shop' } }, select: { id: true } }).catch(() => null),
      loose.scheduledPost?.findFirst({ where: { tenantId }, select: { id: true } }).catch(() => null),
      loose.contentWeek?.findMany({
        where: { tenantId }, orderBy: { startDate: 'desc' }, take: 8,
        select: { edited: true, approvedAt: true, ticks: true },
      }).catch(() => []) as Promise<{ edited?: unknown; approvedAt?: unknown; ticks?: unknown }[]>,
      this.prisma.setting.findFirst({ where: { tenantId, key: 'content_offer' }, select: { id: true } }).catch(() => null),
    ]);
    return hasAgencyWork({
      teamSuggestion: Boolean(sug),
      scheduledPost: Boolean(post),
      weeks: Array.isArray(weeks) ? weeks : [],
      offerSet: Boolean(offer),
    });
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
    const shopSees = await this.shopSeesPlan(tenantId).catch(() => false);
    // The demand side. Deliberately built from the Census and the shop's own
    // description — NOT from its booking history. "Who should I target?" is a
    // question about the people who have never been in the book, and a shop
    // with twenty-two bookings has almost no history to reason from anyway.
    const audience = await this.audienceFor(tenantId, ctx.nearbyZips, { allowFetch: false }).catch(() => null);
    const market = audience
      ? buildMarketPlan({
        area: audience,
        industry: ctx.industry,
        declaredWhoWeServe: ctx.identity.profile.whoWeServe || null,
        declaredWhatWeDo: ctx.identity.profile.whatWeDo || null,
        firstVisitTicketCents: ctx.firstVisitTicketCents,
        grossMarginPct: ctx.promo.margin.grossMarginPct,
        cpaCeilingCents: ads?.ceiling.strictCents ?? null,
        openSlots: ads?.budget.openSlots ?? null,
        campaignDays: ads?.budget.days ?? 14,
        city: ctx.region.city,
        region: ctx.region.region,
        money: ctx.money,
      })
      : null;
    const generatedWeek = await this.weekPlanFor(tenantId, ctx);
    // Frozen on read, so the archive exists even for a salon nobody opens on a
    // Monday. Idempotent per (tenant, week) — extra reads cost one upsert.
    const kept = await this.keepWeek(tenantId, ctx.tz, generatedWeek).catch(() => null);
    // The team's version is what the salon reads, when there is one.
    const week = kept?.edited
      ? ((await this.weekAtRaw(user, kept.weekKey).catch(() => null))?.week as typeof generatedWeek) ?? generatedWeek
      : generatedWeek;
    // Built once with every phrase in both languages (see ./i18n), then
    // rendered twice below. The screen picks; nothing in here has to know which
    // language the person looking at it reads.
    const payload = {
      // Where we think the salon is, and how sure we are. The screen shows this
      // so a wrong city gets corrected by the person who knows, instead of
      // quietly skewing every suggestion for months.
      region: {
        label: ctx.region.label, known: ctx.region.regionKnown, market: ctx.region.market,
        // Named source when we know, and a fix the SHOP can carry out when we
        // do not. The old copy sent the owner to a screen only our staff can
        // open, for data the shop had already given us.
        source: ctx.loc.sourceLabel, fix: ctx.loc.fix,
      },
      // The trade this engine thinks the business is in. On screen next to the
      // region, because "everything looks like a nail salon" is a symptom with
      // two causes — the industry not being set, or the industry being set and
      // ignored — and only one line of UI tells them apart.
      industry: { code: ctx.industry, trade: ctx.playbook.trade },
      // The label the screen shows. The business's own sentence when it has
      // given one; the enum is demoted to a footnote beside it.
      contentLang: ctx.contentLang,
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
      // Which week this is, and whether a human has been through it.
      weekMeta: kept ? {
        ...kept,
        label: weekLabel(kept.weekKey),
        canEdit: user.role === UserRole.SUPER_ADMIN || Boolean(user.supportSession),
        // Is the SHOP seeing this plan on its own screen yet? The rule (see
        // agency-work) is invisible from here otherwise, and a team that
        // cannot tell has to go and log in as the salon to find out.
        shopSees,
      } : null,
      // The offer form's current values — the team edits them on the plan.
      // (`offer` below is the system's advice; this is the person's decision.)
      offerForm: ctx.offer,
      currencySign: currencySign(ctx.currency),
      videoFeeds: ctx.tradeProfile ? feedsOf(ctx.tradeProfile) : videoFeeds(ctx.industry, ctx.region.market),
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
      // Who is out there, before anything about who has already been in.
      market: market ? {
        ...market,
        maxSpend: market.maxSpendCents !== null ? ctx.money(market.maxSpendCents) : null,
      } : null,
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
        runDayLabels: (ads?.window.labels.run ?? []).map(viOf),
        pauseDayLabels: (ads?.window.labels.pause ?? []).map(viOf),
        money: ctx.money,
      }),
      seo: await this.seoFor(tenantId, ctx).catch(() => null),
      // The keyword map for this trade in this market: what to write and what
      // to bid on. Placeholders are filled here rather than on the screen —
      // the salon's own city and name are the whole point of a local keyword,
      // and a template shown raw is a template that gets copied raw into an
      // ad account.
      keywordPlan: this.keywordPlanFor(ctx),
      lapsed: ctx.revenue.lapsed,
      quietSlots: ctx.revenue.loads.slice(0, 3),
      busySlots: [...ctx.revenue.loads].reverse().slice(0, 3),
      topYields: ctx.revenue.yields.slice(0, 3),
      thin: ctx.signals.thin,
    };

    // Vietnamese is the shape callers already expect, so it stays at the top
    // level; the English rendering rides alongside under `en`. A client that
    // predates this keeps working and simply never reads `en`.
    return { ...localizeDeep(payload, 'vi'), en: localizeDeep(payload, 'en') };
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
  ): Promise<CensusResult & { lines: Txt[]; cachedAt?: string }> {
    const blank: CensusResult = { ok: false, year: null, zips: [], totalPopulation: null, weightedMedianIncomeUsd: null };
    if (!zips) {
      return {
        ...blank,
        lines: [],
        error: bi(
          'Chưa có mã ZIP nào của tiệm. Thêm địa chỉ (có ZIP) ở Cài đặt tiệm → Thông tin công ty, hoặc bấm "Quét & học tự động".',
          'No ZIP code on file for the shop. Add an address with a ZIP under Shop settings → Company info, or press "Scan & learn automatically".'),
      };
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
        : {
          ...blank,
          lines: [],
          error: bi(
            'Đang lấy số liệu dân cư cho khu vực này — hệ thống tự chạy nền mỗi giờ, không cần thao tác.',
            'Still pulling the population figures for this area — the system does it in the background every hour, nothing for you to do.'),
        };
    }

    const r = await fetchCensus(zips, { apiKey: process.env.CENSUS_API_KEY || null });
    if (r.ok) {
      const value = { at: new Date().toISOString(), zips, data: r };
      if (row?.id) await this.prisma.setting.update({ where: { id: row.id }, data: { value: value as never } }).catch(() => undefined);
      else await this.prisma.setting.create({ data: { tenantId, key: KEY, value: value as never } }).catch(() => undefined);
    } else {
      this.logger.warn(`census failed for ${tenantId}: ${r.diagnostic ?? viOf(r.error)}`);
      // Serve stale-but-real figures rather than nothing, and say they are old.
      if (cached.data?.ok) return { ...cached.data, lines: describeArea(cached.data), cachedAt: cached.at };
    }
    return { ...r, lines: describeArea(r) };
  }

  /**
   * The demand side: who lives around the shop, cached for a month.
   *
   * Same discipline as areaFor — page loads read the cache and stop, the hourly
   * tick fills it. Kept in its own cache key rather than folded into
   * `census_cache` so that a failure in one does not blank the other: the
   * headline population figure and the age/income breakdown come from different
   * Census tables and fail independently.
   */
  async audienceFor(
    tenantId: string,
    zips: string | null,
    opts: { allowFetch?: boolean; year?: number | null } = {},
  ): Promise<AreaAudience | null> {
    if (!zips) return null;
    const KEY = 'census_audience_cache';
    const row = await this.prisma.setting.findFirst({ where: { tenantId, key: KEY }, select: { id: true, value: true } }).catch(() => null);
    const cached = (row?.value ?? {}) as { at?: string; zips?: string; data?: AreaAudience };
    const fresh = cached.at && Date.now() - Date.parse(cached.at) < 30 * 86_400_000;
    if (fresh && cached.zips === zips && cached.data?.ok) return cached.data;
    if (opts.allowFetch === false) return cached.data?.ok ? cached.data : null;

    const r = await fetchAreaAudience(normaliseZips(zips), {
      apiKey: process.env.CENSUS_API_KEY || null,
      ...(opts.year ? { year: opts.year } : {}),
    });
    if (r.ok) {
      const value = { at: new Date().toISOString(), zips, data: r };
      if (row?.id) await this.prisma.setting.update({ where: { id: row.id }, data: { value: value as never } }).catch(() => undefined);
      else await this.prisma.setting.create({ data: { tenantId, key: KEY, value: value as never } }).catch(() => undefined);
    } else {
      this.logger.warn(`census audience failed for ${tenantId}: ${r.notes.map(viOf).join(' | ')}`);
      if (cached.data?.ok) return cached.data;
    }
    return r;
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
  /**
   * The shop said yes. File WHAT it said yes to, not just that it did.
   *
   * The approval used to write one line into the team's inbox and nothing
   * else, so the day-7 promise had no campaign to be seven days into. The row
   * holds the agreed figures: a review that reports against a budget nobody
   * recorded is a review about nothing.
   */
  async approveAdsCampaign(user: AuthenticatedUser): Promise<void> {
    const tenantId = this.tenantId(user);
    const pitch = await this.adsPitchForSalon(user);
    if (!pitch || pitch.state !== 'offer') return;
    const ctx0 = await this.gather(tenantId);
    const num = (label: string) => {
      const raw = pitch.figures.find((f) => viOf(f.label) === label)?.value ?? '';
      const n = Number(String(raw).replace(/[^0-9]/g, ''));
      return Number.isFinite(n) && n > 0 ? n : 0;
    };
    const ceiling = cpaCeiling({
      avgTicketCents: ctx0.firstVisitTicketCents ?? ctx0.audience.segments[0]?.avgTicketCents ?? null,
      grossMarginPct: ctx0.promo.margin.grossMarginPct,
      medianGapDays: ctx0.audience.segments.find((sg) => sg.key === 'regular')?.medianGapDays ?? null,
    });
    await this.writeCampaign(tenantId, {
      requestedAt: new Date().toISOString(),
      days: CAMPAIGN_DAYS,
      dailyCents: num('mỗi ngày') * 100,
      ceilingCents: ceiling.strictCents,
      startedAt: null,
      done: {},
    });
  }

  /** A person switched the campaign on. Everything downstream dates from here. */
  async startAdsCampaign(user: AuthenticatedUser, onIso?: string): Promise<{ startedAt: string }> {
    const tenantId = this.tenantId(user);
    const startedAt = (typeof onIso === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(onIso))
      ? onIso
      : new Date().toISOString().slice(0, 10);
    await this.writeCampaign(tenantId, { startedAt });
    return { startedAt };
  }

  /**
   * A review was actually sent. Ticking it is what stops it shouting.
   *
   * `note` is what was changed — the one blank in the generated message, kept
   * here so the next review can say what the last one did, and so "we watched
   * it" can never pass for the service.
   */
  async markAdsReview(user: AuthenticatedUser, day: unknown, note?: unknown): Promise<{ ok: true }> {
    const tenantId = this.tenantId(user);
    const n = Math.max(1, Math.min(365, Math.round(Number(day) || 0)));
    const c = await this.campaignRow(tenantId);
    const done = { ...(c?.done ?? {}) };
    done[String(n)] = {
      at: new Date().toISOString(),
      by: user.email ?? user.userId ?? null,
      ...(typeof note === 'string' && note.trim() ? { note: note.trim().slice(0, 500) } : {}),
    } as never;
    await this.writeCampaign(tenantId, { done });
    return { ok: true };
  }

  /** The campaign row, or a blank one. Never throws — a missing row is "no campaign". */
  private async campaignRow(tenantId: string): Promise<Campaign | null> {
    const row = await this.prisma.setting
      .findFirst({ where: { tenantId, key: ADS_CAMPAIGN_KEY }, select: { value: true } })
      .catch(() => null);
    const v = (row?.value ?? null) as (Partial<Campaign> & { requestedAt?: string }) | null;
    if (!v || !v.days) return null;
    return {
      startedAt: typeof v.startedAt === 'string' ? v.startedAt : null,
      days: Math.max(1, Math.round(Number(v.days) || 14)),
      dailyCents: Math.max(0, Math.round(Number(v.dailyCents) || 0)),
      ceilingCents: typeof v.ceilingCents === 'number' ? v.ceilingCents : null,
      done: (v.done ?? {}) as Campaign['done'],
    };
  }

  private async writeCampaign(tenantId: string, patch: Record<string, unknown>): Promise<void> {
    const row = await this.prisma.setting
      .findFirst({ where: { tenantId, key: ADS_CAMPAIGN_KEY }, select: { id: true, value: true } })
      .catch(() => null);
    const next = { ...((row?.value ?? {}) as object), ...patch };
    if (row?.id) {
      await this.prisma.setting.update({ where: { id: row.id }, data: { value: next as never } }).catch(() => null);
    } else {
      await this.prisma.setting.create({ data: { tenantId, key: ADS_CAMPAIGN_KEY, value: next as never } as never }).catch(() => null);
    }
  }

  /**
   * NEW CUSTOMERS THE ADS BROUGHT, INSIDE THE CAMPAIGN'S OWN WINDOW.
   *
   * The monthly receipt answers "this month"; a review answers "since the
   * campaign started", and the two windows are not the same fortnight. Same
   * rule for who counts: a customer whose FIRST appointment ever arrived
   * through a paid channel. Everything else is the sign outside and the friend
   * who recommended them.
   */
  private async paidFirstsSince(tenantId: string, fromIso: string): Promise<number> {
    const from = new Date(`${fromIso}T00:00:00Z`);
    if (Number.isNaN(from.getTime())) return 0;
    type Row = { customerId: string | null; startTime: Date; source?: string | null; utmSource?: string | null; attrReferrer?: string | null; attrLandingUrl?: string | null };
    const appts = await this.prisma.appointment.findMany({
      where: { tenantId, startTime: { gte: from }, status: { notIn: ['CANCELLED', 'NO_SHOW'] } as never },
      select: { customerId: true, startTime: true, source: true, utmSource: true, attrReferrer: true, attrLandingUrl: true } as never,
      take: 5000,
    }).catch(() => [] as Row[]) as Row[];
    const ids = Array.from(new Set(appts.map((a) => a.customerId).filter(Boolean))) as string[];
    if (!ids.length) return 0;
    const hist = await this.prisma.appointment.findMany({
      where: { tenantId, customerId: { in: ids }, status: { notIn: ['CANCELLED', 'NO_SHOW'] } as never },
      select: { customerId: true, startTime: true },
      take: 20000,
    }).catch(() => [] as { customerId: string | null; startTime: Date }[]) as { customerId: string | null; startTime: Date }[];
    const earliest = new Map<string, number>();
    for (const h of hist) {
      if (!h.customerId) continue;
      const t = h.startTime.getTime();
      earliest.set(h.customerId, Math.min(earliest.get(h.customerId) ?? t, t));
    }
    return appts.filter((a) => {
      if (!a.customerId || earliest.get(a.customerId) !== a.startTime.getTime()) return false;
      const p = PLATFORM_OF[bookingChannel({ source: a.source, utmSource: a.utmSource, attrReferrer: a.attrReferrer, attrLandingUrl: a.attrLandingUrl })];
      return p === 'google' || p === 'meta' || p === 'zalo';
    }).length;
  }

  /**
   * WHAT THE TEAM OWES THIS SALON TODAY.
   *
   * Returns null only when there is no campaign at all. A campaign agreed but
   * not started still comes back, because "the shop said yes eleven days ago
   * and nobody switched it on" is exactly the thing a screen has to say out
   * loud.
   */
  async adsReviewFor(tenantId: string, ctx: Awaited<ReturnType<ContentService['gather']>>) {
    const c = await this.campaignRow(tenantId);
    if (!c) return null;
    const todayKey = new Date().toISOString().slice(0, 10);
    if (!c.startedAt) {
      return { started: false, days: c.days, reviews: [], next: null, report: null, salon: ctx.tenantName };
    }
    const reviews = dueReviews(c, todayKey);
    const due = nextReview(c, todayKey);
    if (!due || due.lateDays < 0) {
      return { started: true, days: c.days, startedAt: c.startedAt, reviews, next: due, report: null, salon: ctx.tenantName };
    }

    const elapsed = Math.max(1, Math.min(c.days, Math.round(
      (Date.parse(`${todayKey}T00:00:00Z`) - Date.parse(`${c.startedAt}T00:00:00Z`)) / 86_400_000) + 1));
    const fromAds = await this.paidFirstsSince(tenantId, c.startedAt);
    const sells = pickAdServices(menuWithBookings(ctx.menu, ctx.signals.services), ctx.firstVisitTicketCents);

    const report = reviewReport({
      dayNumber: due.dayNumber,
      days: c.days,
      // No platform figure is stored per campaign, so this is the approved
      // budget for the days actually run — and it says so on the message.
      spentCents: c.dailyCents * elapsed,
      spendEstimated: true,
      fromAds,
      ceilingCents: c.ceilingCents,
      service: sells.names[0] ? { vi: sells.names[0], en: sells.names[0] } : null,
    });
    return {
      started: true, days: c.days, startedAt: c.startedAt, reviews, next: due, report,
      salon: ctx.tenantName,
      job: reviewJobText(due.dayNumber, ctx.tenantName),
    };
  }

  private async adsFor(tenantId: string, ctx: Awaited<ReturnType<ContentService['gather']>>) {
    const regulars = ctx.audience.segments.find((s) => s.key === 'regular');
    const anySeg = ctx.audience.segments[0];
    // The SAME service pick the salon's own card shows. The team's ad copy and
    // keyword list used to be built from the top of the per-chair-hour table,
    // which on a real menu is a five-minute wax — so the build sheet named a
    // service nobody would search for. See ./ad-service.
    const sells = pickAdServices(
      menuWithBookings(ctx.menu, ctx.signals.services),
      ctx.firstVisitTicketCents ?? ctx.audience.segments[0]?.avgTicketCents ?? null,
    );
    const ceiling = cpaCeiling({
      // A first visit, not the biggest segment's average. Advertising buys
      // first visits; pricing them at what a regular spends is how a salon
      // talks itself into paying more for a customer than the customer brings.
      avgTicketCents: ctx.firstVisitTicketCents ?? anySeg?.avgTicketCents ?? null,
      grossMarginPct: ctx.promo.margin.grossMarginPct,
      medianGapDays: regulars?.medianGapDays ?? anySeg?.medianGapDays ?? null,
    });

    // Free capacity to aim at: how many appointments would fit in the quiet
    // blocks over a fortnight, at this salon's own average visit length. A
    // campaign that needs more customers than there are chairs cannot work, and
    // that is worth knowing before the money goes out rather than after.
    //
    // The comment above used to say "at this salon's own average visit length"
    // while the code divided by 60 and multiplied by 2 — a hardcoded thirty
    // minutes for every trade on the platform. An estate agency does not book
    // in half-hours. The service list has the real durations.
    // The load figures cover 28 days of bookings; a campaign runs 14. Comparing
    // a fortnight of budget against a month of empty chairs would say there is
    // twice the room there is, and "feasible" is the check that stops a salon
    // buying customers it cannot seat.
    const LOAD_WINDOW_DAYS = 28;
    const quiet = ctx.revenue.loads.slice(0, 3);
    /**
     * FREE CAPACITY, FROM THE SHOP RATHER THAN FROM ITS BOOKING HISTORY.
     *
     * What stood here measured the gap between the busiest weekday and the
     * quietest three. A salon with two appointments a day, every day, has no
     * gap — so it reported no room, for a shop that was almost entirely empty.
     * A salon being set up got the same answer, and the ad screen used it to
     * refuse a campaign: "your quiet hours only hold 0". See ./ad-capacity for
     * the whole account; the short version is that open hours times chairs is
     * a fact about the salon, and it exists before the first booking does.
     */
    // The busiest single day this salon has worked, so a shop that never filled
    // in its staff list still gets an answer: the loads are weekday x block
    // summed over the window, so one weekday's total divided by the weeks in it
    // is what that day looks like.
    const perWeekday = new Map<number, number>();
    for (const l of ctx.revenue.loads) perWeekday.set(l.weekday, (perWeekday.get(l.weekday) ?? 0) + l.minutes);
    const weeksInWindow = LOAD_WINDOW_DAYS / 7;
    const busiestDayMinutes = perWeekday.size
      ? Math.max(...Array.from(perWeekday.values())) / weeksInWindow
      : null;

    const capacity = adCapacity({
      openMinutesPerWeek: ctx.openMinutesPerWeek,
      openDaysPerWeek: ctx.openDaysPerWeek,
      chairs: ctx.chairs,
      busiestDayMinutes,
      bookedMinutes: ctx.revenue.loads.reduce((sum, l) => sum + l.minutes, 0),
      historyDays: LOAD_WINDOW_DAYS,
      slotMinutes: ctx.avgServiceMinutes,
      campaignDays: CAMPAIGN_DAYS,
    });
    // A salon that is genuinely full is the one case where more traffic has
    // nowhere to sit. Everything else — thin data, no hours on file, no staff
    // yet — comes through as null, and budgetPlan reports 'unknown' rather
    // than printing a zero it cannot stand behind.
    const openSlots = capacity.slots === null ? null : (isFull(capacity) ? 0 : capacity.slots);

    const budget = budgetPlan({ ceiling, openSlots });
    const window = runWindow({
      quietWeekdays: quiet.map((q) => q.weekday),
      busyWeekdays: [...ctx.revenue.loads].reverse().slice(0, 2).map((l) => l.weekday),
      leadDays: ctx.lead.medianDays,
    });
    // How each channel is actually performing, and what to do per platform.
    // Measured on acquisition and retention rather than booking count, because
    // a channel busy with regulars rebooking is not a channel worth buying.
    // A paid Google click lands on the Business Profile, so how thin that
    // profile is belongs in the spending advice, not only in the SEO tab.
    const loose = this.prisma as unknown as Record<string, { count?: (a: unknown) => Promise<number> }>;
    const reviewCount = await loose.googleReview?.count?.({ where: { tenantId } }).catch(() => null) ?? null;

    const { reports, coverage, caveat } = channelReports(ctx.channelBookings, Date.now());
    const plans = platformPlans(reports, {
      grossMarginPct: ctx.promo.margin.grossMarginPct,
      firstVisitTicketCents: ctx.firstVisitTicketCents,
      openSlots,
      runDayLabels: window.labels.run,
      pauseDayLabels: window.labels.pause,
      quietLabels: quiet.map((q) => q.label),
      leadDays: ctx.lead.medianDays,
      topServiceName: sells.names[0] ?? ctx.signals.services[0]?.name ?? null,
      city: ctx.region.city,
      region: ctx.region.region,
      lapsedCount: ctx.revenue.lapsed.count,
      customerCount: ctx.audience.totalCustomers,
      reviewCount: reviewCount,
      market: ctx.region.market,
      money: ctx.money,
    });

    // The year's rhythm on top of the fortnight's: the same money placed
    // against the dates people book for. See ./ads-calendar.
    const calendar = adsCalendar({
      baseDailyCents: budget.dailyCents,
      events: regionEvents(new Date(), {
        market: ctx.region.market, city: ctx.region.city, region: ctx.region.region,
      }, { horizonDays: 90 }).events,
      leadDays: ctx.lead.medianDays,
    });

    // Who else the customer sees. Read from Google's own index once a month,
    // and simply absent when no key is configured — see ./places.service.
    const competition = await this.places.scan(tenantId, {
      trade: viOf(ctx.playbook.trade),
      city: ctx.region.city,
      region: ctx.region.region,
      postalCode: ctx.loc?.postalCode ?? null,
      salonName: viOf(ctx.identity.label) || ctx.tenantName || null,
    }).catch(() => null);

    return {
      ceiling,
      budget,
      window,
      competition,
      calendar: {
        ...calendar,
        baseDaily: ctx.money(calendar.baseDailyCents),
        periods: calendar.periods.map((p) => ({ ...p, daily: ctx.money(p.dailyCents), total: ctx.money(p.totalCents) })),
        months: calendar.months.map((m) => ({ ...m, total: ctx.money(m.totalCents), flat: ctx.money(m.flatCents) })),
      },
      lead: ctx.lead,
      channels: {
        reports: reports.map((r) => ({
          ...r,
          revenue: ctx.money(r.revenueCents),
          avgTicket: ctx.money(r.avgTicketCents),
          valuePerAcquired: r.valuePerAcquiredCents !== null ? ctx.money(r.valuePerAcquiredCents) : null,
        })),
        coverage,
        caveat,
      },
      plans: plans.map((p) => ({
        ...p,
        ceiling: p.ceilingCents !== null ? ctx.money(p.ceilingCents) : null,
        daily: p.dailyCents !== null ? ctx.money(p.dailyCents) : null,
        total: p.totalCents !== null ? ctx.money(p.totalCents) : null,
        // The form, filled in — but only for the campaign we are actually
        // telling them to run. Printing a full build sheet for a platform the
        // plan says to leave alone is how a "hold" gets built by mistake.
        spec: p.dailyCents !== null
          ? buildCampaignSpec({
            platform: p.platform,
            businessName: viOf(ctx.identity.label) || null,
            city: ctx.region.city,
            region: ctx.region.region,
            topServiceName: sells.names[0] ?? ctx.signals.services[0]?.name ?? null,
            offerHeadline: null,
            reviewCount,
            bookingUrl: null,
            lapsedCount: ctx.revenue.lapsed.count,
            runDayLabels: window.labels.run,
            quietLabel: quiet[0]?.label ?? null,
            dailyCents: p.dailyCents,
            days: p.days,
            ceilingCents: p.ceilingCents,
            targetBookings: p.bookingsToBreakEven,
            weekKey: weekKey(new Date(), ctx.tz),
            money: ctx.money,
          })
          : null,
      })),
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
      // The review the card promised the shop. Null when no campaign was ever
      // agreed; present and shouting when one is agreed and nobody started it.
      review: await this.adsReviewFor(tenantId, ctx),
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
   * The keyword map for this trade in this market: what to write about and what
   * to bid on.
   *
   * Placeholders are filled here rather than on the screen. The salon's own city
   * and name are the whole point of a local keyword, and a template shown raw is
   * a template that gets copied raw into an ad account or an H1.
   */
  private keywordPlanFor(ctx: {
    industry?: string | null;
    region: { market?: string | null; city?: string | null; label: string };
    tenantName: string;
  }) {
    const tk = tradeKeywordsFor(ctx.industry, ctx.region.market);
    const vals = { city: ctx.region.city || ctx.region.label, brand: ctx.tenantName, year: new Date().getFullYear() };
    return {
      adGroups: tk.adGroups.map((g) => ({
        name: viOf(g.name), intent: g.intent, note: viOf(g.note),
        keywords: g.keywords.map((k) => fillKeyword(k, vals)),
      })),
      seoTopics: tk.seoTopics.map((t2) => ({
        title: fillKeyword(viOf(t2.title), vals), kind: t2.kind, why: viOf(t2.why),
        targets: t2.targets.map((k) => fillKeyword(k, vals)),
      })),
    };
  }

  /**
   * The first thing anyone can say about a new salon, with the confidence
   * attached.
   *
   * This exists because the platform could already produce a complete plan for
   * a shop it had never looked at, and that plan was indistinguishable from one
   * built on real data. The report below states which it is — every fact filed
   * with its source, every gap filed with what it costs — so nobody quotes a
   * catalog back to a client as an audit.
   */
  async onboardingReport(user: AuthenticatedUser) {
    const tenantId = this.tenantId(user);
    const ctx = await this.gather(tenantId);
    const seo = await this.seoFor(tenantId, ctx).catch(() => null);

    const loose = this.prisma as unknown as Record<string, { findFirst?: (a: unknown) => Promise<unknown>; findUnique?: (a: unknown) => Promise<unknown> }>;
    const [extraRow, scanRow, roadmapRow, services, msgConn, msgPage, gbpConn] = await Promise.all([
      this.prisma.setting.findFirst({ where: { tenantId, key: 'company_extra' }, select: { value: true } }).catch(() => null),
      this.prisma.setting.findFirst({ where: { tenantId, key: PROFILE_SCAN_KEY }, select: { value: true } }).catch(() => null),
      this.prisma.setting.findFirst({ where: { tenantId, key: SEO_ROADMAP_KEY }, select: { value: true } }).catch(() => null),
      this.prisma.service.findMany({ where: { tenantId, isActive: true }, select: { name: true }, take: 40 }).catch(() => []),
      loose.messengerConnection?.findUnique?.({ where: { tenantId }, select: { pageId: true } }).catch(() => null) ?? null,
      loose.messengerPage?.findFirst?.({ where: { tenantId }, select: { pageId: true } }).catch(() => null) ?? null,
      loose.marketingChannelConnection?.findFirst?.({ where: { tenantId, platform: 'gbp' }, select: { id: true } }).catch(() => null) ?? null,
    ]);

    const checks: Record<string, string> = {};
    for (const c of seo?.checks ?? []) checks[c.key] = c.state;
    const stored = (roadmapRow?.value ?? {}) as { tier?: string; ticks?: Record<string, { done?: boolean; at?: string; by?: string }> };
    const ticks = stored.ticks ?? (stored as Record<string, { done?: boolean; at?: string; by?: string }>);
    const tier = asTier(stored.tier);
    const roadmap = buildRoadmap(checks, ticks, tier);

    // One-off manual jobs only. A measured row cannot be "done" by a person,
    // and a recurring row is not a first-month milestone — it is the rhythm
    // that starts afterwards and never stops.
    const todo = roadmap.tracks
      .flatMap((t) => t.phases.flatMap((p) => p.tasks))
      .filter((t) => t.state === 'todo' && !t.recurring && t.kind === 'manual')
      .map((t) => ({ id: t.id, title: t.title, minutes: t.minutes ?? 30, track: t.track }));

    const plan = this.keywordPlanFor(ctx);
    const scan = scanRow?.value as { at?: string; ok?: boolean } | null;
    const website = String(((extraRow?.value ?? {}) as { website?: string }).website ?? '').trim() || null;

    const out = buildOnboardingReport({
      shopName: ctx.tenantName,
      tradeLabel: ctx.identity.label,
      region: { label: ctx.region.label, city: ctx.region.city, regionKnown: ctx.region.regionKnown },
      identity: { declared: ctx.identity.declared, filled: ctx.identity.filled, profile: ctx.identity.profile },
      services: (services as { name: string }[]).map((x) => ({ name: x.name })),
      website,
      facebookConnected: Boolean((msgConn as { pageId?: string } | null)?.pageId || (msgPage as { pageId?: string } | null)?.pageId),
      gbpConnected: Boolean((gbpConn as { id?: string } | null)?.id),
      scan: scan ? { at: scan.at ?? null, ok: Boolean(scan.ok) } : null,
      seo: {
        measured: seo?.measured ?? 0,
        unknown: seo?.unknown ?? 0,
        failing: seo?.failing ?? 0,
      },
      tier,
      weeksToGoal: {
        map: roadmap.tracks.find((t) => t.track === 'map')?.weeksToGoal ?? [0, 0],
        web: roadmap.tracks.find((t) => t.track === 'web')?.weeksToGoal ?? [0, 0],
      },
      todo,
      keywords: {
        // The primary term of each page to build: the first target is the one
        // that goes in the title and the H1, so it is the one worth showing.
        primary: plan.seoTopics.map((t) => t.targets[0]).filter(Boolean).slice(0, 8),
        pages: plan.seoTopics.length,
      },
    });

    // Both languages: the agency reads this in Vietnamese and some of them
    // forward it to an English-speaking owner without rewriting a word.
    return { ...localizeDeep(out, 'vi'), en: localizeDeep(out, 'en') };
  }

  // ---- the Google Maps roadmap -------------------------------------------

  /**
   * The roadmap for one salon: the catalog, plus what the system measured,
   * plus what a person ticked.
   *
   * The SEO report is rebuilt here rather than cached, because a task's state
   * has to be true at the moment it is read. A checklist showing yesterday's
   * answer is the one failure mode that makes people stop trusting it.
   */
  async seoRoadmap(user: AuthenticatedUser) {
    const tenantId = this.tenantId(user);
    const ctx = await this.gather(tenantId);
    const report = await this.seoFor(tenantId, ctx).catch(() => null);
    const checks: Record<string, string> = {};
    for (const c of report?.checks ?? []) checks[c.key] = c.state;

    const row = await this.prisma.setting
      .findFirst({ where: { tenantId, key: SEO_ROADMAP_KEY }, select: { value: true } })
      .catch(() => null);
    const stored = (row?.value ?? {}) as { tier?: string; ticks?: Record<string, { done?: boolean; at?: string; by?: string }> };
    // Older rows stored the ticks at the top level, before the tier existed.
    // Read both shapes rather than migrating: a salon that ticked ten boxes
    // last week must not open the board to find them gone.
    const ticks = stored.ticks ?? (stored as Record<string, { done?: boolean; at?: string; by?: string }>);

    // The keyword map rides with the board. "Build a keyword list" as a bare
    // instruction is where every one of these plans stalls; the list itself,
    // already filled with this salon's city and name, is the difference between
    // a task someone reads and a task someone does.
    return localizeDeep(
      { ...buildRoadmap(checks, ticks, asTier(stored.tier)), keywords: this.keywordPlanFor(ctx) },
      'vi',
    );
  }

  /** The market this salon competes in. Declared by whoever looked at the map —
   *  nothing here can count the shops in a five-mile radius. */
  async setSeoTier(user: AuthenticatedUser, tier: unknown) {
    const tenantId = this.tenantId(user);
    await this.writeRoadmap(tenantId, (cur) => ({ ...cur, tier: asTier(tier) as Tier }));
    return this.seoRoadmap(user);
  }

  /** Read-modify-write of the roadmap row, in the one shape everything uses. */
  private async writeRoadmap(
    tenantId: string,
    change: (cur: { tier?: string; ticks?: Record<string, unknown> }) => Record<string, unknown>,
  ) {
    const row = await this.prisma.setting
      .findFirst({ where: { tenantId, key: SEO_ROADMAP_KEY }, select: { id: true, value: true } })
      .catch(() => null);
    const raw = (row?.value ?? {}) as Record<string, unknown>;
    const cur = raw.ticks || raw.tier
      ? (raw as { tier?: string; ticks?: Record<string, unknown> })
      : { ticks: raw as Record<string, unknown> };
    const next = change(cur);
    if (row?.id) await this.prisma.setting.update({ where: { id: row.id }, data: { value: next as never } });
    else await this.prisma.setting.create({ data: { tenantId, key: SEO_ROADMAP_KEY, value: next as never } });
  }

  /** Tick or untick one manual task. Measured tasks refuse: their answer comes
   *  from the numbers, and an override would make the whole board a guess. */
  async setSeoTask(user: AuthenticatedUser, taskId: string, done: boolean) {
    const tenantId = this.tenantId(user);
    if (!manualTaskIds().includes(taskId)) {
      throw new BadRequestException('Mục này do hệ thống tự xác nhận, không tích tay được.');
    }
    await this.writeRoadmap(tenantId, (cur) => ({
      ...cur,
      ticks: {
        ...(cur.ticks ?? {}),
        // The timestamp is what makes a recurring job expire with its period,
        // so it is written even when unticking — a tick with no date would be
        // permanently "done" for weekly work.
        [taskId]: done
          ? { done: true, at: new Date().toISOString(), by: user.email ?? user.userId ?? null }
          : { done: false, at: new Date().toISOString() },
      },
    }));
    return this.seoRoadmap(user);
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
  /**
   * Which language this salon's plan is written in.
   *
   * 'auto' clears the column and restores the behaviour that existed before it:
   * Vietnamese explanation, English captions. That is the right default for the
   * customers this was built for — Vietnamese owners with American customers —
   * and it must stay reachable, not become a thing you can only leave.
   */
  async setContentLang(user: AuthenticatedUser, lang: unknown) {
    const tenantId = this.tenantId(user);
    const value = lang === 'en' || lang === 'vi' ? lang : null;
    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: { contentLang: value } as never,
    });
    return { ok: true, contentLang: value };
  }

  /**
   * The HTTP shape: the same scan, rendered in both languages like the plan.
   */
  async scanProfile(user: AuthenticatedUser, opts: { note?: string } = {}) {
    const out = await this.scanProfileRaw(user, opts);
    return { ...localizeDeep(out, 'vi'), en: localizeDeep(out, 'en') };
  }

  private async scanProfileRaw(user: AuthenticatedUser, opts: { note?: string } = {}) {
    return this.scanProfileFor(this.tenantId(user), opts);
  }

  /**
   * The scan, keyed by tenant rather than by whoever pressed the button.
   *
   * Split out so the scheduler can run it. The scan was excellent and ran
   * exactly never on its own: a salon that nobody opened the screen for kept
   * `businessType: SALON` — the enum default — for ever, and every keyword,
   * playbook and calendar downstream was built for a generic salon rather than
   * for the nail bar, spa or barber it actually was.
   */
  async scanProfileFor(tenantId: string, opts: { note?: string } = {}): Promise<{
    draft: Record<string, string>; sources: Txt[]; warnings: Txt[];
    saved: boolean; locationSaved: string | null;
  }> {
    // The warnings are read on the same screen as the plan, by the same person,
    // in whichever language they set. `draft` is the AI's Vietnamese prose about
    // the business itself and is NOT translated here — which language the model
    // writes in is its own setting, one toggle further down that screen.
    const note = String(opts.note ?? '').trim().slice(0, 1000);
    const warnings: Txt[] = [];
    const sources: Txt[] = [];
    const chunks: string[] = [];

    const extra = await this.prisma.setting.findFirst({ where: { tenantId, key: 'company_extra' }, select: { value: true } }).catch(() => null);
    const website = String(((extra?.value ?? {}) as { website?: string }).website ?? '').trim();

    if (website) {
      try {
        const r = await readWebsite(website);
        chunks.push(`--- ${r.source} ---\n${r.text}`);
        sources.push(r.source);
      } catch (e) {
        // A SiteReadError carries the site's own failure, which is one language
        // by nature; only our own fallback sentence has two.
        warnings.push(e instanceof SiteReadError ? e.message : bi('Không đọc được website.', 'Could not read the website.'));
      }
    } else {
      warnings.push(bi(
        'Chưa có địa chỉ website trong phần cài đặt tiệm.',
        'No website address in the salon settings yet.'));
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
        const rawTxt: Txt = e instanceof SiteReadError ? raw : bi(raw, 'Could not read the Facebook page.');
        // Meta's permission errors are three lines of documentation links. The
        // salon cannot act on those; the agency can, and only needs one line.
        warnings.push(/permission|pages_read|Public Content Access/i.test(raw)
          ? bi(
            'Fanpage chưa cấp quyền đọc nội dung cho ứng dụng — cần duyệt quyền pages_read_engagement bên Meta. Đã bỏ qua fanpage và dùng các nguồn còn lại.',
            'The Facebook page has not granted content-read access to the app — the pages_read_engagement permission needs approving on Meta. Skipped the page and used the other sources.')
          : rawTxt);
      }
    } else {
      warnings.push(bi('Chưa kết nối Facebook Page.', 'No Facebook Page connected.'));
    }

    // The salon's own service list, which is a fact rather than a claim.
    const services = await this.prisma.service.findMany({
      where: { tenantId, isActive: true }, select: { name: true, description: true }, take: 40,
    }).catch(() => []) as { name: string; description: string | null }[];
    if (services.length) {
      chunks.push(`--- Dịch vụ đã khai trong hệ thống ---\n${services.map((s) => `${s.name}${s.description ? `: ${s.description}` : ''}`).join('\n')}`);
      sources.push(bi(
        `${services.length} dịch vụ trong hệ thống`,
        `${services.length} services in the system`));
    }

    if (!chunks.length) {
      return {
        draft: {}, sources, saved: false, locationSaved: null,
        warnings: [...warnings, bi(
          'Không có nguồn nào đọc được — thêm website vào cài đặt tiệm rồi quét lại.',
          'Nothing could be read — add a website in the salon settings and scan again.')],
      };
    }

    const key = process.env.ANTHROPIC_API_KEY || '';
    if (!key) {
      return {
        draft: {}, sources, saved: false, locationSaved: null,
        warnings: [...warnings, bi(
          'Chưa cấu hình AI trên bản này nên chưa tự đọc được.',
          'AI is not configured on this deployment, so nothing could be read automatically.')],
      };
    }

    const system = `Bạn đọc tài liệu của một doanh nghiệp và điền một hồ sơ ngắn về chính doanh nghiệp đó.

LUẬT:
1. CHỈ dùng những gì có trong tài liệu. Không suy đoán, không thêm thắt cho đầy đủ.
2. Ô nào tài liệu không nói tới thì để CHUỖI RỖNG. Một ô trống trung thực có ích hơn một câu nghe hợp lý mà sai.
3. Phân biệt DOANH NGHIỆP NÀY với KHÁCH HÀNG CỦA HỌ. Một công ty marketing phục vụ tiệm nail KHÔNG PHẢI là tiệm nail — đây là nhầm lẫn nguy hiểm nhất, hãy đọc kỹ.
4. "whoWeServe" chỉ điền khi tài liệu nói rõ họ phục vụ ai. Không suy ra từ ngôn ngữ trang web hay từ tên.
5. Viết tiếng Việt, ngắn gọn, mỗi ô 1-2 câu.
6. "trade" = ngành CHÍNH của doanh nghiệp này, chọn ĐÚNG MỘT mã trong danh sách: ${knownTrades().join(' | ')}. NAIL/HAIR/LASH/BROW/SPA/MASSAGE/PMU là các ngành làm đẹp; RESTAURANT = quán ăn, nhà hàng, cà phê, tiệm bánh; REAL_ESTATE = bất động sản, môi giới nhà đất; SERVICE = dịch vụ tại nhà/sửa chữa/vệ sinh/lắp đặt và mọi ngành bán hàng hoặc dịch vụ khác. Không chắc thì để CHUỖI RỖNG — tuyệt đối không đoán là làm đẹp chỉ vì phần mềm này hay dùng cho tiệm nail.

TRẢ VỀ JSON THUẦN:
{"trade":"...","whatWeDo":"...","whoWeServe":"...","languages":"...","serviceArea":"...","edge":"...","avoid":""}`;

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
      return {
        draft: {}, sources, saved: false, locationSaved: null,
        warnings: [...warnings, bi(
          'Đọc được nội dung nhưng AI chưa phân tích được. Thử lại sau ít phút.',
          'The sources were read but the AI could not analyse them. Try again in a few minutes.')],
      };
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
      warnings.push(bi(
        'Đọc được nguồn nhưng chưa rút ra được mô tả rõ ràng — kiểm tra lại và sửa tay.',
        'The sources were read but no clear description came out of them — check and write it by hand.'));
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
    // The trade, from what the business says it is. Every restaurant, agency
    // and repair shop that signed up sat on the salon default and got nail
    // trends, a nail plan and nail captions until somebody noticed. The scan
    // now fills the trade from two witnesses (the model's reading of the
    // sources, the keyword detector) — and only into a slot no person has
    // set; see pickTrade.
    {
      const tenantRow = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true, businessType: true } })
        .catch(() => null) as unknown as { name?: string | null; businessType?: string | null } | null;
      const detection = detectIndustry({
        declaredWhatWeDo: draft.whatWeDo,
        serviceNames: services.map((x) => x.name),
        tenantName: tenantRow?.name ?? null,
        website: website || null,
        currentIndustry: String(cur?.trade || tenantRow?.businessType || 'SALON'),
      });
      const picked = pickTrade({
        modelTrade: typeof parsed.trade === 'string' ? parsed.trade : '',
        detection,
        manual: cur?.tradeSource === 'manual',
        known: knownTrades(),
      });
      if (picked && picked !== (cur?.trade || '')) {
        merged.trade = picked;
        merged.tradeSource = 'auto';
        sources.push(bi(`Ngành: ${viOf(playbookFor(picked).trade)} (tự nhận từ mô tả)`, `Trade: ${enOf(playbookFor(picked).trade)} (read from the description)`));
      } else if (cur?.tradeSource) {
        merged.tradeSource = cur.tradeSource;
      }
    }
    const row = await this.prisma.setting.findFirst({ where: { tenantId, key: 'business_profile' }, select: { id: true } }).catch(() => null);
    if (row?.id) await this.prisma.setting.update({ where: { id: row.id }, data: { value: merged as never } }).catch(() => undefined);
    else await this.prisma.setting.create({ data: { tenantId, key: 'business_profile', value: merged as never } }).catch(() => undefined);

    // A business outside the built-in trades gets a playbook of its own,
    // written from the description just saved. Same scan, one more call.
    const tp = await this.ensureTradeProfile(tenantId).catch(() => null);
    if (tp) sources.push(bi(`Sổ tay nội dung riêng cho ${tp.trade.vi}`, `A content playbook of its own: ${tp.trade.en}`));

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
      const found = resolveShopLocation({
        market: t.market,
        tenantCity: t.city, tenantPostal: t.postalCode,
        address: String(((extra?.value ?? {}) as { address?: string }).address ?? ''),
        serviceArea: merged.serviceArea,
      });
      if (found.region) {
        await this.prisma.tenant.update({
          where: { id: tenantId },
          data: {
            city: t.city || found.city || null,
            region: found.region,
            postalCode: t.postalCode || found.postalCode || null,
          } as never,
        }).catch(() => undefined);
        locationSaved = [found.city, found.region].filter(Boolean).join(', ');
      }
    }

    return { draft: merged, sources, warnings, saved: true, locationSaved };
  }

  /** The salon marks progress: filmed, posted, or honestly skipped. */
  async setIdeaStatus(user: AuthenticatedUser, id: string, status: string, resultNote?: string, postedUrl?: string) {
    const tenantId = this.tenantId(user);
    const ALLOWED = ['published', 'filmed', 'posted', 'skipped'];
    if (!ALLOWED.includes(status)) throw new BadRequestException('Trạng thái không hợp lệ');
    const done = status === 'posted' || status === 'filmed';
    const r = await this.prisma.contentIdea.updateMany({
      where: { id, tenantId },
      data: {
        status,
        doneAt: done ? new Date() : null,
        ...(resultNote ? { resultNote: resultNote.slice(0, 500) } : {}),
        // The link is what turns "đã đăng" from a checkbox into something
        // anybody can open. Only https, because a checkbox that stores
        // "facebook" helps nobody find the post six weeks later.
        ...(postedUrl && /^https:\/\/\S+$/.test(postedUrl.trim())
          ? { postedUrl: postedUrl.trim().slice(0, 600) }
          : {}),
      } as never,
    });
    if (!r.count) throw new NotFoundException('Không tìm thấy ý tưởng');
    return { ok: true, status };
  }
}

/** The audit trail on the stored offer: who set it, when. Not user input. */
function pickMeta(v: unknown): { updatedAt?: string; updatedBy?: string | null } {
  const r = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  return {
    ...(typeof r.updatedAt === 'string' ? { updatedAt: r.updatedAt } : {}),
    ...(typeof r.updatedBy === 'string' ? { updatedBy: r.updatedBy } : {}),
  };
}

/** '$' / '₫' / 'C$' — what the caption prints in front of an amount. */
function currencySign(code: string | null | undefined): string {
  const c = String(code ?? 'USD').toUpperCase();
  return c === 'VND' ? '₫' : c === 'CAD' ? 'C$' : c === 'AUD' ? 'A$' : c === 'EUR' ? '€' : c === 'GBP' ? '£' : '$';
}
