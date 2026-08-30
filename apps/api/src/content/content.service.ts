import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { AuthenticatedUser, resolveTenantScope } from '../common/tenant/tenant-context';
import { formatMoneyShort, localeForCountry } from '../common/money';
import { buildSignalProfile, signalsToPrompt, SignalProfile } from './content-signals';
import { buildRevenueProfile, revenueToPrompt, RevenueProfile } from './revenue-signals';
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
    signals: SignalProfile;
    revenue: RevenueProfile;
    money: (c: number) => string;
  }> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { name: true, timezone: true, businessType: true },
    });
    const tz = tenant?.timezone || 'America/Los_Angeles';
    const extra = await this.prisma.setting.findFirst({ where: { tenantId, key: 'company_extra' }, select: { value: true } }).catch(() => null);
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

    return {
      tenantName: tenant?.name || 'Tiệm',
      industry: String((tenant as { businessType?: string } | null)?.businessType ?? 'SALON'),
      city: String(ex.address ?? '').split(',').slice(-2).join(',').trim(),
      tz,
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
      revenue: buildRevenueProfile({ bookings: bookingRows, customers, services }),
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

TRẢ VỀ JSON THUẦN, không markdown, không lời dẫn:
{"ideas":[{"rank":1,"formatName":"...","title":"...","hook":"...","shotList":"cảnh 1 · cảnh 2 · cảnh 3","caption":"...","hashtags":"#... #...","bestTime":"18:30","reason":"..."}]}`;

    const userMsg = [
      signalsToPrompt(ctx.signals),
      '',
      revenueToPrompt(ctx.revenue, ctx.money),
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
      const match = formats.find((f) => f.name.toLowerCase() === String(idea.formatName ?? '').toLowerCase());
      await this.prisma.contentIdea.create({
        data: {
          tenantId, forDate, status: 'draft',
          rank: Number(idea.rank) || created + 1,
          formatId: match?.id ?? null,
          formatName: idea.formatName ?? match?.name ?? null,
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

  /** Draft for every active salon of an industry — the scheduler's entry point. */
  async generateAll(industry = 'SALON'): Promise<{ tenants: number; created: number }> {
    const tenants = await this.prisma.tenant.findMany({
      where: { status: 'ACTIVE', deletedAt: null, businessType: industry } as never,
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
    return {
      events: ctx.signals.events,
      offer: ctx.revenue.advice,
      lapsed: ctx.revenue.lapsed,
      quietSlots: ctx.revenue.loads.slice(0, 3),
      busySlots: [...ctx.revenue.loads].reverse().slice(0, 3),
      topYields: ctx.revenue.yields.slice(0, 3),
      thin: ctx.signals.thin,
    };
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
