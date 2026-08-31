import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthenticatedUser } from '../common/tenant/tenant-context';
import { STARTER_FORMATS } from './starter-formats';
import { detectIndustry, configGaps } from './industry-detect';

/**
 * The Lumio team's side of the content engine.
 *
 * Two jobs live here, and both are deliberately human:
 *
 *  - the FORMAT LIBRARY and the week's TREND NOTES. No API sells "what is
 *    trending for nail salons in Orange County this week"; a person watching
 *    the feeds for half an hour does. One edit here reaches every salon in
 *    that trade the next morning, which is the leverage that makes an agency
 *    an agency instead of a freelancer with more clients.
 *
 *  - the REVIEW QUEUE. Drafts never reach a salon unread. The agency sells
 *    judgement; shipping an unreviewed model output turns it into a pipe, and
 *    one embarrassing suggestion in a client's feed costs more than a week of
 *    reviewing takes.
 */
@Injectable()
export class ContentAdminService {
  constructor(private readonly prisma: PrismaService) {}

  // ---- format library -----------------------------------------------------

  async listFormats(industry?: string) {
    return this.prisma.contentFormat.findMany({
      where: industry ? { industry } : {},
      orderBy: [{ active: 'desc' }, { heat: 'asc' }, { updatedAt: 'desc' }],
      take: 200,
    });
  }

  async saveFormat(dto: {
    id?: string; industry: string; niche?: string | null; name: string; summary: string;
    hookGuide?: string | null; shotList?: string | null; lengthSec?: number | null;
    audience?: string | null; heat?: string; active?: boolean; tags?: string[]; notes?: string | null;
  }) {
    const HEAT = ['hot', 'steady', 'cold'];
    if (!dto.name?.trim() || !dto.summary?.trim()) throw new BadRequestException('Cần tên và mô tả ngắn cho định dạng');
    if (dto.heat && !HEAT.includes(dto.heat)) throw new BadRequestException('heat phải là hot | steady | cold');
    const data = {
      industry: (dto.industry || 'SALON').toUpperCase(),
      niche: dto.niche?.trim() || null,
      name: dto.name.trim().slice(0, 120),
      summary: dto.summary.trim().slice(0, 500),
      hookGuide: dto.hookGuide?.trim().slice(0, 500) || null,
      shotList: dto.shotList?.trim().slice(0, 800) || null,
      lengthSec: dto.lengthSec ?? null,
      audience: dto.audience?.trim().slice(0, 200) || null,
      heat: dto.heat ?? 'steady',
      active: dto.active ?? true,
      tags: (dto.tags ?? []) as never,
      notes: dto.notes?.trim().slice(0, 1000) || null,
    };
    if (dto.id) {
      const r = await this.prisma.contentFormat.updateMany({ where: { id: dto.id }, data });
      if (!r.count) throw new NotFoundException('Không tìm thấy định dạng');
      return { ok: true, id: dto.id };
    }
    const created = await this.prisma.contentFormat.create({ data });
    return { ok: true, id: created.id };
  }

  /**
   * Fill an empty library with the formats that reliably work in this trade.
   * Skips anything already present by name, so pressing it twice is harmless
   * and it never overwrites a format the team has tuned.
   */
  async seedFormats(industry = 'SALON') {
    const IND = industry.toUpperCase();
    const seeds = STARTER_FORMATS[IND];
    if (!seeds?.length) {
      throw new BadRequestException(`Chưa có bộ mẫu cho ngành ${IND}. Các ngành đang có: ${Object.keys(STARTER_FORMATS).join(', ')}`);
    }
    const existing = await this.prisma.contentFormat.findMany({ where: { industry: IND }, select: { name: true } });
    const have = new Set(existing.map((e: { name: string }) => e.name.trim().toLowerCase()));
    let added = 0;
    for (const f of seeds) {
      if (have.has(f.name.toLowerCase())) continue;
      await this.prisma.contentFormat.create({
        data: {
          industry: IND, niche: IND === 'SALON' ? 'nail' : null, name: f.name, summary: f.summary,
          hookGuide: f.hookGuide, shotList: f.shotList, lengthSec: f.lengthSec,
          audience: f.audience, heat: f.heat, active: true, tags: f.tags as never,
        },
      }).catch(() => undefined);
      added += 1;
    }
    return { added, skipped: seeds.length - added };
  }

