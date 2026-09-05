import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthenticatedUser } from '../common/tenant/tenant-context';
import { clientSuggestion, mediaOf, suggestionStatus, type SuggestionRow } from './client-view';

/**
 * One trend, picked by a person, handed to one salon.
 *
 * WHY THIS EXISTS RATHER THAN JUST SHOWING THE SALON THE TREND BOARD
 *
 * The trend board is the method: which hashtag feeds get read, which product
 * rankings, in what order. Handing a salon the board hands it to whoever the
 * owner shares their password with, and the agency's only durable advantage is
 * gone. So the board stays on the team's side and a staff member carries ONE
 * thing across: "film this, this week". The salon gets an instruction it can
 * act on and nothing it could hand to a competitor.
 *
 * WHY IT CLOSES THE LOOP
 *
 * The suggestion is not a message; it is a small piece of work with a state.
 * The salon films it and sends the file back on the same card, which is the
 * whole point — the material arrives attached to the thing that asked for it,
 * rather than as an unlabelled video in a group chat at eleven at night.
 */
@Injectable()
export class SuggestionsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Loose access: the model exists on the deploy, not in the local client. */
  private get table() {
    return (this.prisma as unknown as Record<string, {
      findMany: (a: unknown) => Promise<unknown>;
      findFirst: (a: unknown) => Promise<unknown>;
      create: (a: unknown) => Promise<unknown>;
      update: (a: unknown) => Promise<unknown>;
    }>).contentSuggestion;
  }

  private tenantId(user: AuthenticatedUser): string {
    const id = user?.tenantId;
    if (!id) throw new BadRequestException('Thiếu tenant.');
    return id;
  }

  private isTeam(user: AuthenticatedUser): boolean {
    return user.role === UserRole.SUPER_ADMIN || Boolean(user.supportSession);
  }

  /**
   * The team hands one over.
   *
   * Team-side only. A salon that could write its own suggestions would be
   * writing into the queue its own staff are measured by, and the point of the
   * card is that somebody at Lumio chose it.
   */
  async create(user: AuthenticatedUser, dto: { title?: string; note?: string; sourceUrl?: string; sourceLabel?: string }) {
    if (!this.isTeam(user)) throw new ForbiddenException('Chỉ team Lumio gửi đề xuất cho tiệm.');
    const tenantId = this.tenantId(user);
    const title = String(dto?.title ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
    if (!title) throw new BadRequestException('Đề xuất chưa có nội dung.');
    const row = await this.table?.create({
      data: {
        tenantId,
        title,
        note: String(dto?.note ?? '').trim().slice(0, 1000) || null,
        // Kept for the team's own reading, never rendered on the salon's side.
        sourceUrl: String(dto?.sourceUrl ?? '').trim().slice(0, 500) || null,
        sourceLabel: String(dto?.sourceLabel ?? '').trim().slice(0, 120) || null,
        createdByName: user.email ?? 'Lumio',
        status: 'sent',
      },
    }).catch(() => null) as SuggestionRow | null;
    if (!row) throw new BadRequestException('Chưa gửi được, thử lại giúp em.');
    return { ok: true, id: row.id };
  }

  /** The team's view: everything, including where it came from. */
  async listForTeam(user: AuthenticatedUser) {
    if (!this.isTeam(user)) throw new ForbiddenException('Chỉ team Lumio xem được mục này.');
    const rows = await this.rows(this.tenantId(user));
    return { suggestions: rows };
  }

  /**
   * The salon's view: rebuilt by `clientSuggestion`, never filtered.
   *
   * Open sent ones first, then the recent history, so the card at the top is
   * always the one waiting on the shop.
   */
  async listForSalon(user: AuthenticatedUser) {
    const rows = await this.rows(this.tenantId(user));
    const open = rows.filter((r) => suggestionStatus(r.status) === 'sent');
    const past = rows.filter((r) => suggestionStatus(r.status) !== 'sent').slice(0, 6);
    return {
      open: open.map(clientSuggestion),
      past: past.map(clientSuggestion),
      waiting: open.length,
    };
  }

  /**
   * Is anybody actually running this salon's marketing?
   *
   * The client screen ships open for every salon (see feature-policy), which is
   * only defensible because it is empty until the agency puts something on it.
   * The week plan is the exception: it is generated for every tenant whether or
   * not anyone is working on it, so showing it unconditionally would hand
   * marketing homework to a shop that bought a booking system and nothing else.
   *
   * Evidence, not a setting: one suggestion sent, or one post scheduled. Both
   * are things only the team creates, so the answer is true exactly when
   * somebody is doing the work.
   */
  async hasAgencyWork(user: AuthenticatedUser): Promise<boolean> {
    const tenantId = this.tenantId(user);
    const loose = this.prisma as unknown as Record<string, {
      findFirst: (a: unknown) => Promise<unknown>;
    }>;
    const [sug, post] = await Promise.all([
      loose.contentSuggestion?.findFirst({ where: { tenantId }, select: { id: true } }).catch(() => null),
      loose.scheduledPost?.findFirst({ where: { tenantId }, select: { id: true } }).catch(() => null),
    ]);
    return Boolean(sug || post);
  }

  private async rows(tenantId: string): Promise<SuggestionRow[]> {
    return (await this.table?.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: 40,
    }).catch(() => [])) as SuggestionRow[] ?? [];
  }

  /**
   * The salon says it filmed the thing, and sends what it filmed.
   *
   * Either side may mark it done: the shop when it uploads, the team when the
   * shop sent the file some other way. What must not happen is a card that
   * sits open because the only person who can close it is the one who has
   * already moved on.
   */
  async markDone(user: AuthenticatedUser, id: string, media: unknown) {
    const tenantId = this.tenantId(user);
    const row = await this.table?.findFirst({ where: { id, tenantId }, select: { id: true, media: true } })
      .catch(() => null) as { id: string; media: unknown } | null;
    if (!row) throw new NotFoundException('Không tìm thấy đề xuất này.');
    // Files ADD to whatever is already there: a shop that sends one clip now
    // and two photos this afternoon has sent three files, not two.
    const merged = [...mediaOf(row.media), ...mediaOf(media)].slice(0, 12);
    await this.table?.update({
      where: { id: row.id },
      data: { status: 'done', doneAt: new Date(), media: merged as never, skipReason: null },
    }).catch(() => undefined);
    return { ok: true, id: row.id, media: merged };
  }

  /** The salon says it does not fit. The reason is the useful half. */
  async skip(user: AuthenticatedUser, id: string, reason: unknown) {
    const tenantId = this.tenantId(user);
    const row = await this.table?.findFirst({ where: { id, tenantId }, select: { id: true } })
      .catch(() => null) as { id: string } | null;
    if (!row) throw new NotFoundException('Không tìm thấy đề xuất này.');
    await this.table?.update({
      where: { id: row.id },
      data: { status: 'skipped', skipReason: String(reason ?? '').trim().slice(0, 500) || null, doneAt: null },
    }).catch(() => undefined);
    return { ok: true, id: row.id };
  }

  /**
   * Put a closed card back in front of the shop. Team side only.
   *
   * `updateMany` with the tenant in the WHERE, not `update` by id: an id alone
   * selecting a row is the shape every cross-tenant bug in this codebase has
   * had, and it is worth the extra word every time.
   */
  async reopen(user: AuthenticatedUser, id: string) {
    if (!this.isTeam(user)) throw new ForbiddenException('Chỉ team Lumio mở lại được.');
    const tenantId = this.tenantId(user);
    const r = await (this.prisma as unknown as Record<string, {
      updateMany: (a: unknown) => Promise<{ count: number }>;
    }>).contentSuggestion?.updateMany({
      where: { id, tenantId },
      data: { status: 'sent', doneAt: null, skipReason: null },
    }).catch(() => ({ count: 0 }));
    if (!r || r.count === 0) throw new NotFoundException('Không tìm thấy đề xuất này.');
    return { ok: true, id };
  }
}
