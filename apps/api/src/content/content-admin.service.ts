import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthenticatedUser } from '../common/tenant/tenant-context';

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
    const data: Record<string, unknown> = {};
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