  /**
   * Read every tenant's own data and report what its setup is missing.
   *
   * This exists because the alternative was asking one person to remember to
   * set an industry, a state, a commission rate and a format library for every
   * client, by hand, forever — and the cost of forgetting is invisible: the
   * screen still fills with plausible advice, it is just advice for the wrong
   * trade. A scan turns a silent misconfiguration into a list.
   *
   * It only ever proposes. Writing businessType would change what the AI
   * hotline says to that client's real customers, and a confident wrong guess
   * applied across a hundred tenants is an efficient way to embarrass a hundred
   * clients at once.
   */
  async scanTenants() {
    type Row = {
      id: string; name: string; businessType: string; region: string | null;
      postalCode: string | null; commissionPct: number | null;
      services: { name: string }[];
    };
    const tenants = await this.prisma.tenant.findMany({
      where: { status: 'ACTIVE', deletedAt: null } as never,
      select: {
        id: true, name: true, businessType: true, region: true, postalCode: true, commissionPct: true,
        services: { where: { isActive: true }, select: { name: true }, take: 40 },
      } as never,
      orderBy: { name: 'asc' },
      take: 500,
    }).catch(() => []) as unknown as Row[];

    // Counted separately, and through a deliberately loose handle.
    //
    // menuItem and restaurantTable exist on the deploy machine's Prisma client
    // and not on the one this was written against, so a typed access compiles
    // in exactly one of the two places. Reaching for them by name keeps the
    // build honest on both, and `groupBy` results are annotated by hand rather
    // than inferred — inference through a stale client silently degrades to
    // `{}`, and `{}` flows into a Map and out again as a runtime surprise.
    type CountRow = { tenantId: string; _count: { _all: number } };
    type IndustryRow = { industry: string; _count: { _all: number } };
    const loose = this.prisma as unknown as Record<string, { groupBy: (a: unknown) => Promise<unknown> }>;
    const groupCount = async (model: string): Promise<CountRow[]> => {
      const r = await loose[model]?.groupBy({ by: ['tenantId'], _count: { _all: true } }).catch(() => []);
      return Array.isArray(r) ? (r as CountRow[]) : [];
    };

    const [menuCounts, tableCounts, formatCounts, extras] = await Promise.all([
      groupCount('menuItem'),
      groupCount('restaurantTable'),
      (async (): Promise<IndustryRow[]> => {
        const r = await loose.contentFormat?.groupBy({ by: ['industry'], where: { active: true }, _count: { _all: true } }).catch(() => []);
        return Array.isArray(r) ? (r as IndustryRow[]) : [];
      })(),
      this.prisma.setting.findMany({ where: { key: 'company_extra' }, select: { tenantId: true, value: true } })
        .catch(() => []) as Promise<{ tenantId: string; value: unknown }[]>,
    ]);
    const menuBy = new Map<string, number>(menuCounts.map((m) => [m.tenantId, m._count?._all ?? 0]));
    const tableBy = new Map<string, number>(tableCounts.map((m) => [m.tenantId, m._count?._all ?? 0]));
    const formatBy = new Map<string, number>(formatCounts.map((m) => [m.industry, m._count?._all ?? 0]));
    const siteBy = new Map<string, string>(
      extras.map((e) => [e.tenantId, String((e.value as { website?: string } | null)?.website ?? '')]),
    );

    const rows = tenants.map((t) => {
      const detection = detectIndustry({
        tenantName: t.name,
        serviceNames: t.services?.map((s) => s.name) ?? [],
        menuItemCount: menuBy.get(t.id) ?? 0,
        tableCount: tableBy.get(t.id) ?? 0,
        website: siteBy.get(t.id) ?? null,
        currentIndustry: t.businessType,
      });
      return {
        tenantId: t.id,
        name: t.name,
        current: t.businessType,
        detection,
        gaps: configGaps({
          detection,
          region: t.region,
          commissionPct: t.commissionPct,
          postalCode: t.postalCode,
          formatCount: formatBy.get(t.businessType) ?? 0,
        }),
      };
    });

    return {
      scanned: rows.length,
      needsAttention: rows.filter((r) => r.gaps.some((g) => g.severity === 'blocking')).length,
      wrongIndustry: rows.filter((r) => r.gaps.some((g) => g.key === 'industry')).length,
      rows,
    };
  }

  /**
   * Apply a detected industry to one tenant.
   *
   * One at a time, on purpose. There is no "apply all" here: the point of the
   * scan is that a person looks at the evidence and agrees, and a bulk button
   * would quietly turn that into a rubber stamp.
   */
  async applyIndustry(tenantId: string, industry: string) {
    const IND = String(industry ?? '').toUpperCase();
    if (!['SALON', 'RESTAURANT', 'REAL_ESTATE', 'SERVICE'].includes(IND)) {
      throw new BadRequestException('Ngành không hợp lệ');
    }
    const r = await this.prisma.tenant.updateMany({ where: { id: tenantId }, data: { businessType: IND } as never });
    if (!r.count) throw new NotFoundException('Không tìm thấy tiệm');
    // Seed that trade's library at the same time: switching industry into an
    // empty library swaps one broken state for another.
    const seeded = await this.seedFormats(IND).catch(() => ({ added: 0, skipped: 0 }));
    return { ok: true, industry: IND, formatsAdded: seeded.added };
  }

  async deleteFormat(id: string) {
    // Soft: ideas reference formats, and history should not lose its label.
    await this.prisma.contentFormat.updateMany({ where: { id }, data: { active: false } });
    return { ok: true };
  }

  // ---- weekly trend notes -------------------------------------------------

  async listNotes(industry?: string) {
    return this.prisma.trendNote.findMany({
      where: industry ? { industry } : {},
      orderBy: [{ active: 'desc' }, { createdAt: 'desc' }],
      take: 50,
    });
  }

  async saveNote(user: AuthenticatedUser, dto: {
    id?: string; industry: string; niche?: string | null; region?: string | null;
    title: string; body: string; days?: number; active?: boolean;
  }) {
    if (!dto.title?.trim() || !dto.body?.trim()) throw new BadRequestException('Cần tiêu đề và nội dung');
    // Trends rot. A note with no end date silently becomes stale advice that
    // still looks authoritative, so everything expires — two weeks by default.
    const days = Math.min(60, Math.max(1, dto.days ?? 14));
    const data = {
      industry: (dto.industry || 'SALON').toUpperCase(),
      niche: dto.niche?.trim() || null,
      region: dto.region?.trim() || null,
      title: dto.title.trim().slice(0, 200),
      body: dto.body.trim().slice(0, 1500),
      expiresAt: new Date(Date.now() + days * 86_400_000),
      active: dto.active ?? true,
      createdByUserId: user.userId ?? null,
    };
    if (dto.id) {
      const r = await this.prisma.trendNote.updateMany({ where: { id: dto.id }, data });
      if (!r.count) throw new NotFoundException('Không tìm thấy ghi chú');
      return { ok: true, id: dto.id };
    }
    const created = await this.prisma.trendNote.create({ data });
    return { ok: true, id: created.id };
  }

  async deleteNote(id: string) {
    await this.prisma.trendNote.updateMany({ where: { id }, data: { active: false } });
    return { ok: true };
  }

  // ---- review queue -------------------------------------------------------

  /** Every salon's drafts for a day, grouped so the team can sweep in minutes. */
  async queue(date?: string) {
    const where: { status: string; forDate?: string } = { status: 'draft', ...(date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? { forDate: date } : {}) };
    const rows = await this.prisma.contentIdea.findMany({
      where,
      orderBy: [{ forDate: 'desc' }, { rank: 'asc' }],
      take: 300,
      include: { tenant: { select: { id: true, name: true } } },
    });
    type Group = { tenantId: string; tenantName: string; forDate: string; ideas: Record<string, unknown>[] };
    const byTenant = new Map<string, Group>();
    for (const r of rows as unknown as Record<string, unknown>[]) {
      const key = `${String(r.tenantId)}|${String(r.forDate)}`;
      const tenantName = ((r.tenant as { name?: string } | null)?.name) ?? '—';
      const g: Group = byTenant.get(key) ?? { tenantId: String(r.tenantId), tenantName, forDate: String(r.forDate), ideas: [] };
      g.ideas.push(r);
      byTenant.set(key, g);
    }
    return { groups: Array.from(byTenant.values()) };
  }

  /** Edit a draft before it goes out — the team's judgement, not the model's. */
  async editIdea(id: string, dto: Partial<{ title: string; hook: string; shotList: string; caption: string; hashtags: string; bestTime: string; reason: string }>) {
    // Named keys rather than Record<string, unknown>. Both compile — the older
    // services use the loose form — but this one cannot silently grow a typo'd
    // key that writes nothing and reports success.
    const data: Partial<Record<'title' | 'hook' | 'shotList' | 'caption' | 'hashtags' | 'bestTime' | 'reason', string>> = {};
    for (const k of ['title', 'hook', 'shotList', 'caption', 'hashtags', 'bestTime', 'reason'] as const) {
      const v = dto[k];
      if (typeof v === 'string') data[k] = v.slice(0, 1200);
    }
    if (!Object.keys(data).length) throw new BadRequestException('Không có gì để sửa');
    const r = await this.prisma.contentIdea.updateMany({ where: { id }, data });
    if (!r.count) throw new NotFoundException('Không tìm thấy ý tưởng');
    return { ok: true };
  }

  /** Release to salons. Ids for a picky day, or a whole date in one press. */
  async publish(dto: { ids?: string[]; forDate?: string; tenantId?: string }) {
    const where: Record<string, unknown> = { status: 'draft' };
    if (dto.ids?.length) where.id = { in: dto.ids.slice(0, 300) };
    else if (dto.forDate) {
      where.forDate = dto.forDate;
      if (dto.tenantId) where.tenantId = dto.tenantId;
    } else throw new BadRequestException('Cần ids hoặc forDate');
    const r = await this.prisma.contentIdea.updateMany({ where: where as never, data: { status: 'published', publishedAt: new Date() } as never });
    return { published: r.count };
  }

  async discard(ids: string[]) {
    if (!ids?.length) throw new BadRequestException('Cần ids');
    const r = await this.prisma.contentIdea.deleteMany({ where: { id: { in: ids.slice(0, 300) }, status: 'draft' } });
    return { removed: r.count };
  }
}
